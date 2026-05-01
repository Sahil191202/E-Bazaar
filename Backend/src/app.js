import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { validateEnv } from "./config/env.js";
import {
  helmetConfig,
  mongoSanitizer,
  xssSanitizer,
  suspiciousRequestGuard,
  requestSizeGuard,
} from "./middlewares/security.middleware.js";
import { globalRateLimiter } from "./middlewares/rateLimit.middleware.js";
import { compressionMiddleware } from "./utils/responseOptimizer.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import logger from "./utils/logger.js";
import cookieParser from 'cookie-parser';

// Routes
import authRoutes from "./routes/v1/auth.routes.js";
import userRoutes from "./routes/v1/user.routes.js";
import vendorRoutes from "./routes/v1/vendor.routes.js";
import agentRoutes from "./routes/v1/agent.routes.js";
import adminRoutes from "./routes/v1/admin.routes.js";
import productRoutes from "./routes/v1/product.routes.js";
import categoryRoutes from "./routes/v1/category.routes.js";
import cartRoutes from "./routes/v1/cart.routes.js";
import orderRoutes from "./routes/v1/order.routes.js";
import paymentRoutes from "./routes/v1/payment.routes.js";
import reviewRoutes from "./routes/v1/review.routes.js";
import couponRoutes from "./routes/v1/coupon.routes.js";
import notificationRoutes from "./routes/v1/notification.routes.js";
import uploadRoutes from "./routes/v1/upload.routes.js";
import internalRoutes from "./routes/v1/internal.route.js";
import bannerRoutes from './banner.routes.js';

// Validate env on startup
validateEnv();

const app = express();
app.use(cookieParser());

// ── Security ──────────────────────────────────────────────────────────────────
app.set("trust proxy", 1); // Trust Nginx reverse proxy
app.use(helmetConfig);
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = process.env.ALLOWED_ORIGINS?.split(",") || [];
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Cache", "X-RateLimit-Remaining"],
    maxAge: 86400, // 24h preflight cache
  }),
);

// ── Parsing & Compression ─────────────────────────────────────────────────────
app.use(compressionMiddleware);

// Raw body for webhooks — MUST be before express.json()
app.use(
  "/api/v1/orders/webhook/razorpay",
  express.raw({ type: "application/json" }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Sanitization ──────────────────────────────────────────────────────────────
app.use(mongoSanitizer);
app.use(xssSanitizer);
app.use(suspiciousRequestGuard);
app.use(requestSizeGuard);

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(globalRateLimiter);

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(
  morgan(
    process.env.NODE_ENV === "production"
      ? ":remote-addr :method :url :status :res[content-length] - :response-time ms"
      : "dev",
    { stream: { write: (msg) => logger.info(msg.trim()) } },
  ),
);

// ── Health checks ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV,
  }),
);

app.get("/health/ready", async (req, res) => {
  try {
    const mongoose = await import("mongoose");
    const { getRedis } = await import("./config/redis.js");

    const dbState = mongoose.default.connection.readyState === 1;
    const redisPing = await getRedis().ping();
    const redisOk = redisPing === "PONG";

    if (dbState && redisOk) {
      res.json({ status: "ready", db: "connected", redis: "connected" });
    } else {
      res.status(503).json({
        status: "not ready",
        db: dbState ? "connected" : "disconnected",
        redis: redisOk ? "connected" : "disconnected",
      });
    }
  } catch (err) {
    res.status(503).json({ status: "error", message: err.message });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────
const V1 = "/api/v1";
app.use(`${V1}/auth`, authRoutes);
app.use(`${V1}/users`, userRoutes);
app.use(`${V1}/vendors`, vendorRoutes);
app.use(`${V1}/agents`, agentRoutes);
app.use(`${V1}/admin`, adminRoutes);
app.use(`${V1}/products`, productRoutes);
app.use(`${V1}/categories`, categoryRoutes);
app.use(`${V1}/cart`, cartRoutes);
app.use(`${V1}/orders`, orderRoutes);
app.use(`${V1}/payments`, paymentRoutes);
app.use(`${V1}/reviews`, reviewRoutes);
app.use(`${V1}/coupons`, couponRoutes);
app.use(`${V1}/notifications`, notificationRoutes);
app.use(`${V1}/upload`, uploadRoutes);
app.use(`${V1}/internal`, internalRoutes);
app.use(`${V1}/banners`, bannerRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use("*", (req, res) => {
  res
    .status(404)
    .json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
