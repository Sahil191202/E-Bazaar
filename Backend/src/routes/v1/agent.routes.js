import { Router }       from 'express';
import multer           from 'multer';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import {
  registerAgentSchema, locationUpdateSchema, pickupSchema,
  otpDeliverSchema, failedAttemptSchema, rateAgentSchema, adminAssignSchema,
}                       from '../../validators/agent.validator.js';
import * as Agent       from '../../controllers/agent.controller.js';

const router  = Router();
const kycUpload = multer({ dest: '/tmp/uploads' }).fields([
  { name: 'aadhar',          maxCount: 1 },
  { name: 'pan',             maxCount: 1 },
  { name: 'driving_license', maxCount: 1 },
  { name: 'vehicle_rc',      maxCount: 1 },
  { name: 'insurance',       maxCount: 1 },
]);
const proofUpload = multer({ dest: '/tmp/uploads' }).single('proof');

router.use(authenticate);

// ── Onboarding ────────────────────────────────────────────────────────────────
router.post('/register', validateBody(registerAgentSchema), Agent.registerAgent);

// ── Profile ───────────────────────────────────────────────────────────────────
router.get('/profile',         authorize('agent'), Agent.getAgentProfile);
router.put('/profile',         authorize('agent'), Agent.updateAgentProfile);
router.post('/kyc',            authorize('agent'), kycUpload, Agent.submitAgentKYC);
router.patch('/availability',  authorize('agent'), Agent.toggleAvailability);

// ── Location ──────────────────────────────────────────────────────────────────
router.post('/location', authorize('agent'), validateBody(locationUpdateSchema), Agent.updateLocation);

// ── Active delivery ───────────────────────────────────────────────────────────
router.get('/delivery/active',                         authorize('agent'), Agent.getActiveDelivery);
router.post('/delivery/:deliveryId/accept',            authorize('agent'), Agent.acceptDelivery);
router.post('/delivery/:deliveryId/reject',            authorize('agent'), Agent.rejectDelivery);
router.post('/delivery/:deliveryId/pickup',            authorize('agent'), validateBody(pickupSchema), Agent.markPickedUp);
router.post('/delivery/:deliveryId/verify-otp',        authorize('agent'), validateBody(otpDeliverSchema), Agent.verifyOTPAndDeliver);
router.post('/delivery/:deliveryId/proof',             authorize('agent'), proofUpload, Agent.uploadProofAndDeliver);
router.post('/delivery/:deliveryId/failed',            authorize('agent'), validateBody(failedAttemptSchema), Agent.markFailedAttempt);
router.post('/delivery/:deliveryId/resend-otp',        authorize('agent'), Agent.resendDeliveryOTP);

// ── History & Earnings ────────────────────────────────────────────────────────
router.get('/deliveries',    authorize('agent'), Agent.getDeliveryHistory);
router.get('/earnings',      authorize('agent'), Agent.getEarningsDashboard);

// ── Customer: rate agent & contact ───────────────────────────────────────────
router.post('/delivery/:deliveryId/rate',              authorize('customer'), validateBody(rateAgentSchema), Agent.rateAgent);
router.get('/order/:orderId/contact',                  authorize('customer'), Agent.getAgentContact);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/all',                  authorize('admin'), Agent.adminGetAgents);
router.post('/admin/assign',              authorize('admin'), validateBody(adminAssignSchema), Agent.adminAssignAgent);
router.post('/admin/:agentId/kyc',        authorize('admin'), Agent.adminReviewAgentKYC);

export default router;