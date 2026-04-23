import { Delivery }      from '../models/Delivery.js';
import { DeliveryAgent } from '../models/DeliveryAgent.js';
import { getRedis }      from '../config/redis.js';
import { getIO }         from './index.js';
import { FCMService }    from '../services/fcm.service.js';
import { isUserOnline } from '../utils/onlineStatus.js';
import logger            from '../utils/logger.js';

// Chat messages stored in Redis (short-lived — active delivery only)
// Key: chat:{orderId} → List of messages
const CHAT_TTL = 24 * 60 * 60; // 24 hours

export const registerChatEvents = (socket) => {

  // ── Join chat room for an active delivery ─────────────────────────────────
  socket.on('chat:join', async ({ orderId }) => {
    try {
      if (!orderId) return socket.emit('error', { message: 'orderId required' });

      // Validate: only the customer or assigned agent can join chat
      const delivery = await Delivery.findOne({
        order:  orderId,
        status: { $in: ['accepted', 'picked_up', 'in_transit'] },
      })
        .populate('agent', 'user')
        .populate('order', 'customer')
        .lean();

      if (!delivery) {
        return socket.emit('error', { message: 'No active delivery for this order' });
      }

      const isCustomer = delivery.order.customer.toString() === socket.userId;
      const isAgent    = delivery.agent.user.toString()     === socket.userId;

      if (!isCustomer && !isAgent) {
        return socket.emit('error', { message: 'Access denied to this chat' });
      }

      const chatRoom = `chat:${orderId}`;
      socket.join(chatRoom);

      // Send chat history (last 50 messages from Redis)
      const history = await getChatHistory(orderId);
      socket.emit('chat:history', { orderId, messages: history });

      logger.info(`User ${socket.userId} joined chat room for order:${orderId}`);
    } catch (err) {
      logger.error('chat:join error:', err.message);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  });

  // ── Send a chat message ───────────────────────────────────────────────────
  socket.on('chat:message', async ({ orderId, text, type = 'text' }) => {
    try {
      if (!orderId || !text?.trim()) {
        return socket.emit('error', { message: 'orderId and text are required' });
      }

      if (text.length > 500) {
        return socket.emit('error', { message: 'Message too long (max 500 chars)' });
      }

      // Validate chat access
      const delivery = await Delivery.findOne({
        order:  orderId,
        status: { $in: ['accepted', 'picked_up', 'in_transit'] },
      })
        .populate('agent', 'user')
        .populate('order', 'customer')
        .lean();

      if (!delivery) {
        return socket.emit('error', { message: 'No active delivery for this order' });
      }

      const isCustomer = delivery.order.customer.toString() === socket.userId;
      const isAgent    = delivery.agent.user.toString()     === socket.userId;

      if (!isCustomer && !isAgent) {
        return socket.emit('error', { message: 'Access denied' });
      }

      const message = {
        id:         `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        orderId,
        senderId:   socket.userId,
        senderName: socket.userName,
        senderRole: socket.userRole,
        text:       text.trim(),
        type,       // 'text' | 'location_request' | 'eta'
        sentAt:     new Date().toISOString(),
        read:       false,
      };

      // Persist to Redis
      await saveChatMessage(orderId, message);

      // Broadcast to chat room
      const chatRoom = `chat:${orderId}`;
      getIO().to(chatRoom).emit('chat:message', message);

      // If recipient is offline, send FCM push
      const recipientId = isCustomer
        ? delivery.agent.user.toString()
        : delivery.order.customer.toString();

      const recipientOnline = await isUserOnline(recipientId);
      if (!recipientOnline) {
        await FCMService.sendToUser(recipientId, {
          title:   `New message from ${socket.userName}`,
          body:    text.trim().slice(0, 100),
          data:    { type: 'chat', orderId, senderId: socket.userId },
        });
      }
    } catch (err) {
      logger.error('chat:message error:', err.message);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // ── Mark messages as read ─────────────────────────────────────────────────
  socket.on('chat:read', async ({ orderId }) => {
    try {
      const chatRoom = `chat:${orderId}`;
      // Notify the other participant that messages were read
      socket.to(chatRoom).emit('chat:read', {
        orderId,
        readBy:   socket.userId,
        readAt:   new Date().toISOString(),
      });
    } catch (err) {
      logger.error('chat:read error:', err.message);
    }
  });

  // ── Leave chat room ────────────────────────────────────────────────────────
  socket.on('chat:leave', ({ orderId }) => {
    socket.leave(`chat:${orderId}`);
    logger.info(`User ${socket.userId} left chat room for order:${orderId}`);
  });
};

// ─── Redis chat helpers ────────────────────────────────────────────────────────

const saveChatMessage = async (orderId, message) => {
  const redis  = getRedis();
  const key    = `chat:${orderId}`;
  await redis.rPush(key, JSON.stringify(message));
  await redis.lTrim(key, -100, -1);  // Keep last 100 messages only
  await redis.expire(key, CHAT_TTL);
};

const getChatHistory = async (orderId, limit = 50) => {
  const redis  = getRedis();
  const key    = `chat:${orderId}`;
  const raw    = await redis.lRange(key, -limit, -1);
  return raw.map((m) => JSON.parse(m));
};