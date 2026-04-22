import Joi from 'joi';

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required();

export const initiateOrderSchema = Joi.object({
  addressId:     objectId,
  paymentMethod: Joi.string().valid('razorpay', 'cod', 'wallet').required(),
  customerNote:  Joi.string().max(300).optional().allow(''),
  walletAmount:  Joi.number().min(0).default(0),
});

export const verifyPaymentSchema = Joi.object({
  orderId:            objectId,
  razorpayOrderId:   Joi.string().required(),
  razorpayPaymentId: Joi.string().required(),
  razorpaySignature: Joi.string().required(),
});

export const cancelOrderSchema = Joi.object({
  reason: Joi.string().min(5).max(300).required(),
});

export const returnRequestSchema = Joi.object({
  itemId: objectId,
  reason: Joi.string().min(5).max(300).required(),
});

export const updateItemStatusSchema = Joi.object({
  status:         Joi.string().valid('processing', 'packed', 'shipped').required(),
  trackingNumber: Joi.string().optional().allow(''),
  carrier:        Joi.string().optional().allow(''),
});

export const adminUpdateStatusSchema = Joi.object({
  status: Joi.string().valid(
    'confirmed', 'processing', 'shipped',
    'out_for_delivery', 'delivered', 'cancelled',
    'refund_initiated', 'refunded'
  ).required(),
  note: Joi.string().max(300).optional(),
});

export const refundSchema = Joi.object({
  amount: Joi.number().min(1).optional(),
  reason: Joi.string().min(5).required(),
});