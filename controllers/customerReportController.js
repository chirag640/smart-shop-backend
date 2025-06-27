const { Sale, User } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const mongoose = require('mongoose');

// GET /reports/customers/top-spenders
const getTopSpenders = catchAsync(async (req, res) => {
  let { from, to, limit = 10 } = req.query;
  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }
  const agg = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$customerId',
        totalSpent: { $sum: '$totalAmount' },
        bills: { $sum: 1 }
      }
    },
    { $sort: { totalSpent: -1 } },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'customer'
      }
    },
    { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        totalSpent: 1,
        bills: 1,
        name: { $concat: ['$customer.firstName', ' ', '$customer.lastName'] },
        email: '$customer.email',
        phone: '$customer.phoneNumber'
      }
    }
  ]);
  res.status(200).json({ success: true, data: agg });
});

// GET /reports/customers/outstanding-credit
const getOutstandingCredit = catchAsync(async (req, res) => {
  const customers = await User.find({ role: 'customer', creditBalance: { $gt: 0 } })
    .select('firstName lastName email phoneNumber creditBalance lastTransactionAt')
    .lean();
  res.status(200).json({ success: true, data: customers });
});

// GET /reports/customers/inactive
const getInactiveCustomers = catchAsync(async (req, res) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Find customers with no sales in last X days
  const activeCustomerIds = await Sale.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$customerId' } }
  ]).then(res => res.map(r => r._id.toString()));
  const inactive = await User.find({
    role: 'customer',
    _id: { $nin: activeCustomerIds }
  }).select('firstName lastName email phoneNumber lastLoginAt').lean();
  res.status(200).json({ success: true, data: inactive });
});

module.exports = {
  getTopSpenders,
  getOutstandingCredit,
  getInactiveCustomers
};
