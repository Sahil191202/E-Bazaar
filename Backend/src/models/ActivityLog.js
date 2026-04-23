import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userRole:  String,
  action:    { type: String, required: true }, // e.g. 'login', 'order_placed', 'product_updated'
  entity:    String,  // 'Order', 'Product', 'User', etc.
  entityId:  mongoose.Schema.Types.ObjectId,
  detail:    String,  // Human-readable description

  // Request metadata
  ip:        String,
  userAgent: String,
  method:    String,
  path:      String,

  // Risk signals
  riskScore:  { type: Number, default: 0 }, // 0-100
  flagged:    { type: Boolean, default: false },
  flagReason: String,

  // Response
  statusCode: Number,
  success:    Boolean,
}, { timestamps: true });

activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ flagged: 1, createdAt: -1 });
activityLogSchema.index({ ip: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 });

// Auto-delete logs older than 90 days
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);