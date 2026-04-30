import mongoose from "mongoose";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    variantId: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Snapshots at time of order (never changes even if product updates)
    name: { type: String, required: true },
    image: { type: String, default: "" },
    sku: { type: String, required: true },
    attributes: { type: Map, of: String, default: {} },

    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true }, // price at order time
    mrp: { type: Number, required: true },
    total: { type: Number, required: true }, // price * quantity

    // Per-item status (vendor can ship items separately)
    status: {
      type: String,
      enum: [
        "confirmed",
        "processing",
        "packed",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "return_requested",
        "returned",
      ],
      default: "confirmed",
    },

    // Vendor commission calculation
    commissionRate: { type: Number, default: 0 }, // % platform takes
    vendorEarning: { type: Number, default: 0 },
    platformEarning: { type: Number, default: 0 },

    // Delivery info per item
    trackingNumber: String,
    carrier: String,
    deliveryAgent: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    cancelledAt: Date,
    cancelReason: String,
    deliveredAt: Date,
    returnReason: String,
    returnedAt: Date,
  },
  { _id: true, timestamps: true },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const addressSnapshotSchema = new mongoose.Schema(
  {
    fullName: String,
    phone: String,
    line1: String,
    line2: String,
    city: String,
    state: String,
    pincode: String,
    country: String,
  },
  { _id: false },
);

// ─── Main Order Schema ────────────────────────────────────────────────────────

const orderSchema = new mongoose.Schema(
  {
    // Readable order ID shown to users
    orderId: { type: String },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    items: {
      type: [orderItemSchema],
      validate: [(v) => v.length > 0, "Order must have at least one item"],
    },

    // Delivery address (snapshot — not a reference)
    deliveryAddress: { type: addressSnapshotSchema, required: true },

    // Pricing
    subtotal: { type: Number, required: true },
    mrpTotal: { type: Number, required: true },
    mrpDiscount: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    couponCode: String,
    shippingCharge: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true }, // final paid amount

    // Payment
    paymentMethod: {
      type: String,
      enum: ["razorpay", "cod", "wallet"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "partially_refunded"],
      default: "pending",
    },

    // Razorpay fields
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    paidAt: Date,

    // Overall order status
    status: {
      type: String,
      enum: [
        "pending_payment",
        "confirmed",
        "processing",
        "packed", // ← add
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refund_initiated",
        "refunded",
      ],
      default: "pending_payment",
    },

    statusHistory: [statusHistorySchema],

    // COD specific
    isCOD: { type: Boolean, default: false },
    codCollected: { type: Boolean, default: false },

    // Wallet used in payment
    walletAmountUsed: { type: Number, default: 0 },

    // Refunds
    refundAmount: { type: Number, default: 0 },
    refundInitiatedAt: Date,
    refundCompletedAt: Date,
    refundReason: String,
    razorpayRefundId: String,

    // Estimated delivery
    estimatedDelivery: Date,

    // Notes
    customerNote: String,
    internalNote: String,

    cancelledAt: Date,
    cancelReason: String,
    deliveredAt: Date,
  },
  { timestamps: true },
);

// ─── Pre-save: generate human-readable order ID ───────────────────────────────
orderSchema.pre("save", async function (next) {
  if (!this.orderId) {
    const date = new Date();
    const prefix = `ORD-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    const count = await this.constructor.countDocuments();
    this.orderId = `${prefix}-${String(count + 1).padStart(6, "0")}`;
  }
  next();
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
orderSchema.index({ orderId: 1 }, { unique: true }); // single source of truth
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ "items.vendor": 1, status: 1 });
orderSchema.index({ razorpayOrderId: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });

export const Order = mongoose.model("Order", orderSchema);
