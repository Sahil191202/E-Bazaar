import { Cart }    from '../models/Cart.js';
import { Product } from '../models/Product.js';
import { Coupon }  from '../models/Coupon.js';
import { ApiError } from '../utils/ApiError.js';

export class CartService {

  // ─── Fetch cart and recalculate everything fresh from DB ─────────────────
  static async getCartWithTotals(userId) {
    let cart = await Cart.findOne({ user: userId }).lean();

    if (!cart || !cart.items.length) {
      return {
        items:         [],
        itemCount:     0,
        subtotal:      0,
        mrpTotal:      0,
        discount:      0,
        couponDiscount: 0,
        shippingCharge: 0,
        total:         0,
        savings:       0,
        coupon:        null,
        stockWarnings: [],
      };
    }

    // Fetch fresh product data for all cart items in one query
    const productIds = [...new Set(cart.items.map((i) => i.product.toString()))];
    const products   = await Product.find({ _id: { $in: productIds } })
      .select('name images variants status totalStock isFreeShipping shippingCharge vendor')
      .lean();

    const productMap = Object.fromEntries(products.map((p) => [p._id.toString(), p]));

    const enrichedItems = [];
    const stockWarnings = [];
    let subtotal  = 0;
    let mrpTotal  = 0;
    let shipping  = 0;

    for (const item of cart.items) {
      const product = productMap[item.product.toString()];

      // Product deleted or deactivated
      if (!product || product.status !== 'active') {
        stockWarnings.push({
          itemId:  item._id,
          message: `"${item.nameSnapshot}" is no longer available`,
          type:    'unavailable',
        });
        continue;
      }

      const variant = product.variants.find((v) => v._id.toString() === item.variantId.toString());

      // Variant removed
      if (!variant || !variant.isActive) {
        stockWarnings.push({
          itemId:  item._id,
          message: `Selected variant of "${product.name}" is no longer available`,
          type:    'unavailable',
        });
        continue;
      }

      // Stock changed
      let finalQuantity = item.quantity;
      if (variant.stock === 0) {
        stockWarnings.push({
          itemId:   item._id,
          message:  `"${product.name}" is out of stock`,
          type:     'out_of_stock',
        });
        continue; // Don't add out-of-stock items to totals
      }

      if (variant.stock < item.quantity) {
        finalQuantity = variant.stock;
        stockWarnings.push({
          itemId:       item._id,
          message:      `"${product.name}" — only ${variant.stock} left, quantity adjusted`,
          type:         'quantity_adjusted',
          newQuantity:  variant.stock,
        });
      }

      // Price change warning
      const priceChanged = variant.price !== item.priceSnapshot;

      const linePrice = variant.price * finalQuantity;
      const lineMrp   = variant.mrp   * finalQuantity;

      subtotal += linePrice;
      mrpTotal += lineMrp;

      // Shipping: add once per vendor, skip if free
      if (!product.isFreeShipping) {
        shipping = Math.max(shipping, product.shippingCharge || 0);
      }

      enrichedItems.push({
        _id:        item._id,
        product:    { _id: product._id, name: product.name, slug: product.slug, status: product.status },
        vendor:     product.vendor,
        variantId:  item.variantId,
        variant: {
          _id:        variant._id,
          sku:        variant.sku,
          price:      variant.price,
          mrp:        variant.mrp,
          stock:      variant.stock,
          attributes: variant.attributes,
          image:      variant.images?.[0]?.url || product.images?.[0]?.url || '',
        },
        quantity:       finalQuantity,
        linePrice,
        lineMrp,
        lineSavings:    lineMrp - linePrice,
        priceChanged,
        oldPrice:       priceChanged ? item.priceSnapshot : null,
        nameSnapshot:   item.nameSnapshot,
        skuSnapshot:    item.skuSnapshot,
      });
    }

    // Apply coupon if present
    let couponDiscount = 0;
    let couponInfo     = null;
    if (cart.coupon?.code) {
      try {
        const result = await this.calculateCouponDiscount(cart.coupon.code, userId, subtotal, enrichedItems);
        couponDiscount = result.discount;
        couponInfo     = result.coupon;
      } catch (e) {
        // Coupon became invalid — silently remove it from totals
        couponInfo = { code: cart.coupon.code, invalid: true, reason: e.message };
      }
    }

    const mrpDiscount = mrpTotal - subtotal;
    const total       = Math.max(0, subtotal - couponDiscount + shipping);

    return {
      items:          enrichedItems,
      itemCount:      enrichedItems.reduce((s, i) => s + i.quantity, 0),
      subtotal,
      mrpTotal,
      mrpDiscount,
      couponDiscount,
      shippingCharge: shipping,
      total,
      savings:        mrpDiscount + couponDiscount,
      coupon:         couponInfo,
      stockWarnings,
    };
  }

  // ─── Validate and calculate coupon discount ───────────────────────────────
  static async calculateCouponDiscount(code, userId, subtotal, items = []) {
    const coupon = await Coupon.findOne({
      code:     code.toUpperCase(),
      isActive: true,
    });

    if (!coupon) throw new ApiError(404, 'Coupon not found or inactive');

    const now = new Date();
    if (now < coupon.startsAt)  throw new ApiError(400, 'Coupon is not active yet');
    if (now > coupon.expiresAt) throw new ApiError(400, 'Coupon has expired');

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      throw new ApiError(400, 'Coupon usage limit reached');
    }

    if (subtotal < coupon.minOrderValue) {
      throw new ApiError(400, `Minimum order value for this coupon is ₹${coupon.minOrderValue}`);
    }

    // Per-user limit check
    const userUsageCount = coupon.usageLog.filter(
      (l) => l.user.toString() === userId.toString()
    ).length;
    if (userUsageCount >= coupon.maxUsesPerUser) {
      throw new ApiError(400, 'You have already used this coupon');
    }

    // Applicability check
    if (coupon.applicableTo === 'specific_users') {
      if (!coupon.allowedUsers.some((u) => u.toString() === userId.toString())) {
        throw new ApiError(400, 'This coupon is not applicable for your account');
      }
    }

    if (coupon.applicableTo === 'specific_products' && items.length) {
      const eligible = items.some((i) =>
        coupon.allowedProducts.some((p) => p.toString() === i.product._id.toString())
      );
      if (!eligible) throw new ApiError(400, 'Coupon not applicable for items in your cart');
    }

    if (coupon.applicableTo === 'specific_categories' && items.length) {
      // Would need category IDs in items — simplified check
      // In full implementation fetch product categories and compare
    }

    // Calculate discount
    let discount = 0;
    if (coupon.discountType === 'flat') {
      discount = coupon.discountValue;
    } else {
      discount = (subtotal * coupon.discountValue) / 100;
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    }

    discount = Math.min(discount, subtotal); // Can't discount more than order value

    return {
      discount: Math.round(discount),
      coupon: {
        code:          coupon.code,
        discountType:  coupon.discountType,
        discountValue: coupon.discountValue,
        description:   coupon.description,
      },
    };
  }
}