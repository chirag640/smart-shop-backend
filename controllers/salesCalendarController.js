const { Sale } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');

// GET /reports/sales-calendar?month=YYYY-MM
const getSalesCalendar = catchAsync(async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, error: 'month param required as YYYY-MM' });
  }
  const [year, mon] = month.split('-');
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 0, 23, 59, 59, 999);

  const sales = await Sale.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
        },
        total: { $sum: '$totalAmount' },
        bills: { $sum: 1 }
      }
    },
    { $sort: { '_id': 1 } }
  ]);

  // Format as { 'YYYY-MM-DD': { total, bills }, ... }
  const result = {};
  sales.forEach(day => {
    result[day._id] = { total: day.total, bills: day.bills };
  });

  res.status(200).json({ success: true, data: result });
});

module.exports = { getSalesCalendar };
