import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import { uploadSingle } from '../../middlewares/upload.middleware.js';
import * as Category    from '../../controllers/category.controller.js';
import fieldRouter      from './categoryField.routes.js';

const router = Router();

// ── Public ─────────────────────────────────────────────────────────────────────
router.get('/',     Category.getCategoryTree);

// ── Nested field routes (public GET, admin POST/PUT/DELETE — auth handled inside)
// Mounts: /api/v1/categories/:categoryId/fields/...
router.use('/:categoryId/fields', fieldRouter);

// ── Admin only ─────────────────────────────────────────────────────────────────
router.use(authenticate, authorize('admin'));
router.get('/all',        Category.getAllCategories);
router.post('/',          uploadSingle, Category.createCategory);
router.put('/:id',        Category.updateCategory);
router.delete('/:id',     Category.deleteCategory);

export default router;