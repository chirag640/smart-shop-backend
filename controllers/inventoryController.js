const InventoryItem = require('../models/InventoryItem');
const { 
  handleImageUpload: handleImageUploadUtil,
  deleteFromCloudinary,
  getDefaultImageUrl
} = require('../utils/imageUtils');
const {
  validateInventoryItem,
  validateStockUpdate,
  buildInventoryQuery,
  buildSortOptions,
  buildPaginationOptions,
  executePaginatedQuery
} = require('../middleware/validation');

// @desc    Create new inventory item
// @route   POST /api/v1/inventory/items
// @access  Private (Admin/Manager)
const createItem = async (req, res) => {
  try {
    const {
      name, description, brand, type, totalUnits, purchasePrice,
      sellPrice, mrpPrice, purchaseDate, stockQty, storeId,
      sku, barcode, minStockLevel, maxStockLevel, category,
      tags, supplier, notes
    } = req.body;

    // Validate required fields
    if (!name || !description || !brand || !type || !totalUnits || 
        !purchasePrice || !sellPrice || !mrpPrice || !purchaseDate || 
        !stockQty || !storeId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Validate price relationships
    if (sellPrice > mrpPrice) {
      return res.status(400).json({
        success: false,
        error: 'Selling price cannot be greater than MRP'
      });
    }

    if (stockQty > totalUnits) {
      return res.status(400).json({
        success: false,
        error: 'Stock quantity cannot be greater than total units'
      });
    }

    // Handle image upload with fallback to default
    const imageData = await handleImageUploadUtil(req.file, type);

    // Create item data
    const itemData = {
      name: name.trim(),
      description: description.trim(),
      brand: brand.trim(),
      type,
      totalUnits: parseInt(totalUnits),
      purchasePrice: parseFloat(purchasePrice),
      sellPrice: parseFloat(sellPrice),
      mrpPrice: parseFloat(mrpPrice),
      purchaseDate: new Date(purchaseDate),
      stockQty: parseInt(stockQty),
      storeId,
      createdBy: req.user.id,
      // Image data
      imageUrl: imageData.imageUrl,
      imagePublicId: imageData.imagePublicId,
      imageVariants: imageData.imageVariants,
      isDefaultImage: imageData.isDefaultImage,
      ...(imageData.imageMetadata && { imageMetadata: imageData.imageMetadata }),
      // Optional fields
      ...(sku && { sku: sku.trim().toUpperCase() }),
      ...(barcode && { barcode: barcode.trim() }),
      ...(minStockLevel && { minStockLevel: parseInt(minStockLevel) }),
      ...(maxStockLevel && { maxStockLevel: parseInt(maxStockLevel) }),
      ...(category && { category }),
      ...(tags && { tags: tags.split(',').map(tag => tag.trim().toLowerCase()) }),
      ...(supplier && { supplier: JSON.parse(supplier) }),
      ...(notes && { notes: notes.trim() })
    };

    const newItem = new InventoryItem(itemData);
    const savedItem = await newItem.save();
    
    // Populate references
    const populatedItem = await InventoryItem.findById(savedItem._id)
      .populate('storeId', 'name location')
      .populate('createdBy', 'firstName lastName email')
      .populate('category', 'name');

    res.status(201).json({
      success: true,
      message: 'Inventory item created successfully',
      data: populatedItem
    });
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create inventory item'
    });
  }
};

