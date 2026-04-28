import { ApiError } from '../utils/ApiError.js';

// Recursively convert { "0": x, "1": y } → [x, y] for any value that looks like an indexed object
const normalizeIndexedArrays = (obj) => {
  if (Array.isArray(obj)) return obj.map(normalizeIndexedArrays);
  if (obj && typeof obj === 'object') {
    const keys = Object.keys(obj);
    const isIndexed = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
    if (isIndexed) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((k) => normalizeIndexedArrays(obj[k]));
    }
    const result = {};
    for (const k of keys) result[k] = normalizeIndexedArrays(obj[k]);
    return result;
  }
  return obj;
};

export const validateBody = (schema) => (req, res, next) => {
  const normalized = normalizeIndexedArrays(req.body); // ← fix indexed objects before validation

  const { error, value } = schema.validate(normalized, {
    abortEarly:   false,
    stripUnknown: true,
    convert:      true,
  });

  if (error) {
    const messages = error.details.map((d) => d.message);
    console.log('🔴 Validation error details:', JSON.stringify(error.details, null, 2));
    throw new ApiError(422, 'Validation failed', messages);
  }

  req.body = value;
  next();
};