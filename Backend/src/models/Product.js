import mongoose from 'mongoose';
import slugify  from 'slugify';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const imageSchema = new mongoose.Schema({
  url:       { type: String, required: true },
  publicId:  { type: String, required: true }, // Cloudinary public_id for deletion
  alt:       { type: String, default: '' },
  isPrimary: { type: Boolean, default: false },
}, { _id: true });

// Each variant = one purchasable SKU (e.g. Red/XL, Blue/M)
const variantSchema = new mongoose.Schema({
  sku:      { type: String, required: true },
  price:    { type: Number, required: true, min: 0 },
  mrp:      { type: Number, required: true, min: 0 }, // Max retail price (for discount display)
  stock:    { type: Number, required: true, default: 0, min: 0 },
  
  // Variant attributes (e.g. { color: 'Red', size: 'XL' })
  attributes: { type: Map, of: String, default: {} },
  
  images:   [imageSchema],
  isActive: { type: Boolean, default: true },

  // Low stock threshold (vendor can configure per variant)
  lowStockThreshold: { type: Number, default: 5 },

  // Weight & dimensions for shipping calculation
  weight: { type: Number, default: 0 }, // in grams
  dimensions: {
    length: { type: Number, default: 0 }, // cm
    width:  { type: Number, default: 0 },
    height: { type: Number, default: 0 },
  },
}, { _id: true });

// Rating summary (computed, not real-time from reviews collection)
const ratingSchema = new mongoose.Schema({
  average: { type: Number, default: 0, min: 0, max: 5 },
  count:   { type: Number, default: 0 },
  // Distribution: { 1: 10, 2: 5, 3: 20, 4: 30, 5: 100 }
  distribution: { type: Map, of: Number, default: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } },
}, { _id: false });

// ─── Main Product Schema ──────────────────────────────────────────────────────

const productSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  slug:        { type: String, unique: true },
  description: { type: String, required: true },
  shortDesc:   { type: String, default: '' }, // For cards/listings

  // Ownership
  vendor:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Taxonomy
  category:    { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  subCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  brand:       { type: String, trim: true, default: '' },
  tags:        [{ type: String, trim: true, lowercase: true }],

  // Images (product-level images, not variant-specific)
  images: [imageSchema],

  // Variants (at least one required)
  variants: {
    type:     [variantSchema],
    validate: [(v) => v.length > 0, 'At least one variant is required'],
  },

  // Convenience fields (derived from cheapest active variant, updated on save)
  basePrice:   { type: Number, default: 0 }, // lowest variant price
  maxPrice:    { type: Number, default: 0 }, // highest variant price
  baseMrp:     { type: Number, default: 0 },
  totalStock:  { type: Number, default: 0 }, // sum of all variant stocks

  // Ratings (denormalized for query performance)
  rating: { type: ratingSchema, default: () => ({}) },

  // Status
  status: {
    type:    String,
    enum:    ['draft', 'pending_approval', 'active', 'rejected', 'archived'],
    default: 'draft',
  },
  rejectionReason: String,

  // Flags
  isFeatured:   { type: Boolean, default: false },
  isBestSeller: { type: Boolean, default: false },
  isNewArrival: { type: Boolean, default: false },

  // Shipping
  isFreeShipping: { type: Boolean, default: false },
  shippingCharge: { type: Number, default: 0 },

  // SEO
  metaTitle:       String,
  metaDescription: String,

  // Analytics (updated by background jobs)
  viewCount:     { type: Number, default: 0 },
  purchaseCount: { type: Number, default: 0 },
  wishlistCount: { type: Number, default: 0 },
}, { timestamps: true });

// ─── Pre-save hooks ───────────────────────────────────────────────────────────

productSchema.pre('save', async function (next) {
  // 1. Auto-slug
  if (this.isModified('name')) {
    let slug = slugify(this.name, { lower: true, strict: true });
    const existing = await this.constructor.findOne({ slug, _id: { $ne: this._id } });
    if (existing) slug = `${slug}-${Date.now()}`;
    this.slug = slug;
  }

  // 2. Derive convenience price/stock fields from variants
  if (this.isModified('variants')) {
    const active = this.variants.filter((v) => v.isActive);
    if (active.length) {
      this.basePrice  = Math.min(...active.map((v) => v.price));
      this.maxPrice   = Math.max(...active.map((v) => v.price));
      this.baseMrp    = Math.min(...active.map((v) => v.mrp));
      this.totalStock = active.reduce((sum, v) => sum + v.stock, 0);
    }
  }
  next();
});

// ─── Indexes (critical for search & filter performance) ───────────────────────

productSchema.index({ name: 'text', description: 'text', brand: 'text', tags: 'text' });
productSchema.index({ slug: 1 });
productSchema.index({ vendor: 1, status: 1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ status: 1, basePrice: 1 });
productSchema.index({ status: 1, 'rating.average': -1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ status: 1, purchaseCount: -1 });
productSchema.index({ isFeatured: 1, status: 1 });
productSchema.index({ tags: 1, status: 1 });
productSchema.index({ brand: 1, status: 1 });
productSchema.index({ totalStock: 1 });

// ─── Instance method: update rating summary ───────────────────────────────────
productSchema.methods.updateRatingSummary = async function (newRating, oldRating = null) {
  const dist = this.rating.distribution;

  if (oldRating) {
    const oldKey = String(Math.round(oldRating));
    dist.set(oldKey, Math.max(0, (dist.get(oldKey) || 0) - 1));
  }

  const newKey = String(Math.round(newRating));
  dist.set(newKey, (dist.get(newKey) || 0) + 1);

  const total = [...dist.values()].reduce((a, b) => a + b, 0);
  const sum   = [...dist.entries()].reduce((a, [k, v]) => a + Number(k) * v, 0);

  this.rating.average = total ? parseFloat((sum / total).toFixed(1)) : 0;
  this.rating.count   = total;
  this.rating.distribution = dist;
};

export const Product = mongoose.model('Product', productSchema);