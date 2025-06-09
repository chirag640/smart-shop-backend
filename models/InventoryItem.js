const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Item name is required'],
    trim: true,
    maxLength: [200, 'Item name cannot exceed 200 characters'],
    index: true
  },
  
  description: {
    type: String,
    required: [true, 'Item description is required'],
    trim: true,
    maxLength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  brand: {
    type: String,
    required: [true, 'Brand is required'],
    trim: true,
    maxLength: [100, 'Brand name cannot exceed 100 characters'],
    index: true
  },
  
  type: {
    type: String,
    required: [true, 'Item type is required'],
    enum: {
      values: ['electronics', 'clothing', 'books', 'home', 'sports', 'beauty', 'toys', 'automotive', 'food', 'other'],
      message: 'Invalid item type'
    },
    index: true
  },
  
  // Inventory Quantities
  totalUnits: {
    type: Number,
    required: [true, 'Total units is required'],
    min: [0, 'Total units cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: 'Total units must be a whole number'
    }
  },
  
  stockQty: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock quantity cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: 'Stock quantity must be a whole number'
    }
  },
  
  // Pricing Information
  purchasePrice: {
    type: Number,
    required: [true, 'Purchase price is required'],
    min: [0, 'Purchase price cannot be negative'],
    validate: {
      validator: function(value) {
        return Number.isFinite(value) && value >= 0;
      },
      message: 'Purchase price must be a valid positive number'
    }
  },
  
  sellPrice: {
    type: Number,
    required: [true, 'Selling price is required'],
    min: [0, 'Selling price cannot be negative'],
    validate: {
      validator: function(value) {
        return Number.isFinite(value) && value >= 0;
      },
      message: 'Selling price must be a valid positive number'
    }
  },
  
  mrpPrice: {
    type: Number,
    required: [true, 'MRP price is required'],
    min: [0, 'MRP price cannot be negative'],
    validate: {
      validator: function(value) {
        return Number.isFinite(value) && value >= 0;
      },
      message: 'MRP price must be a valid positive number'
    }
  },
  
  // Purchase Information
  purchaseDate: {
    type: Date,
    required: [true, 'Purchase date is required'],
    validate: {
      validator: function(value) {
        return value <= new Date();
      },
      message: 'Purchase date cannot be in the future'
    }
  },
  
  // Media
  imageUrl: {
    type: String,
    default: function() {
      return `https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/${this.type || 'other'}-default.jpg`;
    },
    validate: {
      validator: function(value) {
        if (!value) return true; // Optional field
        const urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
        return urlRegex.test(value);
      },
      message: 'Please provide a valid image URL'
    }
  },
  
  imagePublicId: {
    type: String,
    trim: true,
    sparse: true // Allow null values but ensure uniqueness when present
  },
  
  imageVariants: {
    thumbnail: {
      type: String,
      default: ''
    },
    small: {
      type: String,
      default: ''
    },
    medium: {
      type: String,
      default: ''
    },
    large: {
      type: String,
      default: ''
    },
    original: {
      type: String,
      default: ''
    }
  },
  
  isDefaultImage: {
    type: Boolean,
    default: true
  },
  
  imageMetadata: {
    width: {
      type: Number,
      min: 0
    },
    height: {
      type: Number,
      min: 0
    },
    format: {
      type: String,
      lowercase: true
    },
    bytes: {
      type: Number,
      min: 0
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  // Additional Product Details
  sku: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
    match: [/^[A-Z0-9-_]+$/, 'SKU can only contain uppercase letters, numbers, hyphens, and underscores']
  },
  
  barcode: {
    type: String,
    sparse: true,
    trim: true,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return /^\d{8,14}$/.test(value); // Standard barcode formats
      },
      message: 'Barcode must be 8-14 digits'
    }
  },
  
  // Inventory Management
  minStockLevel: {
    type: Number,
    default: 10,
    min: [0, 'Minimum stock level cannot be negative']
  },
  
  maxStockLevel: {
    type: Number,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return value >= this.minStockLevel;
      },
      message: 'Maximum stock level must be greater than minimum stock level'
    }
  },
  
  reorderPoint: {
    type: Number,
    default: function() {
      return this.minStockLevel + 5;
    },
    min: [0, 'Reorder point cannot be negative']
  },
  
  // Store and User References
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: [true, 'Store ID is required'],
    index: true
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by user ID is required'],
    index: true
  },
  
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Category and Tags
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    index: true
  },
  
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxLength: [50, 'Tag cannot exceed 50 characters']
  }],
  
  // Status and Soft Delete
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  
  status: {
    type: String,
    enum: {
      values: ['in_stock', 'low_stock', 'out_of_stock', 'discontinued'],
      message: 'Invalid status'
    },
    default: 'in_stock',
    index: true
  },
  
  // Additional Metadata
  supplier: {
    name: {
      type: String,
      trim: true,
      maxLength: [100, 'Supplier name cannot exceed 100 characters']
    },
    contactInfo: {
      phone: String,
      email: {
        type: String,
        validate: {
          validator: function(value) {
            if (!value) return true;
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
          },
          message: 'Please provide a valid email address'
        }
      },
      address: String
    }
  },
  
  // Tracking Information
  lastSoldDate: {
    type: Date
  },
  
  lastRestockedDate: {
    type: Date
  },
  
  totalSold: {
    type: Number,
    default: 0,
    min: [0, 'Total sold cannot be negative']
  },
  
  // Notes and Comments
  notes: {
    type: String,
    maxLength: [500, 'Notes cannot exceed 500 characters']
  },
  
  // Audit Trail
  deletedAt: {
    type: Date
  },
  
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
inventoryItemSchema.index({ storeId: 1, isDeleted: 1 });
inventoryItemSchema.index({ name: 'text', description: 'text', brand: 'text' });
inventoryItemSchema.index({ type: 1, brand: 1 });
inventoryItemSchema.index({ status: 1, isActive: 1 });
inventoryItemSchema.index({ purchaseDate: -1 });
inventoryItemSchema.index({ stockQty: 1 });

