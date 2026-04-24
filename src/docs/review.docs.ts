/**
 * @swagger
 * tags:
 *   name: Reviews
 *   description: Reviews and ratings
 */

/**
 * @swagger
 * /reviews:
 *   post:
 *     summary: Submit a review for a completed booking
 *     tags: [Reviews]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId, type, rating, comment]
 *             properties:
 *               bookingId: { type: string }
 *               type:
 *                 type: string
 *                 enum: [renter_to_owner, owner_to_renter, renter_to_item]
 *                 description: >
 *                   renter_to_owner - Renter reviews the owner,
 *                   owner_to_renter - Owner reviews the renter,
 *                   renter_to_item - Renter reviews the item
 *               rating: { type: integer, minimum: 1, maximum: 5, example: 5 }
 *               comment: { type: string, minLength: 10, maxLength: 1000 }
 *     responses:
 *       201:
 *         description: Review submitted
 *       400:
 *         description: Booking not completed or invalid type
 *       409:
 *         description: Review already submitted
 */

/**
 * @swagger
 * /reviews/user/{userId}:
 *   get:
 *     summary: Get all reviews for a user (public)
 *     tags: [Reviews]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Reviews retrieved
 */

/**
 * @swagger
 * /reviews/item/{itemId}:
 *   get:
 *     summary: Get all reviews for an item (public)
 *     tags: [Reviews]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Reviews retrieved
 */

/**
 * @swagger
 * /reviews/my:
 *   get:
 *     summary: Get reviews I have submitted
 *     tags: [Reviews]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Reviews retrieved
 */

/**
 * @swagger
 * /reviews/pending:
 *   get:
 *     summary: Get completed bookings where I have pending reviews to submit
 *     tags: [Reviews]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pending reviews retrieved
 */

/**
 * @swagger
 * /reviews/admin/all:
 *   get:
 *     summary: Get all reviews (admin only)
 *     tags: [Reviews]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Reviews retrieved
 *       401:
 *         description: Unauthorized
 */