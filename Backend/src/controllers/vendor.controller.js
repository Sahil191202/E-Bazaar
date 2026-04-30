import { Vendor } from "../models/Vendor.js";
import { Payout } from "../models/Payout.js";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { Coupon } from "../models/Coupon.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { UploadService } from "../services/upload.service.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";
import slugify from "slugify";

// ─────────────────────────────────────────────────────────────────────────────
//  ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────

export const registerVendor = asyncHandler(async (req, res) => {
  const existing = await Vendor.findOne({ user: req.user._id });
  if (existing) throw new ApiError(409, "Vendor profile already exists");

  const {
    storeName,
    storeDesc,
    storeEmail,
    storePhone,
    panNumber,
    gstNumber,
    storeAddress,
  } = req.body;

  // Generate unique store slug
  let storeSlug = slugify(storeName, { lower: true, strict: true });
  const slugConflict = await Vendor.findOne({ storeSlug });
  if (slugConflict) storeSlug = `${storeSlug}-${Date.now()}`;

  const vendor = await Vendor.create({
    user: req.user._id,
    storeName,
    storeSlug,
    storeDesc,
    storeEmail,
    storePhone,
    panNumber: panNumber?.toUpperCase(),
    gstNumber: gstNumber?.toUpperCase(),
    storeAddress,
  });

  // Update user role to vendor
  await User.findByIdAndUpdate(req.user._id, { role: "vendor" });

  res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { vendor },
        "Vendor registered. Please complete KYC.",
      ),
    );
});

// ─────────────────────────────────────────────────────────────────────────────
//  VENDOR PROFILE
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorProfile = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ user: req.user._id })
    .populate("user", "name email phone avatar")
    .lean();
  if (!vendor) throw new ApiError(404, "Vendor profile not found");
  res.json(new ApiResponse(200, { vendor }));
});

export const updateVendorProfile = asyncHandler(async (req, res) => {
  const {
    storeName,
    storeDesc,
    storeEmail,
    storePhone,
    storeAddress,
    autoAcceptOrders,
    vacationMode,
    vacationMessage,
  } = req.body;

  const vendor = await Vendor.findOne({ user: req.user._id });
  if (!vendor) throw new ApiError(404, "Vendor profile not found");

  if (storeName) vendor.storeName = storeName;
  if (storeDesc) vendor.storeDesc = storeDesc;
  if (storeEmail) vendor.storeEmail = storeEmail;
  if (storePhone) vendor.storePhone = storePhone;
  if (storeAddress) vendor.storeAddress = storeAddress;
  if (autoAcceptOrders !== undefined)
    vendor.autoAcceptOrders = autoAcceptOrders;
  if (vacationMode !== undefined) vendor.vacationMode = vacationMode;
  if (vacationMessage) vendor.vacationMessage = vacationMessage;

  // Handle image uploads
  if (req.files?.logo?.[0]) {
    if (vendor.storeLogo)
      await UploadService.deleteImage(vendor.storeLogoPublicId).catch(() => {});
    const uploaded = await UploadService.uploadImage(
      req.files.logo[0].path,
      "vendors/logos",
    );
    vendor.storeLogo = uploaded.url;
  }
  if (req.files?.banner?.[0]) {
    const uploaded = await UploadService.uploadImage(
      req.files.banner[0].path,
      "vendors/banners",
    );
    vendor.storeBanner = uploaded.url;
  }

  await vendor.save();
  res.json(new ApiResponse(200, { vendor }, "Store profile updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  KYC
// ─────────────────────────────────────────────────────────────────────────────

export const submitKYC = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ user: req.user._id });
  if (!vendor) throw new ApiError(404, "Vendor profile not found");

  if (vendor.kycStatus === "approved") {
    throw new ApiError(400, "KYC already approved");
  }

  const { panNumber, gstNumber, aadharLast4 } = req.body;

  if (panNumber) vendor.panNumber = panNumber.toUpperCase();
  if (gstNumber) vendor.gstNumber = gstNumber.toUpperCase();
  if (aadharLast4) vendor.aadharNumber = aadharLast4;

  // Upload documents
  if (req.files && Object.keys(req.files).length) {
    for (const [fieldname, fileArray] of Object.entries(req.files)) {
      const file = fileArray[0];
      const uploaded = await UploadService.uploadImage(
        file.path,
        "vendors/kyc",
      );
      vendor.documents = vendor.documents.filter((d) => d.type !== fieldname);
      vendor.documents.push({
        type: fieldname,
        url: uploaded.url,
        publicId: uploaded.publicId,
        status: "pending",
      });
    }
  }

  vendor.kycStatus = "pending";
  vendor.kycSubmittedAt = new Date();
  vendor.kycRejectionReason = null;

  await vendor.save();
  res.json(
    new ApiResponse(
      200,
      null,
      "KYC submitted. Under review (1-2 business days).",
    ),
  );
});

