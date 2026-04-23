import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  order:    { type: mongoose.Schema.Types.ObjectId, ref: 'Order',   required: true },
  vendor:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },

  rating:  { type: Number, required: true, min: 1, max: 5 },
  title:   { type: String, trim: true, maxlength: 100 },
  body:    { type: String, trim: true, maxlength: 1000 },

  images:  [{ url: String, publicId: String }],

  isVerifiedPurchase: { type: Boolean, default: true },
  isApproved:         { type: Boolean, default: true },
  isFlagged:          { type: Boolean, default: false },
  flagReason:         String,

  helpfulCount:   { type: Number, default: 0 },
  helpfulVotes:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  vendorReply:    { type: String, trim: true, maxlength: 500 },
  vendorRepliedAt: Date,
}, { timestamps: true });

// One review per customer per product per order
reviewSchema.index({ product: 1, customer: 1, order: 1 }, { unique: true });
reviewSchema.index({ product: 1, isApproved: 1, createdAt: -1 });
reviewSchema.index({ customer: 1 });
reviewSchema.index({ vendor: 1 });
reviewSchema.index({ rating: 1 });

export const Review = mongoose.model('Review', reviewSchema);