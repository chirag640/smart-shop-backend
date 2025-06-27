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
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { logAudit } = require('../utils/auditLogService');

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

    // Additional business rule validations beyond express-validator
    // Check if user has access to the specified store
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      if (!req.user.storeId || req.user.storeId.toString() !== storeId?.toString()) {
        return res.status(403).json({
          success: false,
          error: 'You can only create items for your assigned store'
        });
      }
    }

    // Validate store exists (can be enhanced with Store model check)
    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: 'Store ID is required'
      });
    }

    // Sanitize and validate numeric inputs
    const sanitizedData = {
      totalUnits: Math.max(0, parseInt(totalUnits) || 0),
      stockQty: Math.max(0, parseInt(stockQty) || 0),
      purchasePrice: Math.max(0, parseFloat(purchasePrice) || 0),
      sellPrice: Math.max(0, parseFloat(sellPrice) || 0),
      mrpPrice: Math.max(0, parseFloat(mrpPrice) || 0),
      minStockLevel: minStockLevel ? Math.max(0, parseInt(minStockLevel)) : undefined,
      maxStockLevel: maxStockLevel ? Math.max(0, parseInt(maxStockLevel)) : undefined
    };

    // Additional business validations
    if (sanitizedData.stockQty > sanitizedData.totalUnits) {
      return res.status(400).json({
        success: false,
        error: 'Stock quantity cannot exceed total units'
      });
    }

    if (sanitizedData.sellPrice > sanitizedData.mrpPrice) {
      return res.status(400).json({
        success: false,
        error: 'Selling price cannot be greater than MRP'
      });
    }

    if (sanitizedData.minStockLevel && sanitizedData.maxStockLevel && 
        sanitizedData.minStockLevel > sanitizedData.maxStockLevel) {
      return res.status(400).json({
        success: false,
        error: 'Minimum stock level cannot be greater than maximum stock level'
      });
    }

    // Handle image upload with fallback to default
    const imageData = await handleImageUploadUtil(req.file, type);

    // Create item data with sanitized inputs
    const itemData = {
      name: name.trim(),
      description: description.trim(),
      brand: brand.trim(),
      type,
      totalUnits: sanitizedData.totalUnits,
      purchasePrice: sanitizedData.purchasePrice,
      sellPrice: sanitizedData.sellPrice,
      mrpPrice: sanitizedData.mrpPrice,
      purchaseDate: new Date(purchaseDate),
      stockQty: sanitizedData.stockQty,
      storeId,
      createdBy: req.user.id,
      // Image data
      imageUrl: imageData.imageUrl,
      imagePublicId: imageData.imagePublicId,
      imageVariants: imageData.imageVariants,
      isDefaultImage: imageData.isDefaultImage,
      ...(imageData.imageMetadata && { imageMetadata: imageData.imageMetadata }),
      // Optional fields with sanitization
      ...(sku && { sku: sku.trim().toUpperCase() }),
      ...(barcode && { barcode: barcode.trim() }),
      ...(sanitizedData.minStockLevel && { minStockLevel: sanitizedData.minStockLevel }),
      ...(sanitizedData.maxStockLevel && { maxStockLevel: sanitizedData.maxStockLevel }),
      ...(category && { category }),
      ...(tags && { 
        tags: tags.split(',')
          .map(tag => tag.trim().toLowerCase())
          .filter(tag => tag.length > 0)
          .slice(0, 10) // Limit to 10 tags
      }),
      ...(supplier && { 
        supplier: typeof supplier === 'string' ? JSON.parse(supplier) : supplier 
      }),
      ...(notes && { notes: notes.trim().substring(0, 500) }) // Limit notes length
    };

    const newItem = new InventoryItem(itemData);
    const savedItem = await newItem.save();
    
    // Populate references
    const populatedItem = await InventoryItem.findById(savedItem._id)
      .populate('storeId', 'name location')
      .populate('createdBy', 'firstName lastName email')
      .populate('category', 'name');

    // Log inventory item creation
    await logAudit({
      userId: req.user.id,
      action: 'create',
      targetType: 'inventory',
      targetId: newItem._id,
      details: { createdBy: req.user.id, item: newItem }
    });

    res.status(201).json({
      success: true,
      message: 'Inventory item created successfully',
      data: populatedItem
    });
  } catch (error) {
    console.error('Create item error:', error);
    
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors
      });
    }
    
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
  try {    const {
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
      availableOnly,
      newArrivals,
      description,
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
    }    // Text search
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

    // Description partial text match
    if (description) {
      query.description = { $regex: description, $options: 'i' };
    }

    // Available items only (stockQty > 0)
    if (availableOnly === 'true') {
      query.stockQty = { $gt: 0 };
    }

    // New arrivals filter (last 7 days by purchaseDate)
    if (newArrivals === 'true') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      query.purchaseDate = { $gte: sevenDaysAgo };
    }

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
    }    // Sorting
    const sortOptions = {};
    const validSortFields = ['name', 'brand', 'type', 'sellPrice', 'mrpPrice', 'purchasePrice', 'purchaseDate', 'stockQty', 'createdAt', 'updatedAt'];
    
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
      },      filters: {
        search, type, brand, storeId, status, category,
        minPrice, maxPrice, lowStock, outOfStock,
        availableOnly, newArrivals, description
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
    }    // Handle other data transformations with enhanced validation
    if (updateData.tags && typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags.split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0 && tag.length <= 50)
        .slice(0, 10); // Limit to 10 tags
    }

    if (updateData.supplier && typeof updateData.supplier === 'string') {
      try {
        updateData.supplier = JSON.parse(updateData.supplier);
      } catch (e) {
        console.warn('Invalid supplier JSON, skipping supplier update');
        delete updateData.supplier;
      }
    }

    // Enhanced type conversions with validation
    if (updateData.totalUnits) {
      updateData.totalUnits = Math.max(0, parseInt(updateData.totalUnits) || 0);
    }
    if (updateData.stockQty) {
      updateData.stockQty = Math.max(0, parseInt(updateData.stockQty) || 0);
    }
    if (updateData.purchasePrice) {
      updateData.purchasePrice = Math.max(0, parseFloat(updateData.purchasePrice) || 0);
    }
    if (updateData.sellPrice) {
      updateData.sellPrice = Math.max(0, parseFloat(updateData.sellPrice) || 0);
    }
    if (updateData.mrpPrice) {
      updateData.mrpPrice = Math.max(0, parseFloat(updateData.mrpPrice) || 0);
    }
    if (updateData.minStockLevel) {
      updateData.minStockLevel = Math.max(0, parseInt(updateData.minStockLevel) || 0);
    }
    if (updateData.maxStockLevel) {
      updateData.maxStockLevel = Math.max(0, parseInt(updateData.maxStockLevel) || 0);
    }

    // Business rule validations
    if (updateData.stockQty && updateData.totalUnits && updateData.stockQty > updateData.totalUnits) {
      return res.status(400).json({
        success: false,
        error: 'Stock quantity cannot exceed total units'
      });
    }

    if (updateData.sellPrice && updateData.mrpPrice && updateData.sellPrice > updateData.mrpPrice) {
      return res.status(400).json({
        success: false,
        error: 'Selling price cannot be greater than MRP'
      });
    }

    if (updateData.minStockLevel && updateData.maxStockLevel && 
        updateData.minStockLevel > updateData.maxStockLevel) {
      return res.status(400).json({
        success: false,
        error: 'Minimum stock level cannot be greater than maximum stock level'
      });
    }

    // Sanitize text fields
    if (updateData.name) updateData.name = updateData.name.trim();
    if (updateData.description) updateData.description = updateData.description.trim();
    if (updateData.brand) updateData.brand = updateData.brand.trim();
    if (updateData.sku) updateData.sku = updateData.sku.trim().toUpperCase();
    if (updateData.barcode) updateData.barcode = updateData.barcode.trim();
    if (updateData.notes) updateData.notes = updateData.notes.trim().substring(0, 500);

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
    .populate('category', 'name');    res.status(200).json({
      success: true,
      message: 'Item updated successfully',
      data: updatedItem
    });
  } catch (error) {
    console.error('Update item error:', error);
    
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors
      });
    }
    
    // Handle cast errors (invalid ObjectId, etc.)
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: `Invalid ${error.path}: ${error.value}`
      });
    }
    
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
// @access  Private (Admin/Manager/Staff)
const updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, operation = 'set', reason } = req.body;

    // Enhanced input validation
    const sanitizedQuantity = parseInt(quantity);
    if (!quantity || sanitizedQuantity < 0 || isNaN(sanitizedQuantity)) {
      return res.status(400).json({
        success: false,
        error: 'Valid non-negative quantity is required'
      });
    }

    if (!['set', 'add', 'subtract'].includes(operation)) {
      return res.status(400).json({
        success: false,
        error: 'Operation must be one of: set, add, subtract'
      });
    }

    const item = await InventoryItem.findById(id)
      .populate('storeId', 'name location');

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Inventory item not found'
      });
    }

    // Check access permissions for store-specific operations
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      if (item.storeId._id.toString() !== req.user.storeId?.toString()) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to update stock for this item'
        });
      }
    }

    // Validate the operation won't result in negative stock
    let newStockQty;
    switch (operation) {
      case 'set':
        newStockQty = sanitizedQuantity;
        break;
      case 'add':
        newStockQty = item.stockQty + sanitizedQuantity;
        break;
      case 'subtract':
        newStockQty = item.stockQty - sanitizedQuantity;
        if (newStockQty < 0) {
          return res.status(400).json({
            success: false,
            error: `Cannot subtract ${sanitizedQuantity} from current stock of ${item.stockQty}. Result would be negative.`
          });
        }
        break;
    }

    // Validate against total units if applicable
    if (newStockQty > item.totalUnits) {
      return res.status(400).json({
        success: false,
        error: `Stock quantity cannot exceed total units (${item.totalUnits})`
      });
    }

    const updatedItem = await item.updateStock(sanitizedQuantity, operation);
    
    // Log stock movement with enhanced details
    const stockMovementLog = {
      itemId: item._id,
      itemName: item.name,
      storeId: item.storeId._id,
      storeName: item.storeId.name,
      operation,
      quantity: sanitizedQuantity,
      previousStock: item.stockQty,
      newStock: updatedItem.stockQty,
      reason: reason || 'Manual stock update',
      updatedBy: req.user.id,
      timestamp: new Date()
    };
    
    console.log('📦 Stock Movement:', stockMovementLog);

    res.status(200).json({
      success: true,
      message: 'Stock updated successfully',
      data: {
        id: updatedItem._id,
        name: updatedItem.name,
        previousStock: item.stockQty,
        newStock: updatedItem.stockQty,
        operation,
        quantity: sanitizedQuantity,
        reason: reason || 'Manual update',
        stockMovement: stockMovementLog
      }
    });
  } catch (error) {
    console.error('Update stock error:', error);
    
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Stock update validation failed',
        details: validationErrors
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update stock'
    });  }
};

