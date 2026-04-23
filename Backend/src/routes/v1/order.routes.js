import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import {
  initiateOrderSchema, verifyPaymentSchema, cancelOrderSchema,
  returnRequestSchema, updateItemStatusSchema,
  adminUpdateStatusSchema, refundSchema,
}                       from '../../validators/order.validator.js';
import * as Order       from '../../controllers/order.controller.js';

const router = Router();

// ── Razorpay webhook (no auth — verified by signature) ────────────────────────
router.post('/webhook/razorpay',
  express.raw({ type: 'application/json' }),  // Raw body for signature verification
  Order.razorpayWebhook
);

// ── All other routes require auth ─────────────────────────────────────────────
router.use(authenticate);

// Customer
router.post('/', authenticate, validateBody(initiateOrderSchema), logActivity('order_placed', 'Order'), Order.initiateOrder);
router.post('/verify-payment',    validateBody(verifyPaymentSchema),    Order.verifyPayment);
router.get('/my',                 Order.getMyOrders);
router.get('/:id',                Order.getOrderById);
router.post('/:id/cancel',        validateBody(cancelOrderSchema),      Order.cancelOrder);
router.post('/:id/return',        validateBody(returnRequestSchema),    Order.requestReturn);

// Vendor
router.get('/vendor/orders',      authorize('vendor'), Order.getVendorOrders);
router.patch('/vendor/items/:itemId/status',
  authorize('vendor'),
  validateBody(updateItemStatusSchema),
  Order.updateItemStatus
);

// Admin
router.get('/admin/all',          authorize('admin'), Order.adminGetOrders);
router.patch('/admin/:id/status', authorize('admin'), validateBody(adminUpdateStatusSchema), Order.adminUpdateOrderStatus);
router.post('/admin/:id/refund',  authorize('admin'), validateBody(refundSchema), Order.adminInitiateRefund);

export default router;