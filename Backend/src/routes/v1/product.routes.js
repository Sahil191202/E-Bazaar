import { Router }         from 'express';
import { authenticate }   from '../../middlewares/auth.middleware.js';
import { authorize }      from '../../middlewares/role.middleware.js';
import { validateBody }   from '../../middlewares/validate.middleware.js';
import { uploadImages, uploadFile } from '../../middlewares/upload.middleware.js';
import {optionalAuth} from '../../middlewares/auth.middleware.js';
import {
  createProductSchema, updateProductSchema, rejectProductSchema,
}                         from '../../validators/product.validator.js';
import * as Product       from '../../controllers/product.controller.js';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/',                   optionalAuth, Product.getProducts);
router.get('/suggestions',        Product.searchSuggestions);
router.get('/slug/:slug',         Product.getProductBySlug);
router.get('/:id',                Product.getProductById);

// ── Vendor ────────────────────────────────────────────────────────────────────
router.use(authenticate);

router.get('/vendor/my-products', authorize('vendor'), Product.getVendorProducts);

router.post('/',
  authorize('vendor'),
  uploadImages,
  Product.createProduct
);

router.put('/:id',
  authorize('vendor'),
  Product.updateProduct
);

// Images
router.post('/:id/images',
  authorize('vendor'),
  uploadImages,
  Product.addProductImages
);
router.delete('/:id/images/:imageId',
  authorize('vendor'),
  Product.deleteProductImage
);

// Variants
router.post('/:id/variants',
  authorize('vendor'),
  uploadImages,
  Product.addVariant
);
router.put('/:id/variants/:variantId',
  authorize('vendor'),
  Product.updateVariant
);

// Inventory
router.get('/:productId/inventory',
  authorize('vendor'),
  Product.getInventoryLogs
);
router.post('/inventory/adjust',
  authorize('vendor'),
  Product.manualStockAdjustment
);

// Bulk upload
router.post('/bulk-upload',
  authorize('vendor'),
  uploadFile,
  Product.bulkUploadProducts
);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.patch('/:id/approve',
  authorize('admin'),
  Product.approveProduct
);
router.patch('/:id/reject',
  authorize('admin'),
  validateBody(rejectProductSchema),
  Product.rejectProduct
);
router.patch('/:id/flags',
  authorize('admin'),
  Product.adminUpdateFlags
);

export default router;