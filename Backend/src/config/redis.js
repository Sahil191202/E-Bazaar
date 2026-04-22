import { createClient } from 'redis';
import logger from '../utils/logger.js';

let redisClient;

export const connectRedis = async () => {
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 2000) },
  });

  redisClient.on('error', (err) => logger.error('Redis error:', err));
  redisClient.on('connect', () => logger.info('✅ Redis connected'));

  await redisClient.connect();
  return redisClient;
};

export const getRedis = () => redisClient;

// Helper wrappers
export const setCache = async (key, value, ttlSeconds = 3600) => {
  await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
};

export const getCache = async (key) => {
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
};

export const delCache = async (key) => redisClient.del(key);

export const delCachePattern = async (pattern) => {
  const keys = await redisClient.keys(pattern);
  if (keys.length) await redisClient.del(keys);
};