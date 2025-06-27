const { Sale, User, InventoryItem } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Expense = require('../models/Expense');

// GET /reports/sales
const getSalesReport = catchAsync(async (req, res) => {
  let { from, to, day, month, paymentMethod } = req.query;
  const match = {};

  // Date filtering
  if (day) {
    const date = new Date(day);
    match.createdAt = {
      $gte: new Date(date.setHours(0, 0, 0, 0)),
      $lte: new Date(date.setHours(23, 59, 59, 999))
    };
  } else if (month) {
    const [year, mon] = month.split('-');
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 0, 23, 59, 59, 999);
    match.createdAt = { $gte: start, $lte: end };
  } else if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }

  // Payment method filter
  if (paymentMethod) match.paymentMode = paymentMethod;

  // Aggregate sales
  const salesAgg = await Sale.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalAmount' },
              avgBill: { $avg: '$totalAmount' },
              count: { $sum: 1 }
            }
          }
        ],
        topItems: [
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.itemId',
              name: { $first: '$items.itemName' },
              quantity: { $sum: '$items.quantity' },
              revenue: { $sum: '$items.totalPrice' }
            }
          },
          { $sort: { quantity: -1, revenue: -1 } },
          { $limit: 10 }
        ],
        topStaff: [
          {
            $group: {
              _id: '$createdBy',
              salesCount: { $sum: 1 },
              totalRevenue: { $sum: '$totalAmount' }
            }
          },
          { $sort: { totalRevenue: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: 'users',
              localField: '_id',
              foreignField: '_id',
              as: 'staff'
            }
          },
          { $unwind: { path: '$staff', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              salesCount: 1,
              totalRevenue: 1,
              staffName: { $concat: ['$staff.firstName', ' ', '$staff.lastName'] },
              staffEmail: '$staff.email',
              staffRole: '$staff.role'
            }
          }
        ]
      }
    }
  ]);

  const totals = salesAgg[0].totals[0] || { totalRevenue: 0, avgBill: 0, count: 0 };
  const topItems = salesAgg[0].topItems || [];
  const topStaff = salesAgg[0].topStaff || [];

  res.status(200).json({
    success: true,
    data: {
      totalRevenue: totals.totalRevenue,
      averageBillValue: totals.avgBill,
      totalBills: totals.count,
      topItems,
      topStaff
    }
  });
});

/**
 * Generate PDF backup summary (sales, stock, expenses)
 * @route GET /reports/backup-summary
 * @access Owner only
 */
const generateBackupSummaryPDF = catchAsync(async (req, res) => {
  // Fetch summary data
  const totalCustomers = await User.countDocuments({ role: 'customer' });
  const totalItems = await InventoryItem.countDocuments();
  const totalStock = await InventoryItem.aggregate([{ $group: { _id: null, total: { $sum: '$stockQty' } } }]);
  const totalBills = await Sale.countDocuments();
  const totalRevenue = await Sale.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]);
  const totalExpenses = await Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);

  // Prepare PDF
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.header('Content-Type', 'application/pdf');
  res.attachment('backup-summary.pdf');
  doc.pipe(res);

  doc.fontSize(20).text('Backup Summary', { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).text(`Date: ${new Date().toLocaleString()}`);
  doc.moveDown();
  doc.fontSize(12).text(`Total Customers: ${totalCustomers}`);
  doc.text(`Total Inventory Items: ${totalItems}`);
  doc.text(`Total Stock Units: ${totalStock[0]?.total || 0}`);
  doc.text(`Total Bills: ${totalBills}`);
  doc.text(`Total Revenue: ₹${totalRevenue[0]?.total?.toFixed(2) || '0.00'}`);
  doc.text(`Total Expenses: ₹${totalExpenses[0]?.total?.toFixed(2) || '0.00'}`);

  doc.moveDown();
  doc.fontSize(10).text('This PDF provides a summary of your business data for backup and reporting purposes.', { align: 'left' });
  doc.end();
});

module.exports = {
  getSalesReport,
  generateBackupSummaryPDF
};
