import { Router }            from 'express';
import { authenticate }      from '../../middlewares/auth.middleware.js';
import { authRateLimiter }   from '../../middlewares/rateLimit.middleware.js';
import { validateBody }      from '../../middlewares/validate.middleware.js';
import {
  phoneVerifySchema,
  completeProfileSchema,
  googleFirebaseSchema,
  googleTokenSchema,
  appleFirebaseSchema,
  linkProviderSchema,
}                            from '../../validators/auth.validator.js';
import * as Auth             from '../../controllers/auth.controller.js';

const router = Router();

// ── Phone OTP (Firebase handles the OTP, we just verify the ID token) ────────
router.post('/phone/verify',           authRateLimiter, validateBody(phoneVerifySchema),    Auth.verifyPhoneAuth);
router.post('/phone/complete-profile', authRateLimiter, validateBody(completeProfileSchema), Auth.completePhoneProfile);

// ── Google OAuth ──────────────────────────────────────────────────────────────
// Option A: via Firebase SDK (recommended for mobile apps)
router.post('/google/firebase', authRateLimiter, validateBody(googleFirebaseSchema), Auth.googleFirebaseAuth);
// Option B: raw Google ID token (for Google One Tap on web)
router.post('/google/token',    authRateLimiter, validateBody(googleTokenSchema),    Auth.googleTokenAuth);

// ── Apple OAuth (via Firebase) ────────────────────────────────────────────────
router.post('/apple/firebase',  authRateLimiter, validateBody(appleFirebaseSchema),  Auth.appleFirebaseAuth);

// ── Link additional provider to existing account ──────────────────────────────
router.post('/link-provider',   authenticate, validateBody(linkProviderSchema), Auth.linkProvider);

// ── Token management ──────────────────────────────────────────────────────────
router.post('/refresh-token',   Auth.refreshToken);
router.post('/logout',          authenticate, Auth.logout);
router.post('/logout-all',      authenticate, Auth.logoutAllDevices);

export default router;