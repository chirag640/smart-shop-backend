const { Expense } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');
const { uploadToCloudinary } = require('../utils/imageUtils');

// POST /expenses - Create expense (with file upload)
const createExpense = catchAsync(async (req, res) => {
  let attachmentUrl = undefined;
  if (req.file) {
    const result = await uploadToCloudinary(req.file.path, { folder: 'expenses' });
    attachmentUrl = result.secure_url;
  }
  const expense = await Expense.create({
    ...req.body,
    attachmentUrl,
    createdBy: req.user._id
  });
  res.status(201).json({ success: true, data: expense });
});

// GET /expenses - Paginated, filtered list
const listExpenses = catchAsync(async (req, res) => {
  let {
    page = 1,
    limit = 20,
    tags,
    minAmount,
    maxAmount,
    from,
    to,
    category,
    paidBy,
    vendorId,
    truckId,
    recurring
  } = req.query;
  page = Math.max(1, parseInt(page));
  limit = Math.max(1, Math.min(100, parseInt(limit)));

  const query = { isDeleted: false };
  if (category) query.category = category;
  if (paidBy) query.paidBy = paidBy;
  if (tags) query.tags = { $in: tags.split(',') };
  if (vendorId) query.vendorId = vendorId;
  if (truckId) query.truckId = truckId;
  if (recurring !== undefined) query.recurring = recurring === 'true';
  if (minAmount || maxAmount) {
    query.amount = {};
    if (minAmount) query.amount.$gte = Number(minAmount);
    if (maxAmount) query.amount.$lte = Number(maxAmount);
  }
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = new Date(from);
    if (to) query.date.$lte = new Date(to);
  }

  const totalItems = await Expense.countDocuments(query);
  const totalPages = Math.ceil(totalItems / limit);
  const expenses = await Expense.find(query)
    .skip((page - 1) * limit)
    .limit(limit)
    .sort({ date: -1 })
    .lean();

  res.status(200).json({
    success: true,
    data: expenses,
    meta: {
      page,
      limit,
      totalItems,
      totalPages
    }
  });
});

// GET /expenses/:id - Full details
const getExpense = catchAsync(async (req, res) => {
  const expense = await Expense.findById(req.params.id).lean();
  if (!expense || expense.isDeleted) return res.status(404).json({ success: false, error: 'Expense not found' });
  res.status(200).json({ success: true, data: expense });
});

// PUT /expenses/:id - Edit all fields
const updateExpense = catchAsync(async (req, res) => {
  let update = { ...req.body };
  if (req.file) {
    const result = await uploadToCloudinary(req.file.path, { folder: 'expenses' });
    update.attachmentUrl = result.secure_url;
  }
  const expense = await Expense.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!expense || expense.isDeleted) return res.status(404).json({ success: false, error: 'Expense not found' });
  res.status(200).json({ success: true, data: expense });
});

// DELETE /expenses/:id - Soft delete
const deleteExpense = catchAsync(async (req, res) => {
  const expense = await Expense.findByIdAndUpdate(req.params.id, { isDeleted: true }, { new: true });
  if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });
  res.status(200).json({ success: true, message: 'Expense deleted' });
});

module.exports = {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  deleteExpense
};
