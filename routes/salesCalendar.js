const express = require('express');
const { getSalesCalendar } = require('../controllers/salesCalendarController');
const { authMiddleware, authorize } = require('../middlewares/auth');

const router = express.Router();

router.use(authMiddleware);
router.get('/sales-calendar', authorize('manager', 'admin', 'superadmin'), getSalesCalendar);

module.exports = router;
