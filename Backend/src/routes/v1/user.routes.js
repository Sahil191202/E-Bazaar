import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import { addAddressSchema, moveToCartSchema } from '../../validators/cart.validator.js';
import * as UserCtrl    from '../../controllers/user.controller.js';
import * as WishCtrl    from '../../controllers/wishlist.controller.js';

const router = Router();
router.use(authenticate);

// Profile
router.get('/profile',    UserCtrl.getProfile);
router.put('/profile',    UserCtrl.updateProfile);

router.post('/profile/email/send-otp',    UserCtrl.sendEmailChangeOTP);
router.post('/profile/email/verify-otp',  UserCtrl.verifyEmailChange);
router.post('/profile/phone/send-otp',    UserCtrl.sendPhoneChangeOTP);
router.post('/profile/phone/verify-otp',  UserCtrl.verifyPhoneChange);

// Addresses
router.get('/addresses',                     UserCtrl.getAddresses);
router.post('/addresses',  validateBody(addAddressSchema), UserCtrl.addAddress);
router.put('/addresses/:addressId',          UserCtrl.updateAddress);
router.delete('/addresses/:addressId',       UserCtrl.deleteAddress);
router.patch('/addresses/:addressId/default', UserCtrl.setDefaultAddress);

// Wishlist
router.get('/wishlist',                         WishCtrl.getWishlist);
router.post('/wishlist',                        WishCtrl.addToWishlist);
router.get('/wishlist/check/:productId',        WishCtrl.checkWishlist);
router.delete('/wishlist/:productId',           WishCtrl.removeFromWishlist);
router.post('/wishlist/:productId/move-to-cart', validateBody(moveToCartSchema), WishCtrl.moveToCart);
router.delete('/wishlist',                      WishCtrl.clearWishlist);

export default router;