// Virtual fields
inventoryItemSchema.virtual('profitMargin').get(function() {
  if (this.purchasePrice === 0) return 0;
  return ((this.sellPrice - this.purchasePrice) / this.purchasePrice * 100).toFixed(2);
});

inventoryItemSchema.virtual('discountPercentage').get(function() {
  if (this.mrpPrice === 0) return 0;
  return ((this.mrpPrice - this.sellPrice) / this.mrpPrice * 100).toFixed(2);
});

inventoryItemSchema.virtual('totalValue').get(function() {
  return (this.stockQty * this.purchasePrice).toFixed(2);
});

inventoryItemSchema.virtual('potentialRevenue').get(function() {
  return (this.stockQty * this.sellPrice).toFixed(2);
});

inventoryItemSchema.virtual('isLowStock').get(function() {
  return this.stockQty <= this.minStockLevel;
});

inventoryItemSchema.virtual('isOutOfStock').get(function() {
  return this.stockQty === 0;
});

inventoryItemSchema.virtual('needsReorder').get(function() {
  return this.stockQty <= this.reorderPoint;
});

// Pre-save middleware
inventoryItemSchema.pre('save', function(next) {
  // Auto-generate SKU if not provided
  if (!this.sku && this.isNew) {
    const brandPrefix = this.brand.substring(0, 3).toUpperCase();
    const typePrefix = this.type.substring(0, 3).toUpperCase();
    const timestamp = Date.now().toString().slice(-6);
    this.sku = `${brandPrefix}-${typePrefix}-${timestamp}`;
  }
  
  // Set default image URL if none provided
  if (!this.imageUrl || this.imageUrl === '') {
    this.imageUrl = `https://res.cloudinary.com/demo/image/upload/v1/smart-shop/defaults/${this.type || 'other'}-default.jpg`;
    this.isDefaultImage = true;
  }
  
  // Update imageMetadata.uploadedAt when imagePublicId changes
  if (this.isModified('imagePublicId') && this.imagePublicId) {
    if (!this.imageMetadata) {
      this.imageMetadata = {};
    }
    this.imageMetadata.uploadedAt = new Date();
  }
  
  // Update status based on stock quantity
  if (this.stockQty === 0) {
    this.status = 'out_of_stock';
  } else if (this.stockQty <= this.minStockLevel) {
    this.status = 'low_stock';
  } else {
    this.status = 'in_stock';
  }
  
  // Validate price relationships
  if (this.sellPrice > this.mrpPrice) {
    return next(new Error('Selling price cannot be greater than MRP'));
  }
  
  if (this.stockQty > this.totalUnits) {
    return next(new Error('Stock quantity cannot be greater than total units'));
  }
  
  next();
});

