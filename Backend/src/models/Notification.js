import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  // null = broadcast to all
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  type: {
    type: String,
    enum: [
      'order_confirmed', 'order_update', 'order_delivered', 'order_cancelled',
      'payment', 'refund', 'payout_completed',
      'low_stock', 'out_of_stock',
      'kyc_update', 'new_order', 'new_delivery',
      'delivery_otp', 'delivery_failed', 'delivery_failed_attempt',
      'promotion', 'announcement', 'system',
      'no_agent_available',
    ],
    required: true,
  },

  title:   { type: String, required: true },
  message: { type: String, required: true },
  data:    { type: mongoose.Schema.Types.Mixed, default: {} },

  isRead:  { type: Boolean, default: false },
  readAt:  Date,

  // Push notification status
  pushSent:   { type: Boolean, default: false },
  pushSentAt: Date,

  // For bulk/broadcast notifications
  isBroadcast:    { type: Boolean, default: false },
  targetAudience: {
    type: String,
    enum: ['all', 'customers', 'vendors', 'agents', 'specific'],
    default: 'specific',
  },
}, { timestamps: true });

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ isBroadcast: 1, createdAt: -1 });
notificationSchema.index({ type: 1 });

// Auto-delete notifications older than 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema);