import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize }    from '../../middlewares/role.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import {
  createCategoryFieldSchema,
  updateCategoryFieldSchema,
  reorderFieldsSchema,
} from '../../validators/categoryField.validator.js';
import * as Field from '../../controllers/categoryField.controller.js';

/**
 * All routes are nested under /api/v1/categories/:categoryId/fields
 * Mount this in category.routes.js (see below) or in app.js directly.
 */
const router = Router({ mergeParams: true }); // mergeParams lets us access :categoryId

// ── Public ─────────────────────────────────────────────────────────────────────
// Vendors / frontend listing forms need to know which fields to show
router.get('/',                Field.getCategoryFields);

// ── Admin only ─────────────────────────────────────────────────────────────────
router.use(authenticate, authorize('admin'));

router.get('/:fieldId',        Field.getCategoryFieldById);

router.post('/',
  validateBody(createCategoryFieldSchema),
  Field.createCategoryField
);

router.put('/:fieldId',
  validateBody(updateCategoryFieldSchema),
  Field.updateCategoryField
);

// Bulk reorder (drag-and-drop in admin UI)
router.patch('/reorder',
  validateBody(reorderFieldsSchema),
  Field.reorderCategoryFields
);

router.delete('/:fieldId',     Field.deleteCategoryField); // ?hard=true for permanent

// ── Options management (inline — no separate model needed) ────────────────────
router.post('/:fieldId/options',              Field.addFieldOption);
router.delete('/:fieldId/options/:optionId',  Field.removeFieldOption);

export default router;