const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    unique: true,
    maxLength: [50, 'Category name cannot exceed 50 characters'],
    minLength: [2, 'Category name must be at least 2 characters']
  },
  description: {
    type: String,
    trim: true,
    maxLength: [200, 'Description cannot exceed 200 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  parentCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  subcategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  icon: {
    type: String,
    trim: true
  },
  color: {
    type: String,
    trim: true,
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please enter a valid hex color code']
  },
  imageUrl: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  metadata: {
    keywords: [String],
    tags: [String]
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
categorySchema.index({ name: 1 });
categorySchema.index({ slug: 1 });
categorySchema.index({ parentCategory: 1 });
categorySchema.index({ isActive: 1 });
categorySchema.index({ sortOrder: 1 });
categorySchema.index({ createdAt: -1 });

// Virtual for item count
categorySchema.virtual('itemCount', {
  ref: 'InventoryItem',
  localField: '_id',
  foreignField: 'category',
  count: true
});

// Virtual for full path (for nested categories)
categorySchema.virtual('fullPath').get(function() {
  // This would need to be populated with parent data
  return this.name;
});

// Virtual for level (depth in hierarchy)
categorySchema.virtual('level').get(function() {
  let level = 0;
  let current = this;
  while (current.parentCategory) {
    level++;
    current = current.parentCategory;
  }
  return level;
});

// Pre-save middleware to generate slug
categorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  
  if (this.isModified() && !this.isNew) {
    this.lastUpdatedBy = this.constructor.currentUser;
  }
  
  next();
});

// Pre-remove middleware to handle subcategories
categorySchema.pre('remove', async function(next) {
  try {
    // Update subcategories to remove parent reference
    await this.model('Category').updateMany(
      { parentCategory: this._id },
      { $unset: { parentCategory: 1 } }
    );
    
    // You might want to handle inventory items here too
    // For now, we'll leave them as they are
    next();
  } catch (error) {
    next(error);
  }
});

// Static method to get category tree
categorySchema.statics.getCategoryTree = async function() {
  const categories = await this.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  
  const categoryMap = new Map();
  const rootCategories = [];
  
  // Create map for quick lookup
  categories.forEach(cat => {
    categoryMap.set(cat._id.toString(), { ...cat, children: [] });
  });
  
  // Build tree structure
  categories.forEach(cat => {
    if (cat.parentCategory) {
      const parent = categoryMap.get(cat.parentCategory.toString());
      if (parent) {
        parent.children.push(categoryMap.get(cat._id.toString()));
      }
    } else {
      rootCategories.push(categoryMap.get(cat._id.toString()));
    }
  });
  
  return rootCategories;
};

// Static method to find by slug
categorySchema.statics.findBySlug = function(slug) {
  return this.findOne({ slug, isActive: true });
};

// Instance method to get all descendants
categorySchema.methods.getDescendants = async function() {
  const descendants = [];
  const queue = [this._id];
  
  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = await this.model('Category').find({ 
      parentCategory: currentId,
      isActive: true 
    });
    
    for (const child of children) {
      descendants.push(child);
      queue.push(child._id);
    }
  }
  
  return descendants;
};

// Instance method to get full path array
categorySchema.methods.getFullPath = async function() {
  const path = [this];
  let current = this;
  
  while (current.parentCategory) {
    current = await this.model('Category').findById(current.parentCategory);
    if (current) {
      path.unshift(current);
    } else {
      break;
    }
  }
  
  return path;
};

module.exports = mongoose.model('Category', categorySchema);
