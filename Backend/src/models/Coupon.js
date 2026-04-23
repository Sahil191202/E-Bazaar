import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code:        { type: String, required: true, uppercase: true, trim: true },
  description: { type: String, default: '' },

  discountType:  { type: String, enum: ['flat', 'percent'], required: true },
  discountValue: { type: Number, required: true, min: 0 },
  maxDiscount:   { type: Number, default: null }, // cap for percent discounts

  minOrderValue: { type: Number, default: 0 },
  maxUses:       { type: Number, default: null }, // null = unlimited
  usedCount:     { type: Number, default: 0 },

  // Per-user limit
  maxUsesPerUser: { type: Number, default: 1 },

  // Who can use it
  applicableTo: {
    type: String,
    enum: ['all', 'specific_users', 'specific_categories', 'specific_products'],
    default: 'all',
  },
  allowedUsers:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  allowedCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  allowedProducts:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

  // Created by (vendor for their products, admin for platform-wide)
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creatorRole: { type: String, enum: ['admin', 'vendor'], required: true },

  isActive:  { type: Boolean, default: true },
  expiresAt: { type: Date, required: true },
  startsAt:  { type: Date, default: Date.now },

  // Track usage per user
  usageLog: [{
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderId:   mongoose.Schema.Types.ObjectId,
    usedAt:    { type: Date, default: Date.now },
  }],
}, { timestamps: true });

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ isActive: 1, expiresAt: 1 });
couponSchema.index({ createdBy: 1 });

export const Coupon = mongoose.model('Coupon', couponSchema);