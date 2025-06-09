const { body, validationResult, query } = require('express-validator');

// Helper function to handle validation results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Inventory item validation rules
const validateInventoryItem = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Name must be between 2 and 200 characters')
    .matches(/^[a-zA-Z0-9\s\-_.,&()]+$/)
    .withMessage('Name contains invalid characters'),
    
  body('description')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Description must be between 10 and 1000 characters'),
    
  body('brand')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Brand must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-_&.]+$/)
    .withMessage('Brand contains invalid characters'),
    
  body('type')
    .isIn(['electronics', 'clothing', 'books', 'home', 'sports', 'beauty', 'toys', 'automotive', 'food', 'other'])
    .withMessage('Invalid item type'),
    
  body('totalUnits')
    .isInt({ min: 0 })
    .withMessage('Total units must be a non-negative integer'),
    
  body('stockQty')
    .isInt({ min: 0 })
    .withMessage('Stock quantity must be a non-negative integer')
    .custom((value, { req }) => {
      if (parseInt(value) > parseInt(req.body.totalUnits)) {
        throw new Error('Stock quantity cannot be greater than total units');
      }
      return true;
    }),
    
  body('purchasePrice')
    .isFloat({ min: 0 })
    .withMessage('Purchase price must be a non-negative number'),
    
  body('sellPrice')
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a non-negative number'),
    
  body('mrpPrice')
    .isFloat({ min: 0 })
    .withMessage('MRP price must be a non-negative number')
    .custom((value, { req }) => {
      if (parseFloat(req.body.sellPrice) > parseFloat(value)) {
        throw new Error('Selling price cannot be greater than MRP');
      }
      return true;
    }),
    
  body('purchaseDate')
    .isISO8601()
    .withMessage('Purchase date must be a valid date')
    .custom((value) => {
      if (new Date(value) > new Date()) {
        throw new Error('Purchase date cannot be in the future');
      }
      return true;
    }),
    
  body('storeId')
    .isMongoId()
    .withMessage('Invalid store ID'),
    
  body('sku')
    .optional()
    .trim()
    .matches(/^[A-Z0-9\-_]+$/)
    .withMessage('SKU can only contain uppercase letters, numbers, hyphens, and underscores'),
    
  body('barcode')
    .optional()
    .isNumeric()
    .isLength({ min: 8, max: 14 })
    .withMessage('Barcode must be 8-14 digits'),
    
  body('minStockLevel')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Minimum stock level must be a non-negative integer'),
    
  body('maxStockLevel')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Maximum stock level must be a non-negative integer')
    .custom((value, { req }) => {
      if (value && req.body.minStockLevel && parseInt(value) < parseInt(req.body.minStockLevel)) {
        throw new Error('Maximum stock level must be greater than minimum stock level');
      }
      return true;
    }),
    
  body('category')
    .optional()
    .isMongoId()
    .withMessage('Invalid category ID'),
    
  body('tags')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const tags = value.split(',').map(tag => tag.trim());
        if (tags.some(tag => tag.length > 50)) {
          throw new Error('Each tag must be 50 characters or less');
        }
        if (tags.length > 10) {
          throw new Error('Maximum 10 tags allowed');
        }
      }
      return true;
    }),
    
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),

  handleValidationErrors
];

// Stock update validation
const validateStockUpdate = [
  body('quantity')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
    
  body('operation')
    .optional()
    .isIn(['set', 'add', 'subtract'])
    .withMessage('Operation must be one of: set, add, subtract'),
    
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Reason cannot exceed 200 characters'),

  handleValidationErrors
];

// User registration validation
const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
    
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
    
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s\-']+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),
    
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s\-']+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),
    
  body('phoneNumber')
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),

  handleValidationErrors
];

// OTP validation
const validateOTP = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
    
  body('otp')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('OTP must be exactly 6 digits'),

  handleValidationErrors
];