// @desc    Get selectable items for billing
// @route   GET /api/v1/inventory/selectable
// @access  Private (Staff and above)
const getSelectableItems = async (req, res) => {
  try {
    const {
      search,
      sort = 'name',
      limit = 50,
      page = 1,
      storeId
    } = req.query;

    // Build base query for selectable items
    const query = {
      isDeleted: false,
      isActive: true,
      stockQty: { $gt: 0 }, // Only items with stock > 0
      status: { $ne: 'discontinued' }
    };

    // Store access control
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      // Non-admin users can only see items from their store
      query.storeId = req.user.storeId;
    } else if (storeId) {
      // Admins can filter by specific store
      query.storeId = storeId;
    }

    // Add search functionality
    if (search && search.trim()) {
      const searchTerm = search.trim();
      query.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { brand: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { sku: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    // Build sort options
    let sortOptions = {};
    switch (sort) {
      case 'mostSold':
        sortOptions = { orderCount: -1, totalSold: -1 };
        break;
      case 'name':
        sortOptions = { name: 1 };
        break;
      case 'stockQty':
        sortOptions = { stockQty: -1 };
        break;
      case 'price':
        sortOptions = { sellPrice: 1 };
        break;
      case 'newest':
        sortOptions = { createdAt: -1 };
        break;
      default:
        sortOptions = { name: 1 };
    }

    // Pagination
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (Math.max(1, parseInt(page)) - 1) * limitNum;

    // Execute query with selected fields
    const items = await InventoryItem.find(query)
      .select('name brand sellPrice mrpPrice stockQty imageUrl orderCount totalSold type status sku')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const totalItems = await InventoryItem.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limitNum);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Enhance items with computed fields
    const enrichedItems = items.map(item => ({
      _id: item._id,
      name: item.name,
      brand: item.brand,
      sellPrice: item.sellPrice,
      mrpPrice: item.mrpPrice,
      stockQty: item.stockQty,
      imageUrl: item.imageUrl || getDefaultImageUrl(item.type),
      orderCount: item.orderCount || 0,
      totalSold: item.totalSold || 0,
      type: item.type,
      status: item.status,
      sku: item.sku,
      // Add computed fields
      discount: item.mrpPrice > item.sellPrice ? 
        Math.round(((item.mrpPrice - item.sellPrice) / item.mrpPrice) * 100) : 0,
      inStock: item.stockQty > 0,
      lowStock: item.stockQty <= (item.minStockLevel || 10)
    }));

    res.status(200).json({
      success: true,
      message: 'Selectable items retrieved successfully',
      data: {
        items: enrichedItems,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems,
          itemsPerPage: limitNum,
          hasNextPage,
          hasPrevPage
        },
        filters: {
          search: search || '',
          sort,
          storeId: query.storeId
        }
      }
    });

  } catch (error) {
    console.error('Error fetching selectable items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch selectable items',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });  }
};

