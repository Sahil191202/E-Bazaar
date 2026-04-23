import { Coupon }      from '../models/Coupon.js';
import { CartService } from '../services/cart.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError }    from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Public: validate a coupon code (preview discount before applying)
export const validateCoupon = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const cartData = await CartService.getCartWithTotals(req.user._id);
  if (!cartData.items.length) throw new ApiError(400, 'Cart is empty');

  const { discount, coupon } = await CartService.calculateCouponDiscount(
    code, req.user._id, cartData.subtotal, cartData.items
  );

  res.json(new ApiResponse(200, {
    valid:    true,
    discount,
    coupon: {
      code:          coupon.code,
      description:   coupon.description,
      discountType:  coupon.discountType,
      discountValue: coupon.discountValue,
    },
    newTotal: cartData.total - discount,
  }, `Coupon valid! You save ₹${discount}`));
});

// Public: list active platform coupons (admin-created, applicableTo: 'all')
export const getPublicCoupons = asyncHandler(async (req, res) => {
  const now = new Date();
  const coupons = await Coupon.find({
    isActive:     true,
    applicableTo: 'all',
    creatorRole:  'admin',
    startsAt:     { $lte: now },
    expiresAt:    { $gt: now },
  })
    .select('code description discountType discountValue maxDiscount minOrderValue expiresAt')
    .sort({ createdAt: -1 })
    .lean();

  res.json(new ApiResponse(200, { coupons }));
});

// Admin: create platform-wide coupon
export const adminCreateCoupon = asyncHandler(async (req, res) => {
  const {
    code, description, discountType, discountValue,
    maxDiscount, minOrderValue, maxUses, maxUsesPerUser,
    expiresAt, startsAt, applicableTo,
    allowedUsers, allowedCategories, allowedProducts,
  } = req.body;

  const existing = await Coupon.findOne({ code: code.toUpperCase() });
  if (existing) throw new ApiError(409, 'Coupon code already exists');

  const coupon = await Coupon.create({
    code:           code.toUpperCase(),
    description,
    discountType,
    discountValue,
    maxDiscount:    maxDiscount    || null,
    minOrderValue:  minOrderValue  || 0,
    maxUses:        maxUses        || null,
    maxUsesPerUser: maxUsesPerUser || 1,
    expiresAt:      new Date(expiresAt),
    startsAt:       startsAt ? new Date(startsAt) : new Date(),
    applicableTo:   applicableTo || 'all',
    allowedUsers:   allowedUsers   || [],
    allowedCategories: allowedCategories || [],
    allowedProducts:   allowedProducts   || [],
    createdBy:   req.user._id,
    creatorRole: 'admin',
  });

  res.status(201).json(new ApiResponse(201, { coupon }, 'Coupon created'));
});

// Admin: get all coupons
export const adminGetCoupons = asyncHandler(async (req, res) => {
  const { isActive, creatorRole } = req.query;
  const filter = {};
  if (isActive    !== undefined) filter.isActive    = isActive === 'true';
  if (creatorRole)               filter.creatorRole = creatorRole;

  const coupons = await Coupon.find(filter)
    .sort({ createdAt: -1 })
    .select('-usageLog')
    .lean();

  res.json(new ApiResponse(200, { coupons }));
});

// Admin: toggle coupon active state
export const adminToggleCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw new ApiError(404, 'Coupon not found');

  coupon.isActive = !coupon.isActive;
  await coupon.save();

  res.json(new ApiResponse(200, { isActive: coupon.isActive }, `Coupon ${coupon.isActive ? 'activated' : 'deactivated'}`));
});

// Admin: delete coupon
export const adminDeleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw new ApiError(404, 'Coupon not found');
  res.json(new ApiResponse(200, null, 'Coupon deleted'));
});