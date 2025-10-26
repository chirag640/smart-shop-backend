const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const InventoryItem = require('../models/InventoryItem');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { InvoiceNotificationService } = require('../utils/invoiceNotificationService');
const Store = require('../models/Store');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const { logAudit } = require('../utils/auditLogService');
const logger = require('../utils/logger');

/**
 * Generate next invoice number
 * Format: INV-YYYY-XXXXXX (e.g., INV-2025-000001)
 */
const generateInvoiceNumber = async () => {
  const currentYear = new Date().getFullYear();
  const prefix = `INV-${currentYear}-`;
  
  // Find the last invoice number for the current year
  const lastSale = await Sale.findOne({
    invoiceNumber: { $regex: `^${prefix}` }
  }).sort({ invoiceNumber: -1 });
  
  let nextNumber = 1;
  if (lastSale) {
    const lastNumber = parseInt(lastSale.invoiceNumber.replace(prefix, ''));
    nextNumber = lastNumber + 1;
  }
  
  // Pad with zeros to make it 6 digits
  const invoiceNumber = `${prefix}${nextNumber.toString().padStart(6, '0')}`;
  return invoiceNumber;
};

/**
 * Calculate pricing details for sale items
 */
const calculatePricing = (items, discount = 0, extraDiscount = 0) => {
  let subtotal = 0;
  let mrpTotal = 0;
  
  const calculatedItems = items.map(item => {
    const totalPrice = item.unitPrice * item.quantity;
    const totalMrp = item.mrp * item.quantity;
    
    subtotal += totalPrice;
    mrpTotal += totalMrp;
    
    return {
      ...item,
      totalPrice
    };
  });
  
  const totalDiscount = discount + extraDiscount;
  const finalAmount = Math.max(0, subtotal - totalDiscount);
  const savings = mrpTotal - finalAmount;
  
  return {
    items: calculatedItems,
    subtotal,
    mrpTotal,
    discount,
    extraDiscount,
    totalDiscount,
    finalAmount,
    savings
  };
};

/**
 * Record a new sale transaction
 * POST /api/billing/sale
 */
