const express = require('express');
const {
  listPartners,
  addPartner,
  updatePartner,
  deletePartner
} = require('../controllers/partnerController');
const { authMiddleware, authorize } = require('../middlewares/auth');

const router = express.Router();

// All routes require owner (superadmin) only
router.use(authMiddleware);
router.use(authorize('superadmin'));

router.get('/', listPartners);
router.post('/', addPartner);
router.put('/:id', updatePartner);
router.delete('/:id', deletePartner);

module.exports = router;
