import { Wishlist }   from '../models/Wishlist.js';
import { Cart }       from '../models/Cart.js';
import { Product }    from '../models/Product.js';
import { CartService } from '../services/cart.service.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError }    from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPagination, paginationMeta } from '../utils/pagination.js';

// ─────────────────────────────────────────────────────────────────────────────
//  GET WISHLIST
// ─────────────────────────────────────────────────────────────────────────────

export const getWishlist = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const wishlist = await Wishlist.findOne({ user: req.user._id })
    .populate({
      path:   'items.product',
      select: 'name slug images variants status basePrice baseMrp rating brand totalStock',
      match:  { status: 'active' }, // Only show active products
    })
    .lean();

  if (!wishlist) {
    return res.json(new ApiResponse(200, { items: [], total: 0 }));
  }

  // Filter out null products (deleted/deactivated)
  const validItems = wishlist.items.filter((i) => i.product !== null);

  // Paginate in memory (wishlist rarely huge, DB-level pagination adds complexity)
  const total      = validItems.length;
  const pagedItems = validItems.slice(skip, skip + limit);

  // Enrich each item with preferred variant and in-stock status
  const enriched = pagedItems.map((item) => {
    const product      = item.product;
    const activeVariants = product.variants?.filter((v) => v.isActive) || [];

    // Use the saved variantId if still valid, else default to cheapest
    let preferredVariant = item.variantId
      ? activeVariants.find((v) => v._id.toString() === item.variantId?.toString())
      : null;
    if (!preferredVariant) preferredVariant = activeVariants[0] || null;

    return {
      _id:       item._id,
      addedAt:   item.addedAt,
      product: {
        _id:       product._id,
        name:      product.name,
        slug:      product.slug,
        image:     product.images?.[0]?.url || '',
        basePrice: product.basePrice,
        baseMrp:   product.baseMrp,
        rating:    product.rating,
        brand:     product.brand,
        inStock:   product.totalStock > 0,
      },
      variant:   preferredVariant ? {
        _id:        preferredVariant._id,
        price:      preferredVariant.price,
        mrp:        preferredVariant.mrp,
        stock:      preferredVariant.stock,
        attributes: preferredVariant.attributes,
      } : null,
    };
  });

  res.json(new ApiResponse(200, { items: enriched }, 'Wishlist', paginationMeta(total, page, limit)));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADD TO WISHLIST
// ─────────────────────────────────────────────────────────────────────────────

export const addToWishlist = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.body;

  // Validate product exists
  const product = await Product.findOne({ _id: productId, status: 'active' }).select('_id');
  if (!product) throw new ApiError(404, 'Product not found');

  let wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) wishlist = new Wishlist({ user: req.user._id, items: [] });

  // Already in wishlist — idempotent
  const exists = wishlist.items.some(
    (i) => i.product.toString() === productId
  );
  if (exists) {
    return res.json(new ApiResponse(200, null, 'Product already in wishlist'));
  }

  if (wishlist.items.length >= 100) {
    throw new ApiError(400, 'Wishlist limit reached (100 items)');
  }

  wishlist.items.push({ product: productId, variantId: variantId || null });
  await wishlist.save();

  // Update product wishlistCount (background, non-blocking)
  Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: 1 } }).exec();

  res.json(new ApiResponse(200, null, 'Added to wishlist'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  REMOVE FROM WISHLIST
// ─────────────────────────────────────────────────────────────────────────────

export const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) throw new ApiError(404, 'Wishlist not found');

  const itemExists = wishlist.items.some((i) => i.product.toString() === productId);
  if (!itemExists) throw new ApiError(404, 'Product not in wishlist');

  wishlist.items = wishlist.items.filter((i) => i.product.toString() !== productId);
  await wishlist.save();

  Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: -1 } }).exec();

  res.json(new ApiResponse(200, null, 'Removed from wishlist'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  MOVE TO CART (from wishlist)
// ─────────────────────────────────────────────────────────────────────────────

export const moveToCart = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { variantId } = req.body; // Client must specify which variant

  if (!variantId) throw new ApiError(400, 'Please select a variant before adding to cart');

  // Validate product & variant
  const product = await Product.findOne({ _id: productId, status: 'active' });
  if (!product) throw new ApiError(404, 'Product not found or unavailable');

  const variant = product.variants.id(variantId);
  if (!variant || !variant.isActive) throw new ApiError(400, 'Selected variant is unavailable');
  if (variant.stock < 1)             throw new ApiError(400, 'Product is out of stock');

  // Add to cart
  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = new Cart({ user: req.user._id, items: [] });

  const existing = cart.items.find(
    (i) => i.product.toString() === productId && i.variantId.toString() === variantId
  );

  if (existing) {
    existing.quantity = Math.min(existing.quantity + 1, variant.stock, 10);
  } else {
    if (cart.items.length >= 50) throw new ApiError(400, 'Cart is full');
    cart.items.push({
      product:            productId,
      variantId,
      quantity:           1,
      priceSnapshot:      variant.price,
      mrpSnapshot:        variant.mrp,
      nameSnapshot:       product.name,
      imageSnapshot:      variant.images?.[0]?.url || product.images?.[0]?.url || '',
      skuSnapshot:        variant.sku,
      attributesSnapshot: variant.attributes,
    });
  }

  await cart.save();

  // Remove from wishlist
  await Wishlist.findOneAndUpdate(
    { user: req.user._id },
    { $pull: { items: { product: productId } } }
  );

  Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: -1 } }).exec();

  const cartData = await CartService.getCartWithTotals(req.user._id);
  res.json(new ApiResponse(200, cartData, 'Moved to cart'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  CHECK IF PRODUCT IS IN WISHLIST
// ─────────────────────────────────────────────────────────────────────────────

export const checkWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const wishlist = await Wishlist.findOne({
    user:            req.user._id,
    'items.product': productId,
  }).select('_id');

  res.json(new ApiResponse(200, { isWishlisted: !!wishlist }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  CLEAR WISHLIST
// ─────────────────────────────────────────────────────────────────────────────

export const clearWishlist = asyncHandler(async (req, res) => {
  await Wishlist.findOneAndUpdate(
    { user: req.user._id },
    { $set: { items: [] } }
  );
  res.json(new ApiResponse(200, null, 'Wishlist cleared'));
});