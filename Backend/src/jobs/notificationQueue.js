import Bull   from 'bull';
import { NotificationService } from '../services/notification.service.js';
import logger from '../utils/logger.js';

const notifQueue = new Bull('notifications', {
  redis: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts:  2,
    backoff:   { type: 'fixed', delay: 3000 },
    removeOnComplete: 50,
    removeOnFail:     20,
  },
});

notifQueue.process(10, async (job) => { // 10 concurrent
  const { type, userId, payload } = job.data;

  switch (type) {
    case 'single':
      await NotificationService.sendToUser(userId, payload);
      break;
    case 'broadcast':
      await NotificationService.broadcastToRole(payload.role, payload);
      break;
    case 'batch':
      for (const uid of job.data.userIds) {
        await NotificationService.sendToUser(uid, payload);
      }
      break;
    default:
      logger.warn(`Unknown notification job type: ${type}`);
  }
});

notifQueue.on('failed', (job, err) =>
  logger.error(`Notification job ${job.id} failed:`, err.message)
);

export const queueNotification = (type, data, opts = {}) =>
  notifQueue.add({ type, ...data }, opts);

export { notifQueue };