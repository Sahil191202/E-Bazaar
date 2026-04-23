import { User }             from '../models/User.js';
import { Vendor }           from '../models/Vendor.js';
import { Order }            from '../models/Order.js';
import { Product }          from '../models/Product.js';
import { Banner }           from '../models/Banner.js';
import { Policy }           from '../models/Policy.js';
import { ActivityLog }      from '../models/ActivityLog.js';
import { CommissionConfig } from '../models/CommissionConfig.js';
import { Notification }     from '../models/Notification.js';
import { Payout }           from '../models/Payout.js';
import { DeliveryAgent }    from '../models/DeliveryAgent.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { FraudService }     from '../services/fraud.service.js';
import { NotificationService } from '../services/notification.service.js';
import { UploadService }    from '../services/upload.service.js';
import { ApiResponse }      from '../utils/ApiResponse.js';
import { ApiError }         from '../utils/ApiError.js';
import { asyncHandler }     from '../utils/asyncHandler.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';

// ─────────────────────────────────────────────────────────────────────────────
//  PLATFORM DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export const getPlatformDashboard = asyncHandler(async (req, res) => {
  const [
    platformSummary,
    userStats,
    pendingActions,
    recentOrders,
  ] = await Promise.all([

    // Revenue, GMV, commission
    AnalyticsService.getPlatformSummary(),

    // User counts by role
    User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),

    // Items needing admin attention
    Promise.all([
      Vendor.countDocuments({ kycStatus: 'pending' }),
      DeliveryAgent.countDocuments({ kycStatus: 'pending' }),
      Product.countDocuments({ status: 'pending_approval' }),
      Payout.countDocuments({ status: 'pending' }),
      ActivityLog.countDocuments({ flagged: true, createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      Order.countDocuments({ status: 'cancelled', paymentStatus: 'paid', refundAmount: 0 }),
    ]),

    // Last 10 orders
    Order.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('customer', 'name phone')
      .select('orderId status paymentMethod totalAmount createdAt customer')
      .lean(),
  ]);

  const userMap = userStats.reduce((acc, u) => { acc[u._id] = u.count; return acc; }, {});
  const [pendingKYCVendors, pendingKYCAgents, pendingProducts, pendingPayouts, fraudAlerts, pendingRefunds] = pendingActions;

  res.json(new ApiResponse(200, {
    platform: platformSummary,
    users: {
      customers: userMap.customer || 0,
      vendors:   userMap.vendor   || 0,
      agents:    userMap.agent    || 0,
      admins:    userMap.admin    || 0,
      total:     Object.values(userMap).reduce((a, b) => a + b, 0),
    },
    pendingActions: {
      pendingKYCVendors,
      pendingKYCAgents,
      pendingProducts,
      pendingPayouts,
      fraudAlerts,
      pendingRefunds,
    },
    recentOrders,
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  PLATFORM ANALYTICS (revenue trends)
// ─────────────────────────────────────────────────────────────────────────────

export const getPlatformAnalytics = asyncHandler(async (req, res) => {
  const { period = 'monthly', from, to } = req.query;

  const formatMap = { daily: '%Y-%m-%d', weekly: '%Y-W%V', monthly: '%Y-%m' };
  const groupFormat = formatMap[period] || '%Y-%m';

  const match = { status: { $nin: ['pending_payment', 'cancelled'] } };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to)   match.createdAt.$lte = new Date(to);
  }

  const [revenueTrend, paymentMethodSplit, topCategories, topVendors] = await Promise.all([

    // Revenue over time
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id:        { $dateToString: { format: groupFormat, date: '$createdAt' } },
          gmv:        { $sum: '$totalAmount' },
          orders:     { $sum: 1 },
          commission: { $sum: { $sum: '$items.platformEarning' } },
          avgOrder:   { $avg: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // Payment method split
    Order.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$totalAmount' } } },
    ]),

    // Top categories by revenue
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $lookup: {
          from:         'products',
          localField:   'items.product',
          foreignField: '_id',
          as:           'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmpty: true } },
      {
        $lookup: {
          from:         'categories',
          localField:   'product.category',
          foreignField: '_id',
          as:           'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmpty: true } },
      {
        $group: {
          _id:      '$category._id',
          name:     { $first: '$category.name' },
          revenue:  { $sum: '$items.total' },
          units:    { $sum: '$items.quantity' },
          orders:   { $addToSet: '$_id' },
        },
      },
      { $project: { name: 1, revenue: 1, units: 1, orderCount: { $size: '$orders' } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),

    // Top vendors by GMV
    Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id:      '$items.vendor',
          revenue:  { $sum: '$items.total' },
          orders:   { $addToSet: '$_id' },
          units:    { $sum: '$items.quantity' },
        },
      },
      {
        $lookup: {
          from:         'vendors',
          localField:   '_id',
          foreignField: 'user',
          as:           'vendor',
        },
      },
      { $unwind: { path: '$vendor', preserveNullAndEmpty: true } },
      {
        $project: {
          storeName:   '$vendor.storeName',
          revenue:     1,
          orderCount:  { $size: '$orders' },
          units:       1,
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
  ]);

  res.json(new ApiResponse(200, {
    period,
    revenueTrend,
    paymentMethodSplit,
    topCategories,
    topVendors,
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const getAllUsers = asyncHandler(async (req, res) => {
  const { role, isActive, isBanned, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (role)              filter.role     = role;
  if (isActive  !== undefined) filter.isActive = isActive === 'true';
  if (isBanned  !== undefined) filter.isBanned = isBanned === 'true';
  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-refreshTokens -fcmTokens -password')
      .lean(),
    User.countDocuments(filter),
  ]);

  res.json(new ApiResponse(200, { users }, 'Users', paginationMeta(total, page, limit)));
});

export const getUserDetail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('-refreshTokens -fcmTokens -password')
    .lean();
  if (!user) throw new ApiError(404, 'User not found');

  const [orderStats, activitySummary] = await Promise.all([
    Order.aggregate([
      { $match: { customer: user._id } },
      {
        $group: {
          _id:        '$status',
          count:      { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
        },
      },
    ]),
    ActivityLog.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('action detail createdAt ip success riskScore flagged')
      .lean(),
  ]);

  res.json(new ApiResponse(200, { user, orderStats, activitySummary }));
});

export const banUser = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'Ban reason is required');

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'admin') throw new ApiError(403, 'Cannot ban an admin');

  user.isBanned  = true;
  user.banReason = reason;
  user.refreshTokens = []; // Force logout all devices
  await user.save();

  // Revoke Firebase tokens if exists
  if (user.firebaseUid) {
    const { FirebaseService } = await import('../services/firebase.service.js');
    await FirebaseService.revokeTokens(user.firebaseUid).catch(() => {});
  }

  await NotificationService.sendToUser(user._id, {
    type:    'system',
    title:   'Account Suspended',
    message: `Your account has been suspended. Reason: ${reason}`,
    data:    {},
  });

  res.json(new ApiResponse(200, null, 'User banned'));
});

export const unbanUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isBanned: false, banReason: '' },
    { new: true }
  );
  if (!user) throw new ApiError(404, 'User not found');
  res.json(new ApiResponse(200, null, 'User unbanned'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  COMMISSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const getCommissionConfig = asyncHandler(async (req, res) => {
  // Global default
  const global = await CommissionConfig.findOne({ vendor: null }).lean();

  // All vendor-specific overrides
  const vendorOverrides = await CommissionConfig.find({ vendor: { $ne: null } })
    .populate('vendor', 'name email')
    .populate('categoryRates.category', 'name')
    .lean();

  res.json(new ApiResponse(200, { global, vendorOverrides }));
});

export const setGlobalCommission = asyncHandler(async (req, res) => {
  const { rate, description, categoryRates } = req.body;

  if (rate < 0 || rate > 100) throw new ApiError(400, 'Rate must be between 0 and 100');

  const config = await CommissionConfig.findOneAndUpdate(
    { vendor: null },
    {
      rate,
      description:   description || `Global commission: ${rate}%`,
      categoryRates: categoryRates || [],
      updatedBy:     req.user._id,
    },
    { upsert: true, new: true }
  );

  // Update env variable reference so new orders use updated rate
  process.env.DEFAULT_COMMISSION_RATE = rate.toString();

  res.json(new ApiResponse(200, { config }, 'Global commission updated'));
});

export const setVendorCommission = asyncHandler(async (req, res) => {
  const { vendorUserId, rate, description, categoryRates } = req.body;

  if (rate < 0 || rate > 100) throw new ApiError(400, 'Rate must be between 0 and 100');

  const vendor = await User.findById(vendorUserId);
  if (!vendor || vendor.role !== 'vendor') throw new ApiError(404, 'Vendor not found');

  const config = await CommissionConfig.findOneAndUpdate(
    { vendor: vendorUserId },
    { rate, description, categoryRates: categoryRates || [], updatedBy: req.user._id },
    { upsert: true, new: true }
  );

  // Update vendor model too
  await Vendor.findOneAndUpdate({ user: vendorUserId }, { commissionRate: rate });

  res.json(new ApiResponse(200, { config }, 'Vendor commission updated'));
});

export const deleteVendorCommission = asyncHandler(async (req, res) => {
  await CommissionConfig.findOneAndDelete({ vendor: req.params.vendorUserId });
  await Vendor.findOneAndUpdate({ user: req.params.vendorUserId }, { commissionRate: null });
  res.json(new ApiResponse(200, null, 'Vendor commission override removed (using global rate now)'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  BANNER / CMS MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const createBanner = asyncHandler(async (req, res) => {
  const {
    title, subtitle, linkType, linkValue,
    placement, startsAt, expiresAt, sortOrder, targetAudience,
  } = req.body;

  if (!req.file) throw new ApiError(400, 'Banner image is required');

  const uploaded = await UploadService.uploadImage(req.file.path, 'banners');

  const banner = await Banner.create({
    title, subtitle,
    imageUrl:  uploaded.url,
    publicId:  uploaded.publicId,
    linkType:  linkType  || 'none',
    linkValue: linkValue || '',
    placement: placement || 'hero',
    sortOrder: sortOrder || 0,
    startsAt:  startsAt  ? new Date(startsAt) : new Date(),
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    targetAudience: targetAudience || 'all',
    createdBy: req.user._id,
  });

  res.status(201).json(new ApiResponse(201, { banner }, 'Banner created'));
});

export const getBanners = asyncHandler(async (req, res) => {
  const { placement, activeOnly = 'true' } = req.query;

  const filter = {};
  if (placement) filter.placement = placement;
  if (activeOnly === 'true') {
    filter.isActive = true;
    filter.startsAt = { $lte: new Date() };
    filter.$or = [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }];
  }

  const banners = await Banner.find(filter)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  res.json(new ApiResponse(200, { banners }));
});

export const updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw new ApiError(404, 'Banner not found');

  const {
    title, subtitle, linkType, linkValue,
    placement, isActive, sortOrder, expiresAt, targetAudience,
  } = req.body;

  if (title)          banner.title          = title;
  if (subtitle)       banner.subtitle       = subtitle;
  if (linkType)       banner.linkType       = linkType;
  if (linkValue !== undefined) banner.linkValue = linkValue;
  if (placement)      banner.placement      = placement;
  if (isActive !== undefined) banner.isActive = isActive;
  if (sortOrder !== undefined) banner.sortOrder = sortOrder;
  if (expiresAt)      banner.expiresAt      = new Date(expiresAt);
  if (targetAudience) banner.targetAudience = targetAudience;

  if (req.file) {
    await UploadService.deleteImage(banner.publicId).catch(() => {});
    const uploaded   = await UploadService.uploadImage(req.file.path, 'banners');
    banner.imageUrl  = uploaded.url;
    banner.publicId  = uploaded.publicId;
  }

  await banner.save();
  res.json(new ApiResponse(200, { banner }, 'Banner updated'));
});

export const deleteBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw new ApiError(404, 'Banner not found');

  await UploadService.deleteImage(banner.publicId).catch(() => {});
  await banner.deleteOne();

  res.json(new ApiResponse(200, null, 'Banner deleted'));
});

export const trackBannerClick = asyncHandler(async (req, res) => {
  await Banner.findByIdAndUpdate(req.params.id, { $inc: { clickCount: 1 } });
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
//  POLICY MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const getPolicy = asyncHandler(async (req, res) => {
  const policy = await Policy.findOne({ type: req.params.type })
    .select('-history')
    .lean();
  if (!policy) throw new ApiError(404, 'Policy not found');
  res.json(new ApiResponse(200, { policy }));
});

export const getAllPolicies = asyncHandler(async (req, res) => {
  const policies = await Policy.find().select('-history -content').lean();
  res.json(new ApiResponse(200, { policies }));
});

export const upsertPolicy = asyncHandler(async (req, res) => {
  const { type }                           = req.params;
  const { title, content, version, changeNotes, publish } = req.body;

  let policy = await Policy.findOne({ type });

  if (policy) {
    // Save current version to history (keep last 5)
    if (policy.history.length >= 5) policy.history.shift();
    policy.history.push({
      version:     policy.version,
      content:     policy.content,
      updatedBy:   req.user._id,
      changeNotes: changeNotes || '',
    });

    policy.title         = title   || policy.title;
    policy.content       = content || policy.content;
    policy.version       = version || policy.version;
    policy.lastUpdatedBy = req.user._id;

    if (publish) {
      policy.isPublished = true;
      policy.publishedAt = new Date();
    }
    await policy.save();
  } else {
    policy = await Policy.create({
      type, title, content,
      version:       version || '1.0',
      isPublished:   !!publish,
      publishedAt:   publish ? new Date() : null,
      lastUpdatedBy: req.user._id,
    });
  }

  res.json(new ApiResponse(200, { policy }, `Policy ${policy.isPublished ? 'published' : 'saved as draft'}`));
});

// ─────────────────────────────────────────────────────────────────────────────
//  FRAUD & ACTIVITY MONITORING
// ─────────────────────────────────────────────────────────────────────────────

export const getActivityLogs = asyncHandler(async (req, res) => {
  const { user, action, flagged, from, to, minRisk } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (user)    filter.user   = user;
  if (action)  filter.action = action;
  if (flagged !== undefined) filter.flagged = flagged === 'true';
  if (minRisk) filter.riskScore = { $gte: Number(minRisk) };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to)   filter.createdAt.$lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name phone email role')
      .lean(),
    ActivityLog.countDocuments(filter),
  ]);

  res.json(new ApiResponse(200, { logs }, 'Activity logs', paginationMeta(total, page, limit)));
});

