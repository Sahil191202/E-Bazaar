import Joi    from 'joi';
import logger from '../utils/logger.js';

const envSchema = Joi.object({
  NODE_ENV:   Joi.string().valid('development', 'production', 'test').required(),
  PORT:       Joi.number().default(5000),

  MONGO_URI:  Joi.string().required(),
  REDIS_URL:  Joi.string().required(),

  JWT_ACCESS_SECRET:   Joi.string().min(32).required(),
  JWT_REFRESH_SECRET:  Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES:  Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES: Joi.string().default('30d'),

  FIREBASE_SERVICE_ACCOUNT: Joi.string().required(),

  RAZORPAY_KEY_ID:        Joi.string().required(),
  RAZORPAY_KEY_SECRET:    Joi.string().required(),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().required(), // ← only once

  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY:    Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),

  GOOGLE_CLIENT_ID: Joi.string().required(),
  ALLOWED_ORIGINS:  Joi.string().required(),

  DEFAULT_COMMISSION_RATE: Joi.number().min(0).max(100).default(10),
  DELIVERY_BASE_EARNING:   Joi.number().default(40),
  DELIVERY_PER_KM_EARNING: Joi.number().default(5),

  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),

  APP_NAME:  Joi.string().default('eCommerce'),
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.string().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),

}).unknown(true);

export const validateEnv = () => {
  const { error, value } = envSchema.validate(process.env, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    console.error("\n❌ Environment validation failed:\n");
    error.details.forEach(d => console.error(" -", d.message));
    process.exit(1);
  }

  Object.assign(process.env, value);
  console.log("✅ Environment variables validated");
};