import { Router }       from 'express';
import multer           from 'multer';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import * as Review      from '../../controllers/review.controller.js';

const router      = Router();
const imgUpload   = multer({ dest: '/tmp/uploads' }).array('images', 5);

// Public
router.get('/product/:productId', Review.getProductReviews);

// Authenticated
router.post('/',                  authenticate, imgUpload, Review.createReview);
router.get('/my',                 authenticate, Review.getMyReviews);
router.post('/:id/helpful',       authenticate, Review.markHelpful);
router.post('/:id/vendor-reply',  authenticate, authorize('vendor'), Review.vendorReplyToReview);
router.patch('/:id/flag',         authenticate, authorize('admin'),  Review.adminFlagReview);

export default router;