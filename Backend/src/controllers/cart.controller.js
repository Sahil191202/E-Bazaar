import { Cart }        from '../models/Cart.js';
import { Product }     from '../models/Product.js';
import { Wishlist }    from '../models/Wishlist.js';
import { CartService } from '../services/cart.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError }    from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ─────────────────────────────────────────────────────────────────────────────
//  GET CART
// ─────────────────────────────────────────────────────────────────────────────

export const getCart = asyncHandler(async (req, res) => {
  const cartData = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, cartData));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADD TO CART
// ─────────────────────────────────────────────────────────────────────────────

export const addToCart = asyncHandler(async (req, res) => {
  const { productId, variantId, quantity = 1 } = req.body;

  // Validate product & variant
  const product = await Product.findOne({ _id: productId, status: 'active' });
  if (!product) throw new ApiError(404, 'Product not found or unavailable');

  const variant = product.variants.id(variantId);
  if (!variant || !variant.isActive) throw new ApiError(404, 'Variant not found or unavailable');
  if (variant.stock < quantity)      throw new ApiError(400, `Only ${variant.stock} units available`);

  let cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    cart = new Cart({ user: req.user._id, items: [] });
  }

  // Check if item already exists
  const existingItem = cart.items.find(
    (i) => i.product.toString() === productId && i.variantId.toString() === variantId
  );

  if (existingItem) {
    const newQty = existingItem.quantity + quantity;
    if (newQty > 10)           throw new ApiError(400, 'Maximum 10 units per item allowed');
    if (newQty > variant.stock) throw new ApiError(400, `Only ${variant.stock} units available`);
    existingItem.quantity      = newQty;
    existingItem.priceSnapshot = variant.price; // Refresh price snapshot
  } else {
    if (cart.items.length >= 50) throw new ApiError(400, 'Cart limit reached (50 items)');

    cart.items.push({
      product:            productId,
      variantId,
      quantity,
      priceSnapshot:      variant.price,
      mrpSnapshot:        variant.mrp,
      nameSnapshot:       product.name,
      imageSnapshot:      variant.images?.[0]?.url || product.images?.[0]?.url || '',
      skuSnapshot:        variant.sku,
      attributesSnapshot: variant.attributes,
    });
  }

  await cart.save();

  // Return full enriched cart
  const cartData = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, cartData, 'Item added to cart'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE ITEM QUANTITY
// ─────────────────────────────────────────────────────────────────────────────

export const updateCartItem = asyncHandler(async (req, res) => {
  const { itemId }  = req.params;
  const { quantity } = req.body;

  if (!quantity || quantity < 1)  throw new ApiError(400, 'Quantity must be at least 1');
  if (quantity > 10)              throw new ApiError(400, 'Maximum 10 units per item');

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw new ApiError(404, 'Cart not found');

  const item = cart.items.id(itemId);
  if (!item) throw new ApiError(404, 'Item not found in cart');

  // Validate against current stock
  const product = await Product.findById(item.product).select('variants status');
  if (!product || product.status !== 'active') throw new ApiError(400, 'Product no longer available');

  const variant = product.variants.id(item.variantId);
  if (!variant || !variant.isActive) throw new ApiError(400, 'Variant no longer available');
  if (variant.stock < quantity)      throw new ApiError(400, `Only ${variant.stock} units available`);

  item.quantity      = quantity;
  item.priceSnapshot = variant.price; // Refresh
  await cart.save();

  const cartData = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, cartData, 'Cart updated'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  REMOVE ITEM
// ─────────────────────────────────────────────────────────────────────────────

export const removeCartItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw new ApiError(404, 'Cart not found');

  const item = cart.items.id(itemId);
  if (!item) throw new ApiError(404, 'Item not found in cart');

  cart.items.pull(itemId);
  await cart.save();

  const cartData = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, cartData, 'Item removed from cart'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  CLEAR ENTIRE CART
// ─────────────────────────────────────────────────────────────────────────────

export const clearCart = asyncHandler(async (req, res) => {
  await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $set: { items: [], coupon: null } }
  );
  res.json(new ApiResponse(200, null, 'Cart cleared'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  APPLY COUPON
// ─────────────────────────────────────────────────────────────────────────────

export const applyCoupon = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw new ApiError(400, 'Coupon code is required');

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || !cart.items.length) throw new ApiError(400, 'Cart is empty');

  // Get enriched cart for subtotal
  const cartData = await CartService.getCartWithTotals(req.user._id);

  // Validate coupon and get discount
  const { discount, coupon } = await CartService.calculateCouponDiscount(
    code,
    req.user._id,
    cartData.subtotal,
    cartData.items
  );

  // Save coupon to cart
  cart.coupon = {
    code:          coupon.code,
    discountType:  coupon.discountType,
    discountValue: coupon.discountValue,
    maxDiscount:   coupon.maxDiscount || null,
  };
  await cart.save();

  // Return updated cart totals
  const updatedCart = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, updatedCart, `Coupon applied! You save ₹${discount}`));
});

