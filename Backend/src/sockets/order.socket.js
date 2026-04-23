import { Order }    from '../models/Order.js';
import { Delivery } from '../models/Delivery.js';
import { DeliveryAgent } from '../models/DeliveryAgent.js';
import { DeliveryService } from '../services/delivery.service.js';
import logger       from '../utils/logger.js';

export const registerOrderEvents = (socket) => {

  // ── Customer subscribes to live updates for their order ───────────────────
  // Client emits this after placing an order or opening order detail page
  socket.on('order:subscribe', async ({ orderId }) => {
    try {
      if (!orderId) return socket.emit('error', { message: 'orderId required' });

      // Verify this order belongs to the user (or agent/vendor/admin can also subscribe)
      const order = await Order.findById(orderId)
        .select('customer items status')
        .lean();

      if (!order) return socket.emit('error', { message: 'Order not found' });

      const isCustomer = order.customer.toString() === socket.userId;
      const isVendor   = order.items.some((i) => i.vendor?.toString() === socket.userId);
      const isAdmin    = socket.userRole === 'admin';
      const isAgent    = socket.userRole === 'agent';

      if (!isCustomer && !isVendor && !isAdmin && !isAgent) {
        return socket.emit('error', { message: 'Access denied' });
      }

      socket.join(`order:${orderId}`);
      logger.info(`User ${socket.userId} subscribed to order:${orderId}`);

      // Send current order status immediately on subscribe
      socket.emit('order:status', {
        orderId,
        status:    order.status,
        timestamp: new Date(),
      });

      // If delivery is active, also send current agent location
      if (['out_for_delivery'].includes(order.status)) {
        const delivery = await Delivery.findOne({ order: orderId, status: { $in: ['accepted', 'picked_up'] } })
          .populate('agent', 'user')
          .lean();

        if (delivery?.agent) {
          const loc = await DeliveryService.getAgentLocation(delivery.agent.user);
          if (loc) {
            socket.emit('agent:location', { ...loc, orderId, timestamp: new Date() });
          }
        }
      }
    } catch (err) {
      logger.error('order:subscribe error:', err.message);
      socket.emit('error', { message: 'Failed to subscribe to order' });
    }
  });

  // ── Unsubscribe from order room ───────────────────────────────────────────
  socket.on('order:unsubscribe', ({ orderId }) => {
    socket.leave(`order:${orderId}`);
    logger.info(`User ${socket.userId} unsubscribed from order:${orderId}`);
  });

  // ── Agent subscribes to their delivery assignment room ────────────────────
  socket.on('agent:subscribe_delivery', async ({ orderId }) => {
    if (socket.userRole !== 'agent') {
      return socket.emit('error', { message: 'Only agents can subscribe to delivery rooms' });
    }

    const agentDoc = await DeliveryAgent.findOne({ user: socket.userId })
      .select('activeDelivery')
      .lean();

    if (agentDoc?.activeDelivery?.toString() === orderId) {
      socket.join(`order:${orderId}`);
      logger.info(`Agent ${socket.userId} joined delivery room for order:${orderId}`);
    }
  });
};