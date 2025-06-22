const express = require('express');
const router = express.Router();
const { Category } = require('../models');
const { authMiddleware, authorize } = require('../middlewares/auth');
const { validateCategory } = require('../middleware/validation');
const { catchAsync, AppError } = require('../middleware/errorHandler');

// @desc    Create new category
// @route   POST /api/v1/categories
// @access  Private (Admin/Manager)
const createCategory = catchAsync(async (req, res, next) => {
  const categoryData = {
    ...req.body,
    createdBy: req.user.id
  };

  // If parentCategory is provided, validate it exists
  if (categoryData.parentCategory) {
    const parentExists = await Category.findById(categoryData.parentCategory);
    if (!parentExists) {
      return next(new AppError('Parent category not found', 404));
    }
  }

  const category = await Category.create(categoryData);

  // If this category has a parent, add it to parent's subcategories
  if (category.parentCategory) {
    await Category.findByIdAndUpdate(
      category.parentCategory,
      { $addToSet: { subcategories: category._id } }
    );
  }

  const populatedCategory = await Category.findById(category._id)
    .populate('parentCategory', 'name slug')
    .populate('createdBy', 'firstName lastName');

  res.status(201).json({
    success: true,
    message: 'Category created successfully',
    data: populatedCategory
  });
});

// @desc    Get all categories
// @route   GET /api/v1/categories
// @access  Public
const getCategories = catchAsync(async (req, res) => {
  const { 
    page = 1, 
    limit = 50, 
    search, 
    parentCategory, 
    isActive,
    tree = false 
  } = req.query;

  if (tree === 'true') {
    // Return hierarchical tree structure
    const categoryTree = await Category.getCategoryTree();
    return res.status(200).json({
      success: true,
      message: 'Category tree retrieved successfully',
      data: categoryTree
    });
  }

  const query = {};
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }
  
  if (parentCategory) {
    query.parentCategory = parentCategory === 'null' ? null : parentCategory;
  }
  
  if (isActive !== undefined) {
    query.isActive = isActive === 'true';
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [categories, total] = await Promise.all([
    Category.find(query)
      .populate('parentCategory', 'name slug')
      .populate('createdBy', 'firstName lastName')
      .populate('itemCount')
      .sort({ sortOrder: 1, name: 1 })
      .skip(skip)
      .limit(limitNum),
    Category.countDocuments(query)
  ]);

  const pagination = {
    currentPage: pageNum,
    totalPages: Math.ceil(total / limitNum),
    totalItems: total,
    itemsPerPage: limitNum
  };

  res.status(200).json({
    success: true,
    message: 'Categories retrieved successfully',
    data: categories,
    pagination
  });
});

// @desc    Get single category
// @route   GET /api/v1/categories/:id
// @access  Public
const getCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id)
    .populate('parentCategory', 'name slug')
    .populate('subcategories', 'name slug isActive')
    .populate('createdBy', 'firstName lastName')
    .populate('itemCount');

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  // Get full path
  const fullPath = await category.getFullPath();

  res.status(200).json({
    success: true,
    data: {
      ...category.toObject(),
      fullPath: fullPath.map(cat => ({ id: cat._id, name: cat.name, slug: cat.slug }))
    }
  });
});

// @desc    Get category by slug
// @route   GET /api/v1/categories/slug/:slug
// @access  Public
const getCategoryBySlug = catchAsync(async (req, res, next) => {
  const category = await Category.findBySlug(req.params.slug)
    .populate('parentCategory', 'name slug')
    .populate('subcategories', 'name slug isActive')
    .populate('itemCount');

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  res.status(200).json({
    success: true,
    data: category
  });
});

// @desc    Update category
// @route   PUT /api/v1/categories/:id
// @access  Private (Admin/Manager)
const updateCategory = catchAsync(async (req, res, next) => {
  const updateData = {
    ...req.body,
    lastUpdatedBy: req.user.id
  };

  // Prevent circular references
  if (updateData.parentCategory === req.params.id) {
    return next(new AppError('Category cannot be its own parent', 400));
  }

  const category = await Category.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  )
  .populate('parentCategory', 'name slug')
  .populate('subcategories', 'name slug')
  .populate('lastUpdatedBy', 'firstName lastName');

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  res.status(200).json({
    success: true,
    message: 'Category updated successfully',
    data: category
  });
});

// @desc    Delete category
// @route   DELETE /api/v1/categories/:id
// @access  Private (Admin only)
const deleteCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  // Check if category has subcategories
  if (category.subcategories && category.subcategories.length > 0) {
    return next(new AppError('Cannot delete category with subcategories. Please move or delete subcategories first.', 400));
  }

  // Check if category has inventory items
  const InventoryItem = require('./InventoryItem');
  const itemCount = await InventoryItem.countDocuments({ category: category._id });
  
  if (itemCount > 0) {
    return next(new AppError(`Cannot delete category with ${itemCount} inventory items. Please reassign items first.`, 400));
  }

  await Category.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: 'Category deleted successfully'
  });
});

// @desc    Reorder categories
// @route   PATCH /api/v1/categories/reorder
// @access  Private (Admin/Manager)
const reorderCategories = catchAsync(async (req, res, next) => {
  const { categoryOrders } = req.body; // Array of { id, sortOrder }

  if (!Array.isArray(categoryOrders)) {
    return next(new AppError('categoryOrders must be an array', 400));
  }

  const updatePromises = categoryOrders.map(({ id, sortOrder }) =>
    Category.findByIdAndUpdate(id, { sortOrder, lastUpdatedBy: req.user.id })
  );

  await Promise.all(updatePromises);

  res.status(200).json({
    success: true,
    message: 'Categories reordered successfully'
  });
});

// Routes
router.route('/')
  .post(authMiddleware, authorize('admin', 'manager', 'superadmin'), validateCategory, createCategory)
  .get(getCategories); // Public access for browsing

router.route('/reorder')
  .patch(authMiddleware, authorize('admin', 'manager', 'superadmin'), reorderCategories);

router.route('/slug/:slug')
  .get(getCategoryBySlug); // Public access

router.route('/:id')
  .get(getCategory) // Public access
  .put(authMiddleware, authorize('admin', 'manager', 'superadmin'), validateCategory, updateCategory)
  .delete(authMiddleware, authorize('admin', 'superadmin'), deleteCategory); // Only admin/superadmin can delete

module.exports = router;
