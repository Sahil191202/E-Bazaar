import * as Admin from '../../controllers/admin.controller.js';
import multer from 'multer';

const router = Router();

// Public — no auth
router.get('/', Admin.getBanners);
router.post('/:id/click', Admin.trackBannerClick);

export default router;