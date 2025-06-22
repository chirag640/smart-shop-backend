const express = require('express');
const {
  searchCustomers,
  getCustomerById,
  getRecentCustomers,
  createCustomer,
  checkCustomerByPhone,
  quickCreateCustomer
} = require('../controllers/customerController');
const { authMiddleware, authorize } = require('../middlewares/auth');
const { 
  validateCustomerCreation, 
  validateQuickCustomerCreation, 
  validatePhoneCheck 
} = require('../middleware/validation');
const { generalLimiter } = require('../middlewares/rateLimiter');
const { catchAsync } = require('../middleware/errorHandler');

const router = express.Router();

// Apply rate limiting to all customer routes
router.use(generalLimiter);

// All customer routes require authentication and staff+ privileges
router.use(authMiddleware);
router.use(authorize('staff', 'manager', 'admin', 'superadmin'));

/**
 * @swagger
 * /customers/search:
 *   get:
 *     summary: Search customers with typeahead support
 *     description: Search customers by name, email, or phone with fuzzy matching support
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query (minimum 2 characters)
 *         example: "john doe"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 10
 *         description: Maximum number of results
 *       - in: query
 *         name: fuzzy
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Enable fuzzy matching for typo tolerance
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include inactive customers in results
 *     responses:
 *       200:
 *         description: Customer search results
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
 *                     customers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           firstName:
 *                             type: string
 *                           lastName:
 *                             type: string
 *                           email:
 *                             type: string
 *                           phoneNumber:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                           displayText:
 *                             type: string
 *                           searchScore:
 *                             type: number
 *                           isActive:
 *                             type: boolean
 *                     query:
 *                       type: string
 *                     fuzzySearch:
 *                       type: boolean
 *                     total:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/search', catchAsync(searchCustomers));

/**
 * @swagger
 * /customers/recent:
 *   get:
 *     summary: Get recently active customers
 *     description: Retrieve a list of recently active customers
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: Recent customers retrieved
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
 *                     customers:
 *                       type: array
 *                     total:
 *                       type: integer
 */
router.get('/recent', catchAsync(getRecentCustomers));

/**
 * @swagger
 * /customers/check-phone:
 *   get:
 *     summary: Check if customer exists by phone number
 *     description: Verify if a customer already exists with the given phone number
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: phone
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 10
 *         description: Phone number to check
 *         example: "+1234567890"
 *     responses:
 *       200:
 *         description: Phone number check completed
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
 *                     exists:
 *                       type: boolean
 *                     customer:
 *                       type: object
 *                       description: "Customer details if found"
 *                     suggestedAction:
 *                       type: string
 *                       description: "Suggested action if customer not found"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
router.get('/check-phone', validatePhoneCheck, catchAsync(checkCustomerByPhone));

/**
 * @swagger
 * /customers/{id}:
 *   get:
 *     summary: Get customer details by ID
 *     description: Retrieve detailed information about a specific customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer details retrieved
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/:id', catchAsync(getCustomerById));

/**
 * @swagger
 * /customers:
 *   post:
 *     summary: Create new customer
 *     description: Create a new customer with phone number auto-fill support
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - phoneNumber
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 example: "Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@email.com"
 *               phoneNumber:
 *                 type: string
 *                 example: "+1234567890"
 *               whatsappNumber:
 *                 type: string
 *                 example: "+1234567890"
 *               sameAsWhatsapp:
 *                 type: boolean
 *                 default: false
 *                 description: "Auto-fill phone number with WhatsApp number"
 *               address:
 *                 type: string
 *                 example: "123 Main St, City, State"
 *               notes:
 *                 type: string
 *                 example: "VIP customer"
 *     responses:
 *       201:
 *         description: Customer created successfully
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
 *                     fullName:
 *                       type: string
 *                     displayText:
 *                       type: string
 *                     tempPassword:
 *                       type: string
 *                       description: "Temporary password for the customer"
 *       409:
 *         description: Customer already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     existingCustomer:
 *                       type: object
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
router.post('/', validateCustomerCreation, catchAsync(createCustomer));

/**
 * @swagger
 * /customers/quick-create:
 *   post:
 *     summary: Quick customer creation for sales flow
 *     description: Simplified customer creation with automatic name splitting
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - phoneNumber
 *             properties:
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *                 description: "Full name (will be split into first and last name)"
 *               phoneNumber:
 *                 type: string
 *                 example: "+1234567890"
 *               whatsappNumber:
 *                 type: string
 *                 example: "+1234567890"
 *               sameAsWhatsapp:
 *                 type: boolean
 *                 default: false
 *                 description: "Use WhatsApp number as phone number"
 *     responses:
 *       201:
 *         description: Customer created successfully
 *       409:
 *         description: Customer already exists
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
router.post('/quick-create', validateQuickCustomerCreation, catchAsync(quickCreateCustomer));

module.exports = router;
