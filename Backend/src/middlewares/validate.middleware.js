import { ApiError } from '../utils/ApiError.js';

export const validateBody = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    const messages = error.details.map((d) => d.message);
    throw new ApiError(422, 'Validation failed', messages);
  }
  next();
};