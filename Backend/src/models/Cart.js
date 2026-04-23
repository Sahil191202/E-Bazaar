import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
  product:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, required: true },

  quantity: { type: Number, required: true, min: 1, max: 10 },

  // Snapshot at time of adding — for detecting price changes
  priceSnapshot: { type: Number, required: true },
  mrpSnapshot:   { type: Number, required: true },
  nameSnapshot:  { type: String, required: true },
  imageSnapshot: { type: String, default: '' },
  skuSnapshot:   { type: String, required: true },
  attributesSnapshot: { type: Map, of: String, default: {} },
}, { _id: true, timestamps: true });

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  items: [cartItemSchema],

  // Applied coupon (optional)
  coupon: {
    code:        String,
    discountType: { type: String, enum: ['flat', 'percent'] },
    discountValue: Number,
    maxDiscount:   Number,
  },
}, { timestamps: true });

cartSchema.index({ user: 1 }, { unique: true });

export const Cart = mongoose.model('Cart', cartSchema);