const { User } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Customer = require('../models/User'); // Assuming customers are in User model with role: 'customer'
const fs = require('fs');
const path = require('path');
const { logAudit } = require('../utils/auditLogService');

// @desc    Search customers with typeahead support
// @route   GET /api/v1/customers/search
// @access  Private (Staff and above)
const searchCustomers = catchAsync(async (req, res) => {
  const { 
    q: searchQuery, 
    limit = 10, 
    includeInactive = false,
    fuzzy = true 
  } = req.query;

  if (!searchQuery || searchQuery.trim().length < 2) {
    return res.status(400).json({
      success: false,
      error: 'Search query must be at least 2 characters long'
    });
  }

  const query = {
    role: 'customer'
  };

  // Include/exclude inactive customers
  if (!includeInactive) {
    query.isActive = true;
  }

  // Store-level filtering for non-admin users
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    // For stores, you might want to filter customers who have made purchases
    // This is a placeholder - adjust based on your business logic
    // query.storeId = req.user.storeId;
  }

  const searchTerm = searchQuery.trim();
  const limitNum = Math.min(20, Math.max(1, parseInt(limit)));

  let customers;

  if (fuzzy) {
    // Fuzzy search using MongoDB text search and regex
    // Create a more flexible search pattern
    const searchPattern = searchTerm
      .split('')
      .join('.*?'); // Allow characters in between for fuzzy matching
    
    const searchRegex = new RegExp(searchPattern, 'i');
    
    // Multiple search strategies for better fuzzy matching
    customers = await User.find({
      ...query,
      $or: [
        // Exact match (highest priority)
        { 
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: new RegExp(`^${searchTerm}`, 'i')
            }
          }
        },
        // Partial match in full name
        { 
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: new RegExp(searchTerm, 'i')
            }
          }
        },
        // Fuzzy match in full name
        { 
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: searchRegex
            }
          }
        },
        // Individual field matches
        { firstName: { $regex: searchTerm, $options: 'i' } },
        { lastName: { $regex: searchTerm, $options: 'i' } },
        { email: { $regex: searchTerm, $options: 'i' } },
        { phoneNumber: { $regex: searchTerm.replace(/\D/g, ''), $options: 'i' } }
      ]
    })
    .select('firstName lastName email phoneNumber isActive lastLoginAt createdAt')
    .limit(limitNum)
    .sort({ 
      // Sort by relevance (exact matches first)
      firstName: 1, 
      lastName: 1 
    })
    .lean();
  } else {
    // Standard search without fuzzy matching
    customers = await User.find({
      ...query,
      $or: [
        { 
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: new RegExp(searchTerm, 'i')
            }
          }
        },
        { firstName: { $regex: searchTerm, $options: 'i' } },
        { lastName: { $regex: searchTerm, $options: 'i' } },
        { email: { $regex: searchTerm, $options: 'i' } },
        { phoneNumber: { $regex: searchTerm.replace(/\D/g, ''), $options: 'i' } }
      ]
    })
    .select('firstName lastName email phoneNumber isActive lastLoginAt createdAt')
    .limit(limitNum)
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  }

  // Add computed fields for better frontend display
  const enrichedCustomers = customers.map(customer => ({
    ...customer,
    fullName: `${customer.firstName} ${customer.lastName}`,
    displayText: `${customer.firstName} ${customer.lastName} (${customer.email})`,
    searchScore: calculateSearchScore(customer, searchTerm)
  }));

  // Sort by search relevance score
  enrichedCustomers.sort((a, b) => b.searchScore - a.searchScore);

  res.status(200).json({
    success: true,
    message: 'Customer search completed',
    data: {
      customers: enrichedCustomers,
      query: searchTerm,
      fuzzySearch: fuzzy,
      total: enrichedCustomers.length,
      hasMore: enrichedCustomers.length === limitNum
    }
  });
});

