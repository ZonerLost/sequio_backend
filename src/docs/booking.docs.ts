/**
 * @swagger
 * tags:
 *   name: Bookings
 *   description: Booking management
 */

/**
 * @swagger
 * /bookings/quote:
 *   post:
 *     summary: Calculate price quote before booking
 *     description: |
 *       Returns the full price breakdown, and the same numbers a booking will be created with.
 *
 *       **Atussa's pricing** (one source of truth: `src/helpers/pricing.helper.ts`)
 *
 *       - **Renter** pays the rental + delivery + an **Atussa Fee** of 3% of the rental amount with a
 *         **$3.99 minimum**, plus TPS (5%) and TVQ (9.975%) on that fee.
 *       - **Owner** is paid 85% of the rental amount, less TPS and TVQ on Atussa's 15% commission,
 *         **plus the delivery fee in full** — delivery carries neither the commission nor the fee.
 *       - **No security deposit.**
 *
 *       On a $100 rental with no delivery: the renter pays **$104.59**
 *       (100 + 3.99 + 0.20 + 0.40) and the owner receives **$82.75** (100 − 15 − 0.75 − 1.50).
 *       Atussa keeps $18.99 and remits $2.85 of tax.
 *
 *       `pricing.renterFee.minimumApplied` tells the UI whether the $3.99 floor was used instead of
 *       3%. `atussaFeeExplainer` is the exact sentence to show behind the "?" next to Atussa Fee, so
 *       the wording lives in one place.
 *
 *       Bookings created before 2026-09-29 carry the old shape (5% fee, $100 deposit, no owner split)
 *       and are never recalculated — a stored price is the price that was agreed.
 *     tags: [Bookings]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dailyRate, startDate, endDate, deliveryType]
 *             properties:
 *               dailyRate: { type: number, example: 25 }
 *               startDate: { type: string, format: date, example: "2026-04-01" }
 *               endDate: { type: string, format: date, example: "2026-04-05" }
 *               deliveryType: { type: string, enum: [pickup, delivery] }
 *               discountCode: { type: string, example: "WELCOME10" }
 *     responses:
 *       200:
 *         description: Quote calculated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalDays: { type: integer }
 *                     deliveryFee: { type: number }
 *                     atussaFeeExplainer: { type: string }
 *                     pricing:
 *                       type: object
 *                       properties:
 *                         currency: { type: string, example: CAD }
 *                         rentalAmount: { type: number, example: 100 }
 *                         deliveryFee: { type: number, example: 0 }
 *                         subtotal: { type: number, example: 100 }
 *                         serviceFee: { type: number, example: 3.99, description: The Atussa Fee, under its original field name }
 *                         securityDeposit: { type: number, example: 0 }
 *                         totalAmount: { type: number, example: 104.59, description: What the renter pays, taxes included }
 *                         taxTotal: { type: number, example: 2.85 }
 *                         taxes:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               code: { type: string, example: TPS }
 *                               label: { type: string, example: TPS (GST) }
 *                               rate: { type: number, example: 0.05 }
 *                               amount: { type: number, example: 0.2 }
 *                               appliedTo: { type: string, enum: [atussa_fee, owner_commission] }
 *                         renterFee:
 *                           type: object
 *                           properties:
 *                             percent: { type: number, example: 3 }
 *                             minimum: { type: number, example: 3.99 }
 *                             amount: { type: number, example: 3.99 }
 *                             taxTotal: { type: number, example: 0.6 }
 *                             minimumApplied: { type: boolean, example: true }
 *                         ownerPayout:
 *                           type: object
 *                           properties:
 *                             commissionPercent: { type: number, example: 15 }
 *                             commission: { type: number, example: 15 }
 *                             commissionTaxTotal: { type: number, example: 2.25 }
 *                             amount: { type: number, example: 82.75, description: What the owner receives }
 *                         platform:
 *                           type: object
 *                           properties:
 *                             revenue: { type: number, example: 18.99 }
 *                             taxCollected: { type: number, example: 2.85 }
 *       400:
 *         description: Invalid body — endDate must be after startDate, dailyRate must be positive
 */

/**
 * @swagger
 * /bookings:
 *   post:
 *     summary: Create a booking request
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, startDate, endDate, deliveryType]
 *             properties:
 *               itemId: { type: string }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               deliveryType: { type: string, enum: [pickup, delivery] }
 *               deliveryAddress:
 *                 type: object
 *                 properties:
 *                   label: { type: string, example: "Home Address" }
 *                   street: { type: string }
 *                   city: { type: string }
 *                   province: { type: string }
 *               pickupTimeFrom: { type: string, example: "09:00 AM" }
 *               pickupTimeTo: { type: string, example: "06:00 PM" }
 *               discountCode: { type: string }
 *     responses:
 *       201:
 *         description: Booking request sent
 *       400:
 *         description: Validation error or date conflict
 *       409:
 *         description: Item already booked for selected dates
 */

/**
 * @swagger
 * /bookings/sent:
 *   get:
 *     summary: Get my bookings as renter
 *     tags: [Bookings]
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
 * /bookings/received:
 *   get:
 *     summary: Get bookings received as item owner
 *     tags: [Bookings]
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
 * /bookings/{id}:
 *   get:
 *     summary: Get booking details
 *     tags: [Bookings]
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
 *       403:
 *         description: Access denied
 */

/**
 * @swagger
 * /bookings/{id}/accept:
 *   put:
 *     summary: Accept a booking request (owner only)
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking accepted
 */

/**
 * @swagger
 * /bookings/{id}/decline:
 *   put:
 *     summary: Decline a booking request (owner only)
 *     tags: [Bookings]
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
 *         description: Booking declined
 */

/**
 * @swagger
 * /bookings/{id}/cancel:
 *   put:
 *     summary: Cancel a booking (renter only)
 *     tags: [Bookings]
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
 *         description: Booking cancelled
 */

/**
 * @swagger
 * /bookings/{id}/complete:
 *   put:
 *     summary: Mark booking as completed (owner only)
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking completed
 */

/**
 * @swagger
 * /bookings/{id}/pre-photos:
 *   post:
 *     summary: Upload pre-rental photos (owner only)
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Photos uploaded
 */

/**
 * @swagger
 * /bookings/{id}/post-photos:
 *   post:
 *     summary: Upload post-rental photos (owner only)
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Photos uploaded
 */