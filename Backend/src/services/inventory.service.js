import { Product }       from '../models/Product.js';
import { InventoryLog }  from '../models/Inventory.js';
import { ApiError }      from '../utils/ApiError.js';
import { NotificationService } from './notification.service.js';

export class InventoryService {

  /**
   * Adjust stock for a specific variant.
   * quantityChange: positive = add stock, negative = deduct
   */
  static async adjustStock({ productId, variantId, quantityChange, type, referenceId, referenceType, note, createdBy }) {
    const product = await Product.findById(productId);
    if (!product) throw new ApiError(404, 'Product not found');

    const variant = product.variants.id(variantId);
    if (!variant) throw new ApiError(404, 'Variant not found');

    const before = variant.stock;
    const after  = before + quantityChange;

    if (after < 0) throw new ApiError(400, `Insufficient stock. Available: ${before}`);

    variant.stock = after;
    await product.save();

    // Log the movement
    await InventoryLog.create({
      product:        productId,
      variantId,
      vendor:         product.vendor,
      type,
      quantityBefore: before,
      quantityChange,
      quantityAfter:  after,
      referenceId,
      referenceType,
      note,
      createdBy,
    });

    // Low stock alert
    if (after <= variant.lowStockThreshold && before > variant.lowStockThreshold) {
      await NotificationService.sendToUser(product.vendor, {
        type:    'low_stock',
        title:   'Low Stock Alert',
        message: `"${product.name}" (${[...variant.attributes.values()].join('/')}) has only ${after} units left.`,
        data:    { productId, variantId },
      });
    }

    // Out of stock alert
    if (after === 0) {
      await NotificationService.sendToUser(product.vendor, {
        type:    'out_of_stock',
        title:   'Out of Stock',
        message: `"${product.name}" (${[...variant.attributes.values()].join('/')}) is now out of stock.`,
        data:    { productId, variantId },
      });
    }

    return { before, after, variant };
  }

  /**
   * Reserve stock during order placement (soft lock).
   * Hard deduction happens on payment success.
   */
  static async reserveStock(items) {
    // items: [{ productId, variantId, quantity }]
    const errors = [];

    for (const item of items) {
      const product = await Product.findById(item.productId).select('name variants');
      const variant = product?.variants.id(item.variantId);

      if (!variant || variant.stock < item.quantity) {
        errors.push(`"${product?.name}" — requested: ${item.quantity}, available: ${variant?.stock ?? 0}`);
      }
    }

    if (errors.length) throw new ApiError(400, 'Stock unavailable', errors);

    // Deduct all at once (atomic per product)
    for (const item of items) {
      await this.adjustStock({
        productId:      item.productId,
        variantId:      item.variantId,
        quantityChange: -item.quantity,
        type:           'sale',
        referenceType:  'Order',
      });
    }
  }

  /**
   * Release reserved stock on order cancellation.
   */
  static async releaseStock(items, orderId) {
    for (const item of items) {
      await this.adjustStock({
        productId:      item.productId,
        variantId:      item.variantId,
        quantityChange: +item.quantity,
        type:           'return',
        referenceId:    orderId,
        referenceType:  'Order',
        note:           'Order cancelled — stock released',
      });
    }
  }
}