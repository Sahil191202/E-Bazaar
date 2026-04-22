import Joi from 'joi';

export const registerAgentSchema = Joi.object({
  vehicleType:   Joi.string().valid('bike', 'bicycle', 'scooter', 'car', 'van').required(),
  vehicleNumber: Joi.string().min(4).max(15).required(),
  vehicleModel:  Joi.string().max(50).optional(),
  vehicleColor:  Joi.string().max(30).optional(),
  serviceZones:  Joi.array().items(Joi.string()).optional(),
});

export const locationUpdateSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
});

export const pickupSchema = Joi.object({
  lat:  Joi.number().min(-90).max(90).required(),
  lng:  Joi.number().min(-180).max(180).required(),
  note: Joi.string().max(200).optional(),
});

export const otpDeliverSchema = Joi.object({
  otp: Joi.string().length(4).pattern(/^\d+$/).required(),
  lat: Joi.number().required(),
  lng: Joi.number().required(),
});

export const failedAttemptSchema = Joi.object({
  reason: Joi.string().min(5).max(300).required(),
  lat:    Joi.number().optional(),
  lng:    Joi.number().optional(),
});

export const rateAgentSchema = Joi.object({
  rating:   Joi.number().min(1).max(5).integer().required(),
  feedback: Joi.string().max(300).optional(),
});

export const adminAssignSchema = Joi.object({
  orderId:     Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  agentUserId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
});