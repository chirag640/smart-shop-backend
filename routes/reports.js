const express = require('express');
const { getSalesReport, generateBackupSummaryPDF } = require('../controllers/reportController');
const { authMiddleware, roleMiddleware } = require('../middlewares/auth');

const router = express.Router();

router.use(authMiddleware);
router.get('/sales', roleMiddleware('owner'), getSalesReport);
router.get('/backup-summary', roleMiddleware('owner'), generateBackupSummaryPDF);

module.exports = router;
