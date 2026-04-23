import { Server }       from 'socket.io';
import { verifyAccessToken } from '../utils/generateToken.js';
import { User }         from '../models/User.js';
import { getCache, setCache, delCache } from '../config/redis.js';
import logger           from '../utils/logger.js';
import { registerOrderEvents } from './order.socket.js';
import { registerChatEvents }  from './chat.socket.js';
import { registerAgentEvents } from './agent.socket.js';
import { setUserOnline, setUserOffline } from '../utils/onlineStatus.js';

let io;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.ALLOWED_ORIGINS?.split(','),
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    // Use polling as fallback for environments that block WebSockets
    transports:      ['websocket', 'polling'],
    pingTimeout:     60000,
    pingInterval:    25000,
    maxHttpBufferSize: 1e6, // 1MB max message size
  });

  // ── Auth middleware (runs before any connection) ──────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) return next(new Error('AUTH_REQUIRED'));

      const decoded = verifyAccessToken(token);

      // Try cache first
      let user = await getCache(`user:${decoded.id}`);
      if (!user) {
        user = await User.findById(decoded.id)
          .select('_id name role isActive isBanned')
          .lean();
      }

      if (!user || !user.isActive || user.isBanned) {
        return next(new Error('AUTH_FAILED'));
      }

      socket.userId   = user._id.toString();
      socket.userRole = user.role;
      socket.userName = user.name;

      next();
    } catch (err) {
      next(new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} | user: ${socket.userId} | role: ${socket.userRole}`);

    // ── Join personal room (for targeted notifications) ───────────────────
    socket.join(`user:${socket.userId}`);

    // ── Join role room (for broadcast notifications) ───────────────────────
    socket.join(`role:${socket.userRole}`);
    socket.join('broadcast'); // Everyone

    // ── Mark user as online in Redis ──────────────────────────────────────
    setCache(`online:${socket.userId}`, { socketId: socket.id, role: socket.userRole }, 300);

    setUserOnline(socket.userId, socket.id, socket.userRole);

    // ── Client events ─────────────────────────────────────────────────────
    registerOrderEvents(socket);
    registerChatEvents(socket);
    registerAgentEvents(socket);

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      logger.info(`Socket disconnected: ${socket.id} | user: ${socket.userId} | reason: ${reason}`);
      await delCache(`online:${socket.userId}`);
    });

    // ── Error handling ────────────────────────────────────────────────────
    socket.on('error', (err) => {
      logger.error(`Socket error for user ${socket.userId}:`, err.message);
    });
  });

  logger.info('✅ Socket.IO initialized');
  return io;
};

export const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
};

// ── Check if a user is currently online ──────────────────────────────────────
export const isUserOnline = async (userId) => {
  const data = await getCache(`online:${userId}`);
  return !!data;
};