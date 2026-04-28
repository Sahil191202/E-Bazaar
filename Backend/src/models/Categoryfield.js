import mongoose from 'mongoose';

/**
 * Supported field types:
 *  text        → <input type="text">
 *  textarea    → <textarea>
 *  number      → <input type="number">
 *  dropdown    → <select>   (single value from options[])
 *  radio       → <radio>    (single value from options[])
 *  checkbox    → <checkbox> (multiple values from options[])
 *  boolean     → Yes / No toggle (no options needed)
 *  date        → <input type="date">
 */

const FIELD_TYPES = ['text', 'textarea', 'number', 'dropdown', 'radio', 'checkbox', 'boolean', 'date'];

const fieldOptionSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },  // Display text
  value: { type: String, required: true, trim: true },  // Stored value (slug-like)
}, { _id: true });

const categoryFieldSchema = new mongoose.Schema({
  // Which category this field belongs to
  category: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Category',
    required: true,
    index:    true,
  },

  // Field identity
  label:       { type: String, required: true, trim: true },       // "Screen Size"
  key:         { type: String, trim: true },        // "screen_size" (auto-generated, used as payload key)
  description: { type: String, default: '' },                       // Help text shown below the field
  placeholder: { type: String, default: '' },                       // Input placeholder

  // Field type
  fieldType: {
    type:     String,
    enum:     FIELD_TYPES,
    required: true,
  },

  // Options — only relevant for dropdown / radio / checkbox
  options: {
    type:     [fieldOptionSchema],
    default:  [],
    validate: {
      validator(opts) {
        const typesNeedingOptions = ['dropdown', 'radio', 'checkbox'];
        if (typesNeedingOptions.includes(this.fieldType)) {
          return opts && opts.length >= 2;
        }
        return true; // other types don't need options
      },
      message: 'dropdown, radio, and checkbox fields require at least 2 options',
    },
  },

  // Validation rules
  isRequired:    { type: Boolean, default: false },
  isFilterable:  { type: Boolean, default: false }, // Show this field in search filters?
  isSearchable:  { type: Boolean, default: false }, // Include in full-text search?

  // For number fields
  minValue: { type: Number, default: null },
  maxValue: { type: Number, default: null },
  unit:     { type: String, default: '' }, // e.g. "inches", "GB", "MP"

  // For text / textarea fields
  minLength: { type: Number, default: null },
  maxLength: { type: Number, default: null },

  // Display order (lower = shown first)
  sortOrder: { type: Number, default: 0 },

  // Soft delete / hide without losing data
  isActive: { type: Boolean, default: true },

  // Audit
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

// ─── Auto-generate `key` from `label` ────────────────────────────────────────
categoryFieldSchema.pre('save', function (next) {
  // Generate key from label on new docs OR when label changes
  if (!this.key || this.isModified('label')) {
    this.key = this.label
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/__+/g, '_')
      .replace(/^_|_$/g, '');
  }
  next();
});

// ─── Compound uniqueness: one key per category ────────────────────────────────
categoryFieldSchema.index({ category: 1, key: 1 }, { unique: true });
categoryFieldSchema.index({ category: 1, isActive: 1, sortOrder: 1 });

export const CategoryField = mongoose.model('CategoryField', categoryFieldSchema);
export { FIELD_TYPES };