// Query parameter validation for inventory filtering
const validateInventoryQuery = [
  // Pagination
  query('page')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Page must be between 1 and 10000')
    .toInt(),
    
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
    
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer')
    .toInt(),
    
  // Search and text filters
  query('search')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search term must be between 1 and 100 characters'),
    
  query('description')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Description search must be between 2 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-_.,&()]+$/)
    .withMessage('Description search contains invalid characters'),
    
  // Category filters
  query('brand')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Brand filter must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-_&.]+$/)
    .withMessage('Brand filter contains invalid characters'),
    
  query('type')
    .optional()
    .isIn(['electronics', 'clothing', 'books', 'home', 'sports', 'beauty', 'toys', 'automotive', 'food', 'other'])
    .withMessage('Invalid item type filter'),
    
  query('category')
    .optional()
    .isMongoId()
    .withMessage('Invalid category ID'),
    
  // Store filter
  query('storeId')
    .optional()
    .isMongoId()
    .withMessage('Invalid store ID'),
    
  // Status filters
  query('status')
    .optional()
    .isIn(['in_stock', 'low_stock', 'out_of_stock', 'discontinued'])
    .withMessage('Invalid status filter'),
    
  query('availableOnly')
    .optional()
    .isBoolean()
    .withMessage('availableOnly must be true or false'),
    
  query('lowStock')
    .optional()
    .isBoolean()
    .withMessage('lowStock must be true or false'),
    
  query('outOfStock')
    .optional()
    .isBoolean()
    .withMessage('outOfStock must be true or false'),
    
  query('newArrivals')
    .optional()
    .isBoolean()
    .withMessage('newArrivals must be true or false'),
    
  query('newArrivalsDays')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('newArrivalsDays must be between 1 and 365'),
    
  // Price filters
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be a non-negative number'),
    
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be a non-negative number')
    .custom((value, { req }) => {
      if (req.query.minPrice && parseFloat(value) < parseFloat(req.query.minPrice)) {
        throw new Error('Maximum price must be greater than minimum price');
      }
      return true;
    }),
    
  // Date filters
  query('purchaseDateFrom')
    .optional()
    .isISO8601()
    .withMessage('Purchase date from must be a valid date'),
    
  query('purchaseDateTo')
    .optional()
    .isISO8601()
    .withMessage('Purchase date to must be a valid date')
    .custom((value, { req }) => {
      if (req.query.purchaseDateFrom && new Date(value) < new Date(req.query.purchaseDateFrom)) {
        throw new Error('Purchase date to must be after purchase date from');
      }
      return true;
    }),
    
  // Sorting
  query('sortBy')
    .optional()
    .isIn(['name', 'sellPrice', 'mrpPrice', 'purchaseDate'])
    .withMessage('Invalid sort field. Supported fields: name, sellPrice, mrpPrice, purchaseDate'),
    
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc'),

  handleValidationErrors
];

// Enhanced query builder helper function
const buildInventoryQuery = (queryParams, userRole, userStoreId) => {
  const {
    search, description, brand, type, category, storeId, status,
    availableOnly, lowStock, outOfStock, newArrivals, newArrivalsDays = 7,
    minPrice, maxPrice, purchaseDateFrom, purchaseDateTo,
    tags, sku, barcode, includeDeleted, minStock, maxStock
  } = queryParams;

  const query = {};
  
  // Base filter - exclude deleted items unless specifically requested
  if (includeDeleted !== 'true') {
    query.isDeleted = false;
  }

  // Store access control
  if (userRole !== 'admin' && userRole !== 'superadmin') {
    query.storeId = userStoreId || storeId;
  } else if (storeId) {
    query.storeId = storeId;
  }

  // Text search - enhanced with description partial match
  if (search || description) {
    const searchConditions = [];
    
    if (search) {
      searchConditions.push(
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { barcode: { $regex: search, $options: 'i' } }
      );
    }
    
    // Separate description partial match
    if (description) {
      searchConditions.push({
        description: { $regex: description, $options: 'i' }
      });
    }
    
    if (searchConditions.length > 0) {
      query.$or = searchConditions;
    }
  }

  // Category filters
  if (brand) {
    query.brand = { $regex: brand, $options: 'i' };
  }
  
  if (type) {
    query.type = type;
  }
  
  if (category) {
    query.category = category;
  }

  // Status filters
  if (status) {
    query.status = status;
  }

  // Stock availability filters
  if (availableOnly === 'true') {
    query.stockQty = { $gt: 0 };
  }
  
  if (lowStock === 'true') {
    query.$expr = { $lte: ['$stockQty', '$minStockLevel'] };
  }
  
  if (outOfStock === 'true') {
    query.stockQty = 0;
  }

  // Stock quantity range
  if (minStock || maxStock) {
    query.stockQty = {};
    if (minStock) query.stockQty.$gte = parseInt(minStock);
    if (maxStock) query.stockQty.$lte = parseInt(maxStock);
  }

  // New arrivals filter
  if (newArrivals === 'true') {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(newArrivalsDays));
    query.purchaseDate = { $gte: daysAgo };
  }

  // Price range filters
  if (minPrice || maxPrice) {
    query.sellPrice = {};
    if (minPrice) query.sellPrice.$gte = parseFloat(minPrice);
    if (maxPrice) query.sellPrice.$lte = parseFloat(maxPrice);
  }

  // Date range filters
  if (purchaseDateFrom || purchaseDateTo) {
    query.purchaseDate = {};
    if (purchaseDateFrom) query.purchaseDate.$gte = new Date(purchaseDateFrom);
    if (purchaseDateTo) query.purchaseDate.$lte = new Date(purchaseDateTo);
  }

  // Advanced filters
  if (tags) {
    const tagArray = tags.split(',').map(tag => tag.trim().toLowerCase());
    query.tags = { $in: tagArray };
  }
  
  if (sku) {
    query.sku = { $regex: sku, $options: 'i' };
  }
  
  if (barcode) {
    query.barcode = barcode;
  }

  return query;
};

