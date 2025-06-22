const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const InventoryItem = require('../models/InventoryItem');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { InvoiceNotificationService } = require('../utils/invoiceNotificationService');

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
          console.log(`Auto-assigned store ${assignedStoreId} for user ${req.user._id}`);
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

          console.log(`📨 Email notification sent for invoice ${sale.invoiceNumber}:`, notificationResults.summary);
          
          // Log WhatsApp skip message if it was requested
          if (sendWhatsApp) {
            console.log('⚠️  WhatsApp notification was requested but is currently disabled');
          }
          
        } catch (notificationError) {
          console.error('Error sending notifications:', notificationError);
          // Don't fail the sale if notifications fail
        }
      } else if (sendWhatsApp) {
        console.log('⚠️  WhatsApp notification requested but service is currently disabled');
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

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Error recording sale:', error);
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
    console.error('Error fetching sales stats:', error);
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
    console.error('Error fetching invoices:', error);
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
      .populate('customerId', 'firstName lastName name email phone address role createdAt')
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
    console.error('Error fetching invoice:', error);
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

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNumber}.pdf"`);
    
    // Pipe PDF to response
    doc.pipe(res);

    // Add company header
    doc.fontSize(20).text('Smart Shop', 50, 50);
    doc.fontSize(10).text('Complete Inventory Management System', 50, 75);
    doc.text('Address: Your Store Address', 50, 90);
    doc.text('Phone: Your Phone Number', 50, 105);
    
    // Add invoice details
    doc.fontSize(16).text('INVOICE', 400, 50);
    doc.fontSize(10);
    doc.text(`Invoice Number: ${sale.invoiceNumber}`, 400, 75);
    doc.text(`Date: ${sale.saleDate.toLocaleDateString()}`, 400, 90);
    doc.text(`Payment Mode: ${sale.paymentMode.toUpperCase()}`, 400, 105);

    // Add customer details
    doc.text('Bill To:', 50, 150);
    doc.text(`${sale.customerName}`, 50, 165);
    if (sale.customerPhone) doc.text(`Phone: ${sale.customerPhone}`, 50, 180);
    if (sale.customerEmail) doc.text(`Email: ${sale.customerEmail}`, 50, 195);

    // Add items table
    let yPosition = 240;
    
    // Table headers
    doc.text('Item', 50, yPosition);
    doc.text('Qty', 200, yPosition);
    doc.text('Price', 250, yPosition);
    doc.text('Total', 350, yPosition);
    
    // Draw line under headers
    doc.moveTo(50, yPosition + 15).lineTo(450, yPosition + 15).stroke();
    yPosition += 25;

    // Add items
    sale.items.forEach(item => {
      doc.text(item.itemName, 50, yPosition);
      doc.text(item.quantity.toString(), 200, yPosition);
      doc.text(`₹${item.unitPrice.toFixed(2)}`, 250, yPosition);
      doc.text(`₹${item.totalPrice.toFixed(2)}`, 350, yPosition);
      yPosition += 20;
    });

    // Add totals
    yPosition += 20;
    doc.moveTo(50, yPosition).lineTo(450, yPosition).stroke();
    yPosition += 15;

    doc.text(`Subtotal: ₹${sale.subtotal.toFixed(2)}`, 300, yPosition);
    yPosition += 15;
    
    if (sale.totalDiscount > 0) {
      doc.text(`Discount: -₹${sale.totalDiscount.toFixed(2)}`, 300, yPosition);
      yPosition += 15;
    }
    
    doc.fontSize(12).text(`Final Amount: ₹${sale.finalAmount.toFixed(2)}`, 300, yPosition);
    
    if (sale.savings > 0) {
      yPosition += 20;
      doc.fontSize(10).text(`You Saved: ₹${sale.savings.toFixed(2)}`, 300, yPosition);
    }

    // Add footer
    doc.fontSize(8);
    doc.text('Thank you for shopping with us!', 50, yPosition + 60);
    doc.text('For support, contact us at support@smartshop.com', 50, yPosition + 75);

    // Finalize PDF
    doc.end();

  } catch (error) {
    console.error('Error generating PDF:', error);
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
    console.error('Error fetching customer history:', error);
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
    console.error('Error fetching stores:', error);
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
    console.error('Error sending invoice notifications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send notifications',
      error: error.message
    });
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
 * Generate PDF content (shared function) - Enhanced with colors and styling
 */
