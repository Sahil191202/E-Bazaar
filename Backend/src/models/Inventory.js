import mongoose from 'mongoose';

// Separate collection for inventory movement audit trail
const inventoryLogSchema = new mongoose.Schema({
  product:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  vendor:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  type: {
    type: String,
    enum: ['restock', 'sale', 'return', 'adjustment', 'damaged'],
    required: true,
  },

  quantityBefore: { type: Number, required: true },
  quantityChange: { type: Number, required: true }, // +ve = added, -ve = reduced
  quantityAfter:  { type: Number, required: true },

  // Reference document (order ID for sales, etc.)
  referenceId:   mongoose.Schema.Types.ObjectId,
  referenceType: { type: String, enum: ['Order', 'Manual', 'Return', 'BulkUpload'] },

  note: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

inventoryLogSchema.index({ product: 1, variantId: 1, createdAt: -1 });
inventoryLogSchema.index({ vendor: 1, createdAt: -1 });

export const InventoryLog = mongoose.model('InventoryLog', inventoryLogSchema);