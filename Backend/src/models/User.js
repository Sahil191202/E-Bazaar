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
  // No index:true here — defined below in schema.index()
  email:  { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  phone:  { type: String, unique: true, sparse: true, trim: true },
  avatar: { type: String, default: '' },
  role:   { type: String, enum: ['customer', 'vendor', 'agent', 'admin'], default: 'customer' },

  firebaseUid: { type: String, unique: true, sparse: true },
  googleId:    { type: String, unique: true, sparse: true },
  appleId:     { type: String, unique: true, sparse: true },

  authProviders: [{
    provider:   { type: String, enum: ['phone', 'google', 'apple', 'email'] },
    providerId: String,
    linkedAt:   { type: Date, default: Date.now },
  }],

  isPhoneVerified: { type: Boolean, default: false },
  isEmailVerified: { type: Boolean, default: false },
  isActive:        { type: Boolean, default: true },
  isBanned:        { type: Boolean, default: false },
  banReason:       String,

  walletBalance: { type: Number, default: 0, min: 0 },
  addresses:     [addressSchema],

  refreshTokens: [{
    token:     String,
    device:    String,
    createdAt: { type: Date, default: Date.now },
  }],

  fcmTokens: [{
    token:    String,
    platform: { type: String, enum: ['android', 'ios', 'web'] },
  }],

  lastLogin: Date,
}, { timestamps: true });

// ✅ Only compound / non-unique indexes here
// unique: true on the field itself already creates the index
userSchema.index({ role: 1, isActive: 1 });

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.refreshTokens;
  return obj;
};

export const User = mongoose.model('User', userSchema);