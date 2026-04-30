import { Vendor } from '../models/Vendor.js';

/**
 * Update vendor's pending payout and total earnings
 * after an order is confirmed/delivered.
 */
export const syncVendorEarnings = async (order) => {
  // Group items by vendor
  const vendorMap = {};

  for (const item of order.items) {
    const vid = item.vendor.toString();
    if (!vendorMap[vid]) vendorMap[vid] = 0;
    vendorMap[vid] += item.vendorEarning;
  }

  // Bulk update each vendor's totals
  const updates = Object.entries(vendorMap).map(([vendorUserId, earning]) =>
    Vendor.findOneAndUpdate(
      { _id: vendorUserId },
      {
        $inc: {
          totalEarnings: earning,
          pendingPayout: earning,
          totalOrders:   1,
        },
      }
    )
  );

  await Promise.all(updates);
};