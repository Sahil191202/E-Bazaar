import { DeliveryAgent } from '../models/DeliveryAgent.js';
import { DeliveryService } from '../services/delivery.service.js';
import { getIO }         from './index.js';
import logger            from '../utils/logger.js';

export const registerAgentEvents = (socket) => {

  // ── Agent sends location update via socket (alternative to REST) ──────────
  // Mobile apps can use this instead of POST /agents/location
  // Reduces HTTP overhead for frequent updates
  socket.on('agent:location_update', async ({ lat, lng }) => {
    try {
      if (socket.userRole !== 'agent') return;
      if (!lat || !lng) return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

      // Store in Redis
      await DeliveryService.updateAgentLocation(socket.userId, lat, lng);

      // Find active delivery and broadcast to order room
      const agent = await DeliveryAgent.findOne({ user: socket.userId })
        .select('activeDelivery')
        .lean();

      if (agent?.activeDelivery) {
        getIO()
          .to(`order:${agent.activeDelivery}`)
          .emit('agent:location', {
            lat,
            lng,
            timestamp: new Date().toISOString(),
            orderId:   agent.activeDelivery,
          });
      }
    } catch (err) {
      logger.error('agent:location_update error:', err.message);
    }
  });

  // ── Agent goes online/offline ─────────────────────────────────────────────
  socket.on('agent:status', async ({ isOnline }) => {
    try {
      if (socket.userRole !== 'agent') return;

      await DeliveryAgent.findOneAndUpdate(
        { user: socket.userId },
        { isOnline: !!isOnline }
      );

      // Broadcast to admin room
      getIO().to('role:admin').emit('agent:status_changed', {
        agentId:   socket.userId,
        isOnline:  !!isOnline,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('agent:status error:', err.message);
    }
  });

  // ── Agent requests ETA (client-side map computes, agent sends result) ──────
  socket.on('agent:eta', async ({ orderId, etaMinutes }) => {
    try {
      if (socket.userRole !== 'agent') return;
      if (!orderId || !etaMinutes) return;

      getIO().to(`order:${orderId}`).emit('agent:eta', {
        orderId,
        etaMinutes,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('agent:eta error:', err.message);
    }
  });
};