// Pre-update middleware for soft delete
inventoryItemSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  if (update.isDeleted === true) {
    update.deletedAt = new Date();
  } else if (update.isDeleted === false) {
    update.deletedAt = undefined;
  }
  
  next();
});

// Static methods
inventoryItemSchema.statics.findActive = function() {
  return this.find({ isDeleted: false, isActive: true });
};

inventoryItemSchema.statics.findByStore = function(storeId) {
  return this.find({ storeId, isDeleted: false });
};

inventoryItemSchema.statics.findLowStock = function(storeId = null) {
  const query = { 
    isDeleted: false, 
    $expr: { $lte: ['$stockQty', '$minStockLevel'] } 
  };
  
  if (storeId) {
    query.storeId = storeId;
  }
  
  return this.find(query);
};

inventoryItemSchema.statics.findOutOfStock = function(storeId = null) {
  const query = { stockQty: 0, isDeleted: false };
  
  if (storeId) {
    query.storeId = storeId;
  }
  
  return this.find(query);
};

inventoryItemSchema.statics.getInventoryValue = async function(storeId = null) {
  const matchStage = { isDeleted: false };
  if (storeId) {
    matchStage.storeId = mongoose.Types.ObjectId(storeId);
  }
  
  const result = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        totalUnits: { $sum: '$stockQty' },
        totalValue: { $sum: { $multiply: ['$stockQty', '$purchasePrice'] } },
        totalPotentialRevenue: { $sum: { $multiply: ['$stockQty', '$sellPrice'] } }
      }
    }
  ]);
  
  return result[0] || {
    totalItems: 0,
    totalUnits: 0,
    totalValue: 0,
    totalPotentialRevenue: 0
  };
};

// Instance methods
inventoryItemSchema.methods.softDelete = function(deletedBy) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  return this.save();
};

inventoryItemSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

inventoryItemSchema.methods.updateStock = function(quantity, operation = 'set') {
  switch (operation) {
    case 'add':
      this.stockQty += quantity;
      this.totalUnits += quantity;
      this.lastRestockedDate = new Date();
      break;
    case 'subtract':
      this.stockQty = Math.max(0, this.stockQty - quantity);
      this.totalSold += quantity;
      if (this.stockQty === 0) {
        this.lastSoldDate = new Date();
      }
      break;
    case 'set':
    default:
      this.stockQty = quantity;
      break;
  }
  
  return this.save();
};

inventoryItemSchema.methods.calculateProfit = function(soldQuantity) {
  const profit = (this.sellPrice - this.purchasePrice) * soldQuantity;
  const profitMargin = this.purchasePrice === 0 ? 0 : (profit / (this.purchasePrice * soldQuantity)) * 100;
  
  return {
    totalProfit: profit.toFixed(2),
    profitMargin: profitMargin.toFixed(2),
    revenue: (this.sellPrice * soldQuantity).toFixed(2),
    cost: (this.purchasePrice * soldQuantity).toFixed(2)
  };
};

// Instance method to get optimized image URL
inventoryItemSchema.methods.getOptimizedImageUrl = function(size = 'medium') {
  if (this.isDefaultImage || !this.imageVariants || !this.imageVariants[size]) {
    return this.imageUrl;
  }
  
  return this.imageVariants[size] || this.imageUrl;
};

// Instance method to get image info
inventoryItemSchema.methods.getImageInfo = function() {
  return {
    url: this.imageUrl,
    publicId: this.imagePublicId,
    isDefault: this.isDefaultImage,
    variants: this.imageVariants,
    metadata: this.imageMetadata
  };
};

// Export the model
const InventoryItem = mongoose.model('InventoryItem', inventoryItemSchema);

module.exports = InventoryItem;