// @desc    Get all inventory items with filters
// @route   GET /api/v1/inventory/items
// @access  Private
const getItems = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      brand,
      storeId,
      status,
      category,
      minPrice,
      maxPrice,
      lowStock,
      outOfStock,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      includeDeleted = false
    } = req.query;

    // Build query
    const query = {};
    
    // Base filter - exclude deleted items unless specifically requested
    if (includeDeleted !== 'true') {
      query.isDeleted = false;
    }

    // Store filter (users can only see their store's items unless admin)
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      query.storeId = req.user.storeId || storeId;
    } else if (storeId) {
      query.storeId = storeId;
    }

    // Text search
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { barcode: { $regex: search, $options: 'i' } }
      ];
    }

    // Filters
    if (type) query.type = type;
    if (brand) query.brand = { $regex: brand, $options: 'i' };
    if (status) query.status = status;
    if (category) query.category = category;

    // Price range
    if (minPrice || maxPrice) {
      query.sellPrice = {};
      if (minPrice) query.sellPrice.$gte = parseFloat(minPrice);
      if (maxPrice) query.sellPrice.$lte = parseFloat(maxPrice);
    }

    // Stock filters
    if (lowStock === 'true') {
      query.$expr = { $lte: ['$stockQty', '$minStockLevel'] };
    }
    
    if (outOfStock === 'true') {
      query.stockQty = 0;
    }

    // Sorting
    const sortOptions = {};
    const validSortFields = ['name', 'brand', 'type', 'sellPrice', 'stockQty', 'createdAt', 'updatedAt'];
    
    if (validSortFields.includes(sortBy)) {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sortOptions.createdAt = -1;
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Execute query
    const [items, total] = await Promise.all([
      InventoryItem.find(query)
        .populate('storeId', 'name location')
        .populate('createdBy', 'firstName lastName')
        .populate('category', 'name description')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      InventoryItem.countDocuments(query)
    ]);

    // Add virtual fields manually for lean queries
    const enrichedItems = items.map(item => ({
      ...item,
      profitMargin: item.purchasePrice === 0 ? 0 : 
        ((item.sellPrice - item.purchasePrice) / item.purchasePrice * 100).toFixed(2),
      discountPercentage: item.mrpPrice === 0 ? 0 : 
        ((item.mrpPrice - item.sellPrice) / item.mrpPrice * 100).toFixed(2),
      totalValue: (item.stockQty * item.purchasePrice).toFixed(2),
      isLowStock: item.stockQty <= item.minStockLevel,
      isOutOfStock: item.stockQty === 0,
      needsReorder: item.stockQty <= (item.reorderPoint || item.minStockLevel + 5)
    }));

    // Pagination info
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
      hasNext: pageNum < Math.ceil(total / limitNum),
      hasPrev: pageNum > 1
    };

    // Summary statistics
    const summary = await InventoryItem.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalStockValue: { $sum: { $multiply: ['$stockQty', '$purchasePrice'] } },
          totalPotentialRevenue: { $sum: { $multiply: ['$stockQty', '$sellPrice'] } },
          lowStockItems: {
            $sum: {
              $cond: [{ $lte: ['$stockQty', '$minStockLevel'] }, 1, 0]
            }
          },
          outOfStockItems: {
            $sum: {
              $cond: [{ $eq: ['$stockQty', 0] }, 1, 0]
            }
          }
        }
      }
    ]);

    const meta = {
      pagination,
      summary: summary[0] || {
        totalItems: 0,
        totalStockValue: 0,
        totalPotentialRevenue: 0,
        lowStockItems: 0,
        outOfStockItems: 0
      },
      filters: {
        search, type, brand, storeId, status, category,
        minPrice, maxPrice, lowStock, outOfStock
      }
    };

    res.status(200).json({
      success: true,
      message: 'Items retrieved successfully',
      data: enrichedItems,
      meta
    });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve inventory items'
    });
  }
};