// @desc    Get item metadata for billing
// @route   GET /api/v1/inventory/:id/metadata
// @access  Private (Staff and above)
const getItemMetadata = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid item ID format'
      });
    }

    // Store access control
    const query = {
      _id: id,
      isDeleted: false,
      isActive: true
    };

    // Non-admin users can only access items from their store
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      query.storeId = req.user.storeId;
    }

    // Find the item with minimal fields needed for billing
    const item = await InventoryItem.findOne(query)
      .select('name brand sellPrice mrpPrice stockQty imageUrl orderCount totalSold type status sku barcode minStockLevel')
      .lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found or you do not have access to this item'
      });
    }

    // Enhance with computed fields for billing UI
    const enrichedItem = {
      _id: item._id,
      name: item.name,
      brand: item.brand,
      sellPrice: item.sellPrice,
      mrpPrice: item.mrpPrice,
      stockQty: item.stockQty,
      imageUrl: item.imageUrl || getDefaultImageUrl(item.type),
      orderCount: item.orderCount || 0,
      totalSold: item.totalSold || 0,
      type: item.type,
      status: item.status,
      sku: item.sku,
      barcode: item.barcode,
      // Computed fields for billing UI
      discount: item.mrpPrice > item.sellPrice ? 
        Math.round(((item.mrpPrice - item.sellPrice) / item.mrpPrice) * 100) : 0,
      inStock: item.stockQty > 0,
      lowStock: item.stockQty <= (item.minStockLevel || 10),
      outOfStock: item.stockQty === 0,
      displayText: `${item.name} - ${item.brand}`,
      priceDisplay: `₹${item.sellPrice}`,
      stockDisplay: `${item.stockQty} units`,
      isAvailable: item.stockQty > 0 && item.status !== 'discontinued'
    };

    res.status(200).json({
      success: true,
      message: 'Item metadata retrieved successfully',
      data: enrichedItem
    });

  } catch (error) {
    console.error('Error fetching item metadata:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch item metadata',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Export inventory items as CSV, XLSX, or PDF
 * @route GET /inventory/export?format=csv|xlsx|pdf
 * @access Admin/Owner only
 */
const exportInventory = async (req, res) => {
  const { format = 'csv' } = req.query;
  const items = await InventoryItem.find({}).lean();
  if (!items || items.length === 0) {
    return res.status(404).json({ success: false, message: 'No inventory items found' });
  }
  // Prepare data
  const exportFields = ['name', 'brand', 'sku', 'barcode', 'stockQty', 'minStockLevel', 'maxStockLevel', 'sellPrice', 'mrpPrice', 'purchasePrice', 'category', 'status', 'createdAt'];
  const data = items.map(i => ({
    name: i.name,
    brand: i.brand,
    sku: i.sku,
    barcode: i.barcode,
    stockQty: i.stockQty,
    minStockLevel: i.minStockLevel,
    maxStockLevel: i.maxStockLevel,
    sellPrice: i.sellPrice,
    mrpPrice: i.mrpPrice,
    purchasePrice: i.purchasePrice,
    category: (i.category && i.category.name) || i.category || '',
    status: i.status || '',
    createdAt: i.createdAt
  }));

  if (format === 'csv') {
    const parser = new Parser({ fields: exportFields });
    const csv = parser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment('inventory.csv');
    return res.send(csv);
  } else if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');
    worksheet.columns = exportFields.map(f => ({ header: f, key: f }));
    worksheet.addRows(data);
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment('inventory.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } else if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.header('Content-Type', 'application/pdf');
    res.attachment('inventory.pdf');
    doc.pipe(res);
    doc.fontSize(18).text('Inventory List', { align: 'center' });
    doc.moveDown();
    data.forEach((row, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${row.name} | ${row.brand} | ${row.sku} | ${row.stockQty} | ₹${row.sellPrice} | ${row.status}`);
    });
    doc.end();
  } else {
    return res.status(400).json({ success: false, message: 'Invalid format. Use csv, xlsx, or pdf.' });
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
  updateStock,
  getSelectableItems,
  getItemMetadata,
  exportInventory
};
