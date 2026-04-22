import mongoose         from 'mongoose';
import { Order }        from '../models/Order.js';
import { Cart }         from '../models/Cart.js';
import { Payment }      from '../models/Payment.js';
import { User }         from '../models/User.js';
import { Coupon }       from '../models/Coupon.js';
import { CartService }  from '../services/cart.service.js';
import { PaymentService } from '../services/payment.service.js';
import { InventoryService } from '../services/inventory.service.js';
import { NotificationService } from '../services/notification.service.js';
import { ApiResponse }  from '../utils/ApiResponse.js';
import { ApiError }     from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';
import { syncVendorEarnings } from '../utils/vendorEarnings.js';

// Default commission rate — override per vendor in Phase 8
const DEFAULT_COMMISSION = parseFloat(process.env.DEFAULT_COMMISSION_RATE || '10');

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 1: INITIATE ORDER
//  Validates cart → reserves stock → creates Razorpay order or COD order
// ─────────────────────────────────────────────────────────────────────────────

export const initiateOrder = asyncHandler(async (req, res) => {
  const { addressId, paymentMethod, customerNote, walletAmount = 0 } = req.body;

  // ── Validate address ──────────────────────────────────────────────────────
  const user = await User.findById(req.user._id);
  const address = user.addresses.id(addressId);
  if (!address) throw new ApiError(404, 'Delivery address not found');

  // ── Validate cart ─────────────────────────────────────────────────────────
  const cartData = await CartService.getCartWithTotals(req.user._id);

  if (!cartData.items.length) throw new ApiError(400, 'Cart is empty');

  const blockers = cartData.stockWarnings.filter(
    (w) => w.type === 'out_of_stock' || w.type === 'unavailable'
  );
  if (blockers.length) {
    throw new ApiError(400, 'Some items are unavailable. Please review your cart.', blockers);
  }

  // ── Validate wallet usage ─────────────────────────────────────────────────
  if (walletAmount > 0) {
    if (user.walletBalance < walletAmount) {
      throw new ApiError(400, `Insufficient wallet balance. Available: ₹${user.walletBalance}`);
    }
    if (walletAmount > cartData.total) {
      throw new ApiError(400, 'Wallet amount cannot exceed order total');
    }
  }

  const finalAmount = Math.max(0, cartData.total - walletAmount);

  // ── Reserve stock (atomic) ────────────────────────────────────────────────
  await InventoryService.reserveStock(
    cartData.items.map((i) => ({
      productId: i.product._id,
      variantId: i.variantId,
      quantity:  i.quantity,
    }))
  );

  // ── Build order items with commission ─────────────────────────────────────
  const orderItems = cartData.items.map((item) => {
    const itemTotal = item.linePrice;
    const { platformEarning, vendorEarning } = PaymentService.calculateCommission(
      itemTotal, DEFAULT_COMMISSION
    );
    return {
      product:         item.product._id,
      vendor:          item.vendor,
      variantId:       item.variantId,
      name:            item.product.name,
      image:           item.variant.image,
      sku:             item.variant.sku,
      attributes:      item.variant.attributes,
      quantity:        item.quantity,
      price:           item.variant.price,
      mrp:             item.variant.mrp,
      total:           itemTotal,
      commissionRate:  DEFAULT_COMMISSION,
      vendorEarning,
      platformEarning,
    };
  });

  // ── Address snapshot ──────────────────────────────────────────────────────
  const addressSnapshot = {
    fullName: address.fullName,
    phone:    address.phone,
    line1:    address.line1,
    line2:    address.line2 || '',
    city:     address.city,
    state:    address.state,
    pincode:  address.pincode,
    country:  address.country,
  };

  // ── Create order (pending_payment) ────────────────────────────────────────
  const order = await Order.create({
    customer:        req.user._id,
    items:           orderItems,
    deliveryAddress: addressSnapshot,
    subtotal:        cartData.subtotal,
    mrpTotal:        cartData.mrpTotal,
    mrpDiscount:     cartData.mrpDiscount,
    couponDiscount:  cartData.couponDiscount,
    couponCode:      cartData.coupon?.code,
    shippingCharge:  cartData.shippingCharge,
    totalAmount:     cartData.total,
    paymentMethod,
    walletAmountUsed: walletAmount,
    isCOD:           paymentMethod === 'cod',
    customerNote,
    estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // +5 days
    statusHistory: [{
      status: 'pending_payment',
      note:   'Order initiated',
    }],
  });

  // ── Deduct wallet immediately (regardless of payment method) ─────────────
  if (walletAmount > 0) {
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { walletBalance: -walletAmount },
    });
  }

  // ── Handle COD: confirm immediately ──────────────────────────────────────
  if (paymentMethod === 'cod') {
    order.status        = 'confirmed';
    order.paymentStatus = 'pending'; // Pay on delivery
    order.statusHistory.push({ status: 'confirmed', note: 'COD order confirmed' });
    await order.save();

    await Payment.create({
      order: order._id, customer: req.user._id,
      amount: order.totalAmount, method: 'cod',
      status: 'created', note: 'Cash on delivery',
    });

    await postOrderConfirmed(order, user);

    return res.status(201).json(new ApiResponse(201, {
      orderId:   order._id,
      orderCode: order.orderId,
      status:    order.status,
      isCOD:     true,
    }, 'Order placed successfully'));
  }

  // ── Handle Razorpay: create payment order ─────────────────────────────────
  if (paymentMethod === 'razorpay') {
    if (finalAmount <= 0) {
      // Fully paid by wallet — confirm directly
      order.status        = 'confirmed';
      order.paymentStatus = 'paid';
      order.paidAt        = new Date();
      order.statusHistory.push({ status: 'confirmed', note: 'Fully paid via wallet' });
      await order.save();
      await postOrderConfirmed(order, user);

      return res.status(201).json(new ApiResponse(201, {
        orderId:   order._id,
        orderCode: order.orderId,
        status:    'confirmed',
      }, 'Order placed via wallet'));
    }

    const razorpayOrder = await PaymentService.createRazorpayOrder({
      amount:  finalAmount,
      receipt: order.orderId,
      notes:   { orderId: order._id.toString(), customerId: req.user._id.toString() },
    });

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    await Payment.create({
      order:          order._id,
      customer:       req.user._id,
      amount:         finalAmount,
      method:         'razorpay',
      status:         'created',
      razorpayOrderId: razorpayOrder.id,
    });

    return res.status(201).json(new ApiResponse(201, {
      orderId:         order._id,
      orderCode:       order.orderId,
      razorpayOrderId: razorpayOrder.id,
      amount:          finalAmount,
      currency:        'INR',
      keyId:           process.env.RAZORPAY_KEY_ID,
    }, 'Payment order created'));
  }

  throw new ApiError(400, 'Invalid payment method');
});

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 2: VERIFY PAYMENT (after Razorpay success on client)
// ─────────────────────────────────────────────────────────────────────────────

