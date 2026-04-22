import Joi from 'joi';

// Firebase ID token is a long JWT string
const firebaseIdToken = Joi.string().min(100).required().messages({
  'string.min': 'Invalid Firebase ID token',
});

export const phoneVerifySchema = Joi.object({
  firebaseIdToken,
  name: Joi.string().min(2).max(50).optional(),
});

export const completeProfileSchema = Joi.object({
  firebaseIdToken,
  name: Joi.string().min(2).max(50).required(),
});

export const googleFirebaseSchema = Joi.object({
  firebaseIdToken,
});

export const googleTokenSchema = Joi.object({
  idToken: Joi.string().min(100).required(),
});

export const appleFirebaseSchema = Joi.object({
  firebaseIdToken,
});

export const linkProviderSchema = Joi.object({
  firebaseIdToken,
});