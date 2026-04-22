import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { errorHandler } from './middlewares/error.middleware.js';
import { globalRateLimiter } from './middlewares/rateLimit.middleware.js';

// Route imports
import authRoutes from './routes/v1/auth.routes.js';
import userRoutes from './routes/v1/user.routes.js';
import vendorRoutes from './routes/v1/vendor.routes.js';
import agentRoutes from './routes/v1/agent.routes.js';
import adminRoutes from './routes/v1/admin.routes.js';
import productRoutes from './routes/v1/product.routes.js';
import categoryRoutes from './routes/v1/category.routes.js';
import cartRoutes from './routes/v1/cart.routes.js';
import orderRoutes from './routes/v1/order.routes.js';
import paymentRoutes from './routes/v1/payment.routes.js';
import reviewRoutes from './routes/v1/review.routes.js';
import couponRoutes from './routes/v1/coupon.routes.js';
import notificationRoutes from './routes/v1/notification.routes.js';
import uploadRoutes from './routes/v1/upload.routes.js';

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(globalRateLimiter);

// Health check
app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
}));

// API routes
const V1 = '/api/v1';
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

// 404 handler
app.use('*', (req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Global error handler
app.use(errorHandler);

export default app;