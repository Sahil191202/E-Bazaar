import mongoose from 'mongoose';

const bankDetailsSchema = new mongoose.Schema({
  accountHolderName: { type: String, trim: true },
  accountNumber:     { type: String, trim: true },
  ifscCode:          { type: String, trim: true, uppercase: true },
  bankName:          { type: String, trim: true },
  branchName:        { type: String, trim: true },
  isVerified:        { type: Boolean, default: false },
}, { _id: false });

const kycDocumentSchema = new mongoose.Schema({
  type:      { type: String, enum: ['aadhar', 'pan', 'gst', 'bank_statement', 'cancelled_cheque'] },
  url:       { type: String, required: true },
  publicId:  String,
  status:    { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rejectionReason: String,
  uploadedAt: { type: Date, default: Date.now },
  verifiedAt: Date,
}, { _id: true });

const vendorSchema = new mongoose.Schema({
  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },

  // ─── Store Info ───────────────────────────────────────────────────────────
  storeName:    { type: String, required: true, trim: true },
  storeSlug:    { type: String, trim: true, lowercase: true },
  storeDesc:    { type: String, default: '' },
  storeLogo:    { type: String, default: '' },
  storeBanner:  { type: String, default: '' },
  storeEmail:   { type: String, trim: true, lowercase: true },
  storePhone:   { type: String, trim: true },
  storeAddress: {
    line1:   String,
    city:    String,
    state:   String,
    pincode: String,
    country: { type: String, default: 'India' },
  },

  // ─── KYC ─────────────────────────────────────────────────────────────────
  panNumber:  { type: String, trim: true, uppercase: true },
  gstNumber:  { type: String, trim: true, uppercase: true },
  aadharNumber: { type: String, trim: true }, // last 4 digits only stored
  documents:  [kycDocumentSchema],

  kycStatus: {
    type:    String,
    enum:    ['not_submitted', 'pending', 'approved', 'rejected'],
    default: 'not_submitted',
  },
  kycRejectionReason: String,
  kycSubmittedAt:     Date,
  kycApprovedAt:      Date,

  // ─── Bank Details (for payouts) ───────────────────────────────────────────
  bankDetails: { type: bankDetailsSchema, default: {} },

  // ─── Commission ───────────────────────────────────────────────────────────
  // Override global commission for this vendor (set by admin)
  commissionRate: { type: Number, default: null }, // null = use global default

  // ─── Financial Summary (denormalized for fast dashboard) ──────────────────
  totalEarnings:    { type: Number, default: 0 },
  pendingPayout:    { type: Number, default: 0 },
  totalPaidOut:     { type: Number, default: 0 },
  totalOrders:      { type: Number, default: 0 },
  totalProducts:    { type: Number, default: 0 },
  totalReviews:     { type: Number, default: 0 },
  avgRating:        { type: Number, default: 0 },

  // ─── Status ───────────────────────────────────────────────────────────────
  isActive:   { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false }, // Verified badge

  // ─── Settings ─────────────────────────────────────────────────────────────
  autoAcceptOrders: { type: Boolean, default: true },
  vacationMode:     { type: Boolean, default: false },
  vacationMessage:  String,

}, { timestamps: true });

vendorSchema.index({ user: 1 }, { unique: true });
vendorSchema.index({ storeSlug: 1 }, { unique: true });
vendorSchema.index({ kycStatus: 1 });
vendorSchema.index({ isActive: 1, isFeatured: -1 });

export const Vendor = mongoose.model('Vendor', vendorSchema);