const generateInvoicePDFContent = (doc, sale) => {
  // --- Color palette ---
  const colors = {
    primary: '#6366f1',
    secondary: '#10b981',
    accent: '#f59e0b',
    danger: '#ef4444',
    dark: '#1f2937',
    light: '#f8fafc',
    gray: '#e5e7eb',
    white: '#fff',
    text: '#111827',
    textLight: '#6b7280',
  };
  const margin = 30;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const contentWidth = pageWidth - margin * 2;

  // --- Header with logo and company info ---
  doc.save();
  doc.circle(margin + 25, margin + 25, 20).fill(colors.primary);
  doc.fillColor(colors.white).fontSize(18).font('Helvetica-Bold').text('SS', margin + 13, margin + 15);
  doc.restore();
  doc.fillColor(colors.primary).fontSize(22).font('Helvetica-Bold').text('SMART SHOP', margin + 60, margin + 10);
  doc.fontSize(10).fillColor(colors.textLight).font('Helvetica').text('Complete Inventory Management', margin + 60, margin + 35);
  doc.fontSize(9).text('📞 +91 9876-543-210  |  📧 hello@smartshop.com', margin + 60, margin + 50);
  doc.fontSize(9).text('🌐 www.smartshop.com', margin + 60, margin + 63);

  // --- Invoice/Customer/Payment Details (single row) ---
  let yPos = margin + 70;
  doc.roundedRect(margin, yPos, contentWidth, 48, 8).fill(colors.white);
  doc.fillColor(colors.text).fontSize(10).font('Helvetica-Bold').text('Invoice #', margin + 15, yPos + 8);
  doc.font('Helvetica').text(sale.invoiceNumber, margin + 15, yPos + 22);
  doc.font('Helvetica-Bold').text('Date', margin + 120, yPos + 8);
  doc.font('Helvetica').text(new Date(sale.createdAt).toLocaleDateString('en-IN'), margin + 120, yPos + 22);
  doc.font('Helvetica-Bold').text('Bill To', margin + 250, yPos + 8);
  doc.font('Helvetica').text(sale.customerName, margin + 250, yPos + 22);
  if (sale.customerPhone) doc.font('Helvetica').text(sale.customerPhone, margin + 250, yPos + 34);
  doc.font('Helvetica-Bold').text('Payment', margin + 400, yPos + 8);
  doc.font('Helvetica').text(sale.paymentMode.toUpperCase(), margin + 400, yPos + 22);

  // --- Items Table ---
  yPos += 60;
  doc.roundedRect(margin, yPos, contentWidth, 28, 6).fill(colors.primary);
  doc.fillColor(colors.white).fontSize(10).font('Helvetica-Bold')
    .text('Item', margin + 15, yPos + 8)
    .text('Qty', margin + 250, yPos + 8)
    .text('Rate', margin + 320, yPos + 8)
    .text('Total', margin + 400, yPos + 8);
  yPos += 28;
  sale.items.forEach((item, idx) => {
    const rowColor = idx % 2 === 0 ? colors.light : colors.white;
    doc.roundedRect(margin, yPos, contentWidth, 24, 0).fill(rowColor);
    doc.fillColor(colors.text).fontSize(9).font('Helvetica-Bold').text(item.itemName, margin + 15, yPos + 7);
    doc.font('Helvetica').fontSize(9).fillColor(colors.textLight);
    doc.text(item.quantity.toString(), margin + 250, yPos + 7);
    doc.text(`₹${item.unitPrice.toFixed(2)}`, margin + 320, yPos + 7);
    doc.text(`₹${item.totalPrice.toFixed(2)}`, margin + 400, yPos + 7);
    yPos += 24;
  });

  // --- Totals Section ---
  yPos += 10;
  doc.roundedRect(margin, yPos, contentWidth, 60, 8).fill(colors.white);
  let tY = yPos + 10;
  doc.fontSize(10).font('Helvetica-Bold').fillColor(colors.text).text('Subtotal:', margin + 20, tY);
  doc.font('Helvetica').text(`₹${sale.subtotal.toFixed(2)}`, margin + 120, tY);
  tY += 14;
  if (sale.discount > 0) {
    doc.font('Helvetica-Bold').fillColor(colors.danger).text('Discount:', margin + 20, tY);
    doc.font('Helvetica').text(`-₹${sale.discount.toFixed(2)}`, margin + 120, tY);
    tY += 14;
  }
  if (sale.gst > 0) {
    doc.font('Helvetica-Bold').fillColor(colors.text).text('GST:', margin + 20, tY);
    doc.font('Helvetica').text(`₹${sale.gst.toFixed(2)}`, margin + 120, tY);
    tY += 14;
  }
  doc.font('Helvetica-Bold').fillColor(colors.secondary).text('Total:', margin + 20, tY);
  doc.font('Helvetica-Bold').fillColor(colors.secondary).text(`₹${sale.totalAmount.toFixed(2)}`, margin + 120, tY);
  if (sale.savings > 0) {
    doc.font('Helvetica-Bold').fillColor(colors.accent).text('You Saved:', margin + 250, yPos + 10);
    doc.font('Helvetica-Bold').fillColor(colors.accent).text(`₹${sale.savings.toFixed(2)}`, margin + 340, yPos + 10);
  }

  // --- QR code placeholder (for digital verification) ---
  doc.save();
  doc.roundedRect(pageWidth - margin - 70, yPos, 60, 60, 8).fill(colors.gray);
  doc.fillColor(colors.textLight).fontSize(8).font('Helvetica').text('QR', pageWidth - margin - 50, yPos + 25);
  doc.restore();

  // --- Footer ---
  doc.roundedRect(margin, pageHeight - 60, contentWidth, 40, 8).fill(colors.primary);
  doc.fillColor(colors.white).fontSize(11).font('Helvetica-Bold').text('Thank you for your business!', margin + 20, pageHeight - 50);
  doc.fontSize(8).font('Helvetica').fillColor(colors.light).text('For support: hello@smartshop.com | +91 9876-543-210', margin + 20, pageHeight - 35);
  doc.fontSize(7).fillColor(colors.textLight).text(`Generated: ${new Date().toLocaleString('en-IN')}`, margin, pageHeight - 20);
  doc.fontSize(7).fillColor(colors.textLight).text(`Invoice: ${sale.invoiceNumber}`, margin + 200, pageHeight - 20);
  doc.fontSize(7).fillColor(colors.textLight).text('Page 1 of 1', pageWidth - margin - 50, pageHeight - 20);
};

module.exports = {
  recordSale,
  getSalesStats,
  getInvoices,
  getInvoiceForPrint,
  getInvoicePDF,
  getCustomerHistory,
  getAvailableStores,
  sendInvoiceNotifications
};
