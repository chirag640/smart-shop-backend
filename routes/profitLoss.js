const express = require('express');
const { getProfitLossReport } = require('../controllers/profitLossController');
const { authMiddleware, authorize } = require('../middlewares/auth');

const router = express.Router();

router.use(authMiddleware);
router.get('/profit-loss', authorize('manager', 'admin', 'superadmin'), getProfitLossReport);

module.exports = router;
