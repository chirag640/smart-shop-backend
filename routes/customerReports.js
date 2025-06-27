const express = require('express');
const { getTopSpenders, getOutstandingCredit, getInactiveCustomers } = require('../controllers/customerReportController');
const { authMiddleware, authorize } = require('../middlewares/auth');

const router = express.Router();

router.use(authMiddleware);
router.get('/top-spenders', authorize('manager', 'admin', 'superadmin'), getTopSpenders);
router.get('/outstanding-credit', authorize('manager', 'admin', 'superadmin'), getOutstandingCredit);
router.get('/inactive', authorize('manager', 'admin', 'superadmin'), getInactiveCustomers);

module.exports = router;
