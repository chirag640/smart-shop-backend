const { Sale, Expense, InventoryItem } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const mongoose = require('mongoose');

// GET /reports/profit-loss
const getProfitLossReport = catchAsync(async (req, res) => {
  let { month, category, store } = req.query;
  const match = {};
  const expenseMatch = { isDeleted: false };

  // Date filtering
  if (month) {
    const [year, mon] = month.split('-');
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 0, 23, 59, 59, 999);
    match.createdAt = { $gte: start, $lte: end };
    expenseMatch.date = { $gte: start, $lte: end };
  }
  if (store) match.storeId = mongoose.Types.ObjectId(store);
  if (category) match['items.category'] = category;

  // Revenue and COGS
  const salesAgg = await Sale.aggregate([
    { $match: match },
    { $unwind: '$items' },
    ...(category ? [{ $match: { 'items.category': category } }] : []),
    {
      $lookup: {
        from: 'inventoryitems',
        localField: 'items.itemId',
        foreignField: '_id',
        as: 'itemDetails'
      }
    },
    { $unwind: { path: '$itemDetails', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$items.totalPrice' },
        cogs: { $sum: { $multiply: ['$itemDetails.purchasePrice', '$items.quantity'] } },
        totalQty: { $sum: '$items.quantity' }
      }
    }
  ]);

  const revenue = salesAgg[0]?.revenue || 0;
  const cogs = salesAgg[0]?.cogs || 0;
  const grossProfit = revenue - cogs;
  const grossMargin = revenue ? (grossProfit / revenue) * 100 : 0;

  // Expenses
  if (store) expenseMatch.storeId = mongoose.Types.ObjectId(store);
  if (category) expenseMatch.category = category;
  const expensesAgg = await Expense.aggregate([
    { $match: expenseMatch },
    { $group: { _id: null, totalExpenses: { $sum: '$amount' } } }
  ]);
  const totalExpenses = expensesAgg[0]?.totalExpenses || 0;

  const netProfit = grossProfit - totalExpenses;
  const netMargin = revenue ? (netProfit / revenue) * 100 : 0;

  res.status(200).json({
    success: true,
    data: {
      revenue,
      cogs,
      grossProfit,
      grossMargin: Number(grossMargin.toFixed(2)),
      totalExpenses,
      netProfit,
      netMargin: Number(netMargin.toFixed(2))
    }
  });
});

module.exports = { getProfitLossReport };
