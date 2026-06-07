/**
 * @swagger
 * /items:
 *   get:
 *     tags: [Items]
 *     summary: Get all items with filters and pagination
 *     security: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         example: tools
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *         example: Montreal
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: condition
 *         schema:
 *           type: string
 *           enum: [new, like_new, good, fair]
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [dailyRate, createdAt, averageRating, totalRentals]
 *           default: createdAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *         example: 45.5017
 *         description: User latitude for location-based filtering
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *         example: -73.5673
 *         description: User longitude for location-based filtering
 *       - in: query
 *         name: radius
 *         schema: { type: number, default: 20 }
 *         description: Search radius in km (requires lat and lng)
 *     responses:
 *       200:
 *         description: Items retrieved with pagination
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     pagination:
 *                       $ref: '#/components/schemas/PaginationMeta'
 *
 *   post:
 *     tags: [Items]
 *     summary: Create a new item listing
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateItemRequest'
 *     responses:
 *       201:
 *         description: Item created successfully
 *       401:
 *         description: Unauthorized
 *
 * /items/feed:
 *   get:
 *     tags: [Items]
 *     summary: Get categorized feed — Near Me, Popular, Recent
 *     security: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *         example: 45.5017
 *         description: User latitude (required for Near Me section)
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *         example: -73.5673
 *         description: User longitude (required for Near Me section)
 *       - in: query
 *         name: radius
 *         schema: { type: number, default: 20 }
 *         description: Search radius in km
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 20 }
 *         description: Number of items per section
 *     responses:
 *       200:
 *         description: Feed retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Feed retrieved
 *                 data:
 *                   type: object
 *                   properties:
 *                     nearMe:
 *                       type: array
 *                       items: { type: object }
 *                     popular:
 *                       type: array
 *                       items: { type: object }
 *                     recent:
 *                       type: array
 *                       items: { type: object }
 *
 * /items/my-listings:
 *   get:
 *     tags: [Items]
 *     summary: Get all listings of the current user
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: My listings retrieved
 *       401:
 *         description: Unauthorized
 *
 * /items/{id}:
 *   get:
 *     tags: [Items]
 *     summary: Get a single item by ID
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Item retrieved
 *       404:
 *         description: Item not found
 *
 *   put:
 *     tags: [Items]
 *     summary: Update an item listing
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
 *             $ref: '#/components/schemas/CreateItemRequest'
 *     responses:
 *       200:
 *         description: Item updated
 *       403:
 *         description: Unauthorized - not the owner
 *       404:
 *         description: Item not found
 *
 *   delete:
 *     tags: [Items]
 *     summary: Delete an item listing
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Item deleted
 *       403:
 *         description: Unauthorized - not the owner
 *
 * /items/{id}/photos:
 *   post:
 *     tags: [Items]
 *     summary: Upload photos for an item (max 5)
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Photos uploaded
 *
 *   delete:
 *     tags: [Items]
 *     summary: Delete a photo from an item
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
 *             required: [photoUrl]
 *             properties:
 *               photoUrl:
 *                 type: string
 *                 example: "https://bucket.s3.amazonaws.com/item-photos/photo.jpg"
 *     responses:
 *       200:
 *         description: Photo deleted
 *
 * /items/{id}/availability:
 *   put:
 *     tags: [Items]
 *     summary: Update item availability and blocked dates
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
 *             $ref: '#/components/schemas/UpdateAvailabilityRequest'
 *     responses:
 *       200:
 *         description: Availability updated
 *       403:
 *         description: Unauthorized - not the owner
 *
 * /items/{id}/pause:
 *   put:
 *     tags: [Items]
 *     summary: Pause a listing — hides it from public search and feed
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Listing paused
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: Listing paused }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     isPaused: { type: boolean, example: true }
 *       400:
 *         description: Listing is already paused
 *       403:
 *         description: Unauthorized - not the owner
 *
 * /items/{id}/resume:
 *   put:
 *     tags: [Items]
 *     summary: Resume a paused listing — makes it visible again
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Listing resumed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: Listing resumed }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     isPaused: { type: boolean, example: false }
 *       400:
 *         description: Listing is not paused
 *       403:
 *         description: Unauthorized - not the owner
 *
 * /items/form-config:
 *   get:
 *     tags: [Items]
 *     summary: Get item listing form configuration
 *     description: >
 *       Returns all static options needed to populate the Add Item form —
 *       categories, conditions, booking types, and currency options.
 *       No authentication required.
 *     security: []
 *     responses:
 *       200:
 *         description: Form config retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     categories:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, example: sports }
 *                           label: { type: string, example: Sports }
 *                     conditions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, example: like_new }
 *                           label: { type: string, example: Like New }
 *                     bookingTypes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, example: manual }
 *                           label: { type: string, example: Request to Book }
 *                           description: { type: string }
 *
 * /items/boost-config:
 *   get:
 *     tags: [Items]
 *     summary: Get boost pricing configuration
 *     description: Returns the current boost price and duration. No authentication required.
 *     security: []
 *     responses:
 *       200:
 *         description: Boost config retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     price: { type: number, example: 9.99 }
 *                     currency: { type: string, example: CAD }
 *                     durationDays: { type: integer, example: 7 }
 *                     description: { type: string }
 *
 * /items/{id}/boost:
 *   post:
 *     tags: [Items]
 *     summary: Boost a listing for 7 days
 *     description: >
 *       Marks the listing as boosted for 7 days. Boosted listings appear at the top of
 *       search results and feed. Owner only. Payment integration (Stripe) is a future milestone —
 *       boost is applied immediately.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Listing boosted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     isBoosted: { type: boolean, example: true }
 *                     boostExpiresAt: { type: string, format: date-time }
 *       400:
 *         description: Cannot boost a paused or inactive listing
 *       403:
 *         description: Forbidden — not the owner
 *
 * /items/{id}/pickup-schedule:
 *   put:
 *     tags: [Items]
 *     summary: Update pickup availability schedule
 *     description: >
 *       Sets the pickup availability schedule for the item. Use scheduleType "recurring" for
 *       weekly repeating days or "specific_dates" for individual date slots.
 *       Times must be in HH:MM format (e.g. "09:00").
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
 *             $ref: '#/components/schemas/UpdateScheduleRequest'
 *     responses:
 *       200:
 *         description: Pickup schedule updated
 *       403:
 *         description: Forbidden — not the owner
 *       404:
 *         description: Item not found
 *
 * /items/{id}/delivery-schedule:
 *   put:
 *     tags: [Items]
 *     summary: Update delivery availability schedule
 *     description: Sets the delivery availability schedule. Same structure as pickup-schedule.
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
 *             $ref: '#/components/schemas/UpdateScheduleRequest'
 *     responses:
 *       200:
 *         description: Delivery schedule updated
 *       403:
 *         description: Forbidden — not the owner
 *       404:
 *         description: Item not found
 */

export {};
