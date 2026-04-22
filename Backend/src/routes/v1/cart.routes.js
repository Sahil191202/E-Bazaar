import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import {
  addToCartSchema, updateCartItemSchema,
  applyCouponSchema, mergeCartSchema,
}                       from '../../validators/cart.validator.js';
import * as CartCtrl    from '../../controllers/cart.controller.js';

const router = Router();

// All cart routes require authentication
router.use(authenticate);

router.get('/',                  CartCtrl.getCart);
router.get('/validate',          CartCtrl.validateCart);
router.post('/add',              validateBody(addToCartSchema),        CartCtrl.addToCart);
router.put('/items/:itemId',     validateBody(updateCartItemSchema),   CartCtrl.updateCartItem);
router.delete('/items/:itemId',  CartCtrl.removeCartItem);
router.delete('/',               CartCtrl.clearCart);
router.post('/coupon',           validateBody(applyCouponSchema),      CartCtrl.applyCoupon);
router.delete('/coupon',         CartCtrl.removeCoupon);
router.post('/merge',            validateBody(mergeCartSchema),        CartCtrl.mergeGuestCart);

export default router;