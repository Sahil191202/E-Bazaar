import app from './src/app.js';
import { connectDB }    from './src/config/db.js';
import { connectRedis } from './src/config/redis.js';
import { initFirebase } from './src/config/firebase.js';  // ← ADD
import { createServer } from 'http';
import { initSocket }   from './src/sockets/index.js';
import logger           from './src/utils/logger.js';
import { startOrderTimeoutJob } from './src/jobs/orderTimeout.job.js';
import { startDeliveryTimeoutJob } from './src/jobs/deliveryTimeout.job.js';

const PORT = process.env.PORT || 5000;
const httpServer = createServer(app);
initSocket(httpServer);

(async () => {
  initFirebase();           // ← Initialize Firebase first
  await connectDB();
  await connectRedis();
  startOrderTimeoutJob();
  startDeliveryTimeoutJob();

  httpServer.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    httpServer.close(() => process.exit(0));
  });
})();