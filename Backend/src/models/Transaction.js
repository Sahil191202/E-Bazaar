import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order:  { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

  type: {
    type:     String,
    enum:     ['credit', 'debit'],
    required: true,
  },

  category: {
    type: String,
    enum: ['order_payment', 'refund', 'wallet_topup', 'payout', 'cashback', 'adjustment'],
    required: true,
  },

  amount:          { type: Number, required: true, min: 0 },
  balanceBefore:   { type: Number, required: true },
  balanceAfter:    { type: Number, required: true },
  currency:        { type: String, default: 'INR' },

  description:     { type: String, required: true },
  referenceId:     String,  // Razorpay payment ID, payout ID, etc.
  referenceType:   { type: String, enum: ['Order', 'Payout', 'Manual', 'Refund'] },

  status:          { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  failureReason:   String,

  metadata:        { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ order: 1 });
transactionSchema.index({ category: 1, createdAt: -1 });
transactionSchema.index({ referenceId: 1 });

export const Transaction = mongoose.model('Transaction', transactionSchema);