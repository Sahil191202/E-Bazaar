import 'dotenv/config';
import "./src/utils/logger.js"; // Init logger first (creates logs dir)
import { createServer } from "http";
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import { connectRedis } from "./src/config/redis.js";
import { initFirebase } from "./src/config/firebase.js";
import { initCloudinary } from "./src/config/cloudinary.js";
import { initSocket } from "./src/sockets/index.js";
import { startOrderTimeoutJob } from "./src/jobs/orderTimeout.job.js";
import { startDeliveryTimeoutJob } from "./src/jobs/deliveryTimeout.job.js";
import { startLocationPersistJob } from "./src/jobs/locationPersist.job.js";
import logger from "./src/utils/logger.js";

console.log("Starting server...");

const PORT       = process.env.PORT || 5000;
const httpServer = createServer(app);

initSocket(httpServer);

(async () => {
  try {
    initFirebase();
    initCloudinary();
    await connectDB();
    await connectRedis();

    startOrderTimeoutJob();
    startDeliveryTimeoutJob();
    startLocationPersistJob();

    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('Boot failed:', err.message);
    process.exit(1);
  }

  process.on('SIGTERM', () => {
    logger.info('SIGTERM — shutting down gracefully');
    httpServer.close(() => process.exit(0));
  });

  process.on('uncaughtException',  (err) => logger.error('Uncaught exception:',  err));
  process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', err));
})();