// Enhanced sorting helper - restricted to specified fields
const buildSortOptions = (sortBy = 'purchaseDate', sortOrder = 'desc') => {
  const validSortFields = ['name', 'sellPrice', 'mrpPrice', 'purchaseDate'];
  
  const sortOptions = {};
  
  if (validSortFields.includes(sortBy)) {
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    // Secondary sort for consistent results
    if (sortBy !== 'purchaseDate') {
      sortOptions.purchaseDate = -1;
    }
  } else {
    // Default sort by purchase date (most recent first)
    sortOptions.purchaseDate = -1;
  }
  
  return sortOptions;
};

// Enhanced pagination helper with metadata
const buildPaginationOptions = (page = 1, limit = 20, offset = null) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  
  // Use offset if provided, otherwise calculate from page
  const skip = offset !== null ? Math.max(0, parseInt(offset)) : (pageNum - 1) * limitNum;
  
  return {
    page: pageNum,
    limit: limitNum,
    skip,
    offset: skip
  };
};

// Helper function to build pagination metadata
const buildPaginationMeta = (page, limit, total, hasData = true) => {
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.min(page, totalPages || 1);
  
  return {
    pagination: {
      currentPage,
      totalPages,
      totalItems: total,
      itemsPerPage: limit,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
      nextPage: currentPage < totalPages ? currentPage + 1 : null,
      prevPage: currentPage > 1 ? currentPage - 1 : null,
      startIndex: total > 0 ? ((currentPage - 1) * limit) + 1 : 0,
      endIndex: Math.min(currentPage * limit, total),
      isEmpty: total === 0,
      isFirstPage: currentPage === 1,
      isLastPage: currentPage === totalPages || total === 0
    }
  };
};

// Helper function for paginated query execution
const executePaginatedQuery = async (Model, query, sortOptions, paginationOptions, populateOptions = null) => {
  try {
    const { skip, limit } = paginationOptions;
    
    // Build the base query
    let dbQuery = Model.find(query);
    
    // Add population if specified
    if (populateOptions) {
      if (Array.isArray(populateOptions)) {
        populateOptions.forEach(populate => {
          dbQuery = dbQuery.populate(populate);
        });
      } else {
        dbQuery = dbQuery.populate(populateOptions);
      }
    }
    
    // Execute count and data queries in parallel
    const [total, data] = await Promise.all([
      Model.countDocuments(query),
      dbQuery
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean()
    ]);
    
    return {
      data,
      total,
      ...buildPaginationMeta(paginationOptions.page, limit, total)
    };
  } catch (error) {
    throw new Error(`Pagination query failed: ${error.message}`);
  }
};

module.exports = {
  validateInventoryItem,
  validateStockUpdate,
  validateUserRegistration,
  validateOTP,
  validateInventoryQuery,
  buildInventoryQuery,
  buildSortOptions,
  buildPaginationOptions,
  buildPaginationMeta,
  executePaginatedQuery,
  handleValidationErrors
};
