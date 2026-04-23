import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  subtitle:    { type: String, default: '' },
  imageUrl:    { type: String, required: true },
  publicId:    { type: String, required: true },
  mobileImageUrl: { type: String, default: '' }, // Separate image for mobile

  // Where clicking the banner goes
  linkType: {
    type: String,
    enum: ['product', 'category', 'vendor', 'url', 'none'],
    default: 'none',
  },
  linkValue: { type: String, default: '' }, // product slug, category slug, url, etc.

  placement: {
    type: String,
    enum: ['hero', 'mid_page', 'sidebar', 'popup', 'category_top'],
    default: 'hero',
  },

  isActive:  { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },

  // Scheduling
  startsAt:  { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },

  // Targeting
  targetAudience: {
    type: String,
    enum: ['all', 'new_users', 'returning_users'],
    default: 'all',
  },

  clickCount: { type: Number, default: 0 },
  viewCount:  { type: Number, default: 0 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

bannerSchema.index({ placement: 1, isActive: 1, sortOrder: 1 });
bannerSchema.index({ expiresAt: 1 });

export const Banner = mongoose.model('Banner', bannerSchema);