const recordSale = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }    const {
      items,
      paymentMode = 'cash',
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      discount = 0,
      extraDiscount = 0,
      paymentReference = '',
      storeId,
      gst,
      cgst,
      gstRate,
      cgstRate,
      notes,
      // Notification options - WhatsApp disabled for now
      sendWhatsApp = false, // Will be ignored - WhatsApp disabled
      sendEmail = false
    } = req.body;

    // Handle both gst/cgst and gstRate/cgstRate naming conventions
    const gstValue = gst || gstRate || 0;
    const cgstValue = cgst || cgstRate || 0;    // Determine storeId with multiple fallback options
    let assignedStoreId = storeId || req.user.storeId;
    
    // If still no storeId, try to get the first available store for this user's role
    if (!assignedStoreId) {
      if (['admin', 'manager', 'staff'].includes(req.user.role)) {
        // For staff roles, try to find their assigned store or any store
        const Store = require('../models/Store');
        const availableStore = await Store.findOne({}).select('_id');
        
        if (availableStore) {
          assignedStoreId = availableStore._id;
          logger.info({ storeId: assignedStoreId, userId: req.user._id }, 'Auto-assigned store for user');
        }
      }
    }
    
    // Final check for storeId
    if (!assignedStoreId) {
      return res.status(400).json({
        success: false,
        message: 'Store ID is required. Please provide storeId in request body or ensure user is assigned to a store.',
        help: {
          solution1: 'Add "storeId": "your-store-id" to the request body',
          solution2: 'Contact admin to assign a store to your user account',
          userRole: req.user.role,
          userId: req.user._id
        }
      });
    }

    // Start a database session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validate and fetch inventory items
      const inventoryItems = await InventoryItem.find({
        _id: { $in: items.map(item => item.itemId) }
      }).session(session);

      if (inventoryItems.length !== items.length) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'One or more items not found in inventory'
        });
      }

      // Check stock availability and prepare sale items
      const saleItems = [];
      const stockUpdates = [];

      for (const requestedItem of items) {
        const inventoryItem = inventoryItems.find(
          item => item._id.toString() === requestedItem.itemId
        );

        if (!inventoryItem) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: `Item not found: ${requestedItem.itemId}`
          });
        }

        if (inventoryItem.stockQty < requestedItem.quantity) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for ${inventoryItem.name}. Available: ${inventoryItem.stockQty}, Requested: ${requestedItem.quantity}`
          });
        }

        // Prepare sale item
        saleItems.push({
          itemId: inventoryItem._id,
          itemName: inventoryItem.name,
          brand: inventoryItem.brand,
          quantity: requestedItem.quantity,
          unitPrice: inventoryItem.sellPrice,
          totalPrice: inventoryItem.sellPrice * requestedItem.quantity,
          mrp: inventoryItem.mrpPrice,
          sku: inventoryItem.sku || ''
        });

        // Prepare stock update
        stockUpdates.push({
          updateOne: {
            filter: { _id: inventoryItem._id },
            update: {
              $inc: { stockQty: -requestedItem.quantity }
            }
          }
        });
      }

      // Calculate pricing
      const pricing = calculatePricing(saleItems, discount, extraDiscount);      // Fetch customer information if customerId provided
      let customer = null;
      let finalCustomerName = customerName || 'Walk-in Customer';
      let finalCustomerPhone = customerPhone || '';
      let finalCustomerEmail = customerEmail || '';
      
      if (customerId) {
        customer = await User.findById(customerId).session(session);
        if (!customer) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'Customer not found'
          });
        }
        
        // Use customer data from database, but allow override from request
        finalCustomerName = customerName || customer.firstName + ' ' + customer.lastName || customer.name || 'Customer';
        finalCustomerPhone = customerPhone || customer.phone || '';
        finalCustomerEmail = customerEmail || customer.email || '';
      }

      // Generate invoice number
      const invoiceNumber = await generateInvoiceNumber();

      // Create sale record
      const sale = new Sale({
        invoiceNumber,
        customerId: customer ? customer._id : null, // Save the customer ID for future reference
        customerName: finalCustomerName,
        customerPhone: finalCustomerPhone,
        customerEmail: finalCustomerEmail,
        items: pricing.items,
        paymentMode,
        paymentReference,
        subtotal: pricing.subtotal,
        mrpTotal: pricing.mrpTotal,
        discount: pricing.discount,
        extraDiscount: pricing.extraDiscount,
        totalDiscount: pricing.totalDiscount,        totalAmount: pricing.finalAmount, // Model expects totalAmount, not finalAmount
        finalAmount: pricing.finalAmount,
        savings: pricing.savings,
        gst: gstValue,
        cgst: cgstValue,
        totalTax: 0, // Will be calculated if needed        saleDate: new Date(),
        handledBy: req.user.id, // Model expects handledBy, not soldBy
        storeId: assignedStoreId,
        notes: notes || ''
      });

      // Save sale
      await sale.save({ session });

      // Update inventory stock levels
      if (stockUpdates.length > 0) {
        await InventoryItem.bulkWrite(stockUpdates, { session });
      }

      // Commit transaction
      await session.commitTransaction();      // Populate sale with related data for response
      await sale.populate([
        { path: 'customerId', select: 'name email phone' },
        { path: 'handledBy', select: 'name email' },
        { path: 'items.itemId', select: 'name brand sku' }
      ]);      // Send notifications if requested (WhatsApp disabled, Email only)
      let notificationResults = null;
      if (sendEmail && finalCustomerEmail) {
        try {
          const pdfBuffer = await generateInvoicePDFBuffer(sale);
          const invoiceData = {
            invoiceNumber: sale.invoiceNumber,
            customerName: finalCustomerName,
            totalAmount: sale.totalAmount,
            items: sale.items,
            paymentMode: sale.paymentMode,
            createdAt: sale.createdAt
          };

          const notificationService = new InvoiceNotificationService();
          notificationResults = await notificationService.sendInvoiceNotifications({
            invoiceData,
            pdfBuffer,
            customerEmail: finalCustomerEmail,
            customerPhone: finalCustomerPhone,
            sendWhatsApp: false, // Disabled for now
            sendEmail: sendEmail && finalCustomerEmail
          });

          logger.info({ invoiceNumber: sale.invoiceNumber, summary: notificationResults.summary }, 'Email notification sent for invoice');
          
          // Log WhatsApp skip message if it was requested
          if (sendWhatsApp) {
            logger.warn('WhatsApp notification was requested but is currently disabled');
          }
          
        } catch (notificationError) {
          logger.error({ err: notificationError }, 'Error sending notifications');
          // Don't fail the sale if notifications fail
        }
      } else if (sendWhatsApp) {
        logger.warn('WhatsApp notification requested but service is currently disabled');
      }res.status(201).json({
        success: true,
        message: 'Sale recorded successfully',
        data: {
          sale,
          invoiceNumber: sale.invoiceNumber,
          totalAmount: sale.totalAmount,
          itemsCount: sale.items.length,
          savings: sale.savings,
          customer: customer ? {
            id: customer._id,
            name: finalCustomerName,
            email: finalCustomerEmail,
            phone: finalCustomerPhone,
            role: customer.role,
            isRegistered: true
          } : {
            name: finalCustomerName,
            email: finalCustomerEmail,
            phone: finalCustomerPhone,
            isRegistered: false
          },          // Include notification results if any were sent
          ...(notificationResults && {
            notifications: {
              requested: {
                whatsApp: sendWhatsApp,
                email: sendEmail
              },
              results: notificationResults.summary,
              whatsAppDisabled: sendWhatsApp, // Flag if WhatsApp was requested but disabled
              details: {
                whatsApp: sendWhatsApp ? {
                  disabled: true,
                  message: 'WhatsApp notifications are currently disabled'
                } : null,
                email: notificationResults.email
              }
            }
          })
        }
      });

      // Log bill/sale creation
      await logAudit({
        userId: req.user.id,
        action: 'create',
        targetType: 'bill',
        targetId: sale._id,
        details: { createdBy: req.user.id, sale }
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    logger.error({ err: error }, 'Error recording sale');
    res.status(500).json({
      success: false,
      message: 'Failed to record sale',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get sales statistics and analytics
 * GET /api/billing/stats
 */
const getSalesStats = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      period = 'today', // today, week, month, year, custom
      storeId,
      paymentMode
    } = req.query;

    // Build date filter
    let dateFilter = {};
    const now = new Date();

    switch (period) {
      case 'today':
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
        dateFilter = { saleDate: { $gte: startOfDay, $lt: endOfDay } };
        break;
      
      case 'week':
        const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { saleDate: { $gte: startOfWeek } };
        break;
      
      case 'month':
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = { saleDate: { $gte: startOfMonth } };
        break;
      
      case 'year':
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        dateFilter = { saleDate: { $gte: startOfYear } };
        break;
      
      case 'custom':
        if (startDate && endDate) {
          dateFilter = {
            saleDate: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          };
        }
        break;
    }

    // Build additional filters
    let additionalFilters = {};
    if (storeId) additionalFilters.storeId = storeId;
    if (paymentMode) additionalFilters.paymentMode = paymentMode;

    const matchFilter = { ...dateFilter, ...additionalFilters };

    // Aggregate sales data
    const salesStats = await Sale.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$finalAmount' },
          totalItems: { $sum: { $size: '$items' } },
          totalDiscount: { $sum: '$totalDiscount' },
          totalSavings: { $sum: '$savings' },
          averageOrderValue: { $avg: '$finalAmount' },
          
          // Payment mode breakdown
          cashSales: {
            $sum: {
              $cond: [{ $eq: ['$paymentMode', 'cash'] }, '$finalAmount', 0]
            }
          },
          upiSales: {
            $sum: {
              $cond: [{ $eq: ['$paymentMode', 'upi'] }, '$finalAmount', 0]
            }
          },
          cardSales: {
            $sum: {
              $cond: [{ $eq: ['$paymentMode', 'card'] }, '$finalAmount', 0]
            }
          },
          creditSales: {
            $sum: {
              $cond: [{ $eq: ['$paymentMode', 'credit'] }, '$finalAmount', 0]
            }
          }
        }
      }
    ]);

    // Get top selling items
    const topItems = await Sale.aggregate([
      { $match: matchFilter },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.itemId',
          itemName: { $first: '$items.itemName' },
          brand: { $first: '$items.brand' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.totalPrice' },
          salesCount: { $sum: 1 }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 }
    ]);    // Get daily sales trend (last 30 days)
    const dailyTrend = await Sale.aggregate([
      {
        $match: {
          saleDate: {
            $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          },
          ...additionalFilters
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$saleDate' }
          },
          sales: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get customer analytics
    const customerStats = await Sale.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalRegisteredCustomers: {
            $sum: {
              $cond: [{ $ne: ['$customerId', null] }, 1, 0]
            }
          },
          totalWalkInCustomers: {
            $sum: {
              $cond: [{ $eq: ['$customerId', null] }, 1, 0]
            }
          },
          registeredCustomerRevenue: {
            $sum: {
              $cond: [{ $ne: ['$customerId', null] }, '$totalAmount', 0]
            }
          },
          walkInRevenue: {
            $sum: {
              $cond: [{ $eq: ['$customerId', null] }, '$totalAmount', 0]
            }
          }
        }
      }
    ]);

    // Get top customers (registered customers only)
    const topCustomers = await Sale.aggregate([
      { 
        $match: { 
          ...matchFilter, 
          customerId: { $ne: null } 
        } 
      },
      {
        $group: {
          _id: '$customerId',
          customerName: { $first: '$customerName' },
          customerEmail: { $first: '$customerEmail' },
          customerPhone: { $first: '$customerPhone' },
          totalPurchases: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          totalItems: { $sum: { $size: '$items' } },
          avgOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 }
    ]);    const stats = salesStats[0] || {
      totalSales: 0,
      totalRevenue: 0,
      totalItems: 0,
      totalDiscount: 0,
      totalSavings: 0,
      averageOrderValue: 0,
      cashSales: 0,
      upiSales: 0,
      cardSales: 0,
      creditSales: 0
    };

    const customerAnalytics = customerStats[0] || {
      totalRegisteredCustomers: 0,
      totalWalkInCustomers: 0,
      registeredCustomerRevenue: 0,
      walkInRevenue: 0
    };

    res.json({
      success: true,
      data: {
        period,
        stats,
        customerAnalytics,
        topItems,
        topCustomers,
        dailyTrend,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    logger.error({ err: error }, 'Error fetching sales stats');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get paginated list of invoices/sales
 * GET /api/billing/invoices
 */
const getInvoices = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      paymentMode,
      startDate,
      endDate,
      customerId,
      sortBy = 'saleDate',
      sortOrder = 'desc'
    } = req.query;

    // Build search filter
    let searchFilter = {};
    
    if (search) {
      searchFilter = {
        $or: [
          { invoiceNumber: { $regex: search, $options: 'i' } },
          { customerName: { $regex: search, $options: 'i' } },
          { customerPhone: { $regex: search, $options: 'i' } }
        ]
      };
    }

    // Build additional filters
    let additionalFilters = {};
    if (paymentMode) additionalFilters.paymentMode = paymentMode;
    if (customerId) additionalFilters.customerId = customerId;
    
    if (startDate && endDate) {
      additionalFilters.saleDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const filters = { ...searchFilter, ...additionalFilters };

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;    // Execute paginated query
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      populate: [
        { 
          path: 'customerId', 
          select: 'firstName lastName name email phone role createdAt',
          // This will populate the full customer object when customerId exists
        },
        { path: 'handledBy', select: 'firstName lastName name email role' }
      ]
    };

    const result = await Sale.paginate(filters, options);

    res.json({
      success: true,
      data: {
        invoices: result.docs,
        pagination: {
          currentPage: result.page,
          totalPages: result.totalPages,
          totalDocs: result.totalDocs,
          limit: result.limit,
          hasNextPage: result.hasNextPage,
          hasPrevPage: result.hasPrevPage
        }
      }
    });

  } catch (error) {
    logger.error({ err: error }, 'Error fetching invoices');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get single invoice details for printing/viewing
 * GET /api/billing/invoice/:invoiceNumber
 */
const getInvoiceForPrint = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;

    const sale = await Sale.findOne({ invoiceNumber })
      .populate('customerId', 'firstName lastName email phone address role createdAt')
      .populate('handledBy', 'firstName lastName name email role')
      .populate('items.itemId', 'name brand sku');

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.json({
      success: true,
      data: { sale }
    });

  } catch (error) {
    logger.error({ err: error }, 'Error fetching invoice');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Generate and download invoice PDF
 * GET /api/billing/invoice/:invoiceNumber/pdf
 */
const getInvoicePDF = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;

    const sale = await Sale.findOne({ invoiceNumber })
      .populate('customerId', 'firstName lastName name email phone address role createdAt')
      .populate('handledBy', 'firstName lastName name email role')
      .populate('items.itemId', 'name brand sku');

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Fetch the store document using sale.storeId
    const storeDoc = await Store.findById(sale.storeId);
    let store = null;
    if (storeDoc) {
      // Map all relevant fields for the PDF
      store = {
        name: storeDoc.name,
        description: storeDoc.description,
        storeType: storeDoc.storeType,
        address: storeDoc.location?.address + ', ' + storeDoc.location?.city + ', ' + storeDoc.location?.state + ' - ' + storeDoc.location?.pincode + ', ' + storeDoc.location?.country,
        phone: storeDoc.contactInfo?.phone,
        email: storeDoc.contactInfo?.email,
        website: storeDoc.contactInfo?.website,
        operatingHours: storeDoc.operatingHours
      };
      logger.debug({ store }, 'PDF Store details'); // Debug print
    }

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNumber}.pdf"`);
    doc.pipe(res);

    // Use the improved PDF content generator
    generateInvoicePDFContent(doc, sale, store);
    doc.end();

  } catch (error) {
    logger.error({ err: error }, 'Error generating PDF');
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get customer purchase history
 * GET /api/billing/customer/:customerId/history
 */
const getCustomerHistory = async (req, res) => {
  try {
    const { customerId } = req.params;
    const {
      page = 1,
      limit = 10,
      startDate,
      endDate,
      sortBy = 'saleDate',
      sortOrder = 'desc'
    } = req.query;

    // Verify customer exists
    const customer = await User.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Build date filter
    let dateFilter = { customerId };
    if (startDate && endDate) {
      dateFilter.saleDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get paginated purchase history
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      populate: [
        { path: 'handledBy', select: 'firstName lastName name email' },
        { path: 'items.itemId', select: 'name brand sku' }
      ]
    };

    const result = await Sale.paginate(dateFilter, options);

    // Calculate customer summary
    const customerSummary = await Sale.aggregate([
      { $match: { customerId: new mongoose.Types.ObjectId(customerId) } },
      {
        $group: {
          _id: null,
          totalPurchases: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          totalItems: { $sum: { $size: '$items' } },
          totalSavings: { $sum: '$savings' },
          avgOrderValue: { $avg: '$totalAmount' },
          firstPurchase: { $min: '$saleDate' },
          lastPurchase: { $max: '$saleDate' }
        }
      }
    ]);

    const summary = customerSummary[0] || {
      totalPurchases: 0,
      totalSpent: 0,
      totalItems: 0,
      totalSavings: 0,
      avgOrderValue: 0,
      firstPurchase: null,
      lastPurchase: null
    };

    res.json({
      success: true,
      data: {
        customer: {
          id: customer._id,
          name: customer.firstName + ' ' + customer.lastName || customer.name,
          email: customer.email,
          phone: customer.phone,
          role: customer.role,
          memberSince: customer.createdAt
        },
        summary,
        purchases: result.docs,
        pagination: {
          currentPage: result.page,
          totalPages: result.totalPages,
          totalDocs: result.totalDocs,
          limit: result.limit,
          hasNextPage: result.hasNextPage,
          hasPrevPage: result.hasPrevPage
        }
      }
    });

  } catch (error) {
    logger.error({ err: error }, 'Error fetching customer history');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer history',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get available stores for current user
 * GET /api/billing/stores
 */
const getAvailableStores = async (req, res) => {
  try {
    const Store = require('../models/Store');
    
    let storeQuery = {};
    
    // If user has assigned store, only show that store
    if (req.user.storeId) {
      storeQuery._id = req.user.storeId;
    }
    
    const stores = await Store.find(storeQuery).select('_id name address isActive');
    
    return res.status(200).json({
      success: true,
      data: {
        stores,
        userStoreId: req.user.storeId || null,
        message: req.user.storeId 
          ? 'Your assigned store' 
          : 'All available stores (you can use any storeId in requests)'
      }
    });
    
  } catch (error) {
    logger.error({ err: error }, 'Error fetching stores');
    return res.status(500).json({
      success: false,
      message: 'Error fetching available stores',
      error: error.message
    });
  }
};

/**
 * Send invoice notifications (WhatsApp/Email)
 * POST /api/billing/invoices/:invoiceNumber/send
 */
const sendInvoiceNotifications = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const { 
      sendWhatsApp = false, 
      sendEmail = false,
      customEmail,
      customPhone 
    } = req.body;

    // Find the sale/invoice
    const sale = await Sale.findOne({ invoiceNumber })
      .populate('customerId', 'firstName lastName email phone')
      .populate('items.itemId', 'name brand');

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Prepare customer contact info
    const customerEmail = customEmail || 
      (sale.customerId ? sale.customerId.email : sale.customerEmail) || 
      sale.customerEmail;
      
    const customerPhone = customPhone || 
      (sale.customerId ? sale.customerId.phone : sale.customerPhone) || 
      sale.customerPhone;    // Validate that we have contact info for requested channels
    if (sendWhatsApp) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp notifications are currently disabled. Please use email notifications only.',
        available: ['email']
      });
    }

    if (sendEmail && !customerEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email sending requested but no email address available'
      });
    }

    // Generate PDF for attachment
    const pdfBuffer = await generateInvoicePDFBuffer(sale);

    // Prepare invoice data for notifications
    const invoiceData = {
      invoiceNumber: sale.invoiceNumber,
      customerName: sale.customerId ? 
        `${sale.customerId.firstName} ${sale.customerId.lastName}` : 
        sale.customerName,
      totalAmount: sale.totalAmount,
      items: sale.items,
      paymentMode: sale.paymentMode,
      createdAt: sale.createdAt
    };    // Send notifications (Email only - WhatsApp disabled)
    const notificationService = new InvoiceNotificationService();
    const results = await notificationService.sendInvoiceNotifications({
      invoiceData,
      pdfBuffer,
      customerEmail,
      customerPhone,
      sendWhatsApp: false, // Force disable WhatsApp
      sendEmail
    });

    // Prepare response
    const response = {
      success: true,
      message: 'Notification sending completed',
      data: {
        invoice: invoiceNumber,
        customer: {
          name: invoiceData.customerName,
          email: customerEmail,
          phone: customerPhone
        },
        notifications: results,
        summary: {
          sent: results.summary.totalSent,
          failed: results.summary.totalFailed,
          channels: results.summary.channels
        }
      }
    };

    // Add specific results to response
    if (results.whatsApp) {
      response.data.whatsApp = {
        requested: sendWhatsApp,
        success: results.whatsApp.success,
        ...(results.whatsApp.success ? {
          messageId: results.whatsApp.messageId,
          status: results.whatsApp.status
        } : {
          error: results.whatsApp.error
        })
      };
    }

    if (results.email) {
      response.data.email = {
        requested: sendEmail,
        success: results.email.success,
        ...(results.email.success ? {
          messageId: results.email.messageId,
          ...(results.email.previewUrl && { previewUrl: results.email.previewUrl })
        } : {
          error: results.email.error
        })
      };
    }

    return res.status(200).json(response);

  } catch (error) {
    logger.error({ err: error }, 'Error sending invoice notifications');
    return res.status(500).json({
      success: false,
      message: 'Failed to send notifications',
      error: error.message
    });
  }
};

