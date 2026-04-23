import mongoose from 'mongoose';
import logger   from '../utils/logger.js';

export const connectDB = async () => {
  try {
    mongoose.set('strictQuery', true);

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Connection pool
      maxPoolSize:     10,
      minPoolSize:     2,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS:     10000,

      // Write concern
      writeConcern: { w: 'majority', j: true },

      // Read preference (use secondary for analytics queries)
      readPreference: 'primaryPreferred',
    });

    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);

    // ── Connection event handlers ─────────────────────────────────────────
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB error:', err.message);
    });

    // ── Query performance monitoring ──────────────────────────────────────
    // if (process.env.NODE_ENV === 'development') {
    //   mongoose.set('debug', (collectionName, method, query, doc) => {
    //     logger.debug(`MongoDB: ${collectionName}.${method}`, { query });
    //   });
    // }

    // Slow query detection (> 100ms)
    mongoose.connection.on('commandStarted', () => {});
    mongoose.plugin((schema) => {
      schema.pre(/^find/, function () {
        this._startTime = Date.now();
      });
      schema.post(/^find/, function () {
        const duration = Date.now() - this._startTime;
        if (duration > 100) {
          logger.warn(`Slow query (${duration}ms):`, this.getQuery());
        }
      });
    });

  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

// ─── Graceful disconnect ──────────────────────────────────────────────────────
export const disconnectDB = async () => {
  await mongoose.connection.close();
  logger.info('MongoDB disconnected gracefully');
};