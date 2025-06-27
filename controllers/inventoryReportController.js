const { InventoryItem, Sale } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const mongoose = require('mongoose');

// GET /reports/inventory/valuation
const getInventoryValuation = catchAsync(async (req, res) => {
  // Aggregate by category and brand
  const agg = await InventoryItem.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: { category: '$category', brand: '$brand' },
        totalValue: { $sum: { $multiply: ['$purchasePrice', '$stockQty'] } },
        items: { $push: { name: '$name', value: { $multiply: ['$purchasePrice', '$stockQty'] }, stockQty: '$stockQty', purchasePrice: '$purchasePrice', brand: '$brand', category: '$category' } }
      }
    }
  ]);
  const grandTotal = agg.reduce((sum, g) => sum + g.totalValue, 0);
  res.status(200).json({ success: true, data: agg, grandTotal });
});

// GET /reports/inventory/low-stock
const getLowStock = catchAsync(async (req, res) => {
  const { threshold = 5 } = req.query;
  const items = await InventoryItem.find({ isActive: true, stockQty: { $lt: Number(threshold) } })
    .select('name stockQty brand category purchasePrice')
    .lean();
  res.status(200).json({ success: true, data: items });
});

// GET /reports/inventory/dead-stock
const getDeadStock = catchAsync(async (req, res) => {
  const { days = 90 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Find items with no sales in last X days
  const soldItemIds = await Sale.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.itemId' } }
  ]).then(res => res.map(r => r._id.toString()));
  const deadItems = await InventoryItem.find({
    isActive: true,
    _id: { $nin: soldItemIds },
    stockQty: { $gt: 0 }
  }).select('name stockQty brand category purchasePrice').lean();
  res.status(200).json({ success: true, data: deadItems });
});

// GET /reports/inventory/expiry
const getExpiringStock = catchAsync(async (req, res) => {
  const { days = 30 } = req.query;
  const now = new Date();
  const expiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const items = await InventoryItem.find({
    isActive: true,
    expiryDate: { $lte: expiryDate, $gte: now },
    stockQty: { $gt: 0 }
  })
    .select('name stockQty brand category purchasePrice expiryDate')
    .lean();
  res.status(200).json({ success: true, data: items });
});

module.exports = {
  getInventoryValuation,
  getLowStock,
  getDeadStock,
  getExpiringStock
};