// @desc    Get single inventory item by ID
// @route   GET /api/v1/inventory/items/:id
// @access  Private
const getItemById = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await InventoryItem.findById(id)
      .populate('storeId', 'name location contactInfo')
      .populate('createdBy', 'firstName lastName email role')
      .populate('lastUpdatedBy', 'firstName lastName email')
      .populate('category', 'name description')
      .populate('deletedBy', 'firstName lastName email');

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found'
      });
    }

    // Check if user has access to this item
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      if (item.storeId._id.toString() !== req.user.storeId?.toString()) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this item'
        });
      }
    }

    // Add recent activity/history if needed
    const itemWithHistory = {
      ...item.toObject(),
      recentActivity: {
        lastUpdated: item.updatedAt,
        lastUpdatedBy: item.lastUpdatedBy,
        ...(item.lastSoldDate && { lastSold: item.lastSoldDate }),
        ...(item.lastRestockedDate && { lastRestocked: item.lastRestockedDate })
      }
    };

    res.status(200).json({
      success: true,
      message: 'Item retrieved successfully',
      data: itemWithHistory
    });
  } catch (error) {
    console.error('Get item by ID error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve inventory item'
    });
  }
};

// @desc    Update inventory item
// @route   PUT /api/v1/inventory/items/:id
// @access  Private (Admin/Manager)
const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.createdBy;
    delete updateData.createdAt;
    delete updateData.isDeleted;
    delete updateData.deletedAt;
    delete updateData.deletedBy;

    // Add audit information
    updateData.lastUpdatedBy = req.user.id;

    // Get existing item for image handling
    const existingItem = await InventoryItem.findById(id);
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found'
      });
    }

    // Check access permissions
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      if (existingItem.storeId.toString() !== req.user.storeId?.toString()) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to update this item'
        });
      }
    }

    // Handle image update
    if (req.file || req.body.removeImage === 'true') {
      try {
        if (req.body.removeImage === 'true') {
          // Remove image and set to default
          if (existingItem.imagePublicId && !existingItem.isDefaultImage) {
            await deleteFromCloudinary(existingItem.imagePublicId);
          }
          
          // Set to default image
          updateData.imageUrl = getDefaultImageUrl(existingItem.type);
          updateData.imagePublicId = null;
          updateData.imageVariants = {};
          updateData.isDefaultImage = true;
          updateData.imageMetadata = null;
          
          console.log('🗑️ Image removed, set to default');
        } else if (req.file) {
          // Upload new image
          const imageData = await handleImageUploadUtil(
            req.file, 
            updateData.type || existingItem.type,
            existingItem.imagePublicId
          );
          
          // Update image data
          updateData.imageUrl = imageData.imageUrl;
          updateData.imagePublicId = imageData.imagePublicId;
          updateData.imageVariants = imageData.imageVariants;
          updateData.isDefaultImage = imageData.isDefaultImage;
          if (imageData.imageMetadata) {
            updateData.imageMetadata = imageData.imageMetadata;
          }
          
          console.log(`📷 Image updated successfully`);
        }
      } catch (imageError) {
        console.warn('Image update failed, continuing with other updates:', imageError);
        // Don't fail the entire update if image handling fails
      }
    }

    // Handle other data transformations
    if (updateData.tags && typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags.split(',').map(tag => tag.trim().toLowerCase());
    }

    if (updateData.supplier && typeof updateData.supplier === 'string') {
      try {
        updateData.supplier = JSON.parse(updateData.supplier);
      } catch (e) {
        console.warn('Invalid supplier JSON, skipping supplier update');
        delete updateData.supplier;
      }
    }

    // Type conversions
    if (updateData.totalUnits) updateData.totalUnits = parseInt(updateData.totalUnits);
    if (updateData.stockQty) updateData.stockQty = parseInt(updateData.stockQty);
    if (updateData.purchasePrice) updateData.purchasePrice = parseFloat(updateData.purchasePrice);
    if (updateData.sellPrice) updateData.sellPrice = parseFloat(updateData.sellPrice);
    if (updateData.mrpPrice) updateData.mrpPrice = parseFloat(updateData.mrpPrice);
    if (updateData.minStockLevel) updateData.minStockLevel = parseInt(updateData.minStockLevel);
    if (updateData.maxStockLevel) updateData.maxStockLevel = parseInt(updateData.maxStockLevel);

    // Update the item
    const updatedItem = await InventoryItem.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true, 
        runValidators: true,
        context: 'query'
      }
    )
    .populate('storeId', 'name location')
    .populate('createdBy', 'firstName lastName email')
    .populate('lastUpdatedBy', 'firstName lastName email')
    .populate('category', 'name');

    res.status(200).json({
      success: true,
      message: 'Item updated successfully',
      data: updatedItem
    });
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update inventory item'
    });
  }
};

