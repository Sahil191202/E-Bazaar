import mongoose from 'mongoose';

const policySchema = new mongoose.Schema({
  type: {
    type:     String,
    enum:     ['privacy_policy', 'terms_of_service', 'return_policy', 'shipping_policy', 'cancellation_policy', 'vendor_agreement'],
    required: true,
    unique:   true,
  },

  title:   { type: String, required: true },
  content: { type: String, required: true }, // HTML or Markdown
  version: { type: String, default: '1.0' },

  isPublished: { type: Boolean, default: false },
  publishedAt: Date,

  // Version history (keep last 5)
  history: [{
    version:     String,
    content:     String,
    updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt:   { type: Date, default: Date.now },
    changeNotes: String,
  }],

  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const Policy = mongoose.model('Policy', policySchema);