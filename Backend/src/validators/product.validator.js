import Joi from 'joi';

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required();

const variantSchema = Joi.object({
  sku:               Joi.string().required(),
  price:             Joi.number().min(0).required(),
  mrp:               Joi.number().min(Joi.ref('price')).required(),
  stock:             Joi.number().min(0).default(0),
  attributes:        Joi.object().default({}),
  weight:            Joi.number().min(0).default(0),
  lowStockThreshold: Joi.number().min(0).default(5),
  dimensions: Joi.object({
    length: Joi.number().min(0).default(0),
    width:  Joi.number().min(0).default(0),
    height: Joi.number().min(0).default(0),
  }).default({}),
});

export const createProductSchema = Joi.object({
  name:           Joi.string().min(3).max(200).required(),
  description:    Joi.string().min(20).required(),
  shortDesc:      Joi.string().max(300).optional(),
  categoryId:     objectId,
  subCategoryId:  Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
  brand:          Joi.string().max(100).optional(),
  tags:           Joi.array().items(Joi.string()).optional(),
  variants:       Joi.alternatives().try(
    Joi.array().items(variantSchema).min(1),
    Joi.string()  // JSON string from multipart
  ).required(),
  isFreeShipping: Joi.boolean().default(false),
  shippingCharge: Joi.number().min(0).default(0),
  metaTitle:      Joi.string().max(70).optional(),
  metaDescription: Joi.string().max(160).optional(),
});

export const updateProductSchema = Joi.object({
  name:           Joi.string().min(3).max(200),
  description:    Joi.string().min(20),
  shortDesc:      Joi.string().max(300),
  brand:          Joi.string().max(100),
  tags:           Joi.array().items(Joi.string()),
  isFreeShipping: Joi.boolean(),
  shippingCharge: Joi.number().min(0),
  metaTitle:      Joi.string().max(70),
  metaDescription: Joi.string().max(160),
});

export const rejectProductSchema = Joi.object({
  reason: Joi.string().min(10).required(),
});