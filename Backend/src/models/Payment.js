import mongoose from 'mongoose';

// Audit log for every payment event
const paymentSchema = new mongoose.Schema({
  order:    { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },

  amount:   { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  method: {
    type: String,
    enum: ['razorpay', 'cod', 'wallet', 'refund'],
    required: true,
  },

  status: {
    type: String,
    enum: ['created', 'captured', 'failed', 'refunded'],
    required: true,
  },

  // Razorpay
  razorpayOrderId:   String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  razorpayRefundId:  String,

  // Raw webhook/response payload for debugging
  gatewayResponse: mongoose.Schema.Types.Mixed,

  failureReason: String,
  note:          String,
}, { timestamps: true });

paymentSchema.index({ order: 1 });
paymentSchema.index({ customer: 1, createdAt: -1 });
paymentSchema.index({ razorpayOrderId: 1 });

export const Payment = mongoose.model('Payment', paymentSchema);