/**
 * Export bills/invoices as CSV, XLSX, or PDF
 * @route GET /billing/export?format=csv|xlsx|pdf
 * @access Admin/Owner only
 */
const exportBills = async (req, res) => {
  const { format = 'csv' } = req.query;
  const bills = await Sale.find({}).lean();
  if (!bills || bills.length === 0) {
    return res.status(404).json({ success: false, message: 'No bills found' });
  }
  // Prepare data
  const exportFields = ['invoiceNumber', 'customerName', 'customerPhone', 'totalAmount', 'paymentMode', 'createdAt', 'status'];
  const data = bills.map(b => ({
    invoiceNumber: b.invoiceNumber,
    customerName: b.customerName || (b.customer && b.customer.name) || '',
    customerPhone: b.customerPhone || (b.customer && b.customer.phoneNumber) || '',
    totalAmount: b.totalAmount,
    paymentMode: b.paymentMode,
    createdAt: b.createdAt,
    status: b.status || ''
  }));

  if (format === 'csv') {
    const parser = new Parser({ fields: exportFields });
    const csv = parser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment('bills.csv');
    return res.send(csv);
  } else if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bills');
    worksheet.columns = exportFields.map(f => ({ header: f, key: f }));
    worksheet.addRows(data);
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment('bills.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } else if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.header('Content-Type', 'application/pdf');
    res.attachment('bills.pdf');
    doc.pipe(res);
    doc.fontSize(18).text('Bills/Invoices List', { align: 'center' });
    doc.moveDown();
    data.forEach((row, idx) => {
      doc.fontSize(12).text(`${idx + 1}. ${row.invoiceNumber} | ${row.customerName} | ${row.customerPhone} | ₹${row.totalAmount} | ${row.paymentMode} | ${row.status}`);
    });
    doc.end();
  } else {
    return res.status(400).json({ success: false, message: 'Invalid format. Use csv, xlsx, or pdf.' });
  }
};

