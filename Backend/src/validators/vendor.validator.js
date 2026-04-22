import Joi from 'joi';

export const registerVendorSchema = Joi.object({
  storeName:    Joi.string().min(3).max(100).required(),
  storeDesc:    Joi.string().max(500).optional().allow(''),
  storeEmail:   Joi.string().email().optional(),
  storePhone:   Joi.string().pattern(/^[6-9]\d{9}$/).optional(),
  panNumber:    Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/).required()
    .messages({ 'string.pattern.base': 'Invalid PAN number format' }),
  gstNumber:    Joi.string().pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional()
    .messages({ 'string.pattern.base': 'Invalid GST number format' }),
  storeAddress: Joi.object({
    line1:   Joi.string().required(),
    city:    Joi.string().required(),
    state:   Joi.string().required(),
    pincode: Joi.string().pattern(/^\d{6}$/).required(),
  }).optional(),
});

export const bankDetailsSchema = Joi.object({
  accountHolderName: Joi.string().min(2).max(100).required(),
  accountNumber:     Joi.string().min(9).max(18).required(),
  ifscCode:          Joi.string().pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/).required()
    .messages({ 'string.pattern.base': 'Invalid IFSC code' }),
  bankName:          Joi.string().required(),
  branchName:        Joi.string().optional(),
});

export const createCouponSchema = Joi.object({
  code:            Joi.string().min(3).max(20).uppercase().required(),
  description:     Joi.string().max(200).optional(),
  discountType:    Joi.string().valid('flat', 'percent').required(),
  discountValue:   Joi.number().min(1).required(),
  maxDiscount:     Joi.number().min(1).optional(),
  minOrderValue:   Joi.number().min(0).default(0),
  maxUses:         Joi.number().min(1).optional(),
  maxUsesPerUser:  Joi.number().min(1).default(1),
  expiresAt:       Joi.date().greater('now').required(),
  startsAt:        Joi.date().optional(),
  applicableTo:    Joi.string().valid('all', 'specific_products').default('specific_products'),
  allowedProducts: Joi.array()
    .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .optional(),
});

export const payoutRequestSchema = Joi.object({
  amount: Joi.number().min(100).optional(),
});

export const kycReviewSchema = Joi.object({
  action:                  Joi.string().valid('approve', 'reject').required(),
  reason:                  Joi.string().when('action', { is: 'reject', then: Joi.required() }),
  documentId:              Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  documentStatus:          Joi.string().valid('approved', 'rejected').optional(),
  documentRejectionReason: Joi.string().optional(),
});

export const processPayoutSchema = Joi.object({
  action:        Joi.string().valid('complete', 'fail').required(),
  transactionId: Joi.string().when('action', { is: 'complete', then: Joi.required() }),
  failReason:    Joi.string().optional(),
});