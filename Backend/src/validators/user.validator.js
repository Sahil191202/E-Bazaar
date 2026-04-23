import Joi from 'joi';

export const updateProfileSchema = Joi.object({
  name:   Joi.string().min(2).max(50).optional(),
  avatar: Joi.string().uri().optional(),
});

export const updateAddressSchema = Joi.object({
  label:     Joi.string().max(20).optional(),
  fullName:  Joi.string().min(2).max(100).optional(),
  phone:     Joi.string().pattern(/^[6-9]\d{9}$/).optional(),
  line1:     Joi.string().min(5).max(200).optional(),
  line2:     Joi.string().max(200).optional().allow(''),
  city:      Joi.string().min(2).max(100).optional(),
  state:     Joi.string().min(2).max(100).optional(),
  pincode:   Joi.string().pattern(/^\d{6}$/).optional(),
  country:   Joi.string().optional(),
  isDefault: Joi.boolean().optional(),
});

export const fcmTokenSchema = Joi.object({
  token:    Joi.string().min(10).required(),
  platform: Joi.string().valid('android', 'ios', 'web').required(),
});