/**
 * Generate PDF buffer for invoice (helper function)
 */
const generateInvoicePDFBuffer = async (sale) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // Generate PDF content (reuse existing PDF generation logic)
      generateInvoicePDFContent(doc, sale);
      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Generate PDF content (shared function) - Clean, modern, single-page, sample-inspired
 * @param {PDFDocument} doc
 * @param {Object} sale
 * @param {Object} store - Store info (name, address, phone, email)
 */
const generateInvoicePDFContent = (doc, sale, store) => {
  // --- Color palette (sample-inspired) ---
  const colors = {
    primary: '#F15A29', // Orange highlight
    dark: '#22223B',
    light: '#F8F8F8',
    gray: '#E5E7EB',
    white: '#FFF',
    text: '#22223B',
    textLight: '#6B7280',
    tableHeader: '#F15A29',
    tableHeaderText: '#FFF',
    tableRowAlt: '#F8F8F8',
    totalBg: '#F15A29',
    totalText: '#FFF',
  };
  const margin = 40;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // --- Logo (top right) ---
  doc.save();
  doc.circle(pageWidth - margin - 30, y + 20, 20).fill(colors.primary);
  doc.fillColor(colors.white).fontSize(12).font('Helvetica-Bold').text('LOGO', pageWidth - margin - 48, y + 10, {width: 36, align: 'center'});
  doc.restore();

  // --- Business Info (top left, dynamic from store) ---
  doc.font('Helvetica-Bold').fontSize(22).fillColor(colors.text).text('INVOICE', margin, y);
  y += 32;
  doc.font('Helvetica').fontSize(10).fillColor(colors.text).text(store?.name || 'Business name', margin, y);
  y += 14;
  doc.text(store?.address || 'Business address', margin, y);
  y += 14;
  doc.text(store?.phone || 'Business phone', margin, y);
  y += 14;
  doc.text(store?.email || 'Business email', margin, y);
  y += 14;
  if (store?.website) {
    doc.text(store.website, margin, y, {link: store.website, underline: true, color: colors.primary});
    y += 14;
  }
  if (store?.description) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(colors.textLight).text(store.description, margin, y, {width: 250});
    y += 14;
  }
  // Operating hours (if available)
  if (store?.operatingHours) {
    let hoursText = 'Hours: ';
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let hoursArr = [];
    days.forEach((d, i) => {
      const oh = store.operatingHours[d];
      if (oh && oh.open && oh.close) {
        hoursArr.push(`${dayLabels[i]}: ${oh.open}-${oh.close}`);
      }
    });
    if (hoursArr.length > 0) {
      doc.font('Helvetica').fontSize(9).fillColor(colors.textLight).text(hoursText + hoursArr.join(' | '), margin, y, {width: 300});
      y += 14;
    }
  }
  y += 10;

  // --- Bill To & Invoice Details Row ---
  const leftX = margin;
  const rightX = margin + 250;
  let rowY = y;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.text).text('Bill to:', leftX, rowY);
  doc.font('Helvetica').fontSize(10).fillColor(colors.text).text(sale.customerName || 'Buyer name/business name', leftX, rowY + 14);
  doc.text(sale.customerAddress || 'Buyer address', leftX, rowY + 28);
  doc.text(sale.customerPhone || 'Buyer phone number', leftX, rowY + 42);
  doc.text(sale.customerEmail || 'Buyer email', leftX, rowY + 56);

  doc.font('Helvetica-Bold').fontSize(10).fillColor(colors.text).text('Invoice number:', rightX, rowY + 0);
  doc.font('Helvetica').fontSize(10).fillColor(colors.text).text(sale.invoiceNumber, rightX + 110, rowY + 0);
  doc.font('Helvetica-Bold').text('Invoice date:', rightX, rowY + 14);
  doc.font('Helvetica').text(sale.createdAt ? new Date(sale.createdAt).toLocaleDateString('en-IN') : 'MM/DD/YYYY', rightX + 110, rowY + 14);
  doc.font('Helvetica-Bold').text('Payment due:', rightX, rowY + 28);
  doc.font('Helvetica').text(sale.dueDate ? new Date(sale.dueDate).toLocaleDateString('en-IN') : (sale.createdAt ? new Date(sale.createdAt).toLocaleDateString('en-IN') : 'MM/DD/YYYY'), rightX + 110, rowY + 28);
  y += 80;

  // --- Table Header ---
  doc.roundedRect(margin, y, contentWidth, 22, 4).fill(colors.tableHeader);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(colors.tableHeaderText)
    .text('Item', margin + 8, y + 6)
    .text('Quantity', margin + 200, y + 6)
    .text('Price per unit', margin + 300, y + 6)
    .text('Amount', margin + 420, y + 6);
  y += 22;

  // --- Table Rows ---
  sale.items.forEach((item, idx) => {
    const rowColor = idx % 2 === 0 ? colors.white : colors.tableRowAlt;
    doc.rect(margin, y, contentWidth, 20).fill(rowColor);
    doc.font('Helvetica').fontSize(10).fillColor(colors.text)
      .text(item.itemName, margin + 8, y + 6, {width: 180, ellipsis: true})
      .text(item.quantity.toString(), margin + 200, y + 6)
      .text(`₹${item.unitPrice.toFixed(2)}`, margin + 300, y + 6)
      .text(`₹${item.totalPrice.toFixed(2)}`, margin + 420, y + 6);
    y += 20;
  });

  // --- Table Bottom Border ---
  doc.moveTo(margin, y).lineTo(margin + contentWidth, y).strokeColor(colors.gray).lineWidth(1).stroke();
  y += 8;

  // --- Totals Section ---
  let totalsX = margin + 300;
  doc.font('Helvetica').fontSize(10).fillColor(colors.text)
    .text('Subtotal', totalsX, y);
  doc.text(`₹${sale.subtotal ? sale.subtotal.toFixed(2) : '0.00'}`, totalsX + 100, y, {align: 'right'});
  y += 14;
  doc.text(`Tax ${sale.gstRate ? sale.gstRate + '%' : '0.00%'}`, totalsX, y);
  doc.text(`₹${sale.gst ? sale.gst.toFixed(2) : '0.00'}`, totalsX + 100, y, {align: 'right'});
  y += 14;
  doc.text('Fees', totalsX, y);
  doc.text('₹0.00', totalsX + 100, y, {align: 'right'});
  y += 14;
  doc.text('Discounts', totalsX, y);
  doc.text(`₹${sale.totalDiscount ? sale.totalDiscount.toFixed(2) : '0.00'}`, totalsX + 100, y, {align: 'right'});
  y += 18;
  // --- TOTAL Row ---
  doc.roundedRect(totalsX, y, 140, 24, 4).fill(colors.totalBg);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.totalText).text('TOTAL', totalsX + 10, y + 6);
  doc.text(`₹${sale.totalAmount ? sale.totalAmount.toFixed(2) : '0.00'}`, totalsX + 70, y + 6);
  y += 36;

  // --- Terms and Conditions ---
  doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.text).text('Terms and conditions', margin, y);
  doc.font('Helvetica').fontSize(9).fillColor(colors.textLight).text('Goods once sold will not be taken back or exchanged. Please retain this invoice for warranty/returns. For support, contact hello@smartshop.com', margin, y + 16, {width: contentWidth - 20});
};

module.exports = {
  recordSale,
  getSalesStats,
  getInvoices,
  getInvoiceForPrint,
  getInvoicePDF,
  getCustomerHistory,
  getAvailableStores,
  sendInvoiceNotifications,
  exportBills
};
