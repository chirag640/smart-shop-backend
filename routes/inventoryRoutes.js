const express = require('express');
const {
  createItem,
  getItems,
  getItemById,
  updateItem,
  deleteItem,
  restoreItem,
  updateStock
} = require('../controllers/inventoryController');
const { authMiddleware, authorize } = require('../middlewares/auth');
const { validateInventoryItem, validateStockUpdate, validateInventoryQuery } = require('../middleware/validation');
const { handleImageUpload, optionalImageUpload } = require('../middleware/upload');
const { 
  generalLimiter, 
  uploadLimiter, 
  createUserLimiter,
  strictLimiter 
} = require('../middlewares/rateLimiter');
const { catchAsync } = require('../middleware/errorHandler');

const router = express.Router();

// Apply general rate limiting to all inventory routes
router.use(generalLimiter);



router.get('/items',
  authMiddleware,
  validateInventoryQuery,
  catchAsync(getItems)
);


router.get('/items/:id',
  authMiddleware,
  catchAsync(getItemById)
);


router.post('/items', 
  uploadLimiter,
  authMiddleware,
  authorize('admin', 'manager', 'superadmin'),
  optionalImageUpload,
  validateInventoryItem,
  createUserLimiter(60 * 60 * 1000, 10), // 10 items per hour per user
  catchAsync(createItem)
);


router.put('/items/:id',
  uploadLimiter,
  authMiddleware,
  authorize('admin', 'manager', 'superadmin'),
  optionalImageUpload,
  createUserLimiter(60 * 60 * 1000, 20), // 20 updates per hour per user
  catchAsync(updateItem)
);

/**
 * @swagger
 * /inventory/items/{id}:
 *   delete:
 *     summary: Delete inventory item
 *     description: Soft delete an inventory item (or permanent delete for admins)
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Inventory item ID
 *       - in: query
 *         name: permanent
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Permanently delete item (admin only)
 *     responses:
 *       200:
 *         description: Item deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     deletedAt:
 *                       type: string
 *                       format: date-time
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.delete('/items/:id',
  strictLimiter,
  authMiddleware,
  authorize('admin', 'manager', 'superadmin'),
  catchAsync(deleteItem)
);


router.post('/items/:id/restore',
  authMiddleware,
  authorize('admin', 'manager', 'superadmin'),
  catchAsync(restoreItem)
);


router.patch('/items/:id/stock',
  authMiddleware,
  authorize('admin', 'manager', 'staff', 'superadmin'),
  validateStockUpdate,
  createUserLimiter(60 * 60 * 1000, 50), // 50 stock updates per hour per user
  catchAsync(updateStock)
);


router.delete('/items/:id/image',
  authMiddleware,
  authorize('admin', 'manager', 'superadmin'),
  catchAsync(async (req, res) => {
    // Set removeImage flag and call update
    req.body.removeImage = 'true';
    await updateItem(req, res);
  })
);


router.get('/stats',
  authMiddleware,
  authorize('admin', 'manager', 'superadmin'),
  catchAsync(async (req, res) => {
    const InventoryItem = require('../models/InventoryItem');
    
    // Build query based on user role and store access
    const query = { isDeleted: false };
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      query.storeId = req.user.storeId;
    } else if (req.query.storeId) {
      query.storeId = req.query.storeId;
    }
    
    const stats = await InventoryItem.getInventoryValue(query.storeId);
    
    res.status(200).json({
      success: true,
      message: 'Inventory statistics retrieved successfully',
      data: stats
    });
  })
);


router.get('/low-stock',
  authMiddleware,
  authorize('admin', 'manager', 'staff', 'superadmin'),
  catchAsync(async (req, res) => {
    const InventoryItem = require('../models/InventoryItem');
    
    const storeId = req.user.role === 'admin' || req.user.role === 'superadmin' 
      ? req.query.storeId 
      : req.user.storeId;
    
    const lowStockItems = await InventoryItem.findLowStock(storeId)
      .populate('storeId', 'name location')
      .populate('category', 'name')
      .lean();
    
    res.status(200).json({
      success: true,
      message: 'Low stock items retrieved successfully',
      data: lowStockItems,
      count: lowStockItems.length
    });
  })
);


router.get('/out-of-stock',
  authMiddleware,
  authorize('admin', 'manager', 'staff', 'superadmin'),
  catchAsync(async (req, res) => {
    const InventoryItem = require('../models/InventoryItem');
    
    const storeId = req.user.role === 'admin' || req.user.role === 'superadmin'
      ? req.query.storeId 
      : req.user.storeId;
    
    const outOfStockItems = await InventoryItem.findOutOfStock(storeId)
      .populate('storeId', 'name location')
      .populate('category', 'name')
      .lean();
    
    res.status(200).json({
      success: true,
      message: 'Out of stock items retrieved successfully',
      data: outOfStockItems,
      count: outOfStockItems.length
    });
  })
);

module.exports = router;
