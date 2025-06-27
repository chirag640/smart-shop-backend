const express = require('express');
const { getReturnsReport } = require('../controllers/returnsReportController');
const { authMiddleware, authorize } = require('../middlewares/auth');

const router = express.Router();

router.use(authMiddleware);
router.get('/returns', authorize('manager', 'admin', 'superadmin'), getReturnsReport);

module.exports = router;
