import Joi from 'joi';

const FIELD_TYPES = ['text', 'textarea', 'number', 'dropdown', 'radio', 'checkbox', 'boolean', 'date'];

const optionSchema = Joi.object({
  label: Joi.string().trim().min(1).max(100).required(),
  value: Joi.string().trim().min(1).max(100).required(),
});

export const createCategoryFieldSchema = Joi.object({
  label:       Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().max(300).optional().allow(''),
  placeholder: Joi.string().trim().max(200).optional().allow(''),
  fieldType:   Joi.string().valid(...FIELD_TYPES).required(),

  // ← Key fix: don't use Joi.when() — validate options in the controller instead
  options: Joi.array().items(optionSchema).optional().default([]),

  isRequired:   Joi.boolean().default(false),
  isFilterable: Joi.boolean().default(false),
  isSearchable: Joi.boolean().default(false),

  minValue:  Joi.number().optional().allow(null),
  maxValue:  Joi.number().optional().allow(null),
  unit:      Joi.string().trim().max(30).optional().allow(''),
  minLength: Joi.number().integer().min(0).optional().allow(null),
  maxLength: Joi.number().integer().min(1).optional().allow(null),

  sortOrder: Joi.number().integer().min(0).default(0),
});

export const updateCategoryFieldSchema = Joi.object({
  label:       Joi.string().trim().min(1).max(100),
  description: Joi.string().trim().max(300).allow(''),
  placeholder: Joi.string().trim().max(200).allow(''),
  options:     Joi.array().items(optionSchema).min(2),
  isRequired:   Joi.boolean(),
  isFilterable: Joi.boolean(),
  isSearchable: Joi.boolean(),
  isActive:     Joi.boolean(),
  minValue:  Joi.number().allow(null),
  maxValue:  Joi.number().allow(null),
  unit:      Joi.string().trim().max(30).allow(''),
  minLength: Joi.number().integer().min(0).allow(null),
  maxLength: Joi.number().integer().min(1).allow(null),
  sortOrder: Joi.number().integer().min(0),
}).min(1);

export const reorderFieldsSchema = Joi.object({
  fields: Joi.array().items(
    Joi.object({
      id:        Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
      sortOrder: Joi.number().integer().min(0).required(),
    })
  ).min(1).required(),
});