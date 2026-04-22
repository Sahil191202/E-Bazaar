import rateLimit from 'express-rate-limit';

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,   // Strict for auth endpoints
  message:  { success: false, message: 'Too many auth attempts. Try again in 15 minutes.' },
});

export const otpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max:      5,                 // Max 5 OTP requests/hour per IP
  message:  { success: false, message: 'Too many OTP requests.' },
});