export const verifyPayment = asyncHandler(async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const order = await Order.findOne({ _id: orderId, customer: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.paymentStatus === 'paid') {
    return res.json(new ApiResponse(200, { orderId: order._id, status: 'already_paid' }));
  }

  // ── Verify Razorpay signature ─────────────────────────────────────────────
  PaymentService.verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });

  // ── Fetch payment from Razorpay to double-check amount ───────────────────
  const rzpPayment = await PaymentService.fetchPayment(razorpayPaymentId);

  if (rzpPayment.status !== 'captured') {
    throw new ApiError(400, `Payment not captured. Status: ${rzpPayment.status}`);
  }

  // Amount in paise verification
  const expectedPaise = Math.round((order.totalAmount - order.walletAmountUsed) * 100);
  if (rzpPayment.amount !== expectedPaise) {
    throw new ApiError(400, 'Payment amount mismatch');
  }

  // ── Update order ──────────────────────────────────────────────────────────
  order.paymentStatus      = 'paid';
  order.status             = 'confirmed';
  order.razorpayPaymentId  = razorpayPaymentId;
  order.razorpaySignature  = razorpaySignature;
  order.paidAt             = new Date();
  order.statusHistory.push({ status: 'confirmed', note: 'Payment received via Razorpay' });
  await order.save();

  // ── Update payment log ────────────────────────────────────────────────────
  await Payment.findOneAndUpdate(
    { razorpayOrderId },
    {
      status:            'captured',
      razorpayPaymentId,
      razorpaySignature,
      gatewayResponse:   rzpPayment,
    }
  );

  const user = await User.findById(req.user._id);
  await postOrderConfirmed(order, user);

  res.json(new ApiResponse(200, {
    orderId:   order._id,
    orderCode: order.orderId,
    status:    order.status,
  }, 'Payment verified. Order confirmed!'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  RAZORPAY WEBHOOK (server-to-server — payment.captured, payment.failed)
// ─────────────────────────────────────────────────────────────────────────────

export const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  // Verify webhook authenticity
  PaymentService.verifyWebhookSignature(req.body, signature);

  const { event, payload } = req.body;
  const rzpPayment = payload?.payment?.entity;
  const rzpOrderId = rzpPayment?.order_id;

  if (!rzpOrderId) return res.json({ received: true });

  const order = await Order.findOne({ razorpayOrderId: rzpOrderId });
  if (!order) return res.json({ received: true }); // Unknown order — ignore

  if (event === 'payment.captured' && order.paymentStatus !== 'paid') {
    order.paymentStatus     = 'paid';
    order.status            = 'confirmed';
    order.razorpayPaymentId = rzpPayment.id;
    order.paidAt            = new Date();
    order.statusHistory.push({ status: 'confirmed', note: 'Payment captured via webhook' });
    await order.save();

    await Payment.findOneAndUpdate(
      { razorpayOrderId: rzpOrderId },
      { status: 'captured', razorpayPaymentId: rzpPayment.id, gatewayResponse: rzpPayment }
    );

    const user = await User.findById(order.customer);
    await postOrderConfirmed(order, user);
  }

  if (event === 'payment.failed') {
    order.status        = 'cancelled';
    order.paymentStatus = 'failed';
    order.cancelReason  = `Payment failed: ${rzpPayment?.error_description || 'Unknown reason'}`;
    order.cancelledAt   = new Date();
    order.statusHistory.push({ status: 'cancelled', note: order.cancelReason });
    await order.save();

    // Release reserved stock
    await InventoryService.releaseStock(
      order.items.map((i) => ({ productId: i.product, variantId: i.variantId, quantity: i.quantity })),
      order._id
    );

    // Refund wallet if used
    if (order.walletAmountUsed > 0) {
      await User.findByIdAndUpdate(order.customer, {
        $inc: { walletBalance: order.walletAmountUsed },
      });
    }

    await Payment.findOneAndUpdate(
      { razorpayOrderId: rzpOrderId },
      { status: 'failed', failureReason: rzpPayment?.error_description, gatewayResponse: rzpPayment }
    );
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET CUSTOMER ORDERS
// ─────────────────────────────────────────────────────────────────────────────

export const getMyOrders = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { customer: req.user._id };
  if (status) filter.status = status;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('orderId status paymentStatus totalAmount items deliveryAddress createdAt isCOD estimatedDelivery')
      .lean(),
    Order.countDocuments(filter),
  ]);

  // Return simplified item list per order
  const simplified = orders.map((o) => ({
    ...o,
    itemCount:  o.items.length,
    firstItem:  { name: o.items[0]?.name, image: o.items[0]?.image },
  }));

  res.json(new ApiResponse(200, { orders: simplified }, 'Orders fetched', paginationMeta(total, page, limit)));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET SINGLE ORDER (Customer)
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user._id })
    .populate('items.product', 'name slug')
    .populate('items.deliveryAgent', 'name phone')
    .lean();

  if (!order) throw new ApiError(404, 'Order not found');
  res.json(new ApiResponse(200, { order }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  CANCEL ORDER (Customer — only before shipped)
// ─────────────────────────────────────────────────────────────────────────────

export const cancelOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'Cancellation reason is required');

  const order = await Order.findOne({ _id: req.params.id, customer: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');

  const cancellableStatuses = ['pending_payment', 'confirmed', 'processing'];
  if (!cancellableStatuses.includes(order.status)) {
    throw new ApiError(400, `Order cannot be cancelled in "${order.status}" status`);
  }

  order.status       = 'cancelled';
  order.cancelReason = reason;
  order.cancelledAt  = new Date();
  order.statusHistory.push({
    status:    'cancelled',
    note:      reason,
    updatedBy: req.user._id,
  });
  await order.save();

  // Release stock
  await InventoryService.releaseStock(
    order.items.map((i) => ({ productId: i.product, variantId: i.variantId, quantity: i.quantity })),
    order._id
  );

  // Initiate refund if paid online
  if (order.paymentStatus === 'paid' && order.razorpayPaymentId) {
    await initiateRefundInternal(order, order.totalAmount - order.walletAmountUsed, reason);
  }

  // Refund wallet if used
  if (order.walletAmountUsed > 0) {
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { walletBalance: order.walletAmountUsed },
    });
  }

  res.json(new ApiResponse(200, null, 'Order cancelled successfully'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  REQUEST RETURN (Customer — after delivery)
// ─────────────────────────────────────────────────────────────────────────────

export const requestReturn = asyncHandler(async (req, res) => {
  const { itemId, reason } = req.body;
  if (!reason) throw new ApiError(400, 'Return reason is required');

  const order = await Order.findOne({ _id: req.params.id, customer: req.user._id });
  if (!order) throw new ApiError(404, 'Order not found');

  const item = order.items.id(itemId);
  if (!item) throw new ApiError(404, 'Item not found');
  if (item.status !== 'delivered') throw new ApiError(400, 'Item must be delivered before requesting a return');

  // 7-day return window
  const deliveredAt = item.deliveredAt || order.deliveredAt;
  const daysSince   = (Date.now() - new Date(deliveredAt)) / (1000 * 60 * 60 * 24);
  if (daysSince > 7) throw new ApiError(400, 'Return window (7 days) has expired');

  item.status       = 'return_requested';
  item.returnReason = reason;
  order.statusHistory.push({
    status:    'return_requested',
    note:      `Return requested for item: ${item.name}. Reason: ${reason}`,
    updatedBy: req.user._id,
  });
  await order.save();

  res.json(new ApiResponse(200, null, 'Return request submitted'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  VENDOR: GET ORDERS FOR THEIR PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorOrders = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { 'items.vendor': req.user._id };
  if (status) filter['items.status'] = status;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('orderId status paymentStatus items deliveryAddress createdAt isCOD')
      .lean(),
    Order.countDocuments(filter),
  ]);

  // Filter to show only this vendor's items
  const vendorOrders = orders.map((o) => ({
    ...o,
    items: o.items.filter((i) => i.vendor.toString() === req.user._id.toString()),
  }));

  res.json(new ApiResponse(200, { orders: vendorOrders }, 'Vendor orders', paginationMeta(total, page, limit)));
});

// ─────────────────────────────────────────────────────────────────────────────
//  VENDOR: UPDATE ITEM STATUS (packed → shipped)
// ─────────────────────────────────────────────────────────────────────────────

export const updateItemStatus = asyncHandler(async (req, res) => {
  const { itemId }                          = req.params;
  const { status, trackingNumber, carrier } = req.body;

  const vendorTransitions = {
    confirmed: ['processing'],
    processing: ['packed'],
    packed:     ['shipped'],
  };

  const order = await Order.findOne({ 'items._id': itemId, 'items.vendor': req.user._id });
  if (!order) throw new ApiError(404, 'Order item not found');

  const item = order.items.id(itemId);
  if (!item) throw new ApiError(404, 'Item not found');

  const allowed = vendorTransitions[item.status];
  if (!allowed?.includes(status)) {
    throw new ApiError(400, `Cannot move item from "${item.status}" to "${status}"`);
  }

  item.status = status;
  if (trackingNumber) item.trackingNumber = trackingNumber;
  if (carrier)        item.carrier        = carrier;

  order.statusHistory.push({
    status,
    note:      `Item "${item.name}" marked as ${status}`,
    updatedBy: req.user._id,
  });

  // Update overall order status if all items have same status
  const allStatuses = order.items.map((i) => i.status);
  const allSame     = allStatuses.every((s) => s === status);
  if (allSame) order.status = status;

  await order.save();

  // Notify customer
  await NotificationService.sendToUser(order.customer, {
    type:    'order_update',
    title:   'Order Update',
    message: `Your item "${item.name}" is now ${status}`,
    data:    { orderId: order._id, itemId },
  });

  res.json(new ApiResponse(200, null, 'Item status updated'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN: GET ALL ORDERS
// ─────────────────────────────────────────────────────────────────────────────

export const adminGetOrders = asyncHandler(async (req, res) => {
  const { status, paymentStatus, paymentMethod, from, to, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (status)        filter.status        = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to)   filter.createdAt.$lte = new Date(to);
  }
  if (search) filter.orderId = { $regex: search, $options: 'i' };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name phone email')
      .select('orderId status paymentStatus paymentMethod totalAmount customer createdAt isCOD')
      .lean(),
    Order.countDocuments(filter),
  ]);

  res.json(new ApiResponse(200, { orders }, 'All orders', paginationMeta(total, page, limit)));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN: UPDATE ORDER STATUS
// ─────────────────────────────────────────────────────────────────────────────

export const adminUpdateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');

  order.status = status;
  order.statusHistory.push({ status, note, updatedBy: req.user._id });

  if (status === 'delivered') {
    order.deliveredAt = new Date();
    if (order.isCOD) {
      order.paymentStatus = 'paid';
      order.codCollected  = true;
    }
    // Mark all items as delivered
    order.items.forEach((i) => {
      i.status      = 'delivered';
      i.deliveredAt = new Date();
    });
  }

  if (status === 'cancelled') {
    order.cancelledAt = new Date();
    order.cancelReason = note;
    await InventoryService.releaseStock(
      order.items.map((i) => ({ productId: i.product, variantId: i.variantId, quantity: i.quantity })),
      order._id
    );
  }

  await order.save();

  await NotificationService.sendToUser(order.customer, {
    type:    'order_update',
    title:   'Order Status Updated',
    message: `Your order ${order.orderId} is now: ${status}`,
    data:    { orderId: order._id },
  });

  res.json(new ApiResponse(200, { order }, 'Order status updated'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN: INITIATE REFUND
// ─────────────────────────────────────────────────────────────────────────────

export const adminInitiateRefund = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  if (!order.razorpayPaymentId) throw new ApiError(400, 'No Razorpay payment found for this order');

  await initiateRefundInternal(order, amount || order.totalAmount, reason);

  res.json(new ApiResponse(200, null, 'Refund initiated'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const initiateRefundInternal = async (order, amount, reason) => {
  const refund = await PaymentService.initiateRefund({
    razorpayPaymentId: order.razorpayPaymentId,
    amount,
    notes: { orderId: order._id.toString(), reason },
  });

  order.refundAmount      = amount;
  order.refundReason      = reason;
  order.razorpayRefundId  = refund.id;
  order.refundInitiatedAt = new Date();
  order.status            = 'refund_initiated';
  order.paymentStatus     = 'refunded';
  order.statusHistory.push({ status: 'refund_initiated', note: reason });
  await order.save();

  await Payment.create({
    order:           order._id,
    customer:        order.customer,
    amount,
    method:          'refund',
    status:          'refunded',
    razorpayPaymentId: order.razorpayPaymentId,
    razorpayRefundId:  refund.id,
    note:            reason,
  });

  await NotificationService.sendToUser(order.customer, {
    type:    'refund',
    title:   'Refund Initiated',
    message: `Refund of ₹${amount} for order ${order.orderId} has been initiated. It will reflect in 5-7 business days.`,
    data:    { orderId: order._id },
  });
};

// Post-order-confirmed: clear cart, mark coupon used, notify
const postOrderConfirmed = async (order, user) => {
  // Clear cart
  await Cart.findOneAndUpdate({ user: order.customer }, { $set: { items: [], coupon: null } });
  
  await syncVendorEarnings(order);


  // Mark coupon as used
  if (order.couponCode) {
    await Coupon.findOneAndUpdate(
      { code: order.couponCode },
      {
        $inc:  { usedCount: 1 },
        $push: { usageLog: { user: order.customer, orderId: order._id } },
      }
    );
  }

  // Notify customer
  await NotificationService.sendToUser(order.customer, {
    type:    'order_confirmed',
    title:   'Order Confirmed! 🎉',
    message: `Your order ${order.orderId} has been confirmed. Estimated delivery in 5 days.`,
    data:    { orderId: order._id },
  });

  // Notify each vendor
  const vendorIds = [...new Set(order.items.map((i) => i.vendor.toString()))];
  for (const vendorId of vendorIds) {
    const vendorItems = order.items.filter((i) => i.vendor.toString() === vendorId);
    await NotificationService.sendToUser(vendorId, {
      type:    'new_order',
      title:   'New Order Received!',
      message: `You have a new order ${order.orderId} with ${vendorItems.length} item(s).`,
      data:    { orderId: order._id },
    });
  }
};