import Joi from 'joi';

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required();

export const addToCartSchema = Joi.object({
  productId: objectId,
  variantId: objectId,
  quantity:  Joi.number().integer().min(1).max(10).default(1),
});

export const updateCartItemSchema = Joi.object({
  quantity: Joi.number().integer().min(1).max(10).required(),
});

export const applyCouponSchema = Joi.object({
  code: Joi.string().min(3).max(30).uppercase().required(),
});

export const mergeCartSchema = Joi.object({
  guestItems: Joi.array().items(Joi.object({
    productId: objectId,
    variantId: objectId,
    quantity:  Joi.number().integer().min(1).max(10),
  })).max(50).required(),
});

export const addAddressSchema = Joi.object({
  label:     Joi.string().max(20).default('Home'),
  fullName:  Joi.string().min(2).max(100).required(),
  phone:     Joi.string().pattern(/^[6-9]\d{9}$/).required(),
  line1:     Joi.string().min(5).max(200).required(),
  line2:     Joi.string().max(200).optional().allow(''),
  city:      Joi.string().min(2).max(100).required(),
  state:     Joi.string().min(2).max(100).required(),
  pincode:   Joi.string().pattern(/^\d{6}$/).required(),
  country:   Joi.string().default('India'),
  isDefault: Joi.boolean().default(false),
});

export const moveToCartSchema = Joi.object({
  variantId: objectId,
});