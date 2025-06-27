const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Store name is required'],
    trim: true,
    maxLength: [100, 'Store name cannot exceed 100 characters']
  },
  location: {
    address: {
      type: String,
      required: [true, 'Store address is required'],
      trim: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true
    },
    pincode: {
      type: String,
      required: [true, 'Pincode is required'],
      trim: true,
      match: [/^\d{6}$/, 'Please enter a valid 6-digit pincode']
    },
    country: {
      type: String,
      default: 'India',
      trim: true
    },
    coordinates: {
      latitude: {
        type: Number,
        min: [-90, 'Latitude must be between -90 and 90'],
        max: [90, 'Latitude must be between -90 and 90']
      },
      longitude: {
        type: Number,
        min: [-180, 'Longitude must be between -180 and 180'],
        max: [180, 'Longitude must be between -180 and 180']
      }
    }
  },
  contactInfo: {
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^[+]?[\d\s\-\(\)]+$/, 'Please enter a valid phone number']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    website: {
      type: String,
      trim: true,
      match: [/^https?:\/\/.+/, 'Please enter a valid website URL']
    }
  },
  description: {
    type: String,
    trim: true,
    maxLength: [500, 'Description cannot exceed 500 characters']
  },
  storeType: {
    type: String,
    enum: ['retail', 'wholesale', 'warehouse', 'showroom', 'online'],
    default: 'retail'
  },
  operatingHours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String }
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  staff: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  staffPermissions: {
    canAddExpenses: { type: Boolean, default: false },
    canEditInventory: { type: Boolean, default: false },
    canViewCost: { type: Boolean, default: false }
  },
  settings: {
    currency: {
      type: String,
      default: 'INR'
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata'
    },
    lowStockAlert: {
      type: Boolean,
      default: true
    },
    emailNotifications: {
      type: Boolean,
      default: true
    },
    smsNotifications: {
      type: Boolean,
      default: false
    }
  },
  isActive: {
    type: Boolean,
    default: true
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
storeSchema.index({ name: 1 });
storeSchema.index({ 'location.city': 1 });
storeSchema.index({ 'location.pincode': 1 });
storeSchema.index({ storeType: 1 });
storeSchema.index({ isActive: 1 });
storeSchema.index({ createdAt: -1 });

// Virtual for full address
storeSchema.virtual('fullAddress').get(function() {
  return `${this.location.address}, ${this.location.city}, ${this.location.state} - ${this.location.pincode}`;
});

// Virtual for total staff count
storeSchema.virtual('staffCount').get(function() {
  return this.staff ? this.staff.length : 0;
});

// Instance method to check if store is open
storeSchema.methods.isOpenNow = function() {
  const now = new Date();
  const day = now.toLocaleLowerCase().substring(0, 3) + (now.getDay() === 0 ? 'sunday' : 
    now.getDay() === 1 ? 'monday' :
    now.getDay() === 2 ? 'tuesday' :
    now.getDay() === 3 ? 'wednesday' :
    now.getDay() === 4 ? 'thursday' :
    now.getDay() === 5 ? 'friday' : 'saturday');
  
  const todayHours = this.operatingHours[day];
  if (!todayHours || !todayHours.open || !todayHours.close) {
    return false;
  }
  
  const currentTime = now.getHours() * 100 + now.getMinutes();
  const openTime = parseInt(todayHours.open.replace(':', ''));
  const closeTime = parseInt(todayHours.close.replace(':', ''));
  
  return currentTime >= openTime && currentTime <= closeTime;
};

// Static method to find stores by city
storeSchema.statics.findByCity = function(city) {
  return this.find({ 
    'location.city': new RegExp(city, 'i'),
    isActive: true 
  });
};

// Pre-save middleware
storeSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.lastUpdatedBy = this.constructor.currentUser;
  }
  next();
});

module.exports = mongoose.model('Store', storeSchema);
