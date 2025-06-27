const express = require('express');
const { createExpense, listExpenses, getExpense, updateExpense, deleteExpense } = require('../controllers/expenseController');
const { authMiddleware, authorize } = require('../middlewares/auth');
const { allowStaffExpenseEdit, recurringOwnerOnly } = require('../middlewares/expense');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const router = express.Router();

router.use(authMiddleware);

// Allow staff to add/edit/delete if toggle is enabled, else only manager/admin/superadmin
router.post('/', allowStaffExpenseEdit, authorize('staff', 'manager', 'admin', 'superadmin'), recurringOwnerOnly, upload.single('attachment'), createExpense);
router.put('/:id', allowStaffExpenseEdit, authorize('staff', 'manager', 'admin', 'superadmin'), recurringOwnerOnly, upload.single('attachment'), updateExpense);
router.delete('/:id', allowStaffExpenseEdit, authorize('staff', 'manager', 'admin', 'superadmin'), deleteExpense);

// Paginated, filtered list
router.get('/', listExpenses);

// Get full details
router.get('/:id', getExpense);

module.exports = router;
