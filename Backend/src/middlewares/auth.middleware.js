import { verifyAccessToken } from '../utils/generateToken.js';
import { User }              from '../models/User.js';
import { ApiError }          from '../utils/ApiError.js';
import { asyncHandler }      from '../utils/asyncHandler.js';
import { getCache, setCache } from '../config/redis.js';

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;

  if (!token) throw new ApiError(401, 'Authentication required');

  const decoded = verifyAccessToken(token);  // throws if invalid

  // Cache user to avoid DB hit on every request
  const cacheKey = `user:${decoded.id}`;
  let user       = await getCache(cacheKey);

  if (!user) {
    user = await User.findById(decoded.id).lean();
    if (!user) throw new ApiError(401, 'User not found');
    await setCache(cacheKey, user, 300); // 5 min cache
  }

  if (!user.isActive || user.isBanned) {
    throw new ApiError(403, 'Account is suspended');
  }

  req.user = user;
  next();
});

export const optionalAuth = async (req, res, next) => {
  try {
    await authenticate(req, res, next);
  } catch {
    next(); // token nahi hai toh bhi continue karo
  }
};