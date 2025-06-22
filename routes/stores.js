const express = require('express');
const router = express.Router();
const { Store } = require('../models');
const { authMiddleware, authorize } = require('../middlewares/auth');
const { validateStore } = require('../middleware/validation');
const { catchAsync, AppError } = require('../middleware/errorHandler');

// @desc    Create new store
// @route   POST /api/v1/stores
// @access  Private (Admin only)
const createStore = catchAsync(async (req, res, next) => {
  const storeData = {
    ...req.body,
    createdBy: req.user.id
  };

  const store = await Store.create(storeData);

  res.status(201).json({
    success: true,
    message: 'Store created successfully',
    data: store
  });
});

// @desc    Get all stores
// @route   GET /api/v1/stores
// @access  Private
const getStores = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, city, storeType, isActive } = req.query;

  const query = {};
  
  if (city) query['location.city'] = new RegExp(city, 'i');
  if (storeType) query.storeType = storeType;
  if (isActive !== undefined) query.isActive = isActive === 'true';

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [stores, total] = await Promise.all([
    Store.find(query)
      .populate('manager', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Store.countDocuments(query)
  ]);

  const pagination = {
    currentPage: pageNum,
    totalPages: Math.ceil(total / limitNum),
    totalItems: total,
    itemsPerPage: limitNum
  };

  res.status(200).json({
    success: true,
    message: 'Stores retrieved successfully',
    data: stores,
    pagination
  });
});

// @desc    Get single store
// @route   GET /api/v1/stores/:id
// @access  Private
const getStore = catchAsync(async (req, res, next) => {
  const store = await Store.findById(req.params.id)
    .populate('manager', 'firstName lastName email phoneNumber')
    .populate('staff', 'firstName lastName email role')
    .populate('createdBy', 'firstName lastName')
    .populate('lastUpdatedBy', 'firstName lastName');

  if (!store) {
    return next(new AppError('Store not found', 404));
  }

  res.status(200).json({
    success: true,
    data: store
  });
});

// @desc    Update store
// @route   PUT /api/v1/stores/:id
// @access  Private (Admin/Manager)
const updateStore = catchAsync(async (req, res, next) => {
  const updateData = {
    ...req.body,
    lastUpdatedBy: req.user.id
  };

  const store = await Store.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  )
  .populate('manager', 'firstName lastName email')
  .populate('lastUpdatedBy', 'firstName lastName');

  if (!store) {
    return next(new AppError('Store not found', 404));
  }

  res.status(200).json({
    success: true,
    message: 'Store updated successfully',
    data: store
  });
});

// @desc    Delete store
// @route   DELETE /api/v1/stores/:id
// @access  Private (Admin only)
const deleteStore = catchAsync(async (req, res, next) => {
  const store = await Store.findById(req.params.id);

  if (!store) {
    return next(new AppError('Store not found', 404));
  }

  await Store.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: 'Store deleted successfully'
  });
});

// Routes
router.route('/')
  .post(authMiddleware, authorize('admin', 'superadmin'), validateStore, createStore)
  .get(authMiddleware, getStores);

router.route('/:id')
  .get(authMiddleware, getStore)
  .put(authMiddleware, authorize('admin', 'superadmin'), validateStore, updateStore)
  .delete(authMiddleware, authorize('admin', 'superadmin'), deleteStore);

module.exports = router;
