import { Router }       from 'express';
import multer           from 'multer';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import Joi              from 'joi';
import * as Admin       from '../../controllers/admin.controller.js';

const router      = Router();
const bannerUpload = multer({ dest: '/tmp/uploads' }).single('image');

// All admin routes require authentication + admin role
router.use(authenticate, authorize('admin'));

// ── Dashboard & Analytics ─────────────────────────────────────────────────────
router.get('/dashboard',            Admin.getPlatformDashboard);
router.get('/analytics',            Admin.getPlatformAnalytics);
router.get('/financial',            Admin.getFinancialOverview);

// ── User Management ───────────────────────────────────────────────────────────
router.get('/users',                Admin.getAllUsers);
router.get('/users/:id',            Admin.getUserDetail);
router.post('/users/:id/ban',       Admin.banUser);
router.post('/users/:id/unban',     Admin.unbanUser);

// ── Commission Management ─────────────────────────────────────────────────────
router.get('/commission',                           Admin.getCommissionConfig);
router.put('/commission/global',                    Admin.setGlobalCommission);
router.put('/commission/vendor',                    Admin.setVendorCommission);
router.delete('/commission/vendor/:vendorUserId',   Admin.deleteVendorCommission);

// ── Banner / CMS ──────────────────────────────────────────────────────────────
router.get('/banners',              Admin.getBanners);
router.post('/banners',             bannerUpload, Admin.createBanner);
router.put('/banners/:id',          bannerUpload, Admin.updateBanner);
router.delete('/banners/:id',       Admin.deleteBanner);
router.post('/banners/:id/click',   Admin.trackBannerClick);

// ── Policies ──────────────────────────────────────────────────────────────────
router.get('/policies',             Admin.getAllPolicies);
router.get('/policies/:type',       Admin.getPolicy);
router.put('/policies/:type',       Admin.upsertPolicy);

// ── Fraud & Activity ──────────────────────────────────────────────────────────
router.get('/activity-logs',        Admin.getActivityLogs);
router.get('/fraud-report',         Admin.getFraudReport);

// ── Notifications ─────────────────────────────────────────────────────────────
router.post('/notifications/bulk',  Admin.sendBulkNotification);
router.get('/notifications/stats',  Admin.getNotificationStats);

export default router;