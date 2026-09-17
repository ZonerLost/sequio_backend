/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin panel endpoints (admin role required)
 */

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get platform-wide statistics
 *     description: >
 *       All figures are all-time except users.new, bookings.byDeliveryType and
 *       bookings.byBookingType, which count documents created between start and end
 *       (all-time when omitted). Bookings created before bookingType existed count as request.
 *     parameters:
 *       - in: query
 *         name: start
 *         schema: { type: string, format: date-time }
 *         description: Range start (inclusive), ISO 8601
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date-time }
 *         description: Range end (inclusive), ISO 8601
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Platform stats retrieved
 *         content:
 *           application/json:
 *             example:
 *               data:
 *                 range: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-30T23:59:59.999Z" }
 *                 users: { total: 100, active: 95, banned: 5, new: 12 }
 *                 items: { total: 200, active: 180 }
 *                 bookings: { total: 500, completed: 300, pending: 50, byDeliveryType: { delivery: 7, pickup: 13 }, byBookingType: { instant: 4, request: 16 } }
 *                 revenue: { total: 15000, currency: CAD }
 *                 eco: { totalCO2Saved: 2500 }
 */

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [user, admin] }
 *       - in: query
 *         name: isBanned
 *         schema: { type: string, enum: ["true", "false"] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Users retrieved
 */

/**
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     summary: Get user details
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User retrieved
 */

/**
 * @swagger
 * /admin/users/{id}/role:
 *   put:
 *     summary: Update user role
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [user, admin] }
 *     responses:
 *       200:
 *         description: Role updated
 */

/**
 * @swagger
 * /admin/users/{id}/identity-doc:
 *   get:
 *     summary: Get pre-signed URL to view user's identity document
 *     description: Returns a temporary URL (15 min) to view the private identity document stored in S3. Admin only.
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Signed URL generated
 *         content:
 *           application/json:
 *             example:
 *               data:
 *                 signedUrl: "https://zonerlost-media.s3.amazonaws.com/identity-docs/abc.png?X-Amz-Expires=900&..."
 *                 expiresInSeconds: 900
 *       404:
 *         description: User not found or no document uploaded
 *
 * /admin/users/{id}/verify-identity:
 *   put:
 *     summary: Approve or reject a user's identity verification
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, reject]
 *                 example: approve
 *     responses:
 *       200:
 *         description: Identity approved or rejected
 *       400:
 *         description: Invalid action
 *       404:
 *         description: User not found
 */

/**
 * @swagger
 * /admin/users/{id}/ban:
 *   put:
 *     summary: Ban a user
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User banned
 */

/**
 * @swagger
 * /admin/users/{id}/unban:
 *   put:
 *     summary: Unban a user
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User unbanned
 */

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     summary: Deactivate a user account
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User deactivated
 */

/**
 * @swagger
 * /admin/items:
 *   get:
 *     summary: List all items
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: ["true", "false"] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Items retrieved
 */

/**
 * @swagger
 * /admin/items/{id}/feature:
 *   put:
 *     summary: Mark an item as featured
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               featuredUntil: { type: string, format: date, example: "2026-05-01" }
 *     responses:
 *       200:
 *         description: Item featured
 */

/**
 * @swagger
 * /admin/items/{id}/deactivate:
 *   put:
 *     summary: Deactivate an item listing
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Item deactivated
 */

/**
 * @swagger
 * /admin/bookings:
 *   get:
 *     summary: List all bookings
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, accepted, active, completed, declined, cancelled]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Bookings retrieved
 */

/**
 * @swagger
 * /admin/bookings/{id}:
 *   get:
 *     summary: Get booking details
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking retrieved
 */

/**
 * @swagger
 * /admin/payments:
 *   get:
 *     summary: List all payments
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed, refunded]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Payments retrieved
 */

/**
 * @swagger
 * /admin/payments/{id}/refund:
 *   put:
 *     summary: Refund a payment
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Payment refunded
 */