export const updateBankDetails = asyncHandler(async (req, res) => {
  const { accountHolderName, accountNumber, ifscCode, bankName, branchName } =
    req.body;

  const vendor = await Vendor.findOne({ user: req.user._id });
  if (!vendor) throw new ApiError(404, "Vendor profile not found");

  vendor.bankDetails = {
    accountHolderName,
    accountNumber,
    ifscCode,
    bankName,
    branchName,
    isVerified: false,
  };

  await vendor.save();
  res.json(
    new ApiResponse(200, null, "Bank details saved. Verification pending."),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  DASHBOARD & ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboard = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({ user: req.user._id }).select(
    "pendingPayout totalEarnings totalPaidOut totalOrders totalProducts kycStatus isActive vacationMode",
  );

  if (!vendor) throw new ApiError(404, "Vendor profile not found");

  // ← vendor._id use karo, req.user._id nahi
  const [summary, orderStats, topProducts] = await Promise.all([
    AnalyticsService.getVendorSummary(req.user._id), // ← vendor._id nahi
    AnalyticsService.getVendorOrderStats(req.user._id),
    AnalyticsService.getVendorTopProducts(req.user._id, 5),
  ]);

  res.json(new ApiResponse(200, { vendor, summary, orderStats, topProducts }));
});

export const getSalesAnalytics = asyncHandler(async (req, res) => {
  const { period = "monthly" } = req.query;
  if (!["daily", "weekly", "monthly"].includes(period)) {
    throw new ApiError(400, "Period must be daily, weekly, or monthly");
  }

  // ← vendor._id fetch karo
  const vendor = await Vendor.findOne({ user: req.user._id }).select("_id");
  if (!vendor) throw new ApiError(404, "Vendor not found");

  const data = await AnalyticsService.getVendorSalesAnalytics(
    req.user._id,
    period,
  );
  res.json(new ApiResponse(200, { period, data }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  PAYOUTS
// ─────────────────────────────────────────────────────────────────────────────

export const getPayouts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [payouts, total, vendor] = await Promise.all([
    Payout.find({ vendor: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payout.countDocuments({ vendor: req.user._id }),
    Vendor.findOne({ user: req.user._id }).select(
      "pendingPayout totalEarnings totalPaidOut",
    ),
  ]);

  res.json(
    new ApiResponse(
      200,
      {
        payouts,
        summary: {
          pendingPayout: vendor?.pendingPayout || 0,
          totalEarnings: vendor?.totalEarnings || 0,
          totalPaidOut: vendor?.totalPaidOut || 0,
        },
      },
      "Payouts",
      paginationMeta(total, page, limit),
    ),
  );
});

export const requestPayout = asyncHandler(async (req, res) => {
  const { amount } = req.body;

  const vendor = await Vendor.findOne({ user: req.user._id });
  if (!vendor) throw new ApiError(404, "Vendor profile not found");

  if (vendor.kycStatus !== "approved") {
    throw new ApiError(403, "KYC must be approved before requesting payouts");
  }
  if (!vendor.bankDetails?.accountNumber) {
    throw new ApiError(
      400,
      "Please add bank details before requesting a payout",
    );
  }
  if (vendor.pendingPayout < 100) {
    throw new ApiError(400, "Minimum payout amount is ₹100");
  }

  const payoutAmount = amount
    ? Math.min(amount, vendor.pendingPayout)
    : vendor.pendingPayout;

  if (payoutAmount < 100) {
    throw new ApiError(
      400,
      `Requested amount (₹${payoutAmount}) is less than minimum ₹100`,
    );
  }

  // Check for pending payout already
  const activePayout = await Payout.findOne({
    vendor: req.user._id,
    status: { $in: ["pending", "processing"] },
  });
  if (activePayout) {
    throw new ApiError(
      400,
      "A payout is already in progress. Please wait for it to complete.",
    );
  }

  const payout = await Payout.create({
    vendor: req.user._id,
    amount: payoutAmount,
    method: "bank_transfer",
    bankAccountLast4: vendor.bankDetails.accountNumber.slice(-4),
    period: {
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to: new Date(),
    },
  });

  // Hold pending amount
  vendor.pendingPayout -= payoutAmount;
  await vendor.save();

  res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { payout },
        "Payout request submitted. Admin will process within 3-5 business days.",
      ),
    );
});

// ─────────────────────────────────────────────────────────────────────────────
//  COUPON MANAGEMENT (Vendor)
// ─────────────────────────────────────────────────────────────────────────────

export const createCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    description,
    discountType,
    discountValue,
    maxDiscount,
    minOrderValue,
    maxUses,
    maxUsesPerUser,
    expiresAt,
    startsAt,
    applicableTo,
    allowedProducts,
  } = req.body;

  const vendor = await Vendor.findOne({ user: req.user._id });
  if (!vendor || vendor.kycStatus !== "approved") {
    throw new ApiError(403, "KYC must be approved to create coupons");
  }

  const existing = await Coupon.findOne({ code: code.toUpperCase() });
  if (existing) throw new ApiError(409, "Coupon code already exists");

  // Vendor coupons can only apply to their own products
  if (applicableTo === "specific_products" && allowedProducts?.length) {
    const { Product } = await import("../models/Product.js");
    const ownProducts = await Product.countDocuments({
      _id: { $in: allowedProducts },
      vendor: req.user._id,
    });
    if (ownProducts !== allowedProducts.length) {
      throw new ApiError(
        403,
        "You can only create coupons for your own products",
      );
    }
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase(),
    description,
    discountType,
    discountValue,
    maxDiscount: maxDiscount || null,
    minOrderValue: minOrderValue || 0,
    maxUses: maxUses || null,
    maxUsesPerUser: maxUsesPerUser || 1,
    expiresAt: new Date(expiresAt),
    startsAt: startsAt ? new Date(startsAt) : new Date(),
    applicableTo: applicableTo || "specific_products",
    allowedProducts: allowedProducts || [],
    createdBy: req.user._id,
    creatorRole: "vendor",
  });

  res.status(201).json(new ApiResponse(201, { coupon }, "Coupon created"));
});

