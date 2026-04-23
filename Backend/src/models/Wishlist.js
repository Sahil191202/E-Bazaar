import mongoose from 'mongoose';

const wishlistItemSchema = new mongoose.Schema({
  product:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null }, // optional preferred variant
  addedAt:   { type: Date, default: Date.now },
}, { _id: true });

const wishlistSchema = new mongoose.Schema({
  user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
  items: [wishlistItemSchema],
}, { timestamps: true });

wishlistSchema.index({ user: 1 }, { unique: true });
wishlistSchema.index({ 'items.product': 1 });

export const Wishlist = mongoose.model('Wishlist', wishlistSchema);