// Helper function to calculate search relevance score
const calculateSearchScore = (customer, searchTerm) => {
  const term = searchTerm.toLowerCase();
  const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase();
  const email = customer.email.toLowerCase();
  
  let score = 0;
  
  // Exact full name match (highest score)
  if (fullName === term) score += 100;
  
  // Full name starts with search term
  else if (fullName.startsWith(term)) score += 80;
  
  // First name exact match
  else if (customer.firstName.toLowerCase() === term) score += 70;
  
  // Last name exact match
  else if (customer.lastName.toLowerCase() === term) score += 65;
  
  // First name starts with term
  else if (customer.firstName.toLowerCase().startsWith(term)) score += 60;
  
  // Last name starts with term
  else if (customer.lastName.toLowerCase().startsWith(term)) score += 55;
  
  // Email starts with term
  else if (email.startsWith(term)) score += 50;
  
  // Full name contains term
  else if (fullName.includes(term)) score += 40;
  
  // First name contains term
  else if (customer.firstName.toLowerCase().includes(term)) score += 30;
  
  // Last name contains term
  else if (customer.lastName.toLowerCase().includes(term)) score += 25;
  
  // Email contains term
  else if (email.includes(term)) score += 20;
  
  // Boost score for active customers
  if (customer.isActive) score += 5;
  
  // Boost score for recently active customers
  if (customer.lastLoginAt) {
    const daysSinceLogin = (Date.now() - new Date(customer.lastLoginAt)) / (1000 * 60 * 60 * 24);
    if (daysSinceLogin < 30) score += 3;
  }
  
  return score;
};

// @desc    Get customer details by ID
// @route   GET /api/v1/customers/:id
// @access  Private (Staff and above)
const getCustomerById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const customer = await User.findOne({
    _id: id,
    role: 'customer'
  })
  .select('firstName lastName email phoneNumber isActive isEmailVerified isPhoneVerified lastLoginAt createdAt profile')
  .populate('profile.addresses')
  .lean();

  if (!customer) {
    return res.status(404).json({
      success: false,
      error: 'Customer not found'
    });
  }

  // Add computed fields
  const enrichedCustomer = {
    ...customer,
    fullName: `${customer.firstName} ${customer.lastName}`,
    displayText: `${customer.firstName} ${customer.lastName} (${customer.email})`
  };

  res.status(200).json({
    success: true,
    message: 'Customer details retrieved',
    data: enrichedCustomer
  });
});

// @desc    Get recent customers
// @route   GET /api/v1/customers/recent
// @access  Private (Staff and above)
const getRecentCustomers = catchAsync(async (req, res) => {
  const { limit = 10 } = req.query;
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

  const customers = await User.find({
    role: 'customer',
    isActive: true
  })
  .select('firstName lastName email phoneNumber lastLoginAt createdAt')
  .sort({ lastLoginAt: -1, createdAt: -1 })
  .limit(limitNum)
  .lean();

  const enrichedCustomers = customers.map(customer => ({
    ...customer,
    fullName: `${customer.firstName} ${customer.lastName}`,
    displayText: `${customer.firstName} ${customer.lastName} (${customer.email})`
  }));

  res.status(200).json({
    success: true,
    message: 'Recent customers retrieved',
    data: {
      customers: enrichedCustomers,
      total: enrichedCustomers.length
    }
  });
});

