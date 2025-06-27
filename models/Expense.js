const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    required: true
  },
  category: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true,
    validate: [
      function(val) { return !val || val.length <= 5; },
      'Maximum 5 tags allowed.'
    ]
  }],
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    trim: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessPartner'
  },
  truckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Truck'
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  attachmentUrl: {
    type: String,
    trim: true
  },
  recurring: {
    type: Boolean,
    default: false
  },
  interval: {
    type: String, // e.g. 'monthly', 'weekly', 'yearly'
    trim: true
  },
  startDate: {
    type: Date
  },
  endDate: {
    type: Date
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const Expense = mongoose.model('Expense', expenseSchema);

module.exports = Expense;
