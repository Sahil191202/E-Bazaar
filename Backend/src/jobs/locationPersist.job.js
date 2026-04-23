import cron              from 'node-cron';
import { DeliveryAgent } from '../models/DeliveryAgent.js';
import { DeliveryService } from '../services/delivery.service.js';
import logger            from '../utils/logger.js';

// Runs every 5 minutes
export const startLocationPersistJob = () => {
  cron.schedule('*/5 * * * *', async () => {
    try {
      // Only persist online agents
      const onlineAgents = await DeliveryAgent.find({ isOnline: true })
        .select('user')
        .lean();

      if (!onlineAgents.length) return;

      await Promise.allSettled(
        onlineAgents.map((a) => DeliveryService.persistAgentLocation(a.user))
      );

      logger.info(`Location persisted for ${onlineAgents.length} agents`);
    } catch (err) {
      logger.error('Location persist job error:', err.message);
    }
  });

  logger.info('✅ Location persist job started (runs every 5 min)');
};