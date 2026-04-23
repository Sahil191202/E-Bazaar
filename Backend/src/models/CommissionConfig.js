import mongoose from 'mongoose';

const commissionConfigSchema = new mongoose.Schema({
  // ← NO unique:true here, NO sparse:true here
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  rate:        { type: Number, required: true, min: 0, max: 100 },
  description: { type: String, default: '' },

  categoryRates: [{
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    rate:     Number,
  }],

  isActive:  { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ✅ One place only
commissionConfigSchema.index({ vendor: 1 }, { unique: true, sparse: true });

export const CommissionConfig = mongoose.model('CommissionConfig', commissionConfigSchema);