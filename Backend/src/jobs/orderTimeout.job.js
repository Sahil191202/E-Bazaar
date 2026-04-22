import cron             from 'node-cron';
import { Order }        from '../models/Order.js';
import { InventoryService } from '../services/inventory.service.js';
import { User }         from '../models/User.js';
import logger           from '../utils/logger.js';

// Runs every 5 minutes
export const startOrderTimeoutJob = () => {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago

      const expiredOrders = await Order.find({
        status:        'pending_payment',
        paymentMethod: 'razorpay',
        createdAt:     { $lt: cutoff },
      });

      if (!expiredOrders.length) return;

      logger.info(`Order timeout job: cancelling ${expiredOrders.length} unpaid orders`);

      for (const order of expiredOrders) {
        order.status       = 'cancelled';
        order.cancelReason = 'Payment timeout — order auto-cancelled after 30 minutes';
        order.cancelledAt  = new Date();
        order.statusHistory.push({ status: 'cancelled', note: 'Auto-cancelled due to payment timeout' });
        await order.save();

        // Release stock
        await InventoryService.releaseStock(
          order.items.map((i) => ({ productId: i.product, variantId: i.variantId, quantity: i.quantity })),
          order._id
        );

        // Refund wallet if used
        if (order.walletAmountUsed > 0) {
          await User.findByIdAndUpdate(order.customer, {
            $inc: { walletBalance: order.walletAmountUsed },
          });
          logger.info(`Wallet refunded ₹${order.walletAmountUsed} to user ${order.customer}`);
        }
      }
    } catch (err) {
      logger.error('Order timeout job error:', err.message);
    }
  });

  logger.info('✅ Order timeout job started (runs every 5 min)');
};