export const getVendorCoupons = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { isActive } = req.query;

  const filter = { createdBy: req.user._id };
  if (isActive !== undefined) filter.isActive = isActive === "true";

  const [coupons, total] = await Promise.all([
    Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("-usageLog")
      .lean(),
    Coupon.countDocuments(filter),
  ]);

  res.json(
    new ApiResponse(
      200,
      { coupons },
      "Coupons",
      paginationMeta(total, page, limit),
    ),
  );
});

export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({
    _id: req.params.id,
    createdBy: req.user._id,
  });
  if (!coupon) throw new ApiError(404, "Coupon not found");

  const { isActive, expiresAt, maxUses, description, minOrderValue } = req.body;

  if (isActive !== undefined) coupon.isActive = isActive;
  if (expiresAt) coupon.expiresAt = new Date(expiresAt);
  if (maxUses) coupon.maxUses = maxUses;
  if (description) coupon.description = description;
  if (minOrderValue !== undefined) coupon.minOrderValue = minOrderValue;

  await coupon.save();
  res.json(new ApiResponse(200, { coupon }, "Coupon updated"));
});

export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({
    _id: req.params.id,
    createdBy: req.user._id,
  });
  if (!coupon) throw new ApiError(404, "Coupon not found");
  if (coupon.usedCount > 0)
    throw new ApiError(400, "Cannot delete a coupon that has been used");

  await coupon.deleteOne();
  res.json(new ApiResponse(200, null, "Coupon deleted"));
});

