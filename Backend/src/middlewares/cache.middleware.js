import { getCache, setCache } from '../config/redis.js';
import logger                 from '../utils/logger.js';

/**
 * Route-level response caching middleware.
 *
 * Usage:
 *   router.get('/products', cacheResponse(300), productController.getProducts);
 *
 * @param {number} ttlSeconds - How long to cache the response
 * @param {Function} keyFn    - Optional custom cache key function (req) => string
 */
export const cacheResponse = (ttlSeconds = 60, keyFn = null) => async (req, res, next) => {
  // Skip cache for authenticated write operations
  if (req.method !== 'GET') return next();

  const cacheKey = keyFn
    ? keyFn(req)
    : `route:${req.originalUrl}:${req.user?._id || 'anon'}`;

  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      res.setHeader('X-Cache', 'MISS');
      if (res.statusCode < 400) {
        await setCache(cacheKey, body, ttlSeconds).catch((e) =>
          logger.error('Cache write error:', e.message)
        );
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    // Cache failure should never block the request
    logger.error('Cache middleware error:', err.message);
    next();
  }
};

/**
 * Cache invalidation helper — call after mutations.
 * Deletes all cache keys matching a pattern.
 */
export const invalidateCache = (patterns) => async (req, res, next) => {
  res.on('finish', async () => {
    if (res.statusCode < 400) {
      try {
        const { getRedis } = await import('../config/redis.js');
        const redis = getRedis();
        for (const pattern of patterns) {
          const keys = await redis.keys(pattern);
          if (keys.length) await redis.del(keys);
        }
      } catch (err) {
        logger.error('Cache invalidation error:', err.message);
      }
    }
  });
  next();
};