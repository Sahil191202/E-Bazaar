import { Category }    from '../models/Category.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError }    from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { UploadService } from '../services/upload.service.js';
import { getCache, setCache, delCachePattern } from '../config/redis.js';

// ─── Admin: Create category ───────────────────────────────────────────────────
export const createCategory = asyncHandler(async (req, res) => {
  const { name, description, parentId, sortOrder, metaTitle, metaDescription } = req.body;

  let ancestors = [];
  let level     = 0;
  let parent    = null;

  if (parentId) {
    parent = await Category.findById(parentId);
    if (!parent) throw new ApiError(404, 'Parent category not found');
    if (parent.level >= 2) throw new ApiError(400, 'Maximum 3 levels of categories allowed');
    ancestors = [...parent.ancestors, parent._id];
    level     = parent.level + 1;
  }

  let image = '';
  if (req.file) {
    const uploaded = await UploadService.uploadImage(req.file.path, 'categories');
    image = uploaded.url;
  }

  const category = await Category.create({
    name, description, parent: parentId || null,
    ancestors, level, sortOrder, image,
    metaTitle, metaDescription,
  });

  await delCachePattern('categories:*');

  res.status(201).json(new ApiResponse(201, { category }, 'Category created'));
});

// ─── Get category tree ────────────────────────────────────────────────────────
export const getCategoryTree = asyncHandler(async (req, res) => {
  const cacheKey = 'categories:tree';
  const cached   = await getCache(cacheKey);
  if (cached) return res.json(new ApiResponse(200, cached));

  const categories = await Category.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  // Build tree in memory
  const map  = {};
  const tree = [];

  categories.forEach((c) => { map[c._id] = { ...c, children: [] }; });
  categories.forEach((c) => {
    if (c.parent) {
      map[c.parent]?.children.push(map[c._id]);
    } else {
      tree.push(map[c._id]);
    }
  });

  await setCache(cacheKey, tree, 3600); // Cache for 1 hour
  res.json(new ApiResponse(200, tree));
});

// ─── Get all (flat list, admin) ───────────────────────────────────────────────
export const getAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find()
    .populate('parent', 'name slug')
    .sort({ level: 1, sortOrder: 1 })
    .lean();
  res.json(new ApiResponse(200, categories));
});

// ─── Update category ──────────────────────────────────────────────────────────
export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  );
  if (!category) throw new ApiError(404, 'Category not found');

  await delCachePattern('categories:*');
  res.json(new ApiResponse(200, { category }, 'Category updated'));
});

// ─── Delete category ──────────────────────────────────────────────────────────
export const deleteCategory = asyncHandler(async (req, res) => {
  const hasChildren = await Category.findOne({ parent: req.params.id });
  if (hasChildren) throw new ApiError(400, 'Cannot delete category with sub-categories');

  await Category.findByIdAndDelete(req.params.id);
  await delCachePattern('categories:*');
  res.json(new ApiResponse(200, null, 'Category deleted'));
});