const express = require('express');
const {
  createItem,
  getItems,
  getItemById,
  updateItem,
  deleteItem,
  restoreItem,
  updateStock,
  getSelectableItems,
  getItemMetadata,
  exportInventory
} = require('../controllers/inventoryController');
const { authMiddleware, authorize, roleMiddleware } = require('../middlewares/auth');
const { validateInventoryItem, validateStockUpdate, validateInventoryQuery } = require('../middleware/validation');
const { handleImageUpload, optionalImageUpload } = require('../middleware/upload');
const { fileUploadSecurity } = require('../middleware/security');
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

/**
 * @swagger
 * /inventory/selectable:
 *   get:
 *     summary: Get selectable items for billing
 *     description: Return items eligible for selection in billing (only items with stock > 0)
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, brand, or description
 *         example: "Samsung"
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [mostSold, name, stockQty, price, newest]
 *           default: name
 *         description: Sort order
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of items per page
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: storeId
 *         schema:
 *           type: string
 *         description: Filter by store ID (admin only)
 *     responses:
 *       200:
 *         description: Selectable items retrieved successfully
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
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           brand:
 *                             type: string
 *                           sellPrice:
 *                             type: number
 *                           mrpPrice:
 *                             type: number
 *                           stockQty:
 *                             type: integer
 *                           imageUrl:
 *                             type: string
 *                           orderCount:
 *                             type: integer
 *                           discount:
 *                             type: integer
 *                           inStock:
 *                             type: boolean
 *                           lowStock:
 *                             type: boolean
 *                     pagination:
 *                       type: object
 *                     filters:
 *                       type: object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/selectable',
  authMiddleware,
  authorize('staff', 'manager', 'admin', 'superadmin'),
  catchAsync(getSelectableItems)
);

router.get('/items',
  authMiddleware,
  validateInventoryQuery,
  catchAsync(getItems)
);

/**
 * @swagger
 * /inventory/items/{id}/metadata:
 *   get:
 *     summary: Get item metadata for billing
 *     description: Retrieve essential item details by ID for billing screen usage
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
 *         example: "60d0fe4f5311236168a109ca"
 *     responses:
 *       200:
 *         description: Item metadata retrieved successfully
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
 *                     _id:
 *                       type: string
 *                       example: "60d0fe4f5311236168a109ca"
 *                     name:
 *                       type: string
 *                       example: "Product A"
 *                     brand:
 *                       type: string
 *                       example: "Brand X"
 *                     sellPrice:
 *                       type: number
 *                       example: 120
 *                     mrpPrice:
 *                       type: number
 *                       example: 150
 *                     stockQty:
 *                       type: integer
 *                       example: 18
 *                     imageUrl:
 *                       type: string
 *                       example: "https://example.com/image.jpg"
 *                     orderCount:
 *                       type: integer
 *                       example: 52
 *                     discount:
 *                       type: integer
 *                       example: 20
 *                     inStock:
 *                       type: boolean
 *                       example: true
 *                     lowStock:
 *                       type: boolean
 *                       example: false
 *                     isAvailable:
 *                       type: boolean
 *                       example: true
 *                     displayText:
 *                       type: string
 *                       example: "Product A - Brand X"
 *                     priceDisplay:
 *                       type: string
 *                       example: "₹120"
 *       404:
 *         description: Item not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/items/:id/metadata',
  authMiddleware,
  authorize('staff', 'manager', 'admin', 'superadmin'),
  catchAsync(getItemMetadata)
);

router.get('/items/:id',
  authMiddleware,
  catchAsync(getItemById)
);


router.post('/items', 
  uploadLimiter,
  authMiddleware,
  roleMiddleware('owner'),
  optionalImageUpload,
  fileUploadSecurity,
  validateInventoryItem,
  createUserLimiter(60 * 60 * 1000, 10), // 10 items per hour per user
  catchAsync(createItem)
);


router.put('/items/:id',
  uploadLimiter,
  authMiddleware,
  roleMiddleware('owner'),
  optionalImageUpload,
  fileUploadSecurity,
  validateInventoryItem,
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
  authMiddleware,
  roleMiddleware('owner'),
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

// Export inventory items (admin/owner only)
router.get('/export', authorize('admin', 'owner', 'superadmin'), exportInventory);

module.exports = router;
