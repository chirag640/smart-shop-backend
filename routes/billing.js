const express = require('express');
const {
  recordSale,
  getSalesStats,
  getInvoices,
  getInvoiceForPrint,
  getInvoicePDF,
  getCustomerHistory,
  getAvailableStores,
  sendInvoiceNotifications
} = require('../controllers/billingController');
const { authMiddleware, authorize } = require('../middlewares/auth');
const { body, validationResult } = require('express-validator');
const { generalLimiter, strictLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Apply rate limiting to all billing routes
router.use(generalLimiter);

// All billing routes require authentication and staff+ privileges
router.use(authMiddleware);
router.use(authorize('staff', 'manager', 'admin', 'superadmin'));

// Validation middleware for sale recording
const validateSaleRecording = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Items must be a non-empty array'),
    
  body('items.*.itemId')
    .isMongoId()
    .withMessage('Each item must have a valid itemId'),
    
  body('items.*.quantity')
    .isInt({ min: 1, max: 1000 })
    .withMessage('Quantity must be a positive integer between 1 and 1000'),

  body('paymentMode')
    .optional()
    .isIn(['cash', 'upi', 'credit', 'card'])
    .withMessage('Payment mode must be one of: cash, upi, credit, card'),

  body('customerId')
    .optional()
    .isMongoId()
    .withMessage('Customer ID must be a valid MongoDB ObjectId'),

  body('discount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Discount must be a non-negative number'),

  body('extraDiscount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Extra discount must be a non-negative number'),

  body('gst')
    .optional()
    .isFloat({ min: 0, max: 50 })
    .withMessage('GST rate must be between 0 and 50 percent'),
  body('cgst')
    .optional()
    .isFloat({ min: 0, max: 50 })
    .withMessage('CGST rate must be between 0 and 50 percent'),

  body('gstRate')
    .optional()
    .isFloat({ min: 0, max: 50 })
    .withMessage('GST rate must be between 0 and 50 percent'),

  body('cgstRate')
    .optional()
    .isFloat({ min: 0, max: 50 })
    .withMessage('CGST rate must be between 0 and 50 percent'),
  body('notes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notes must be a string with maximum 500 characters'),
  body('storeId')
    .optional()
    .isMongoId()
    .withMessage('Store ID must be a valid MongoDB ObjectId'),

  body('sendWhatsApp')
    .optional()
    .isBoolean()
    .withMessage('sendWhatsApp must be a boolean'),

  body('sendEmail')
    .optional()
    .isBoolean()
    .withMessage('sendEmail must be a boolean'),
    
  // Handle validation errors
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',        errors: errors.array().map(error => ({
          field: error.param,
          message: error.msg,
          value: error.value
        }))
      });
    }
    next();
  }
];

// POST route for recording sales
router.post('/record-sale',
  strictLimiter,
  authMiddleware,
  authorize('staff', 'manager', 'admin', 'superadmin'),
  validateSaleRecording,
  recordSale
);

router.get('/sales-stats',
  getSalesStats
);

router.get('/invoices',
  getInvoices
);

router.get('/invoices/:invoiceNumber/print',
  getInvoiceForPrint
);

router.get('/invoices/:invoiceNumber/pdf',
  getInvoicePDF
);

// Get customer purchase history
router.get('/customer/:customerId/history',
  getCustomerHistory
);

// Get available stores for user
router.get('/stores',
  getAvailableStores
);

// Send invoice notifications (WhatsApp/Email)
router.post('/invoices/:invoiceNumber/send',
  body('sendWhatsApp')
    .optional()
    .isBoolean()
    .withMessage('sendWhatsApp must be a boolean'),
  
  body('sendEmail')
    .optional()
    .isBoolean()
    .withMessage('sendEmail must be a boolean'),
  
  body('customEmail')
    .optional()
    .isEmail()
    .withMessage('customEmail must be a valid email'),
  
  body('customPhone')
    .optional()
    .isMobilePhone()
    .withMessage('customPhone must be a valid phone number'),
  
  sendInvoiceNotifications
);

module.exports = router;
