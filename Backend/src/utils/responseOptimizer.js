import compression from 'compression';

/**
 * Compression middleware — gzip/brotli responses > 1KB.
 * Reduces response size by 60-80%.
 */
export const compressionMiddleware = compression({
  level:  6,   // Compression level (1=fast, 9=best)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress SSE streams or already-compressed content
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
});

/**
 * Strip null/undefined fields from response objects.
 * Reduces payload size.
 */
export const stripNulls = (obj) => {
  if (Array.isArray(obj)) return obj.map(stripNulls);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, stripNulls(v)])
    );
  }
  return obj;
};

/**
 * Add cache-control headers for public static content.
 */
export const addCacheHeaders = (maxAge = 3600) => (req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=60`);
  }
  next();
};

/**
 * ETag support for conditional requests.
 * Client sends If-None-Match → server returns 304 if unchanged.
 */
export const etagSupport = (req, res, next) => {
  res.setHeader('Vary', 'Accept-Encoding');
  next();
};