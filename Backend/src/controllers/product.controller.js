import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { InventoryLog } from "../models/Inventory.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { UploadService } from "../services/upload.service.js";
import { getPagination, paginationMeta } from "../utils/pagination.js";
import {
  getCache,
  setCache,
  delCache,
  delCachePattern,
} from "../config/redis.js";
import { parseCSV, parseExcel } from "../utils/bulkUpload.js";
import fs from "fs";
import mongoose from "mongoose";
import { CategoryFieldService } from "../services/categoryField.service.js";

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE PRODUCT (Vendor)
// ─────────────────────────────────────────────────────────────────────────────

export const createProduct = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    shortDesc,
    categoryId,
    subCategoryId,
    brand,
    tags,
    variants,
    isFreeShipping,
    shippingCharge,
    metaTitle,
    metaDescription,
  } = req.body;

  // Validate category
  if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
    throw new ApiError(400, "Invalid category ID");
  }

  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError(404, "Category not found");

  // Upload product images
  let images = [];
  if (req.files?.length) {
    const uploaded = await UploadService.uploadMultiple(
      req.files,
      `products/${req.user._id}`,
    );
    images = uploaded.map((u, i) => ({ ...u, alt: name, isPrimary: i === 0 }));
  }

  const parseArrayField = (field, name) => {
    try {
      let value = typeof field === "string" ? JSON.parse(field) : field;

      if (!Array.isArray(value) && typeof value === "object") {
        value = Object.values(value);
      }

      if (!Array.isArray(value)) {
        throw new Error();
      }

      return value;
    } catch {
      throw new ApiError(400, `${name} must be an array`);
    }
  };

  const parsedVariants = parseArrayField(variants, "Variants");
  const parsedTags = tags ? parseArrayField(tags, "Tags") : [];

  // ✅ Ensure at least one variant
  if (!parsedVariants.length) {
    throw new ApiError(400, "At least one variant is required");
  }

  // ✅ SKU validation
  const skus = parsedVariants.map((v) => {
    if (!v.sku) throw new ApiError(400, "Each variant must have a SKU");
    return v.sku;
  });

  // Check global SKU uniqueness
  const skuConflict = await Product.findOne({ "variants.sku": { $in: skus } });
  if (skuConflict)
    throw new ApiError(
      409,
      `SKU already exists: ${skuConflict.variants.find((v) => skus.includes(v.sku))?.sku}`,
    );

  let validatedCustomFields = {};
  const rawCustomFields = req.body.customFields
    ? typeof req.body.customFields === "string"
      ? JSON.parse(req.body.customFields)
      : req.body.customFields
    : {};

  if (rawCustomFields && Object.keys(rawCustomFields).length) {
    const fieldDefs = await CategoryFieldService.getFieldsForCategory(
      categoryId,
      category.ancestors,
    );
    validatedCustomFields = CategoryFieldService.validateCustomFields(
      rawCustomFields,
      fieldDefs,
    );
  } else {
    // Even if vendor sent no custom fields, check if any are required
    const fieldDefs = await CategoryFieldService.getFieldsForCategory(
      categoryId,
      category.ancestors,
    );
    const requiredFields = fieldDefs.filter((f) => f.isRequired);
    if (requiredFields.length) {
      CategoryFieldService.validateCustomFields({}, fieldDefs); // Will throw if required fields missing
    }
  }

  const product = await Product.create({
    name,
    description,
    shortDesc,
    vendor: req.user._id,
    category: categoryId,
    subCategory: subCategoryId,
    brand,
    tags: parsedTags,
    images,
    variants: parsedVariants,
    isFreeShipping,
    shippingCharge,
    customFields: validatedCustomFields, // ← ADD THIS
    metaTitle,
    metaDescription,
    status: "pending_approval",
  });

  await delCachePattern("products:*");

  res
    .status(201)
    .json(new ApiResponse(201, { product }, "Product submitted for approval"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET PRODUCTS (Public — with search, filters, pagination)
// ─────────────────────────────────────────────────────────────────────────────

export const getProducts = asyncHandler(async (req, res) => {
  const {
    q, // Search query
    category, // Category ID or slug
    brand, // Brand name
    minPrice, // Min price filter
    maxPrice, // Max price filter
    rating, // Min rating (e.g. 4 for 4+)
    inStock, // 'true' to show only in-stock
    isFeatured,
    isBestSeller,
    isNewArrival,
    sort = "relevance", // relevance | price_asc | price_desc | rating | newest | popular
    tags,
  } = req.query;

  const { page, limit, skip } = getPagination(req.query);

  // ── Build filter ────────────────────────────────────────────────────────────
  const filter = {};

  if (req.query.status) {
    filter.status = req.query.status;
  } else {
    filter.status = "active";
  }

  if (req.query.status && req.query.status !== "active") {
    // Sirf admin hi non-active products dekh sakta hai
    if (!req.user || req.user.role !== "admin") {
      filter.status = "active"; // non-admin ko force active
    } else {
      filter.status = req.query.status;
    }
  } else {
    filter.status = req.query.status || "active";

    // Public route pe req.user nahi hoga
    const isAdmin = req.user?.role === "admin";

    if (req.query.status && isAdmin) {
      filter.status = req.query.status;
    } else {
      filter.status = "active"; // public aur non-admin ke liye hamesha active
    }
  }

  // Full-text search
  if (q) {
    filter.$text = { $search: q };
  }

  // Category filter (supports slug or ID)
  if (category) {
    let cat;
    if (category.match(/^[0-9a-fA-F]{24}$/)) {
      cat = await Category.findById(category).select("_id");
    } else {
      cat = await Category.findOne({ slug: category }).select("_id");
    }
    if (cat) {
      // Include the category AND all its descendants
      const descendants = await Category.find({ ancestors: cat._id }).select(
        "_id",
      );
      const categoryIds = [cat._id, ...descendants.map((d) => d._id)];
      filter.category = { $in: categoryIds };
    }
  }

  if (brand) filter.brand = { $regex: new RegExp(`^${brand}$`, "i") };
  if (tags)
    filter.tags = { $in: tags.split(",").map((t) => t.trim().toLowerCase()) };
  if (minPrice || maxPrice) {
    filter.basePrice = {};
    if (minPrice) filter.basePrice.$gte = Number(minPrice);
    if (maxPrice) filter.basePrice.$lte = Number(maxPrice);
  }
  if (rating) filter["rating.average"] = { $gte: Number(rating) };
  if (inStock === "true") filter.totalStock = { $gt: 0 };
  if (isFeatured === "true") filter.isFeatured = true;
  if (isNewArrival === "true") {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    filter.createdAt = { $gte: thirtyDaysAgo };
    // OR use manual flag:
    // filter.isNewArrival = true;
  }
  if (isBestSeller === "true") filter.isBestSeller = true;

  // ── Build sort ──────────────────────────────────────────────────────────────
  const sortMap = {
    relevance: q ? { score: { $meta: "textScore" } } : { purchaseCount: -1 },
    price_asc: { basePrice: 1 },
    price_desc: { basePrice: -1 },
    rating: { "rating.average": -1, "rating.count": -1 },
    newest: { createdAt: -1 },
    popular: { purchaseCount: -1 },
  };
  const sortObj = sortMap[sort] || sortMap.relevance;

  // ── Cache key ───────────────────────────────────────────────────────────────
  const cacheKey = `products:list:${JSON.stringify({ ...req.query, page, limit })}`;
  const cached = await getCache(cacheKey);
  if (cached)
    return res.json(
      new ApiResponse(200, cached.data, "Products fetched", cached.meta),
    );

  // ── Query ───────────────────────────────────────────────────────────────────
  const projection = q ? { score: { $meta: "textScore" } } : {};

  const [products, total] = await Promise.all([
    Product.find(filter, projection)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .populate("category", "name slug")
      .populate("vendor", "name avatar")
      .select("-description -variants.dimensions -__v") // Exclude heavy fields from list
      .lean(),
    Product.countDocuments(filter),
  ]);

  const meta = paginationMeta(total, page, limit);
  const result = { products };

  await setCache(cacheKey, { data: result, meta }, 300); // 5 min

  res.json(new ApiResponse(200, result, "Products fetched", meta));
});

export const toggleProductFlag = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isFeatured, isNewArrival, isBestSeller } = req.body;

  const updates = {};
  if (typeof isFeatured === "boolean") updates.isFeatured = isFeatured;
  if (typeof isNewArrival === "boolean") updates.isNewArrival = isNewArrival;
  if (typeof isBestSeller === "boolean") updates.isBestSeller = isBestSeller;

  const product = await Product.findByIdAndUpdate(id, updates, { new: true });
  if (!product) throw new ApiError(404, "Product not found");

  res.json(new ApiResponse(200, { product }, "Product flags updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET SINGLE PRODUCT (Public)
// ─────────────────────────────────────────────────────────────────────────────

export const getProductBySlug = asyncHandler(async (req, res) => {
  const cacheKey = `product:slug:${req.params.slug}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    // Increment view count in background (non-blocking)
    Product.findByIdAndUpdate(cached._id, { $inc: { viewCount: 1 } }).exec();
    return res.json(new ApiResponse(200, { product: cached }));
  }

  const product = await Product.findOne({
    slug: req.params.slug,
    status: { $in: ["active", "pending_approval"] },
  })
    .populate("category", "name slug ancestors")
    .populate("subCategory", "name slug")
    .populate("vendor", "name avatar")
    .lean();

  if (!product) throw new ApiError(404, "Product not found");

  await setCache(cacheKey, product, 600); // 10 min
  Product.findByIdAndUpdate(product._id, { $inc: { viewCount: 1 } }).exec();

  res.json(new ApiResponse(200, { product }));
});

export const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate("category", "name slug")
    .populate("vendor", "name avatar")
    .lean();
  if (!product) throw new ApiError(404, "Product not found");
  res.json(new ApiResponse(200, { product }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE PRODUCT (Vendor — own products only)
// ─────────────────────────────────────────────────────────────────────────────

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.user._id,
  });
  if (!product) throw new ApiError(404, "Product not found");

  const {
    name,
    description,
    shortDesc,
    brand,
    tags,
    isFreeShipping,
    shippingCharge,
    metaTitle,
    metaDescription,
  } = req.body;

  if (req.body.customFields) {
    const rawCustomFields =
      typeof req.body.customFields === "string"
        ? JSON.parse(req.body.customFields)
        : req.body.customFields;

    const cat = await Category.findById(product.category).lean();
    if (cat) {
      const fieldDefs = await CategoryFieldService.getFieldsForCategory(
        product.category,
        cat.ancestors,
      );
      // Merge existing custom fields with new values (patch semantics)
      const existing = Object.fromEntries(product.customFields || new Map());
      const merged = { ...existing, ...rawCustomFields };
      product.customFields = CategoryFieldService.validateCustomFields(
        merged,
        fieldDefs,
      );
    }
  }

  if (name) product.name = name;
  if (description) product.description = description;
  if (shortDesc) product.shortDesc = shortDesc;
  if (brand) product.brand = brand;
  if (tags) product.tags = tags;
  if (isFreeShipping !== undefined) product.isFreeShipping = isFreeShipping;
  if (shippingCharge !== undefined) product.shippingCharge = shippingCharge;
  if (metaTitle) product.metaTitle = metaTitle;
  if (metaDescription) product.metaDescription = metaDescription;

  // If product was active and edited, put back to pending
  if (product.status === "active") product.status = "pending_approval";

  await product.save();

  await delCache(`product:slug:${product.slug}`);
  await delCachePattern("products:*");

  res.json(new ApiResponse(200, { product }, "Product updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  MANAGE VARIANTS (Vendor)
// ─────────────────────────────────────────────────────────────────────────────

export const addVariant = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.user._id,
  });
  if (!product) throw new ApiError(404, "Product not found");

  const {
    sku,
    price,
    mrp,
    stock,
    attributes,
    weight,
    dimensions,
    lowStockThreshold,
  } = req.body;

  // SKU uniqueness check
  const skuExists = await Product.findOne({ "variants.sku": sku });
  if (skuExists) throw new ApiError(409, `SKU "${sku}" already exists`);

  let images = [];
  if (req.files?.length) {
    const uploaded = await UploadService.uploadMultiple(
      req.files,
      `products/${req.user._id}`,
    );
    images = uploaded.map((u, i) => ({ ...u, alt: sku, isPrimary: i === 0 }));
  }

  product.variants.push({
    sku,
    price,
    mrp,
    stock,
    attributes,
    weight,
    dimensions,
    lowStockThreshold,
    images,
  });
  await product.save();

  await delCache(`product:slug:${product.slug}`);
  res.json(new ApiResponse(200, { product }, "Variant added"));
});

export const updateVariant = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.user._id,
  });
  if (!product) throw new ApiError(404, "Product not found");

  const variant = product.variants.id(req.params.variantId);
  if (!variant) throw new ApiError(404, "Variant not found");

  const {
    price,
    mrp,
    stock,
    attributes,
    weight,
    dimensions,
    lowStockThreshold,
    isActive,
  } = req.body;
  if (price !== undefined) variant.price = price;
  if (mrp !== undefined) variant.mrp = mrp;
  if (stock !== undefined) variant.stock = stock;
  if (attributes !== undefined) variant.attributes = attributes;
  if (weight !== undefined) variant.weight = weight;
  if (dimensions !== undefined) variant.dimensions = dimensions;
  if (lowStockThreshold !== undefined)
    variant.lowStockThreshold = lowStockThreshold;
  if (isActive !== undefined) variant.isActive = isActive;

  await product.save();
  await delCache(`product:slug:${product.slug}`);
  res.json(new ApiResponse(200, { variant }, "Variant updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  MANAGE IMAGES (Vendor)
// ─────────────────────────────────────────────────────────────────────────────

export const addProductImages = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.user._id,
  });
  if (!product) throw new ApiError(404, "Product not found");

  if (!req.files?.length) throw new ApiError(400, "No images uploaded");
  if (product.images.length + req.files.length > 10)
    throw new ApiError(400, "Maximum 10 images per product");

  const uploaded = await UploadService.uploadMultiple(
    req.files,
    `products/${req.user._id}`,
  );
  const newImages = uploaded.map((u) => ({ ...u, alt: product.name }));
  product.images.push(...newImages);

  await product.save();
  await delCache(`product:slug:${product.slug}`);
  res.json(new ApiResponse(200, { images: product.images }, "Images added"));
});

export const deleteProductImage = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    vendor: req.user._id,
  });
  if (!product) throw new ApiError(404, "Product not found");

  const image = product.images.id(req.params.imageId);
  if (!image) throw new ApiError(404, "Image not found");

  await UploadService.deleteImage(image.publicId);
  product.images.pull(req.params.imageId);
  await product.save();

  await delCache(`product:slug:${product.slug}`);
  res.json(new ApiResponse(200, null, "Image deleted"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  SEARCH SUGGESTIONS (Autocomplete)
// ─────────────────────────────────────────────────────────────────────────────

export const searchSuggestions = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json(new ApiResponse(200, []));

  const cacheKey = `suggest:${q.toLowerCase()}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.json(new ApiResponse(200, cached));

  const [products, brands, categories] = await Promise.all([
    // Product name matches
    Product.find(
      { $text: { $search: q }, status: "active" },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(5)
      .select("name slug images")
      .lean(),

    // Brand matches
    Product.distinct("brand", {
      brand: { $regex: new RegExp(q, "i") },
      status: "active",
    }).then((b) => b.slice(0, 3)),

    // Category matches
    Category.find({ name: { $regex: new RegExp(q, "i") }, isActive: true })
      .limit(3)
      .select("name slug")
      .lean(),
  ]);

  const suggestions = {
    products: products.map((p) => ({
      name: p.name,
      slug: p.slug,
      image: p.images[0]?.url,
    })),
    brands: brands.map((b) => ({ type: "brand", name: b })),
    categories: categories.map((c) => ({
      type: "category",
      name: c.name,
      slug: c.slug,
    })),
  };

  await setCache(cacheKey, suggestions, 120); // 2 min cache
  res.json(new ApiResponse(200, suggestions));
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

export const approveProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { status: "active", rejectionReason: "" },
    { new: true },
  );
  if (!product) throw new ApiError(404, "Product not found");
  await delCachePattern("products:*");
  res.json(new ApiResponse(200, { product }, "Product approved"));
});

export const rejectProduct = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, "Rejection reason is required");

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { status: "rejected", rejectionReason: reason },
    { new: true },
  );
  if (!product) throw new ApiError(404, "Product not found");
  res.json(new ApiResponse(200, { product }, "Product rejected"));
});