// @desc    Create new customer (supports walk-in without phone)
// @route   POST /api/v1/customers
// @access  Private (Staff and above)
const createCustomer = catchAsync(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phoneNumber,
    whatsappNumber,
    sameAsWhatsapp = false,
    address,
    notes,
    isWalkIn = false // NEW: flag for walk-in
  } = req.body;

  // Allow walk-in customers without phone number
  if (!firstName || !lastName || (!phoneNumber && !isWalkIn)) {
    return res.status(400).json({
      success: false,
      error: 'First name, last name, and phone number are required unless walk-in.'
    });
  }

  // If walk-in, use default phone and label
  let finalPhoneNumber = phoneNumber;
  let walkInLabel = false;
  if (isWalkIn && !phoneNumber) {
    finalPhoneNumber = '0000000000';
    walkInLabel = true;
  } else if (sameAsWhatsapp && whatsappNumber) {
    finalPhoneNumber = whatsappNumber;
  }

  // Normalize phone number (remove spaces, dashes, etc.)
  const normalizedPhone = finalPhoneNumber ? finalPhoneNumber.replace(/\D/g, '') : '';
  
  // Check if customer already exists (by phone or email), skip for walk-in default phone
  let existingCustomer = null;
  if (!walkInLabel) {
    existingCustomer = await User.findOne({
      role: 'customer',
      $or: [
        { phoneNumber: { $regex: normalizedPhone, $options: 'i' } },
        ...(email ? [{ email: email.toLowerCase() }] : [])
      ]
    });
  }

  if (existingCustomer) {
    return res.status(409).json({
      success: false,
      error: 'Customer already exists with this phone number or email',
      data: {
        existingCustomer: {
          _id: existingCustomer._id,
          fullName: `${existingCustomer.firstName} ${existingCustomer.lastName}`,
          email: existingCustomer.email,
          phoneNumber: existingCustomer.phoneNumber
        }
      }
    });
  }

  // Create customer data
  const customerData = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phoneNumber: finalPhoneNumber,
    role: 'customer',
    isActive: true,
    createdBy: req.user.id, // Link to staff member who created the customer
    profile: {
      createdByStaff: req.user.id,
      createdByStore: req.user.storeId,
      ...(notes && { notes: notes.trim() }),
      ...(address && { 
        addresses: [{
          type: 'primary',
          address: address.trim(),
          isDefault: true,
          createdAt: new Date()
        }]
      })
    }
  };

  // Add walk-in label if applicable
  if (walkInLabel) {
    customerData.profile.isWalkIn = true;
    customerData.profile.walkInLabel = 'Walk-In';
  }

  // Add email if provided
  if (email && email.trim()) {
    customerData.email = email.toLowerCase().trim();
  } else {
    // Generate a placeholder email if not provided
    const timestamp = Date.now();
    customerData.email = `customer.${normalizedPhone || 'walkin'}.${timestamp}@placeholder.local`;
    customerData.isEmailVerified = false;
  }

  // Add WhatsApp number if different from phone
  if (whatsappNumber && !sameAsWhatsapp) {
    customerData.profile.whatsappNumber = whatsappNumber;
  }

  // Generate temporary password (customer can reset later)
  const tempPassword = Math.random().toString(36).slice(-8);
  customerData.password = tempPassword;

  try {
    const newCustomer = new User(customerData);
    const savedCustomer = await newCustomer.save();

    // Populate the response
    const populatedCustomer = await User.findById(savedCustomer._id)
      .select('-password')
      .populate('createdBy', 'firstName lastName email role')
      .populate('profile.createdByStore', 'name location')
      .lean();

    // Add computed fields
    const enrichedCustomer = {
      ...populatedCustomer,
      fullName: `${populatedCustomer.firstName} ${populatedCustomer.lastName}`,
      displayText: `${populatedCustomer.firstName} ${populatedCustomer.lastName} (${populatedCustomer.phoneNumber})`,
      tempPassword: tempPassword // Send temp password in response (in real app, send via SMS/email)
    };

    // Log customer creation
    await logAudit({
      userId: req.user.id,
      action: 'create',
      targetType: 'customer',
      targetId: savedCustomer._id,
      details: { createdBy: req.user.id, customer: enrichedCustomer }
    });

    // Log customer creation
    console.log(`👤 New Customer Created: ${enrichedCustomer.fullName} by ${req.user.firstName} ${req.user.lastName}`);

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: enrichedCustomer
    });

  } catch (error) {
    // Handle validation errors
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

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        error: `Customer with this ${field} already exists`
      });
    }

    throw error;
  }
});