export const getFraudReport = asyncHandler(async (req, res) => {
  const { from, to, minRiskScore = 50 } = req.query;

  const report = await FraudService.getFraudReport({
    from:         from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to:           to   || new Date(),
    minRiskScore: Number(minRiskScore),
  });

  const suspiciousIPs = await FraudService.getSuspiciousIPs(24);

  res.json(new ApiResponse(200, { ...report, suspiciousIPs }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  BULK NOTIFICATIONS & ANNOUNCEMENTS
// ─────────────────────────────────────────────────────────────────────────────

export const sendBulkNotification = asyncHandler(async (req, res) => {
  const { title, message, targetAudience, type = 'announcement', data = {} } = req.body;

  if (!title || !message) throw new ApiError(400, 'Title and message are required');

  const validAudiences = ['all', 'customers', 'vendors', 'agents'];
  if (!validAudiences.includes(targetAudience)) {
    throw new ApiError(400, `Invalid audience. Must be one of: ${validAudiences.join(', ')}`);
  }

  // Map audience to role
  const roleMap = {
    all:       'all',
    customers: 'customer',
    vendors:   'vendor',
    agents:    'agent',
  };

  await NotificationService.broadcastToRole(roleMap[targetAudience], {
    type, title, message, data,
  });

  // Also store individual notifications for users who are offline
  // (they'll see it when they open the app)
  let userFilter = { isActive: true };
  if (targetAudience !== 'all') userFilter.role = roleMap[targetAudience];

  const users = await User.find(userFilter).select('_id').lean();

  // Batch insert — don't await (background job)
  const docs = users.map((u) => ({
    user:           u._id,
    type,
    title,
    message,
    data,
    isBroadcast:    false, // Individual copy for read-tracking
    targetAudience: 'specific',
  }));

  // Insert in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < docs.length; i += chunkSize) {
    await Notification.insertMany(docs.slice(i, i + chunkSize), { ordered: false });
  }

  res.json(new ApiResponse(200, {
    recipientCount: users.length,
    audience:       targetAudience,
  }, `Notification sent to ${users.length} users`));
});

export const getNotificationStats = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

  const [total, byType, readRate] = await Promise.all([
    Notification.countDocuments({ createdAt: { $gte: since } }),

    Notification.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 }, read: { $sum: { $cond: ['$isRead', 1, 0] } } } },
      { $sort: { count: -1 } },
    ]),

    Notification.aggregate([
      { $match: { createdAt: { $gte: since }, user: { $ne: null } } },
      {
        $group: {
          _id:       null,
          total:     { $sum: 1 },
          read:      { $sum: { $cond: ['$isRead', 1, 0] } },
        },
      },
    ]),
  ]);

  const readRateData = readRate[0] || { total: 0, read: 0 };

  res.json(new ApiResponse(200, {
    totalSent:   total,
    byType,
    readRate:    readRateData.total
      ? parseFloat(((readRateData.read / readRateData.total) * 100).toFixed(1))
      : 0,
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  FINANCIAL MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const getFinancialOverview = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  const dateFilter = {};
  if (from || to) {
    dateFilter.createdAt = {};
    if (from) dateFilter.createdAt.$gte = new Date(from);
    if (to)   dateFilter.createdAt.$lte = new Date(to);
  }

  const [
    revenueStats,
    payoutStats,
    refundStats,
    walletStats,
  ] = await Promise.all([

    // Platform revenue (commission)
    Order.aggregate([
      { $match: { ...dateFilter, status: { $nin: ['pending_payment', 'cancelled'] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id:        null,
          gmv:        { $sum: '$totalAmount' },
          commission: { $sum: '$items.platformEarning' },
          vendorPaid: { $sum: '$items.vendorEarning' },
          orders:     { $sum: 1 },
        },
      },
    ]),

    // Payout stats
    Payout.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id:    '$status',
          count:  { $sum: 1 },
          amount: { $sum: '$amount' },
        },
      },
    ]),

    // Refund stats
    Order.aggregate([
      { $match: { ...dateFilter, paymentStatus: { $in: ['refunded', 'partially_refunded'] } } },
      {
        $group: {
          _id:          null,
          totalRefunds: { $sum: 1 },
          refundAmount: { $sum: '$refundAmount' },
        },
      },
    ]),

    // Wallet balance across all users
    User.aggregate([
      { $group: { _id: null, totalWalletBalance: { $sum: '$walletBalance' } } },
    ]),
  ]);

  const revenue  = revenueStats[0]  || { gmv: 0, commission: 0, vendorPaid: 0, orders: 0 };
  const refunds  = refundStats[0]   || { totalRefunds: 0, refundAmount: 0 };
  const wallets  = walletStats[0]   || { totalWalletBalance: 0 };
  const payoutMap = payoutStats.reduce((acc, p) => { acc[p._id] = p; return acc; }, {});

  res.json(new ApiResponse(200, {
    revenue,
    payouts: {
      pending:    payoutMap.pending    || { count: 0, amount: 0 },
      processing: payoutMap.processing || { count: 0, amount: 0 },
      completed:  payoutMap.completed  || { count: 0, amount: 0 },
    },
    refunds,
    walletLiability: wallets.totalWalletBalance,
  }));
});