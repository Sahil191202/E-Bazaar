import { Order }  from '../models/Order.js';
import { Product } from '../models/Product.js';

export class AnalyticsService {

  // ─── Vendor sales analytics ───────────────────────────────────────────────
  static async getVendorSalesAnalytics(vendorId, period = 'monthly') {
    const now  = new Date();
    let from, groupFormat, dateLabel;

    switch (period) {
      case 'daily':
        from        = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29); // last 30 days
        groupFormat = '%Y-%m-%d';
        dateLabel   = 'day';
        break;
      case 'weekly':
        from        = new Date(now.getFullYear(), now.getMonth() - 3, 1); // last 3 months
        groupFormat = '%Y-W%V';
        dateLabel   = 'week';
        break;
      case 'monthly':
      default:
        from        = new Date(now.getFullYear() - 1, now.getMonth(), 1); // last 12 months
        groupFormat = '%Y-%m';
        dateLabel   = 'month';
    }

    const salesData = await Order.aggregate([
      // Match orders with this vendor's items, confirmed/delivered
      {
        $match: {
          'items.vendor': vendorId,
          status:         { $in: ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'] },
          createdAt:      { $gte: from },
        },
      },
      // Unwind items to work per item
      { $unwind: '$items' },
      // Filter only this vendor's items
      { $match: { 'items.vendor': vendorId } },
      // Group by period
      {
        $group: {
          _id: {
            $dateToString: { format: groupFormat, date: '$createdAt' },
          },
          revenue:    { $sum: '$items.vendorEarning' },
          orders:     { $addToSet: '$_id' },
          units:      { $sum: '$items.quantity' },
          commission: { $sum: '$items.platformEarning' },
        },
      },
      {
        $project: {
          _id:        0,
          period:     '$_id',
          revenue:    { $round: ['$revenue', 2] },
          orderCount: { $size: '$orders' },
          units:      1,
          commission: { $round: ['$commission', 2] },
        },
      },
      { $sort: { period: 1 } },
    ]);

    return salesData;
  }

  // ─── Vendor top products ──────────────────────────────────────────────────
  static async getVendorTopProducts(vendorId, limit = 5) {
    return Order.aggregate([
      { $match: { 'items.vendor': vendorId, status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      { $match: { 'items.vendor': vendorId } },
      {
        $group: {
          _id:      '$items.product',
          name:     { $first: '$items.name' },
          image:    { $first: '$items.image' },
          revenue:  { $sum: '$items.vendorEarning' },
          units:    { $sum: '$items.quantity' },
          orders:   { $addToSet: '$_id' },
        },
      },
      {
        $project: {
          name:       1,
          image:      1,
          revenue:    { $round: ['$revenue', 2] },
          units:      1,
          orderCount: { $size: '$orders' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]);
  }

  // ─── Vendor order status breakdown ────────────────────────────────────────
  static async getVendorOrderStats(vendorId) {
    const stats = await Order.aggregate([
      { $match: { 'items.vendor': vendorId } },
      { $unwind: '$items' },
      { $match: { 'items.vendor': vendorId } },
      {
        $group: {
          _id:     '$items.status',
          count:   { $sum: 1 },
          revenue: { $sum: '$items.vendorEarning' },
        },
      },
    ]);

    return stats.reduce((acc, s) => {
      acc[s._id] = { count: s.count, revenue: s.revenue };
      return acc;
    }, {});
  }

  // ─── Vendor summary card (for dashboard header) ───────────────────────────
  static async getVendorSummary(vendorId) {
    const [today, thisMonth, allTime] = await Promise.all([
      // Today's revenue
      Order.aggregate([
        {
          $match: {
            'items.vendor': vendorId,
            status:         { $nin: ['cancelled', 'pending_payment'] },
            createdAt:      { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.vendor': vendorId } },
        { $group: { _id: null, revenue: { $sum: '$items.vendorEarning' }, orders: { $addToSet: '$_id' } } },
      ]),

      // This month
      Order.aggregate([
        {
          $match: {
            'items.vendor': vendorId,
            status:         { $nin: ['cancelled', 'pending_payment'] },
            createdAt: {
              $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.vendor': vendorId } },
        { $group: { _id: null, revenue: { $sum: '$items.vendorEarning' }, orders: { $addToSet: '$_id' } } },
      ]),

      // All time
      Order.aggregate([
        {
          $match: {
            'items.vendor': vendorId,
            status:         { $nin: ['cancelled', 'pending_payment'] },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.vendor': vendorId } },
        { $group: { _id: null, revenue: { $sum: '$items.vendorEarning' }, orders: { $addToSet: '$_id' } } },
      ]),
    ]);

    return {
      today: {
        revenue:    today[0]?.revenue    || 0,
        orderCount: today[0]?.orders?.length || 0,
      },
      thisMonth: {
        revenue:    thisMonth[0]?.revenue    || 0,
        orderCount: thisMonth[0]?.orders?.length || 0,
      },
      allTime: {
        revenue:    allTime[0]?.revenue    || 0,
        orderCount: allTime[0]?.orders?.length || 0,
      },
    };
  }

  // ─── Admin platform analytics ─────────────────────────────────────────────
  static async getPlatformSummary() {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [todayStats, monthStats, totalStats] = await Promise.all([
      Order.aggregate([
        { $match: { status: { $nin: ['cancelled', 'pending_payment'] }, createdAt: { $gte: startOfToday } } },
        { $group: { _id: null, gmv: { $sum: '$totalAmount' }, orders: { $sum: 1 }, commission: { $sum: { $sum: '$items.platformEarning' } } } },
      ]),
      Order.aggregate([
        { $match: { status: { $nin: ['cancelled', 'pending_payment'] }, createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, gmv: { $sum: '$totalAmount' }, orders: { $sum: 1 }, commission: { $sum: { $sum: '$items.platformEarning' } } } },
      ]),
      Order.aggregate([
        { $match: { status: { $nin: ['cancelled', 'pending_payment'] } } },
        { $group: { _id: null, gmv: { $sum: '$totalAmount' }, orders: { $sum: 1 }, commission: { $sum: { $sum: '$items.platformEarning' } } } },
      ]),
    ]);

    return {
      today:     todayStats[0]  || { gmv: 0, orders: 0, commission: 0 },
      thisMonth: monthStats[0]  || { gmv: 0, orders: 0, commission: 0 },
      allTime:   totalStats[0]  || { gmv: 0, orders: 0, commission: 0 },
    };
  }
}