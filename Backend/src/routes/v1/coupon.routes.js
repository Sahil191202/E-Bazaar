import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import * as Coupon      from '../../controllers/coupon.controller.js';

const router = Router();

// Public
router.get('/public',         Coupon.getPublicCoupons);
router.get('/validate/:code', authenticate, Coupon.validateCoupon);

// Admin
router.get('/',               authenticate, authorize('admin'), Coupon.adminGetCoupons);
router.post('/',              authenticate, authorize('admin'), Coupon.adminCreateCoupon);
router.patch('/:id/toggle',   authenticate, authorize('admin'), Coupon.adminToggleCoupon);
router.delete('/:id',         authenticate, authorize('admin'), Coupon.adminDeleteCoupon);

export default router;