// @desc    Check if customer exists by phone number
// @route   GET /api/v1/customers/check-phone
// @access  Private (Staff and above)
const checkCustomerByPhone = catchAsync(async (req, res) => {
  const { phone } = req.query;

  if (!phone || phone.trim().length < 10) {
    return res.status(400).json({
      success: false,
      error: 'Valid phone number is required'
    });
  }

  // Normalize phone number
  const normalizedPhone = phone.replace(/\D/g, '');

  const customer = await User.findOne({
    role: 'customer',
    phoneNumber: { $regex: normalizedPhone, $options: 'i' }
  })
  .select('firstName lastName email phoneNumber isActive createdAt')
  .lean();

  if (customer) {
    const enrichedCustomer = {
      ...customer,
      fullName: `${customer.firstName} ${customer.lastName}`,
      displayText: `${customer.firstName} ${customer.lastName} (${customer.email || customer.phoneNumber})`
    };

    res.status(200).json({
      success: true,
      message: 'Customer found',
      data: {
        exists: true,
        customer: enrichedCustomer
      }
    });
  } else {
    res.status(200).json({
      success: true,
      message: 'Customer not found',
      data: {
        exists: false,
        suggestedAction: 'create_new'
      }
    });
  }
});

// @desc    Quick customer creation for sales flow
// @route   POST /api/v1/customers/quick-create
// @access  Private (Staff and above)
const quickCreateCustomer = catchAsync(async (req, res) => {
  const {
    name, // Can be full name that we'll split
    phoneNumber,
    whatsappNumber,
    sameAsWhatsapp = false
  } = req.body;

  if (!name || !phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Name and phone number are required'
    });
  }

  // Split name into first and last name
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  // Auto-fill phone number if "same as WhatsApp" is checked
  let finalPhoneNumber = phoneNumber;
  if (sameAsWhatsapp && whatsappNumber) {
    finalPhoneNumber = whatsappNumber;
  }

  // Create customer using the main create function
  req.body = {
    firstName,
    lastName: lastName || 'Customer', // Default last name if not provided
    phoneNumber: finalPhoneNumber,
    whatsappNumber,
    sameAsWhatsapp
  };

  // Call the main create function
  return createCustomer(req, res);
});

/**
 * Export customers as CSV, XLSX, or PDF
 * @route GET /customers/export?format=csv|xlsx|pdf
 * @access Admin/Owner only
 */
const exportCustomers = async (req, res) => {
  const { format = 'csv' } = req.query;
  const customers = await Customer.find({ role: 'customer' }).lean();
  if (!customers || customers.length === 0) {
    return res.status(404).json({ success: false, message: 'No customers found' });
  }
  // Prepare data
  const exportFields = ['firstName', 'lastName', 'phoneNumber', 'email', 'whatsappNumber', 'isActive', 'createdAt'];
  const data = customers.map(c => exportFields.reduce((obj, key) => { obj[key] = c[key] || ''; return obj; }, {}));

  if (format === 'csv') {
    const parser = new Parser({ fields: exportFields });
    const csv = parser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment('customers.csv');
    return res.send(csv);
  } else if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Customers');
    worksheet.columns = exportFields.map(f => ({ header: f, key: f }));
    worksheet.addRows(data);
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment('customers.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } else if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.header('Content-Type', 'application/pdf');
    res.attachment('customers.pdf');
    doc.pipe(res);
    doc.fontSize(18).text('Customer List', { align: 'center' });
    doc.moveDown();
    data.forEach((row, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${row.firstName} ${row.lastName} | ${row.phoneNumber} | ${row.email} | ${row.isActive ? 'Active' : 'Inactive'}`);
    });
    doc.end();
  } else {
    return res.status(400).json({ success: false, message: 'Invalid format. Use csv, xlsx, or pdf.' });
  }
};

module.exports = {
  searchCustomers,
  getCustomerById,
  getRecentCustomers,
  createCustomer,
  checkCustomerByPhone,
  quickCreateCustomer,
  exportCustomers
};
