import mongoose from 'mongoose';
import bcrypt   from 'bcryptjs';

const addressSchema = new mongoose.Schema({
  label:     { type: String, default: 'Home' },
  fullName:  { type: String, required: true },
  phone:     { type: String, required: true },
  line1:     { type: String, required: true },
  line2:     String,
  city:      { type: String, required: true },
  state:     { type: String, required: true },
  pincode:   { type: String, required: true },
  country:   { type: String, default: 'India' },
  isDefault: { type: Boolean, default: false },
}, { _id: true });

const userSchema = new mongoose.Schema({
  name:   { type: String, required: true, trim: true },
  email:  { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  phone:  { type: String, unique: true, sparse: true, trim: true },
  avatar: { type: String, default: '' },
  role:   {
    type:    String,
    enum:    ['customer', 'vendor', 'agent', 'admin'],
    default: 'customer',
  },

  // ─── Auth providers ──────────────────────────────────────────────────────────
  // Firebase UID — set for phone-auth users and Firebase-OAuth users
  firebaseUid: { type: String, unique: true, sparse: true },

  // OAuth provider IDs (for users who sign in via Google/Apple directly
  // through your backend without going through Firebase)
  googleId:    { type: String, unique: true, sparse: true },
  appleId:     { type: String, unique: true, sparse: true },

  // Which providers this account has linked
  authProviders: [{
    provider:   { type: String, enum: ['phone', 'google', 'apple', 'email'] },
    providerId: String,               // UID / sub from that provider
    linkedAt:   { type: Date, default: Date.now },
  }],

  // ─── Verification flags ───────────────────────────────────────────────────
  isPhoneVerified: { type: Boolean, default: false },
  isEmailVerified: { type: Boolean, default: false },

  // ─── Account status ───────────────────────────────────────────────────────
  isActive:  { type: Boolean, default: true },
  isBanned:  { type: Boolean, default: false },
  banReason: String,

  // ─── Wallet ───────────────────────────────────────────────────────────────
  walletBalance: { type: Number, default: 0, min: 0 },

  // ─── Addresses ────────────────────────────────────────────────────────────
  addresses: [addressSchema],

  // ─── Refresh tokens (per device) ─────────────────────────────────────────
  refreshTokens: [{
    token:     String,
    device:    String,
    createdAt: { type: Date, default: Date.now },
  }],

  // ─── Push notification tokens ────────────────────────────────────────────
  fcmTokens: [{
    token:    String,
    platform: { type: String, enum: ['android', 'ios', 'web'] },
  }],

  lastLogin: Date,
}, { timestamps: true });

// Indexes
userSchema.index({ phone: 1 });
userSchema.index({ email: 1 });
userSchema.index({ firebaseUid: 1 });
userSchema.index({ role: 1, isActive: 1 });

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.refreshTokens;
  return obj;
};

export const User = mongoose.model('User', userSchema);