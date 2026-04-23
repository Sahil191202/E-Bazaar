import helmet       from 'helmet';
import rateLimit    from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import { ApiError } from '../utils/ApiError.js';

// ─── Helmet — HTTP security headers ──────────────────────────────────────────
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https://res.cloudinary.com'],
      connectSrc:  ["'self'", 'https://api.razorpay.com'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginResourcePolicy:   { policy: 'cross-origin' },
  crossOriginEmbedderPolicy:   false,
  hsts: {
    maxAge:            31536000, // 1 year
    includeSubDomains: true,
    preload:           true,
  },
});

// ─── MongoDB injection sanitizer ──────────────────────────────────────────────
// Strips $ and . from user inputs — prevents NoSQL injection
export const mongoSanitizer = mongoSanitize({
  replaceWith:     '_',
  onSanitize:      ({ req, key }) => {
    // Log attempted NoSQL injection
    console.warn(`Sanitized key "${key}" from ${req.ip}`);
  },
});

// ─── XSS sanitizer (manual — strips HTML tags from strings) ──────────────────
export const xssSanitizer = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    }
    if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, sanitize(v)])
      );
    }
    return obj;
  };

  if (req.body)  req.body  = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  next();
};

// ─── Request size guard ───────────────────────────────────────────────────────
export const requestSizeGuard = (req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'] || '0');
  const MAX_SIZE      = 10 * 1024 * 1024; // 10MB

  if (contentLength > MAX_SIZE) {
    return next(new ApiError(413, 'Request payload too large'));
  }
  next();
};

// ─── Suspicious header detection ─────────────────────────────────────────────
export const suspiciousRequestGuard = (req, res, next) => {
  const suspiciousPatterns = [
    /\.\.\//,           // Path traversal
    /<script/i,         // XSS attempt
    /union\s+select/i,  // SQL injection
    /eval\s*\(/i,       // Code injection
    /base64_decode/i,   // PHP injection
  ];

  const url = req.url + JSON.stringify(req.body || {});
  const isSuspicious = suspiciousPatterns.some((p) => p.test(url));

  if (isSuspicious) {
    return next(new ApiError(400, 'Invalid request'));
  }
  next();
};

// ─── API key guard for webhook endpoints ─────────────────────────────────────
export const webhookRawBody = (req, res, buf) => {
  // Store raw body for Razorpay webhook signature verification
  req.rawBody = buf;
};