// @desc    Soft delete inventory item
// @route   DELETE /api/v1/inventory/items/:id
// @access  Private (Admin/Manager)
const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent = false } = req.query;

    const item = await InventoryItem.findById(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found'
      });
    }

    // Check access permissions
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      if (item.storeId.toString() !== req.user.storeId?.toString()) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to delete this item'
        });
      }
    }

    if (permanent === 'true' && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
      // Permanent deletion (admin only)
      
      // Delete image from Cloudinary if it's not a default image
      if (item.imagePublicId && !item.isDefaultImage) {
        try {
          const deleteResult = await deleteFromCloudinary(item.imagePublicId);
          if (deleteResult.success) {
            console.log('🗑️ Image deleted from Cloudinary during permanent delete');
          } else {
            console.warn('Failed to delete image from Cloudinary:', deleteResult.message);
          }
        } catch (cloudinaryError) {
          console.warn('Cloudinary deletion error during permanent delete:', cloudinaryError);
        }
      }

      await InventoryItem.findByIdAndDelete(id);
      
      res.status(200).json({
        success: true,
        message: 'Item permanently deleted'
      });
    } else {
      // Soft delete
      const deletedItem = await item.softDelete(req.user.id);
      
      res.status(200).json({
        success: true,
        message: 'Item moved to trash',
        data: {
          id: deletedItem._id,
          name: deletedItem.name,
          deletedAt: deletedItem.deletedAt
        }
      });
    }
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete inventory item'
    });
  }
};

// @desc    Restore soft deleted item
// @route   POST /api/v1/inventory/items/:id/restore
// @access  Private (Admin/Manager)
const restoreItem = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await InventoryItem.findById(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found'
      });
    }

    if (!item.isDeleted) {
      return res.status(400).json({
        success: false,
        error: 'Item is not deleted'
      });
    }

    const restoredItem = await item.restore();
    
    res.status(200).json({
      success: true,
      message: 'Item restored successfully',
      data: {
        id: restoredItem._id,
        name: restoredItem.name,
        restoredAt: restoredItem.updatedAt
      }
    });
  } catch (error) {
    console.error('Restore item error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to restore inventory item'
    });
  }
};

// @desc    Update stock quantity
// @route   PATCH /api/v1/inventory/items/:id/stock
// @access  Private (Admin/Manager)
const updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, operation = 'set', reason } = req.body;

    if (!quantity || quantity < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid quantity is required'
      });
    }

    const item = await InventoryItem.findById(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found'
      });
    }

    const updatedItem = await item.updateStock(parseInt(quantity), operation);
    
    // Log stock movement (you can extend this to create a StockMovement model)
    console.log(`Stock updated for ${item.name}: ${operation} ${quantity}. New stock: ${updatedItem.stockQty}. Reason: ${reason || 'Manual update'}`);

    res.status(200).json({
      success: true,
      message: 'Stock updated successfully',
      data: {
        id: updatedItem._id,
        name: updatedItem.name,
        previousStock: operation === 'set' ? null : 
          (operation === 'add' ? updatedItem.stockQty - quantity : updatedItem.stockQty + quantity),
        newStock: updatedItem.stockQty,
        operation,
        quantity: parseInt(quantity)
      }
    });
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update stock'
    });
  }
};

// Export middleware and controllers
module.exports = {
  createItem,
  getItems,
  getItemById,
  updateItem,
  deleteItem,
  restoreItem,
  updateStock
};
