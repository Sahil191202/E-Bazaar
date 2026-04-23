console.log("Starting server...");
// import "./src/utils/logger.js"; // Init logger first (creates logs dir)
import { createServer } from "http";
import app from "./src/app.js";
// import { connectDB } from "./src/config/db.js";
// import { connectRedis } from "./src/config/redis.js";
// import { initFirebase } from "./src/config/firebase.js";
// import { initCloudinary } from "./src/config/cloudinary.js";
// import { initSocket } from "./src/sockets/index.js";
// import { startOrderTimeoutJob } from "./src/jobs/orderTimeout.job.js";
// import { startDeliveryTimeoutJob } from "./src/jobs/deliveryTimeout.job.js";
// import { startLocationPersistJob } from "./src/jobs/locationPersist.job.js";
// import logger from "./src/utils/logger.js";

const PORT = process.env.PORT || 5000;
const httpServer = createServer(app);

initSocket(httpServer);

console.log("BOOT START");

(async () => {
  try {
    console.log("Step 1: Firebase");
    initFirebase();

    console.log("Step 2: Cloudinary");
    initCloudinary();

    console.log("Step 3: DB");
    await connectDB();

    console.log("Step 4: Redis");
    await connectRedis();

    console.log("Step 5: Jobs");
    startOrderTimeoutJob();

    console.log("Step 6: Server listen");
    httpServer.listen(PORT, () => {
      console.log(`Running on ${PORT}`);
    });

  } catch (err) {
    console.error("CRASH:", err);
  }

  process.on("SIGTERM", () => {
    logger.info("SIGTERM — shutting down gracefully");
    httpServer.close(() => process.exit(0));
  });

  process.on("uncaughtException", (err) =>
    logger.error("Uncaught exception:", err),
  );
  process.on("unhandledRejection", (err) =>
    logger.error("Unhandled rejection:", err),
  );
})();
