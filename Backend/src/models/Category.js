import mongoose from 'mongoose';
import slugify  from 'slugify';

const categorySchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  slug:        { type: String, unique: true },
  description: { type: String, default: '' },
  image:       { type: String, default: '' },

  // Self-referencing for multi-level tree: Root → Level1 → Level2
  parent:    { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  level:     { type: Number, default: 0 }, // 0=root, 1=sub, 2=sub-sub

  isActive:  { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },

  // SEO
  metaTitle:       String,
  metaDescription: String,
}, { timestamps: true });

// Auto-generate slug
categorySchema.pre('save', async function (next) {
  if (this.isModified('name')) {
    let slug = slugify(this.name, { lower: true, strict: true });
    // Ensure uniqueness
    const existing = await this.constructor.findOne({ slug, _id: { $ne: this._id } });
    if (existing) slug = `${slug}-${Date.now()}`;
    this.slug = slug;
  }
  next();
});

// Indexes
categorySchema.index({ parent: 1 });
categorySchema.index({ slug: 1 });
categorySchema.index({ isActive: 1, sortOrder: 1 });

export const Category = mongoose.model('Category', categorySchema);