export const getCouponUsage = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findOne({
    _id: req.params.id,
    createdBy: req.user._id,
  })
    .populate("usageLog.user", "name phone email")
    .lean();
  if (!coupon) throw new ApiError(404, "Coupon not found");

  res.json(
    new ApiResponse(200, {
      code: coupon.code,
      usedCount: coupon.usedCount,
      maxUses: coupon.maxUses,
      usageLog: coupon.usageLog.slice(-50), // last 50 uses
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  SHIPPING LABELS & PACKAGING SLIPS
// ─────────────────────────────────────────────────────────────────────────────

export const generateShippingLabel = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findOne({
    _id: orderId,
    "items.vendor": req.user._id,
  }).populate("customer", "name phone");

  if (!order) throw new ApiError(404, "Order not found");

  const vendor = await Vendor.findOne({ user: req.user._id });
  const vendorItems = order.items.filter(
    (i) => i.vendor.toString() === req.user._id.toString(),
  );

  // Return structured data — frontend/PDF service renders actual label
  const label = {
    labelType: "shipping",
    orderId: order.orderId,
    generatedAt: new Date().toISOString(),

    ship_to: {
      name: order.deliveryAddress.fullName,
      phone: order.deliveryAddress.phone,
      address: `${order.deliveryAddress.line1}${order.deliveryAddress.line2 ? ", " + order.deliveryAddress.line2 : ""}`,
      city: order.deliveryAddress.city,
      state: order.deliveryAddress.state,
      pincode: order.deliveryAddress.pincode,
      country: order.deliveryAddress.country,
    },

    ship_from: {
      name: vendor.storeName,
      phone: vendor.storePhone,
      address: vendor.storeAddress?.line1 || "",
      city: vendor.storeAddress?.city || "",
      state: vendor.storeAddress?.state || "",
      pincode: vendor.storeAddress?.pincode || "",
    },

    items: vendorItems.map((i) => ({
      name: i.name,
      sku: i.sku,
      quantity: i.quantity,
    })),

    totalItems: vendorItems.reduce((s, i) => s + i.quantity, 0),
    paymentMethod: order.isCOD ? "COD" : "Prepaid",
    codAmount: order.isCOD ? order.totalAmount : 0,
  };

  res.json(new ApiResponse(200, { label }));
});

export const generatePackagingSlip = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findOne({
    _id: orderId,
    "items.vendor": req.user._id,
  }).populate("customer", "name phone email");

  if (!order) throw new ApiError(404, "Order not found");

  const vendorItems = order.items.filter(
    (i) => i.vendor.toString() === req.user._id.toString(),
  );

  const slip = {
    slipType: "packaging",
    orderId: order.orderId,
    generatedAt: new Date().toISOString(),

    customer: {
      name: order.customer.name,
      phone: order.customer.phone,
      email: order.customer.email,
    },

    deliveryAddress: order.deliveryAddress,

    items: vendorItems.map((i) => ({
      name: i.name,
      sku: i.sku,
      attributes: Object.fromEntries(i.attributes || []),
      quantity: i.quantity,
      price: i.price,
      total: i.total,
    })),

    subtotal: vendorItems.reduce((s, i) => s + i.total, 0),
    paymentMethod: order.isCOD ? "Cash on Delivery" : "Prepaid",
    orderDate: order.createdAt,
    estimatedDelivery: order.estimatedDelivery,

    note: order.customerNote || "",
  };

  res.json(new ApiResponse(200, { slip }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC: GET STORE PAGE
// ─────────────────────────────────────────────────────────────────────────────

export const getPublicStorePage = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOne({
    storeSlug: req.params.slug,
    isActive: true,
  })
    .populate("user", "name avatar")
    .select(
      "-bankDetails -documents -panNumber -gstNumber -aadharNumber -kycRejectionReason",
    )
    .lean();

  if (!vendor) throw new ApiError(404, "Store not found");

  const { Product } = await import("../models/Product.js");
  const { page, limit, skip } = getPagination(req.query);

  const [products, total] = await Promise.all([
    Product.find({ vendor: vendor.user._id, status: "active" })
      .sort({ purchaseCount: -1 })
      .skip(skip)
      .limit(limit)
      .select("name slug images basePrice baseMrp rating totalStock")
      .lean(),
    Product.countDocuments({ vendor: vendor.user._id, status: "active" }),
  ]);

  res.json(
    new ApiResponse(
      200,
      { vendor, products },
      "Store",
      paginationMeta(total, page, limit),
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN: KYC MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const adminGetPendingKYC = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { status = "pending" } = req.query;

  const [vendors, total] = await Promise.all([
    Vendor.find({ kycStatus: status })
      .populate("user", "name email phone")
      .sort({ kycSubmittedAt: 1 }) // Oldest first
      .skip(skip)
      .limit(limit)
      .select(
        "storeName kycStatus documents panNumber gstNumber kycSubmittedAt user",
      )
      .lean(),
    Vendor.countDocuments({ kycStatus: status }),
  ]);

  res.json(
    new ApiResponse(
      200,
      { vendors },
      `KYC ${status}`,
      paginationMeta(total, page, limit),
    ),
  );
});

export const adminReviewKYC = asyncHandler(async (req, res) => {
  const { vendorId } = req.params;
  const {
    action,
    reason,
    documentId,
    documentStatus,
    documentRejectionReason,
  } = req.body;

  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new ApiError(404, "Vendor not found");

  // Review individual document
  if (documentId) {
    const doc = vendor.documents.id(documentId);
    if (!doc) throw new ApiError(404, "Document not found");
    doc.status = documentStatus;
    if (documentRejectionReason) doc.rejectionReason = documentRejectionReason;
    if (documentStatus === "approved") doc.verifiedAt = new Date();
  }

  // Overall KYC decision
  if (action === "approve") {
    vendor.kycStatus = "approved";
    vendor.isVerified = true;
    vendor.kycApprovedAt = new Date();
    vendor.documents.forEach((d) => {
      if (d.status === "pending") d.status = "approved";
    });
  } else if (action === "reject") {
    if (!reason) throw new ApiError(400, "Rejection reason is required");
    vendor.kycStatus = "rejected";
    vendor.kycRejectionReason = reason;
  }

  await vendor.save();

  // Notify vendor
  const { NotificationService } =
    await import("../services/notification.service.js");
  await NotificationService.sendToUser(vendor.user, {
    type: "kyc_update",
    title: action === "approve" ? "KYC Approved! 🎉" : "KYC Rejected",
    message:
      action === "approve"
        ? "Your KYC has been approved. You can now list products and request payouts."
        : `KYC rejected: ${reason}. Please re-submit corrected documents.`,
    data: { vendorId: vendor._id },
  });

  res.json(new ApiResponse(200, null, `KYC ${action}d successfully`));
});

export const adminProcessPayout = asyncHandler(async (req, res) => {
  const { payoutId } = req.params;
  const { action, transactionId, failReason } = req.body;

  const payout = await Payout.findById(payoutId);
  if (!payout) throw new ApiError(404, "Payout not found");
  if (payout.status === "completed")
    throw new ApiError(400, "Payout already completed");

  if (action === "complete") {
    if (!transactionId) throw new ApiError(400, "Transaction ID is required");

    payout.status = "completed";
    payout.transactionId = transactionId;
    payout.completedAt = new Date();
    payout.initiatedBy = req.user._id;
    await payout.save();

    // Update vendor totals
    await Vendor.findOneAndUpdate(
      { user: payout.vendor },
      {
        $inc: { totalPaidOut: payout.amount },
      },
    );

    const { NotificationService } =
      await import("../services/notification.service.js");
    await NotificationService.sendToUser(payout.vendor, {
      type: "payout_completed",
      title: "Payout Completed! 💰",
      message: `₹${payout.amount} has been transferred to your bank account.`,
      data: { payoutId },
    });
  } else if (action === "fail") {
    payout.status = "failed";
    payout.failedAt = new Date();
    payout.failReason = failReason || "Payment failed";

    // Refund pending balance
    await Vendor.findOneAndUpdate(
      { user: payout.vendor },
      { $inc: { pendingPayout: payout.amount } },
    );

    await payout.save();
  }

  res.json(new ApiResponse(200, { payout }, `Payout ${action}d`));
});
