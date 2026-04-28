import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import multer           from 'multer';
import {
  registerVendorSchema, bankDetailsSchema, createCouponSchema,
  payoutRequestSchema, kycReviewSchema, processPayoutSchema,
}                       from '../../validators/vendor.validator.js';
import * as Vendor      from '../../controllers/vendor.controller.js';

const router = Router();

// Multer for store images
const storeUpload = multer({ dest: '/tmp/uploads' }).fields([
  { name: 'logo',   maxCount: 1 },
  { name: 'banner', maxCount: 1 },
]);

// Multer for KYC documents (multiple fields)
const kycUpload = multer({ dest: '/tmp/uploads' }).fields([
  { name: 'pan',             maxCount: 1 },
  { name: 'aadhar',          maxCount: 1 },
  { name: 'gst',             maxCount: 1 },
  { name: 'bank_statement',  maxCount: 1 },
  { name: 'cancelled_cheque', maxCount: 1 },
]);

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/store/:slug', Vendor.getPublicStorePage);

// ── All vendor routes require auth ────────────────────────────────────────────
router.use(authenticate);

// Onboarding (any authenticated user can register as vendor)
router.post('/register',   validateBody(registerVendorSchema), Vendor.registerVendor);

// Profile (vendor only from here)
router.get('/profile',     authorize('vendor', 'admin'), Vendor.getVendorProfile);
router.put('/profile',     authorize('vendor', 'admin'), storeUpload, Vendor.updateVendorProfile);

// KYC
router.post('/kyc',         authorize('vendor', 'admin'), kycUpload, Vendor.submitKYC);
router.put('/bank-details', authorize('vendor', 'admin'), validateBody(bankDetailsSchema), Vendor.updateBankDetails);

// Dashboard & Analytics
router.get('/dashboard',         authorize('vendor', 'admin'), Vendor.getDashboard);
router.get('/analytics/sales',   authorize('vendor', 'admin'), Vendor.getSalesAnalytics);

// Payouts
router.get('/payouts',           authorize('vendor', 'admin'), Vendor.getPayouts);
router.post('/payouts/request',  authorize('vendor', 'admin'), validateBody(payoutRequestSchema), Vendor.requestPayout);

// Coupons
router.get('/coupons',               authorize('vendor', 'admin'), Vendor.getVendorCoupons);
router.post('/coupons',              authorize('vendor', 'admin'), validateBody(createCouponSchema), Vendor.createCoupon);
router.put('/coupons/:id',           authorize('vendor', 'admin'), Vendor.updateCoupon);
router.delete('/coupons/:id',        authorize('vendor', 'admin'), Vendor.deleteCoupon);
router.get('/coupons/:id/usage',     authorize('vendor', 'admin'), Vendor.getCouponUsage);

// Shipping docs
router.get('/orders/:orderId/shipping-label',  authorize('vendor', 'admin'), Vendor.generateShippingLabel);
router.get('/orders/:orderId/packaging-slip',  authorize('vendor', 'admin'), Vendor.generatePackagingSlip);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin/kyc',               authorize('admin'), Vendor.adminGetPendingKYC);
router.post('/admin/:vendorId/kyc',    authorize('admin'), validateBody(kycReviewSchema), Vendor.adminReviewKYC);
router.post('/admin/payouts/:payoutId', authorize('admin'), validateBody(processPayoutSchema), Vendor.adminProcessPayout);

export default router;