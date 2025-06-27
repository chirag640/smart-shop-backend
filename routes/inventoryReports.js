const express = require('express');
const { getInventoryValuation, getLowStock, getDeadStock, getExpiringStock } = require('../controllers/inventoryReportController');
const { authMiddleware, authorize } = require('../middlewares/auth');

const router = express.Router();

router.use(authMiddleware);
router.get('/valuation', authorize('manager', 'admin', 'superadmin'), getInventoryValuation);
router.get('/low-stock', authorize('manager', 'admin', 'superadmin'), getLowStock);
router.get('/dead-stock', authorize('manager', 'admin', 'superadmin'), getDeadStock);
router.get('/expiry', authorize('manager', 'admin', 'superadmin'), getExpiringStock);

module.exports = router;
