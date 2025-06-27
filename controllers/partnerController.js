const { BusinessPartner } = require('../models');
const { catchAsync } = require('../middleware/errorHandler');

// List all partners (owner only)
const listPartners = catchAsync(async (req, res) => {
  const partners = await BusinessPartner.find({ isActive: true, deletedAt: null })
    .sort({ createdAt: -1 })
    .lean();
  res.status(200).json({ success: true, data: partners });
});

// Add new partner (owner only)
const addPartner = catchAsync(async (req, res) => {
  const { name, contact, businessName, GST, notes } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
  const partner = await BusinessPartner.create({
    name,
    contact,
    businessName,
    GST,
    notes,
    createdBy: req.user._id
  });
  res.status(201).json({ success: true, data: partner });
});

// Update partner (owner only)
const updatePartner = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { name, contact, businessName, GST, notes } = req.body;
  const partner = await BusinessPartner.findByIdAndUpdate(
    id,
    { name, contact, businessName, GST, notes },
    { new: true }
  );
  if (!partner || partner.deletedAt) return res.status(404).json({ success: false, error: 'Partner not found' });
  res.status(200).json({ success: true, data: partner });
});

// Soft delete partner (owner only)
const deletePartner = catchAsync(async (req, res) => {
  const { id } = req.params;
  const partner = await BusinessPartner.findByIdAndUpdate(
    id,
    { isActive: false, deletedAt: new Date() },
    { new: true }
  );
  if (!partner) return res.status(404).json({ success: false, error: 'Partner not found' });
  res.status(200).json({ success: true, message: 'Partner deleted' });
});

module.exports = {
  listPartners,
  addPartner,
  updatePartner,
  deletePartner
};
