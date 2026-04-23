import mongoose from 'mongoose';
import slugify  from 'slugify';

const categorySchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  // ← NO unique:true here
  slug:        { type: String },
  description: { type: String, default: '' },
  image:       { type: String, default: '' },

  parent:    { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  level:     { type: Number, default: 0 },

  isActive:  { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },

  metaTitle:       String,
  metaDescription: String,
}, { timestamps: true });

categorySchema.pre('save', async function (next) {
  if (this.isModified('name')) {
    let slug = slugify(this.name, { lower: true, strict: true });
    const existing = await this.constructor.findOne({ slug, _id: { $ne: this._id } });
    if (existing) slug = `${slug}-${Date.now()}`;
    this.slug = slug;
  }
  next();
});

// ✅ One place only
categorySchema.index({ slug: 1 },     { unique: true });
categorySchema.index({ parent: 1 });
categorySchema.index({ isActive: 1, sortOrder: 1 });

export const Category = mongoose.model('Category', categorySchema);