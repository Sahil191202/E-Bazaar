import mongoose from 'mongoose';

// Standalone order item — mirrors the embedded schema in Order
// Useful for vendor-specific item queries without loading full order
const orderItemSchema = new mongoose.Schema({
  order:    { type: mongoose.Schema.Types.ObjectId, ref: 'Order',   required: true },
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  vendor:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },

  variantId:  { type: mongoose.Schema.Types.ObjectId, required: true },
  name:       { type: String, required: true },
  image:      { type: String, default: '' },
  sku:        { type: String, required: true },
  attributes: { type: Map, of: String, default: {} },

  quantity: { type: Number, required: true, min: 1 },
  price:    { type: Number, required: true },
  mrp:      { type: Number, required: true },
  total:    { type: Number, required: true },

  status: {
    type:    String,
    enum:    ['confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled','return_requested','returned'],
    default: 'confirmed',
  },

  commissionRate:  { type: Number, default: 0 },
  vendorEarning:   { type: Number, default: 0 },
  platformEarning: { type: Number, default: 0 },

  trackingNumber: String,
  carrier:        String,
  deliveryAgent:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  cancelledAt:  Date,
  cancelReason: String,
  deliveredAt:  Date,
  returnReason: String,
  returnedAt:   Date,
}, { timestamps: true });

orderItemSchema.index({ order: 1 });
orderItemSchema.index({ vendor: 1, status: 1 });
orderItemSchema.index({ customer: 1 });
orderItemSchema.index({ product: 1 });

export const OrderItem = mongoose.model('OrderItem', orderItemSchema);