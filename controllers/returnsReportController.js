const { Sale, User } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const mongoose = require('mongoose');

// GET /reports/returns
const getReturnsReport = catchAsync(async (req, res) => {
  let { staff, customer, from, to } = req.query;
  const match = { isRefunded: true };
  if (staff) match.createdBy = mongoose.Types.ObjectId(staff);
  if (customer) match.customerId = mongoose.Types.ObjectId(customer);
  if (from || to) {
    match.refundDate = {};
    if (from) match.refundDate.$gte = new Date(from);
    if (to) match.refundDate.$lte = new Date(to);
  }

  const agg = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRefunded: { $sum: '$refundAmount' },
        bills: { $sum: 1 }
      }
    }
  ]);
  const refunds = await Sale.find(match)
    .select('invoiceNumber refundAmount refundReason refundDate createdBy customerId')
    .populate('createdBy', 'firstName lastName email')
    .populate('customerId', 'firstName lastName email phoneNumber')
    .lean();
  res.status(200).json({
    success: true,
    data: {
      totalRefunded: agg[0]?.totalRefunded || 0,
      bills: agg[0]?.bills || 0,
      refunds
    }
  });
});

module.exports = { getReturnsReport };
