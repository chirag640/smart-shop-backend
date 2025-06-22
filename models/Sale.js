const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const saleItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryItem',
    required: true
  },
  itemName: {
    type: String,
    required: true
  },
  brand: {
    type: String,
    default: ''
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  mrp: {
    type: Number,
    default: 0,
    min: 0
  },
  sku: {
    type: String,
    default: ''
  }
}, { _id: false });

const saleSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Customer information
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // Can be null for walk-in customers
  },
  customerName: {
    type: String,
    required: true
  },
  customerPhone: {
    type: String,
    default: ''
  },
  customerEmail: {
    type: String,
    default: ''
  },

  // Sale items
  items: [saleItemSchema],

  // Payment information
  paymentMode: {
    type: String,
    enum: ['cash', 'upi', 'credit', 'card'],
    required: true,
    default: 'cash'
  },  paymentReference: {
    type: String,
    default: '' // Optional - for future use with payment gateways
  },
  // Amounts
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  mrpTotal: {
    type: Number,
    default: 0,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  extraDiscount: {
    type: Number,
    default: 0,
    min: 0
  },
  gst: {
    type: Number,
    default: 9,
    min: 0
  },
  cgst: {
    type: Number,
    default: 9,
    min: 0
  },
  totalTax: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },

  // Store and staff information
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true
  },
  handledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true // Staff member who handled the sale
  },

  // Status and metadata
  status: {
    type: String,
    enum: ['completed', 'partial_refund', 'full_refund', 'cancelled'],
    default: 'completed'
  },
  notes: {
    type: String,
    default: ''
  },

  // Timestamps
  saleDate: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
saleSchema.index({ storeId: 1, saleDate: -1 });
saleSchema.index({ customerId: 1, saleDate: -1 });
saleSchema.index({ handledBy: 1, saleDate: -1 });
saleSchema.index({ paymentMode: 1, saleDate: -1 });
saleSchema.index({ status: 1 });
saleSchema.index({ invoiceNumber: 1 }, { unique: true });

// Virtual for formatted invoice number
saleSchema.virtual('formattedInvoiceNumber').get(function() {
  return `INV-${this.invoiceNumber}`;
});

// Virtual for total items count
saleSchema.virtual('totalItemsCount').get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Virtual for total savings (MRP vs actual billed)
saleSchema.virtual('totalSavings').get(function() {
  return Math.max(0, this.mrpTotal - this.totalAmount);
});

// Pre-save middleware to update timestamps
saleSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to generate invoice number
saleSchema.statics.generateInvoiceNumber = async function() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  
  const prefix = `${year}${month}${day}`;
  
  // Find the highest invoice number for today
  const lastInvoice = await this.findOne(
    { invoiceNumber: { $regex: `^${prefix}` } },
    {},
    { sort: { invoiceNumber: -1 } }
  );
  
  let sequence = 1;
  if (lastInvoice) {
    const lastSequence = parseInt(lastInvoice.invoiceNumber.slice(-4));
    sequence = lastSequence + 1;
  }
  
  return `${prefix}${String(sequence).padStart(4, '0')}`;
};

// Method to calculate amounts
saleSchema.methods.calculateAmounts = function() {
  // Calculate subtotal from items
  this.subtotal = this.items.reduce((total, item) => total + item.totalPrice, 0);
  
  // Calculate MRP total
  this.mrpTotal = this.items.reduce((total, item) => total + (item.mrp * item.quantity), 0);
  
  // Apply discounts (manual discount first, then extra discount)
  const amountAfterDiscount = this.subtotal - this.discount - this.extraDiscount;
  
  // Calculate GST + CGST
  const gstAmount = (amountAfterDiscount * this.gst) / 100;
  const cgstAmount = (amountAfterDiscount * this.cgst) / 100;
  this.totalTax = gstAmount + cgstAmount;
  
  // Calculate final total
  this.totalAmount = amountAfterDiscount + this.totalTax;
  
  return this;
};

// Method to format for display
saleSchema.methods.toDisplayFormat = function() {
  return {
    _id: this._id,
    invoiceNumber: this.formattedInvoiceNumber,
    customerName: this.customerName,
    customerPhone: this.customerPhone,
    paymentMode: this.paymentMode,
    totalAmount: this.totalAmount,
    totalItemsCount: this.totalItemsCount,
    saleDate: this.saleDate,
    status: this.status,
    handledBy: this.handledBy  };
};

// Add pagination plugin
saleSchema.plugin(mongoosePaginate);

const Sale = mongoose.model('Sale', saleSchema);

module.exports = Sale;
