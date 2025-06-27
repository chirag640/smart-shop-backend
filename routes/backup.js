const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { Parser: Json2csvParser } = require('json2csv');
const mongoose = require('mongoose');
const User = require('../models/User');
const InventoryItem = require('../models/InventoryItem');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');
const { validateCustomerCreation } = require('../middleware/validation');
const { validateInventoryItem } = require('../middleware/validation');

// Helper: fetch all data for export
async function fetchAllData() {
  const customers = await User.find({ role: 'customer' }).lean();
  const items = await InventoryItem.find().lean();
  const bills = await Sale.find().lean();
  const expenses = await Expense.find().lean();
  return { customers, items, bills, expenses };
}

// GET /backup/export?format=csv|json
router.get('/export', authMiddleware, roleMiddleware('owner'), async (req, res) => {
  const format = req.query.format || 'json';
  const { customers, items, bills, expenses } = await fetchAllData();

  if (format === 'json') {
    // Zip all JSON files
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename=backup-json.zip');
    const archive = archiver('zip');
    archive.pipe(res);
    archive.append(JSON.stringify(customers, null, 2), { name: 'customers.json' });
    archive.append(JSON.stringify(items, null, 2), { name: 'items.json' });
    archive.append(JSON.stringify(bills, null, 2), { name: 'bills.json' });
    archive.append(JSON.stringify(expenses, null, 2), { name: 'expenses.json' });
    archive.finalize();
  } else if (format === 'csv') {
    // Zip all CSV files
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename=backup-csv.zip');
    const archive = archiver('zip');
    archive.pipe(res);
    const csvOpts = { header: true };
    archive.append(new Json2csvParser(csvOpts).parse(customers), { name: 'customers.csv' });
    archive.append(new Json2csvParser(csvOpts).parse(items), { name: 'items.csv' });
    archive.append(new Json2csvParser(csvOpts).parse(bills), { name: 'bills.csv' });
    archive.append(new Json2csvParser(csvOpts).parse(expenses), { name: 'expenses.csv' });
    archive.finalize();
  } else {
    res.status(400).json({ success: false, error: 'Invalid format' });
  }
});

// Import tool (admin only): POST /backup/import
router.post('/import', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  // Accepts JSON body: { customers, items, bills, expenses }
  const { customers, items, bills, expenses } = req.body || {};
  if (!customers && !items && !bills && !expenses) {
    return res.status(400).json({ success: false, error: 'No data provided for import' });
  }
  let imported = { customers: 0, items: 0, bills: 0, expenses: 0 };
  let errors = [];
  // Customers
  if (Array.isArray(customers)) {
    for (const c of customers) {
      try {
        await validateCustomerObj(c);
        await User.updateOne(
          { $or: [{ email: c.email }, { phoneNumber: c.phoneNumber }] },
          { $set: c },
          { upsert: true }
        );
        imported.customers++;
      } catch (e) { errors.push({ type: 'customer', data: c, error: e.message }); }
    }
  }
  // Items
  if (Array.isArray(items)) {
    for (const i of items) {
      try {
        await validateInventoryObj(i);
        await InventoryItem.updateOne(
          { sku: i.sku },
          { $set: i },
          { upsert: true }
        );
        imported.items++;
      } catch (e) { errors.push({ type: 'item', data: i, error: e.message }); }
    }
  }
  // Bills
  if (Array.isArray(bills)) {
    for (const b of bills) {
      try {
        await validateBillObj(b);
        await Sale.updateOne(
          { invoiceNumber: b.invoiceNumber },
          { $set: b },
          { upsert: true }
        );
        imported.bills++;
      } catch (e) { errors.push({ type: 'bill', data: b, error: e.message }); }
    }
  }
  // Expenses
  if (Array.isArray(expenses)) {
    for (const ex of expenses) {
      try {
        await validateExpenseObj(ex);
        await Expense.updateOne(
          { _id: ex._id },
          { $set: ex },
          { upsert: true }
        );
        imported.expenses++;
      } catch (e) { errors.push({ type: 'expense', data: ex, error: e.message }); }
    }
  }
  res.json({ success: true, imported, errors });
});

// Helper: validate a customer object
async function validateCustomerObj(obj) {
  // Required: firstName, lastName, email, phoneNumber
  if (!obj.firstName || !obj.lastName || !obj.email || !obj.phoneNumber) {
    throw new Error('Customer missing required fields');
  }
  // Email format
  if (!/^.+@.+\..+$/.test(obj.email)) throw new Error('Invalid email');
  // Phone format (basic)
  if (!/^\+?\d{10,15}$/.test(obj.phoneNumber)) throw new Error('Invalid phone number');
}

// Helper: validate an inventory item object
async function validateInventoryObj(obj) {
  if (!obj.name || !obj.brand || !obj.sku || !obj.stockQty) throw new Error('Item missing required fields');
  if (typeof obj.stockQty !== 'number' || obj.stockQty < 0) throw new Error('Invalid stockQty');
}

// Helper: validate a bill object
async function validateBillObj(obj) {
  if (!obj.invoiceNumber || !obj.totalAmount) throw new Error('Bill missing required fields');
  if (typeof obj.totalAmount !== 'number' || obj.totalAmount < 0) throw new Error('Invalid totalAmount');
}

// Helper: validate an expense object
async function validateExpenseObj(obj) {
  if (!obj.amount || typeof obj.amount !== 'number' || obj.amount < 0) throw new Error('Expense missing/invalid amount');
}

// TODO: Add granular validation for import tool
// Example: validate required fields, types, and constraints for each entity before upsert
// This can be done by using existing validation logic or custom checks per entity
// For now, basic upsert is implemented. For production, add per-entity validation here.

module.exports = router;
