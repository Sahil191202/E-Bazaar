import { User }        from '../models/User.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError }    from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { delCache }    from '../config/redis.js';
import bcrypt from "bcryptjs";
import { getRedis } from "../config/redis.js";
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
//  GET ALL ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────

export const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('addresses');
  res.json(new ApiResponse(200, { addresses: user.addresses }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADD ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

export const addAddress = asyncHandler(async (req, res) => {
  const { label, fullName, phone, line1, line2, city, state, pincode, country, isDefault } = req.body;

  const user = await User.findById(req.user._id);
  if (user.addresses.length >= 10) throw new ApiError(400, 'Maximum 10 addresses allowed');

  const newAddress = { label, fullName, phone, line1, line2, city, state, pincode, country: country || 'India' };

  // If this is the first address or set as default, unset all others
  if (isDefault || user.addresses.length === 0) {
    user.addresses.forEach((a) => { a.isDefault = false; });
    newAddress.isDefault = true;
  }

  user.addresses.push(newAddress);
  await user.save();

  await delCache(`user:${req.user._id}`);

  const added = user.addresses[user.addresses.length - 1];
  res.status(201).json(new ApiResponse(201, { address: added }, 'Address added'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

export const updateAddress = asyncHandler(async (req, res) => {
  const { addressId } = req.params;
  const { label, fullName, phone, line1, line2, city, state, pincode, country, isDefault } = req.body;

  const user = await User.findById(req.user._id);
  const address = user.addresses.id(addressId);
  if (!address) throw new ApiError(404, 'Address not found');

  if (label)    address.label    = label;
  if (fullName) address.fullName = fullName;
  if (phone)    address.phone    = phone;
  if (line1)    address.line1    = line1;
  if (line2 !== undefined) address.line2 = line2;
  if (city)     address.city     = city;
  if (state)    address.state    = state;
  if (pincode)  address.pincode  = pincode;
  if (country)  address.country  = country;

  if (isDefault) {
    user.addresses.forEach((a) => { a.isDefault = false; });
    address.isDefault = true;
  }

  await user.save();
  await delCache(`user:${req.user._id}`);

  res.json(new ApiResponse(200, { address }, 'Address updated'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

export const deleteAddress = asyncHandler(async (req, res) => {
  const { addressId } = req.params;

  const user = await User.findById(req.user._id);
  const address = user.addresses.id(addressId);
  if (!address) throw new ApiError(404, 'Address not found');

  const wasDefault = address.isDefault;
  user.addresses.pull(addressId);

  // If deleted address was default, make the first remaining one default
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save();
  await delCache(`user:${req.user._id}`);

  res.json(new ApiResponse(200, null, 'Address deleted'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  SET DEFAULT ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

export const setDefaultAddress = asyncHandler(async (req, res) => {
  const { addressId } = req.params;

  const user = await User.findById(req.user._id);
  const address = user.addresses.id(addressId);
  if (!address) throw new ApiError(404, 'Address not found');

  user.addresses.forEach((a) => { a.isDefault = false; });
  address.isDefault = true;

  await user.save();
  await delCache(`user:${req.user._id}`);

  res.json(new ApiResponse(200, { addresses: user.addresses }, 'Default address updated'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET / UPDATE PROFILE
// ─────────────────────────────────────────────────────────────────────────────

export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('-refreshTokens -fcmTokens')
    .lean();
  if (!user) throw new ApiError(404, 'User not found');
  res.json(new ApiResponse(200, { user }));
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, avatar } = req.body;
  const allowedUpdates = {};

  if (name)   allowedUpdates.name   = name;
  if (avatar) allowedUpdates.avatar = avatar;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: allowedUpdates },
    { new: true, runValidators: true }
  ).select('-refreshTokens -fcmTokens');

  await delCache(`user:${req.user._id}`);

  res.json(new ApiResponse(200, { user }, 'Profile updated'));
});

// ── Send OTP to new email ─────────────────────────────────────────────────────
export const sendEmailChangeOTP = asyncHandler(async (req, res) => {
  const redis = getRedis();
  const { email } = req.body;
  if (!email) throw new ApiError(400, 'Email required');

  const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.user.id } });
  if (existing) throw new ApiError(409, 'Email already in use');

  const otp  = Math.floor(100000 + Math.random() * 900000).toString();
  const hash = await bcrypt.hash(otp, 10);

  await redis.setEx(`email_change:${req.user.id}`, 300, JSON.stringify({ email, hash }));

  // Dev: print OTP
  logger.info(`[EMAIL CHANGE OTP DEV] ${email} → ${otp}`);
  // Prod: await sendEmail({ to: email, subject: 'Verify new email', text: `OTP: ${otp}` });

  res.json(new ApiResponse(200, {}, 'OTP sent'));
});

// ── Verify OTP and update email ───────────────────────────────────────────────
export const verifyEmailChange = asyncHandler(async (req, res) => {
  const redis = getRedis();

  const { otp } = req.body;

  const stored  = await redis.get(`email_change:${req.user.id}`);
  if (!stored) throw new ApiError(400, 'OTP expired or not requested');

  const { email, hash } = JSON.parse(stored);
  const valid = await bcrypt.compare(otp, hash);
  if (!valid) throw new ApiError(400, 'Invalid OTP');

  await User.findByIdAndUpdate(req.user.id, {
    email:           email.toLowerCase(),
    isEmailVerified: true,
  });
  await redis.del(`email_change:${req.user.id}`);

  res.json(new ApiResponse(200, {}, 'Email updated'));
});

// ── Send OTP to new phone ─────────────────────────────────────────────────────
export const sendPhoneChangeOTP = asyncHandler(async (req, res) => {
  const redis = getRedis();

  const { phone } = req.body;
  if (!phone) throw new ApiError(400, 'Phone required');

  const existing = await User.findOne({ phone, _id: { $ne: req.user.id } });
  if (existing) throw new ApiError(409, 'Phone already in use');

  const otp  = Math.floor(100000 + Math.random() * 900000).toString();
  const hash = await bcrypt.hash(otp, 10);

  await redis.setEx(`phone_change:${req.user.id}`, 300, JSON.stringify({ phone, hash }));
  logger.info(`[PHONE CHANGE OTP DEV] ${phone} → ${otp}`);

  res.json(new ApiResponse(200, {}, 'OTP sent to phone'));
});

// ── Verify OTP and update phone ───────────────────────────────────────────────
export const verifyPhoneChange = asyncHandler(async (req, res) => {
  const redis = getRedis();

  const { otp } = req.body;
  const stored  = await redis.get(`phone_change:${req.user.id}`);
  if (!stored) throw new ApiError(400, 'OTP expired or not requested');

  const { phone, hash } = JSON.parse(stored);
  const valid = await bcrypt.compare(otp, hash);
  if (!valid) throw new ApiError(400, 'Invalid OTP');

  await User.findByIdAndUpdate(req.user.id, {
    phone,
    isPhoneVerified: true,
  });
  await redis.del(`phone_change:${req.user.id}`);

  res.json(new ApiResponse(200, {}, 'Phone updated'));
});