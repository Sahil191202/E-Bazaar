// src/utils/onlineStatus.js
import { getCache, setCache, delCache } from '../config/redis.js';

export const setUserOnline  = (userId, socketId, role) =>
  setCache(`online:${userId}`, { socketId, role }, 300);

export const setUserOffline = (userId) =>
  delCache(`online:${userId}`);

export const isUserOnline   = async (userId) => {
  const data = await getCache(`online:${userId}`);
  return !!data;
};