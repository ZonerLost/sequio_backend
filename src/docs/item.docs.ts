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
 *         description: >
 *           Either vocabulary. One of the 20 legacy slugs the app has always sent, or any slug from
 *           `GET /items/catalog`. A legacy slug is translated to the most precise level it means —
 *           `cameras` finds Photography & video, not the whole of Electronics & Technology.
 *         example: tools
 *       - in: query
 *         name: subcategory
 *         schema: { type: string }
 *         description: A subcategory slug. Narrower than `category`, and combinable with it.
 *         example: power_tools
 *       - in: query
 *         name: itemType
 *         schema: { type: string }
 *         description: >
 *           An item type slug — the narrowest filter there is. Only listings placed on that exact
 *           type match, so this returns nothing for a type no owner has used yet.
 *         example: drill
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
 *           enum: [dailyRate, createdAt, averageRating, totalRentals, distance]
 *           default: createdAt
 *         description: >
 *           `distance` orders nearest first and needs `lat` and `lng`; without them it falls
 *           back to `createdAt`. Unlike every other order it does NOT put boosted listings first.
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Ignored when sortBy=distance — nearest first is the only useful direction.
 *       - in: query
 *         name: lat
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         example: 45.5017
 *         description: Centre of the radius search. Must be sent with lng or both are ignored.
 *       - in: query
 *         name: lng
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         example: -73.5673
 *         description: Centre of the radius search. Must be sent with lat or both are ignored.
 *       - in: query
 *         name: radius
 *         schema: { type: number, default: 20, minimum: 1, maximum: 500 }
 *         description: >
 *           Search radius in **kilometres** (requires lat and lng). A true circle — listings are
 *           measured by great-circle distance, not by a bounding box.
 *       - in: query
 *         name: distance
 *         schema: { type: number, minimum: 1, maximum: 500 }
 *         description: Alias for `radius`, in kilometres. `radius` wins when both are sent.
 *     responses:
 *       200:
 *         description: >
 *           Items retrieved with pagination. Every item carries `distanceKm` when lat/lng were
 *           supplied — a number in kilometres, or null for a listing that has no coordinates.
 *           `location.geoSource` says whether the point came from the client or was derived from
 *           the address text, and `location.geoPrecision` how exact it is (`city`, `village`,
 *           `address`, `building`) — draw a circle for a city, a pin for an address.
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
 * /items/catalog:
 *   get:
 *     tags: [Items]
 *     summary: The full category tree for the Add Item picker and search filters
 *     security: []
 *     description: >
 *       12 categories, their subcategories and the item types under each. Inactive, merged and
 *       prohibited nodes are left out — they exist so historical listings keep resolving, not so
 *       anything new can be filed under them.
 *
 *
 *       `slug` is the stable identifier and the only thing to store or compare. `nameEn` and
 *       `nameFr` are display only, and **`nameFr` is currently null everywhere**: the client has
 *       not supplied French copy. They fill it in through the admin dictionary, so it will appear
 *       without an app release.
 *     responses:
 *       200: { description: The catalogue tree }
 *
 * /items/classify:
 *   get:
 *     tags: [Items]
 *     summary: Suggest a category from a free-text item title
 *     security: []
 *     description: >
 *       Call this as the owner types the title on Add Item. Returns up to three suggestions, each
 *       with the category, subcategory, item type, a confidence between 0 and 1, and which word
 *       produced the match.
 *
 *
 *       **Respect `ambiguous`.** When it is true the top suggestions are close together and the
 *       screen should show the choices rather than pre-selecting the first — "Kärcher" makes
 *       pressure washers, carpet cleaners and steam cleaners, and guessing one is worse than asking.
 *       When `unrecognised` is true nothing matched and the owner should pick manually.
 *
 *
 *       Each suggestion carries `eligibility`. `prohibited` means the listing must not be allowed
 *       to publish and `eligibilityNote` says why; `conditional` means it may publish but the
 *       owner has requirements to meet, which the note states.
 *     parameters:
 *       - in: query
 *         name: title
 *         required: true
 *         schema: { type: string, minLength: 2, maxLength: 200 }
 *         example: Kärcher to clean the patio
 *     responses:
 *       200: { description: Suggestions, possibly ambiguous or empty }
 *       400: { description: Title too short }
 *
 * /items/feed:
 *   get:
 *     tags: [Items]
 *     summary: Get categorized feed — Near Me, Popular, Recent
 *     security: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         example: 45.5017
 *         description: User latitude (required for Near Me section)
 *       - in: query
 *         name: lng
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         example: -73.5673
 *         description: User longitude (required for Near Me section)
 *       - in: query
 *         name: radius
 *         schema: { type: number, default: 20, minimum: 1, maximum: 500 }
 *         description: >
 *           Search radius in **kilometres**. Near Me is ordered nearest first within it; all three
 *           sections carry `distanceKm` once lat/lng are supplied.
 *       - in: query
 *         name: distance
 *         schema: { type: number, minimum: 1, maximum: 500 }
 *         description: Alias for `radius`, in kilometres. `radius` wins when both are sent.
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
