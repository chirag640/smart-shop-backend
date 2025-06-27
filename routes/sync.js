const express = require('express');
const router = express.Router();
const { extractSyncContext } = require('../middlewares/sync');
const InventoryItem = require('../models/InventoryItem');
const User = require('../models/User');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');
// Add other models as needed

// Utility to get model by entity name
const entityModelMap = {
  inventory: InventoryItem,
  user: User,
  customers: User, // Use User model for customers
  bills: Sale, // Use Sale model for bills
  expenses: Expense, // Use Expense model for expenses
  // Add more entities here as needed
};

// Utility: log conflicts (simple in-memory, replace with DB or file as needed)
const syncConflicts = [];

function detectConflict(serverDoc, clientDoc) {
  if (!serverDoc) return false;
  if (clientDoc.syncVersion < serverDoc.syncVersion) return true;
  if (clientDoc.syncVersion === serverDoc.syncVersion && new Date(clientDoc.updatedAt) < new Date(serverDoc.updatedAt)) return true;
  return false;
}

// GET /sync/:entity/changes?since=<timestamp>
router.get('/:entity/changes', extractSyncContext, async (req, res) => {
  const { entity } = req.params;
  const { lastSyncedAt } = req.syncContext;
  const Model = entityModelMap[entity];
  if (!Model) return res.status(400).json({ success: false, error: 'Invalid entity' });

  const query = { isDeleted: { $ne: true } };
  if (lastSyncedAt) query.updatedAt = { $gt: lastSyncedAt };

  try {
    const changes = await Model.find(query).lean();
    res.json({ success: true, data: changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /sync/:entity/push
router.post('/:entity/push', extractSyncContext, async (req, res) => {
  const { entity } = req.params;
  const Model = entityModelMap[entity];
  if (!Model) return res.status(400).json({ success: false, error: 'Invalid entity' });

  const records = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];

  for (const record of records) {
    try {
      let serverDoc = null;
      if (record._id) {
        serverDoc = await Model.findById(record._id);
      }
      if (serverDoc && detectConflict(serverDoc, record)) {
        // Conflict: cloud wins, log it
        syncConflicts.push({ entity, id: record._id, deviceId: req.syncContext.deviceId, timestamp: new Date(), serverVersion: serverDoc.syncVersion, clientVersion: record.syncVersion });
        results.push({ _id: record._id, status: 'conflict', resolved: 'cloud', server: serverDoc });
        continue;
      }
      // Upsert by _id if present, else create
      if (record._id) {
        const updated = await Model.findOneAndUpdate(
          { _id: record._id },
          { ...record, deviceId: req.syncContext.deviceId, $inc: { syncVersion: 1 }, updatedAt: new Date() },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        results.push({ _id: updated._id, status: 'updated' });
      } else {
        const created = await Model.create({ ...record, deviceId: req.syncContext.deviceId });
        results.push({ _id: created._id, status: 'created' });
      }
    } catch (err) {
      results.push({ _id: record._id || null, status: 'error', error: err.message });
    }
  }
  res.json({ success: true, results });
});

// GET /sync/:entity/deleted?since=<timestamp>
router.get('/:entity/deleted', extractSyncContext, async (req, res) => {
  const { entity } = req.params;
  const { lastSyncedAt } = req.syncContext;
  const Model = entityModelMap[entity];
  if (!Model) return res.status(400).json({ success: false, error: 'Invalid entity' });

  const query = { isDeleted: true };
  if (lastSyncedAt) query.updatedAt = { $gt: lastSyncedAt };

  try {
    const deleted = await Model.find(query, '_id updatedAt deletedAt').lean();
    res.json({ success: true, data: deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /sync/customers/changes?since=<timestamp>
router.get('/customers/changes', extractSyncContext, async (req, res) => {
  const { lastSyncedAt, deviceId } = req.syncContext;
  const storeId = req.user?.storeId || req.query.storeId;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const query = { role: 'customer', isDeleted: { $ne: true }, 'profile.createdByStore': storeId };
  if (lastSyncedAt) query.updatedAt = { $gt: lastSyncedAt };
  try {
    const changes = await User.find(query).lean();
    res.json({ success: true, data: changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /sync/customers/push
router.post('/customers/push', extractSyncContext, async (req, res) => {
  const storeId = req.user?.storeId || req.body?.storeId || req.query.storeId;
  const createdByStaff = req.user?._id || req.body?.createdByStaff;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const records = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const record of records) {
    try {
      // Fuzzy match: name + phone (case-insensitive, trimmed)
      const name = (record.firstName || '').trim().toLowerCase();
      const phone = (record.phoneNumber || '').replace(/\D/g, '');
      const match = await User.findOne({
        role: 'customer',
        firstName: new RegExp('^' + name + '$', 'i'),
        phoneNumber: new RegExp(phone + '$'),
        'profile.createdByStore': storeId
      });
      if (match) {
        // Merge: update existing
        await User.findByIdAndUpdate(match._id, {
          ...record,
          deviceId: req.syncContext.deviceId,
          $inc: { syncVersion: 1 },
          updatedAt: new Date()
        });
        results.push({ _id: match._id, status: 'merged' });
      } else {
        // Create new
        const created = await User.create({
          ...record,
          role: 'customer',
          'profile.createdByStore': storeId,
          'profile.createdByStaff': createdByStaff,
          deviceId: req.syncContext.deviceId
        });
        results.push({ _id: created._id, status: 'created' });
      }
    } catch (err) {
      results.push({ _id: record._id || null, status: 'error', error: err.message });
    }
  }
  res.json({ success: true, results });
});

// GET /sync/customers/deleted?since=<timestamp>
router.get('/customers/deleted', extractSyncContext, async (req, res) => {
  const { lastSyncedAt } = req.syncContext;
  const storeId = req.user?.storeId || req.query.storeId;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const query = { role: 'customer', isDeleted: true, 'profile.createdByStore': storeId };
  if (lastSyncedAt) query.updatedAt = { $gt: lastSyncedAt };
  try {
    const deleted = await User.find(query, '_id updatedAt deletedAt').lean();
    res.json({ success: true, data: deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /sync/bills/push — Queue and process new bills
router.post('/bills/push', extractSyncContext, async (req, res) => {
  const storeId = req.user?.storeId || req.body?.storeId || req.query.storeId;
  const handledBy = req.user?._id || req.body?.handledBy;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const records = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const record of records) {
    try {
      // Support tempId for offline mapping
      const tempId = record.tempId;
      // Always generate a new invoice number if not present
      if (!record.invoiceNumber) {
        record.invoiceNumber = await Sale.generateInvoiceNumber();
      }
      // Upsert by invoiceNumber (unique)
      let sale = await Sale.findOneAndUpdate(
        { invoiceNumber: record.invoiceNumber },
        { ...record, storeId, handledBy, deviceId: req.syncContext.deviceId, updatedAt: new Date() },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      results.push({ _id: sale._id, invoiceNumber: sale.invoiceNumber, tempId, status: 'synced' });
    } catch (err) {
      results.push({ tempId: record.tempId || null, status: 'error', error: err.message });
    }
  }
  res.json({ success: true, results });
});

// GET /sync/bills/changes?since=... — Cloud-side new bills
router.get('/bills/changes', extractSyncContext, async (req, res) => {
  const { lastSyncedAt } = req.syncContext;
  const storeId = req.user?.storeId || req.query.storeId;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const query = { storeId };
  if (lastSyncedAt) query.updatedAt = { $gt: lastSyncedAt };
  try {
    const bills = await Sale.find(query).lean();
    res.json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /sync/bills/ack — Mark bills as synced
router.post('/bills/ack', extractSyncContext, async (req, res) => {
  const ids = req.body.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No bill IDs provided' });
  }
  try {
    await Sale.updateMany({ _id: { $in: ids } }, { $set: { isSynced: true } });
    res.json({ success: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /sync/expenses/changes
router.get('/expenses/changes', extractSyncContext, async (req, res) => {
  const { lastSyncedAt } = req.syncContext;
  const storeId = req.user?.storeId || req.query.storeId;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const query = { storeId, isDeleted: { $ne: true } };
  if (lastSyncedAt) query.updatedAt = { $gt: lastSyncedAt };
  try {
    const expenses = await Expense.find(query).lean();
    res.json({ success: true, data: expenses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /sync/expenses/push
router.post('/expenses/push', extractSyncContext, async (req, res) => {
  const storeId = req.user?.storeId || req.body?.storeId || req.query.storeId;
  const createdBy = req.user?._id || req.body?.createdBy;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const records = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const record of records) {
    try {
      let attachmentUrl = record.attachmentUrl;
      // If base64 image is provided, upload to Cloudinary
      if (record.attachmentBase64) {
        const uploadRes = await cloudinary.uploader.upload(record.attachmentBase64, {
          folder: `expenses/${storeId}`,
          resource_type: 'image',
          public_id: `expense_${Date.now()}`
        });
        attachmentUrl = uploadRes.secure_url;
      }
      // Upsert by _id if present, else create
      if (record._id) {
        const updated = await Expense.findOneAndUpdate(
          { _id: record._id },
          { ...record, storeId, createdBy, attachmentUrl, deviceId: req.syncContext.deviceId, $inc: { syncVersion: 1 }, updatedAt: new Date() },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        results.push({ _id: updated._id, status: 'updated', attachmentUrl });
      } else {
        const created = await Expense.create({ ...record, storeId, createdBy, attachmentUrl, deviceId: req.syncContext.deviceId });
        results.push({ _id: created._id, status: 'created', attachmentUrl });
      }
    } catch (err) {
      results.push({ _id: record._id || null, status: 'error', error: err.message });
    }
  }
  res.json({ success: true, results });
});

// GET /sync/expenses/deleted?since=<timestamp>
router.get('/expenses/deleted', extractSyncContext, async (req, res) => {
  const { lastSyncedAt } = req.syncContext;
  const storeId = req.user?.storeId || req.query.storeId;
  if (!storeId) return res.status(400).json({ success: false, error: 'Missing storeId' });
  const query = { storeId, isDeleted: true };
  if (lastSyncedAt) query.updatedAt = { $gt: lastSyncedAt };
  try {
    const deleted = await Expense.find(query, '_id updatedAt deletedAt').lean();
    res.json({ success: true, data: deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
