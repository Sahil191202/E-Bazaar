// Wraps async route handlers — no try/catch needed in controllers
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);