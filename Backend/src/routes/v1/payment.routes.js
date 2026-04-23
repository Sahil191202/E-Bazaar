import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import * as Payment     from '../../controllers/payment.controller.js';

const router = Router();

router.get('/my',        authenticate,                       Payment.getMyPayments);
router.get('/wallet',    authenticate,                       Payment.getWallet);
router.get('/admin/all', authenticate, authorize('admin'),   Payment.adminGetPayments);

export default router;