import { ActivityLog } from '../models/ActivityLog.js';
import { User }        from '../models/User.js';
import { Order }       from '../models/Order.js';
import { NotificationService } from './notification.service.js';
import logger          from '../utils/logger.js';

export class FraudService {

  // ─── Analyze a single activity log for fraud signals ──────────────────────
  static async analyzeActivity(log) {
    let riskScore  = 0;
    const signals  = [];

    const windowMs = 15 * 60 * 1000; // 15-min window
    const since    = new Date(Date.now() - windowMs);

    // ── Signal 1: Too many failed logins from same IP ────────────────────────
    if (log.action === 'login' && !log.success) {
      const failedLogins = await ActivityLog.countDocuments({
        ip:        log.ip,
        action:    'login',
        success:   false,
        createdAt: { $gte: since },
      });

      if (failedLogins >= 5) {
        riskScore += 40;
        signals.push(`${failedLogins} failed logins from IP ${log.ip} in 15 min`);
      }
    }

    // ── Signal 2: Multiple accounts from same IP ─────────────────────────────
    if (log.action === 'register') {
      const registrations = await ActivityLog.countDocuments({
        ip:        log.ip,
        action:    'register',
        createdAt: { $gte: since },
      });

      if (registrations >= 3) {
        riskScore += 30;
        signals.push(`${registrations} registrations from IP ${log.ip} in 15 min`);
      }
    }

    // ── Signal 3: Rapid order placement ──────────────────────────────────────
    if (log.action === 'order_placed' && log.user) {
      const recentOrders = await Order.countDocuments({
        customer:  log.user,
        createdAt: { $gte: since },
      });

      if (recentOrders >= 5) {
        riskScore += 35;
        signals.push(`${recentOrders} orders placed by user ${log.user} in 15 min`);
      }
    }

    // ── Signal 4: High-value order from new account ───────────────────────────
    if (log.action === 'order_placed' && log.user) {
      const user = await User.findById(log.user).select('createdAt').lean();
      const ageHours = (Date.now() - new Date(user?.createdAt)) / (1000 * 60 * 60);

      if (ageHours < 1) {
        const recentOrder = await Order.findOne({ customer: log.user })
          .sort({ createdAt: -1 })
          .select('totalAmount')
          .lean();

        if (recentOrder?.totalAmount > 10000) {
          riskScore += 25;
          signals.push(`High-value order ₹${recentOrder.totalAmount} from account < 1hr old`);
        }
      }
    }

    // ── Signal 5: Same IP, multiple different users placing orders ────────────
    if (log.action === 'order_placed') {
      const usersFromIp = await ActivityLog.distinct('user', {
        ip:        log.ip,
        action:    'order_placed',
        createdAt: { $gte: since },
        user:      { $ne: null },
      });

      if (usersFromIp.length >= 3) {
        riskScore += 20;
        signals.push(`${usersFromIp.length} different users ordering from IP ${log.ip}`);
      }
    }

    // ── Persist risk score if notable ─────────────────────────────────────────
    if (riskScore > 0) {
      const flagged = riskScore >= 50;
      await ActivityLog.findByIdAndUpdate(log._id, {
        riskScore,
        flagged,
        flagReason: signals.join(' | '),
      });

      // Alert admin for high-risk events
      if (flagged) {
        logger.warn(`🚨 Fraud alert: score=${riskScore}, signals=[${signals.join(', ')}]`);
        await NotificationService.notifyAdmins({
          type:    'system',
          title:   '🚨 Fraud Alert',
          message: `Risk score ${riskScore}/100 — ${signals[0]}`,
          data:    { logId: log._id, signals, riskScore },
        });
      }
    }
  }

  // ─── Get fraud report for admin dashboard ─────────────────────────────────
  static async getFraudReport({ from, to, minRiskScore = 50 }) {
    const match = {
      flagged:    true,
      riskScore:  { $gte: minRiskScore },
      createdAt:  { $gte: new Date(from), $lte: new Date(to) },
    };

    const [logs, summary] = await Promise.all([
      ActivityLog.find(match)
        .sort({ riskScore: -1, createdAt: -1 })
        .limit(100)
        .populate('user', 'name phone email')
        .lean(),

      ActivityLog.aggregate([
        { $match: match },
        {
          $group: {
            _id:          '$action',
            count:        { $sum: 1 },
            avgRiskScore: { $avg: '$riskScore' },
            maxRiskScore: { $max: '$riskScore' },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ]);

    return { logs, summary };
  }

  // ─── Suspicious IP analysis ───────────────────────────────────────────────
  static async getSuspiciousIPs(hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    return ActivityLog.aggregate([
      { $match: { createdAt: { $gte: since }, flagged: true } },
      {
        $group: {
          _id:         '$ip',
          flagCount:   { $sum: 1 },
          avgRisk:     { $avg: '$riskScore' },
          users:       { $addToSet: '$user' },
          actions:     { $addToSet: '$action' },
          lastSeenAt:  { $max: '$createdAt' },
        },
      },
      { $sort: { flagCount: -1 } },
      { $limit: 20 },
    ]);
  }
}