// ─────────────────────────────────────────────────────────────────────────────
//  REMOVE COUPON
// ─────────────────────────────────────────────────────────────────────────────

export const removeCoupon = asyncHandler(async (req, res) => {
  await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $set: { coupon: null } }
  );
  const cartData = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, cartData, 'Coupon removed'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  VALIDATE CART (before checkout — returns warnings + final totals)
// ─────────────────────────────────────────────────────────────────────────────

export const validateCart = asyncHandler(async (req, res) => {
  const cartData = await CartService.getCartWithTotals(req.user._id);

  if (!cartData.items.length) {
    throw new ApiError(400, 'Cart is empty');
  }

  const isValid = cartData.stockWarnings.filter(
    (w) => w.type === 'out_of_stock' || w.type === 'unavailable'
  ).length === 0;

  res.json(new ApiResponse(200, {
    ...cartData,
    isValid,
    canCheckout: isValid && cartData.items.length > 0,
  }, isValid ? 'Cart is valid' : 'Cart has issues that need to be resolved'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  MERGE GUEST CART (after login — sync local storage cart with DB cart)
// ─────────────────────────────────────────────────────────────────────────────

export const mergeGuestCart = asyncHandler(async (req, res) => {
  const { guestItems } = req.body;
  // guestItems: [{ productId, variantId, quantity }]

  if (!guestItems?.length) {
    return res.json(new ApiResponse(200, null, 'Nothing to merge'));
  }

  for (const item of guestItems) {
    try {
      // Reuse addToCart logic by calling the service directly
      const product = await Product.findOne({ _id: item.productId, status: 'active' });
      if (!product) continue;

      const variant = product.variants.id(item.variantId);
      if (!variant || !variant.isActive || variant.stock < 1) continue;

      let cart = await Cart.findOne({ user: req.user._id });
      if (!cart) cart = new Cart({ user: req.user._id, items: [] });

      const existing = cart.items.find(
        (i) => i.product.toString() === item.productId && i.variantId.toString() === item.variantId
      );

      if (existing) {
        const newQty = Math.min(existing.quantity + item.quantity, variant.stock, 10);
        existing.quantity = newQty;
      } else if (cart.items.length < 50) {
        cart.items.push({
          product:            item.productId,
          variantId:          item.variantId,
          quantity:           Math.min(item.quantity, variant.stock, 10),
          priceSnapshot:      variant.price,
          mrpSnapshot:        variant.mrp,
          nameSnapshot:       product.name,
          imageSnapshot:      variant.images?.[0]?.url || product.images?.[0]?.url || '',
          skuSnapshot:        variant.sku,
          attributesSnapshot: variant.attributes,
        });
      }

      await cart.save();
    } catch (e) {
      // Skip invalid items silently
      continue;
    }
  }

  const cartData = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, cartData, 'Guest cart merged'));
});