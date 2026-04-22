import mongoose from 'mongoose';

const deliveryEventSchema = new mongoose.Schema({
  event: {
    type: String,
    enum: [
      'assigned', 'accepted', 'rejected', 'reached_vendor',
      'picked_up', 'in_transit', 'reached_customer',
      'otp_verified', 'delivered', 'failed_attempt',
      'returned_to_vendor',
    ],
    required: true,
  },
  location: {
    lat: Number,
    lng: Number,
  },
  note:      String,
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const deliverySchema = new mongoose.Schema({
  order:  { type: mongoose.Schema.Types.ObjectId, ref: 'Order',         required: true },
  agent:  { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryAgent', required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User',          required: true },

  // ─── Assignment ────────────────────────────────────────────────────────────
  assignedAt:   { type: Date, default: Date.now },
  acceptedAt:   Date,
  rejectedAt:   Date,
  rejectReason: String,

  // ─── Pickup ────────────────────────────────────────────────────────────────
  pickedUpAt: Date,
  pickupLocation: {
    lat: Number,
    lng: Number,
  },

  // ─── Delivery ─────────────────────────────────────────────────────────────
  deliveredAt: Date,
  deliveryLocation: {
    lat: Number,
    lng: Number,
  },

  // ─── Delivery verification ─────────────────────────────────────────────────
  // OTP sent to customer, agent enters it on delivery
  deliveryOtp:       String,    // stored hashed
  otpVerified:       { type: Boolean, default: false },
  otpVerifiedAt:     Date,

  proofType: {
    type: String,
    enum: ['otp', 'photo', 'signature', 'otp_and_photo'],
    default: 'otp',
  },
  proofImageUrl:    String,  // Photo of delivered package
  proofImagePublicId: String,
  signatureUrl:     String,  // Digital signature image

  // ─── Status ────────────────────────────────────────────────────────────────
  status: {
    type:    String,
    enum:    ['assigned', 'accepted', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled'],
    default: 'assigned',
  },

  // ─── Failed attempt ────────────────────────────────────────────────────────
  failedAttempts: { type: Number, default: 0 },
  lastFailReason: String,

  // ─── Timeline of events ────────────────────────────────────────────────────
  events: [deliveryEventSchema],

  // ─── Agent earnings for this delivery ─────────────────────────────────────
  agentEarning:    { type: Number, default: 0 },
  earningSettled:  { type: Boolean, default: false },

  // ─── Customer rating for agent ─────────────────────────────────────────────
  customerRating:  { type: Number, min: 1, max: 5 },
  customerFeedback: String,
  ratedAt:         Date,

  // ─── Distance ─────────────────────────────────────────────────────────────
  estimatedDistanceKm: { type: Number, default: 0 },
  actualDistanceKm:    { type: Number, default: 0 },

}, { timestamps: true });

deliverySchema.index({ order: 1 });
deliverySchema.index({ agent: 1, status: 1 });
deliverySchema.index({ status: 1, assignedAt: -1 });

export const Delivery = mongoose.model('Delivery', deliverySchema);