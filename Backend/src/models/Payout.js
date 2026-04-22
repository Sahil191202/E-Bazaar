import mongoose from 'mongoose';

const payoutItemSchema = new mongoose.Schema({
  order:        { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  orderItemId:  mongoose.Schema.Types.ObjectId,
  amount:       Number,
  settledAt:    Date,
}, { _id: false });

const payoutSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  amount:    { type: Number, required: true, min: 0 },
  currency:  { type: String, default: 'INR' },

  status: {
    type:    String,
    enum:    ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },

  // Orders included in this payout
  orders:    [payoutItemSchema],

  // Payment details
  method:            { type: String, enum: ['bank_transfer', 'upi', 'wallet'], default: 'bank_transfer' },
  transactionId:     String,
  transactionNote:   String,
  bankAccountLast4:  String,

  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin
  initiatedAt: Date,
  completedAt: Date,
  failedAt:    Date,
  failReason:  String,

  period: {
    from: Date,
    to:   Date,
  },
}, { timestamps: true });

payoutSchema.index({ vendor: 1, status: 1 });
payoutSchema.index({ status: 1, createdAt: -1 });

export const Payout = mongoose.model('Payout', payoutSchema);