import Bull   from 'bull';
import { EmailService } from '../services/email.service.js';
import logger from '../utils/logger.js';

const emailQueue = new Bull('email', {
  redis: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts:  3,
    backoff:   { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail:     50,
  },
});

// ── Process jobs ──────────────────────────────────────────────────────────────
emailQueue.process(5, async (job) => { // 5 concurrent
  const { type, payload } = job.data;

  switch (type) {
    case 'order_confirmation':
      await EmailService.sendOrderConfirmation(payload.user, payload.order);
      break;
    case 'welcome':
      await EmailService.sendWelcome(payload.user);
      break;
    case 'raw':
      await EmailService.send(payload);
      break;
    default:
      logger.warn(`Unknown email job type: ${type}`);
  }
});

emailQueue.on('completed', (job) => logger.info(`Email job ${job.id} completed`));
emailQueue.on('failed',    (job, err) => logger.error(`Email job ${job.id} failed:`, err.message));

// ── Helper to add jobs ────────────────────────────────────────────────────────
export const queueEmail = (type, payload, opts = {}) =>
  emailQueue.add({ type, payload }, opts);

export { emailQueue };