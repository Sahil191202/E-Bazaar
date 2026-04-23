import { ActivityLog } from '../models/ActivityLog.js';
import { FraudService } from '../services/fraud.service.js';
import logger           from '../utils/logger.js';

// Attach to any route you want to audit
export const logActivity = (action, entity = null) => async (req, res, next) => {
  // Run after response
  res.on('finish', async () => {
    try {
      const log = await ActivityLog.create({
        user:       req.user?._id || null,
        userRole:   req.user?.role || 'anonymous',
        action,
        entity,
        entityId:   req.params?.id || null,
        detail:     `${req.method} ${req.path}`,
        ip:         req.ip || req.headers['x-forwarded-for'],
        userAgent:  req.headers['user-agent'],
        method:     req.method,
        path:       req.path,
        statusCode: res.statusCode,
        success:    res.statusCode < 400,
      });

      // Run fraud check asynchronously — don't block response
      FraudService.analyzeActivity(log).catch((e) =>
        logger.error('Fraud analysis error:', e.message)
      );
    } catch (e) {
      logger.error('Activity log error:', e.message);
    }
  });

  next();
};