export const adminUpdateFlags = asyncHandler(async (req, res) => {
  const { isFeatured, isBestSeller, isNewArrival } = req.body;
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { isFeatured, isBestSeller, isNewArrival } },
    { new: true },
  );
  if (!product) throw new ApiError(404, "Product not found");
  await delCache(`product:slug:${product.slug}`);
  res.json(new ApiResponse(200, { product }, "Product flags updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  VENDOR: GET OWN PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorProducts = asyncHandler(async (req, res) => {
  const { status, page: p, limit: l } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { vendor: req.user._id };
  if (status) filter.status = status;

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("name slug images status basePrice totalStock rating createdAt")
      .lean(),
    Product.countDocuments(filter),
  ]);

  res.json(
    new ApiResponse(
      200,
      { products },
      "Vendor products",
      paginationMeta(total, page, limit),
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  BULK UPLOAD (Vendor — CSV / Excel)
// ─────────────────────────────────────────────────────────────────────────────

export const bulkUploadProducts = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Please upload a CSV or Excel file");

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  let rows;
  if (mimeType === "text/csv") {
    rows = await parseCSV(filePath);
  } else {
    rows = await parseExcel(filePath);
  }

  // Clean up temp file
  fs.unlink(filePath, () => {});

  if (!rows.length)
    throw new ApiError(400, "File is empty or has no valid rows");
  if (rows.length > 500)
    throw new ApiError(400, "Maximum 500 products per upload");

  const results = { success: [], failed: [] };

  for (const [index, row] of rows.entries()) {
    try {
      const {
        name,
        description,
        categoryId,
        sku,
        price,
        mrp,
        stock,
        brand,
        tags,
      } = row;

      if (!name || !description || !categoryId || !sku || !price || !mrp) {
        throw new Error(
          "Missing required fields: name, description, categoryId, sku, price, mrp",
        );
      }

      const skuExists = await Product.findOne({ "variants.sku": sku });
      if (skuExists) throw new Error(`SKU "${sku}" already exists`);

      await Product.create({
        name,
        description,
        vendor: req.user._id,
        category: categoryId,
        brand: brand || "",
        tags: tags ? tags.split("|").map((t) => t.trim()) : [],
        variants: [
          {
            sku,
            price: Number(price),
            mrp: Number(mrp),
            stock: Number(stock) || 0,
          },
        ],
        status: "pending_approval",
      });

      results.success.push({ row: index + 2, name });
    } catch (err) {
      results.failed.push({
        row: index + 2,
        name: row.name || "Unknown",
        error: err.message,
      });
    }
  }

  await delCachePattern("products:*");

  res.json(
    new ApiResponse(
      200,
      results,
      `Bulk upload: ${results.success.length} created, ${results.failed.length} failed`,
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  INVENTORY LOG (Vendor)
// ─────────────────────────────────────────────────────────────────────────────

export const getInventoryLogs = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { page, limit, skip } = getPagination(req.query);

  const product = await Product.findOne({
    _id: productId,
    vendor: req.user._id,
  });
  if (!product) throw new ApiError(404, "Product not found");

  const [logs, total] = await Promise.all([
    InventoryLog.find({ product: productId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InventoryLog.countDocuments({ product: productId }),
  ]);

  res.json(
    new ApiResponse(
      200,
      { logs },
      "Inventory logs",
      paginationMeta(total, page, limit),
    ),
  );
});

export const manualStockAdjustment = asyncHandler(async (req, res) => {
  const { productId, variantId, quantity, note } = req.body;

  const product = await Product.findOne({
    _id: productId,
    vendor: req.user._id,
  });
  if (!product) throw new ApiError(404, "Product not found");

  const { InventoryService } = await import("../services/inventory.service.js");
  const result = await InventoryService.adjustStock({
    productId,
    variantId,
    quantityChange: quantity, // Can be negative for removal
    type: "adjustment",
    referenceType: "Manual",
    note,
    createdBy: req.user._id,
  });

  res.json(new ApiResponse(200, result, "Stock adjusted"));
});
