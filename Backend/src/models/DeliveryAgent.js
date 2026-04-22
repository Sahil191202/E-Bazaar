import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema({
  type:         { type: String, enum: ['bike', 'bicycle', 'scooter', 'car', 'van'], required: true },
  number:       { type: String, required: true, uppercase: true, trim: true },
  model:        { type: String, trim: true },
  color:        { type: String, trim: true },
  rcUrl:        String, // Registration certificate image
  insuranceUrl: String,
  rcPublicId:   String,
}, { _id: false });

const locationSchema = new mongoose.Schema({
  type:        { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
}, { _id: false });

const agentDocumentSchema = new mongoose.Schema({
  type:      { type: String, enum: ['aadhar', 'pan', 'driving_license', 'vehicle_rc', 'insurance'] },
  url:       String,
  publicId:  String,
  status:    { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rejectionReason: String,
  verifiedAt: Date,
}, { _id: true });

const deliveryAgentSchema = new mongoose.Schema({
  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    unique:   true,
  },

  // ─── Profile ──────────────────────────────────────────────────────────────
  agentCode:   { type: String, unique: true }, // Human-readable: AGT-00001
  vehicle:     vehicleSchema,
  documents:   [agentDocumentSchema],

  // ─── KYC ──────────────────────────────────────────────────────────────────
  kycStatus: {
    type:    String,
    enum:    ['not_submitted', 'pending', 'approved', 'rejected'],
    default: 'not_submitted',
  },
  kycRejectionReason: String,

  // ─── Availability ──────────────────────────────────────────────────────────
  isOnline:      { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },

  // ─── Location (GeoJSON — updated via Redis, persisted periodically) ────────
  lastLocation:     locationSchema,
  lastLocationAt:   Date,
  currentZone:      String, // City/zone for routing

  // ─── Current assignment ────────────────────────────────────────────────────
  activeDelivery: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'Order',
    default: null,
  },

  // ─── Service area ─────────────────────────────────────────────────────────
  serviceZones: [String], // e.g. ['Mumbai-North', 'Mumbai-West']

  // ─── Earnings summary (denormalized) ──────────────────────────────────────
  totalEarnings:       { type: Number, default: 0 },
  pendingPayout:       { type: Number, default: 0 },
  totalPaidOut:        { type: Number, default: 0 },
  totalDeliveries:     { type: Number, default: 0 },
  totalFailedAttempts: { type: Number, default: 0 },
  avgRating:           { type: Number, default: 0 },
  totalRatings:        { type: Number, default: 0 },

  // ─── Bank Details ─────────────────────────────────────────────────────────
  bankDetails: {
    accountHolderName: String,
    accountNumber:     String,
    ifscCode:          String,
    bankName:          String,
  },

}, { timestamps: true });

// Auto-generate agent code
deliveryAgentSchema.pre('save', async function (next) {
  if (!this.agentCode) {
    const count     = await this.constructor.countDocuments();
    this.agentCode  = `AGT-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Geo index for proximity queries
deliveryAgentSchema.index({ lastLocation: '2dsphere' });
deliveryAgentSchema.index({ user: 1 });
deliveryAgentSchema.index({ isOnline: 1, isActive: 1 });
deliveryAgentSchema.index({ kycStatus: 1 });

export const DeliveryAgent = mongoose.model('DeliveryAgent', deliveryAgentSchema);