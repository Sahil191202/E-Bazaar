import cron              from 'node-cron';
import { getRedis }      from '../config/redis.js';
import { Delivery }      from '../models/Delivery.js';
import { DeliveryAgent } from '../models/DeliveryAgent.js';
import { DeliveryService } from '../services/delivery.service.js';
import logger            from '../utils/logger.js';

// Runs every 30 seconds
export const startDeliveryTimeoutJob = () => {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const redis = getRedis();

      // Scan for timed-out delivery assignments
      const keys = await redis.keys('delivery:timeout:*');
      if (!keys.length) return;

      for (const key of keys) {
        const deliveryId = key.split(':')[2];
        const ttl        = await redis.ttl(key);

        // TTL expired (Redis auto-deletes, but check remaining)
        if (ttl <= 0) {
          const delivery = await Delivery.findById(deliveryId);
          if (!delivery || delivery.status !== 'assigned') continue;

          logger.info(`Auto-rejecting delivery ${deliveryId} — agent timeout`);

          delivery.status       = 'cancelled';
          delivery.rejectReason = 'Auto-rejected — agent did not respond in 2 minutes';
          await delivery.save();

          // Free agent
          const agent = await DeliveryAgent.findById(delivery.agent);
          if (agent) {
            await DeliveryAgent.findByIdAndUpdate(agent._id, { activeDelivery: null });

            // Try next nearest agent
            try {
              await DeliveryService.autoAssign(
                delivery.order,
                parseFloat(process.env.DEFAULT_VENDOR_LAT || '19.0760'),
                parseFloat(process.env.DEFAULT_VENDOR_LNG || '72.8777')
              );
            } catch (e) {
              logger.warn(`No agents for order ${delivery.order}: ${e.message}`);
            }
          }

          await redis.del(key);
        }
      }
    } catch (err) {
      logger.error('Delivery timeout job error:', err.message);
    }
  });

  logger.info('✅ Delivery timeout job started (runs every 30 sec)');
};