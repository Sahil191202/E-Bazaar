import { Category } from "../models/Category.js";
import { CategoryField } from "../models/CategoryField.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { delCachePattern } from "../config/redis.js";

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE a custom field for a category  (Admin)
// ─────────────────────────────────────────────────────────────────────────────

export const createCategoryField = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;

  // Verify category exists
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError(404, "Category not found");

  const {
    label,
    description,
    placeholder,
    fieldType,
    options,
    isRequired,
    isFilterable,
    isSearchable,
    minValue,
    maxValue,
    unit,
    minLength,
    maxLength,
    sortOrder,
  } = req.body;

  const selectableTypes = ["dropdown", "radio", "checkbox"];
  if (selectableTypes.includes(fieldType)) {
    if (!options || options.length < 2) {
      throw new ApiError(
        400,
        "dropdown, radio, and checkbox fields require at least 2 options",
      );
    }
  }

  // Build the document
  const fieldDoc = {
    category: categoryId,
    label,
    description: description || "",
    placeholder: placeholder || "",
    fieldType,
    options: options || [],
    isRequired: isRequired ?? false,
    isFilterable: isFilterable ?? false,
    isSearchable: isSearchable ?? false,
    sortOrder: sortOrder ?? 0,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  };

  // Attach numeric constraints only for number fields
  if (fieldType === "number") {
    if (minValue !== undefined) fieldDoc.minValue = minValue;
    if (maxValue !== undefined) fieldDoc.maxValue = maxValue;
    if (unit) fieldDoc.unit = unit;
  }

  // Attach length constraints only for text/textarea fields
  if (["text", "textarea"].includes(fieldType)) {
    if (minLength !== undefined) fieldDoc.minLength = minLength;
    if (maxLength !== undefined) fieldDoc.maxLength = maxLength;
  }

  let field;
  try {
    field = await CategoryField.create(fieldDoc);
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate key → same label/key for this category
      throw new ApiError(
        409,
        `A field with the same key already exists in this category`,
      );
    }
    throw err;
  }

  // Bust cache so listing pages re-fetch field schemas
  await delCachePattern(`category:fields:${categoryId}`);

  res.status(201).json(new ApiResponse(201, { field }, "Custom field created"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET all fields for a category  (Public — needed by listing create forms)
// ─────────────────────────────────────────────────────────────────────────────

export const getCategoryFields = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { includeInactive = "false" } = req.query;

  const category = await Category.findById(categoryId).lean();
  if (!category) throw new ApiError(404, "Category not found");

  // Build category ID list: own + all ancestors (to support field inheritance)
  const categoryIds = [...category.ancestors.map(String), String(categoryId)];

  const filter = { category: { $in: categoryIds } };
  if (includeInactive !== "true") filter.isActive = true;

  const fields = await CategoryField.find(filter)
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  // Group by which category they belong to (useful for UI rendering)
  const grouped = {};
  for (const f of fields) {
    const key = String(f.category);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(f);
  }

  res.json(new ApiResponse(200, { fields, grouped, total: fields.length }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET a single field  (Admin)
// ─────────────────────────────────────────────────────────────────────────────

export const getCategoryFieldById = asyncHandler(async (req, res) => {
  const field = await CategoryField.findById(req.params.fieldId)
    .populate("category", "name slug")
    .lean();
  if (!field) throw new ApiError(404, "Field not found");
  res.json(new ApiResponse(200, { field }));
});

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE a field  (Admin)
// ─────────────────────────────────────────────────────────────────────────────

export const updateCategoryField = asyncHandler(async (req, res) => {
  const field = await CategoryField.findOne({
    _id: req.params.fieldId,
    category: req.params.categoryId,
  });

  if (!field) throw new ApiError(404, "Field not found");

  const allowedUpdates = [
    "label",
    "description",
    "placeholder",
    "options",
    "isRequired",
    "isFilterable",
    "isSearchable",
    "isActive",
    "minValue",
    "maxValue",
    "unit",
    "minLength",
    "maxLength",
    "sortOrder",
  ];

  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) {
      field[key] = req.body[key];
    }
  }

  // Note: fieldType is intentionally NOT updatable after creation.
  // Changing type would invalidate existing listing data.
  // Admin must delete + recreate if the type needs to change.

  field.updatedBy = req.user._id;

  await field.save();

  await delCachePattern(`category:fields:${req.params.categoryId}`);

  res.json(new ApiResponse(200, { field }, "Field updated"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  REORDER fields in bulk  (Admin)
// ─────────────────────────────────────────────────────────────────────────────

export const reorderCategoryFields = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { fields } = req.body; // [{ id, sortOrder }, ...]

  // Bulk write for efficiency
  const ops = fields.map(({ id, sortOrder }) => ({
    updateOne: {
      filter: { _id: id, category: categoryId },
      update: { $set: { sortOrder, updatedBy: req.user._id } },
    },
  }));

  await CategoryField.bulkWrite(ops);

  await delCachePattern(`category:fields:${categoryId}`);

  res.json(new ApiResponse(200, null, "Fields reordered"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE a field  (Admin — soft delete by default, hard delete optional)
// ─────────────────────────────────────────────────────────────────────────────

export const deleteCategoryField = asyncHandler(async (req, res) => {
  const { categoryId, fieldId } = req.params;
  const { hard = "false" } = req.query;

  const field = await CategoryField.findOne({
    _id: fieldId,
    category: categoryId,
  });
  if (!field) throw new ApiError(404, "Field not found");

  if (hard === "true") {
    // ⚠️  Hard delete — existing listing data for this key becomes orphaned.
    // Only allowed if admin explicitly requests it.
    await field.deleteOne();
    await delCachePattern(`category:fields:${categoryId}`);
    return res.json(new ApiResponse(200, null, "Field permanently deleted"));
  }

  // Default: soft delete (isActive = false) — preserves historical listing data
  field.isActive = false;
  field.updatedBy = req.user._id;
  await field.save();

  await delCachePattern(`category:fields:${categoryId}`);
  res.json(
    new ApiResponse(
      200,
      null,
      "Field deactivated (listings keep existing data)",
    ),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADD an option to an existing dropdown / radio / checkbox field  (Admin)
// ─────────────────────────────────────────────────────────────────────────────

export const addFieldOption = asyncHandler(async (req, res) => {
  const { categoryId, fieldId } = req.params;
  const { label, value } = req.body;

  if (!label || !value)
    throw new ApiError(400, "Option label and value are required");

  const field = await CategoryField.findOne({
    _id: fieldId,
    category: categoryId,
  });
  if (!field) throw new ApiError(404, "Field not found");

  const selectableTypes = ["dropdown", "radio", "checkbox"];
  if (!selectableTypes.includes(field.fieldType)) {
    throw new ApiError(
      400,
      `Cannot add options to a "${field.fieldType}" field`,
    );
  }

  // Check for duplicate value
  const duplicate = field.options.find((o) => o.value === value.trim());
  if (duplicate)
    throw new ApiError(409, `Option with value "${value}" already exists`);

  field.options.push({ label: label.trim(), value: value.trim() });
  field.updatedBy = req.user._id;
  await field.save();

  await delCachePattern(`category:fields:${categoryId}`);

  res
    .status(201)
    .json(new ApiResponse(201, { options: field.options }, "Option added"));
});

// ─────────────────────────────────────────────────────────────────────────────
//  REMOVE an option from a field  (Admin)
// ─────────────────────────────────────────────────────────────────────────────

export const removeFieldOption = asyncHandler(async (req, res) => {
  const { categoryId, fieldId, optionId } = req.params;

  const field = await CategoryField.findOne({
    _id: fieldId,
    category: categoryId,
  });
  if (!field) throw new ApiError(404, "Field not found");

  const option = field.options.id(optionId);
  if (!option) throw new ApiError(404, "Option not found");

  const selectableTypes = ["dropdown", "radio", "checkbox"];
  if (selectableTypes.includes(field.fieldType) && field.options.length <= 2) {
    throw new ApiError(
      400,
      "Cannot remove option — field must have at least 2 options",
    );
  }

  field.options.pull(optionId);
  field.updatedBy = req.user._id;
  await field.save();

  await delCachePattern(`category:fields:${categoryId}`);

  res.json(new ApiResponse(200, { options: field.options }, "Option removed"));
});
