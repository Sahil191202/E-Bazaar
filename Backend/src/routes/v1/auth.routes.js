import { Router }          from 'express';
import { authenticate }    from '../../middlewares/auth.middleware.js';
import { authRateLimiter } from '../../middlewares/rateLimit.middleware.js';
import { validateBody }    from '../../middlewares/validate.middleware.js';
import { logActivity }     from '../../middlewares/activityLog.middleware.js';
import {
  phoneVerifySchema,
  completeProfileSchema,
  googleFirebaseSchema,
  googleTokenSchema,
  appleFirebaseSchema,
  linkProviderSchema,
}                          from '../../validators/auth.validator.js';
import * as Auth           from '../../controllers/auth.controller.js';

const router = Router();

// ── Phone OTP ─────────────────────────────────────────────────────────────────
router.post('/phone/verify',
  authRateLimiter,
  validateBody(phoneVerifySchema),
  logActivity('phone_auth'),
  Auth.verifyPhoneAuth
);

router.post('/phone/complete-profile',
  authRateLimiter,
  validateBody(completeProfileSchema),
  logActivity('complete_profile'),
  Auth.completePhoneProfile
);

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.post('/google/firebase',
  authRateLimiter,
  validateBody(googleFirebaseSchema),
  logActivity('google_auth'),
  Auth.googleFirebaseAuth
);

router.post('/google/token',
  authRateLimiter,
  validateBody(googleTokenSchema),
  logActivity('google_auth'),
  Auth.googleTokenAuth
);

// ── Apple OAuth ───────────────────────────────────────────────────────────────
router.post('/apple/firebase',
  authRateLimiter,
  validateBody(appleFirebaseSchema),
  logActivity('apple_auth'),
  Auth.appleFirebaseAuth
);

// ── Link provider to existing account ────────────────────────────────────────
router.post('/link-provider',
  authenticate,
  validateBody(linkProviderSchema),
  logActivity('link_provider'),
  Auth.linkProvider
);

// ── Token management ──────────────────────────────────────────────────────────
router.post('/refresh-token', Auth.refreshToken);

router.post('/logout',
  authenticate,
  logActivity('logout'),
  Auth.logout
);

router.post('/logout-all',
  authenticate,
  logActivity('logout_all'),
  Auth.logoutAllDevices
);

export default router;