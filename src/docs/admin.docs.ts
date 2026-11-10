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
 * /admin/catalog:
 *   get:
 *     summary: The whole catalogue, as an administrator needs to see it
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     description: >
 *       Unlike the public `GET /items/catalog`, this includes inactive, merged and **prohibited**
 *       nodes — a picker that offers a prohibited item type is a bug, and an administrator who
 *       cannot see one cannot un-prohibit it. Each subcategory carries its listing count and each
 *       item type its alias count.
 *
 *
 *       `aliasKinds` comes back alongside the tree so the admin screen does not hardcode the list.
 *     responses:
 *       200: { description: The catalogue tree and the alias kinds }
 *
 * /admin/catalog/categories:
 *   post:
 *     summary: Add a category
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [slug, nameEn]
 *             properties:
 *               slug: { type: string, example: pet_supplies, description: "Lowercase, digits and underscores. An identifier, never shown to a user, and never changed afterwards." }
 *               nameEn: { type: string }
 *               nameFr: { type: string, nullable: true }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Created }
 *       409: { description: That slug already exists }
 *
 * /admin/catalog/categories/{slug}:
 *   put:
 *     summary: Rename, re-sort, retire or merge a category
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       **There is no delete.** Listings reference slugs, so deleting a node orphans them
 *       permanently. Retiring one is `active: false`; replacing one is `mergedInto`, which also
 *       moves every listing onto the survivor and reports how many in `effects`.
 *
 *
 *       `slug` is not accepted and is silently dropped if sent.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nameEn: { type: string }
 *               nameFr: { type: string, nullable: true }
 *               sortOrder: { type: integer }
 *               active: { type: boolean }
 *               mergedInto: { type: string, nullable: true, description: "The surviving slug. null undoes the merge." }
 *     responses:
 *       200: { description: "Updated, with an `effects` object naming what else moved" }
 *       409: { description: The merge would make a cycle }
 *
 * /admin/catalog/subcategories:
 *   post:
 *     summary: Add a subcategory
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *       400: { description: Unknown parent category }
 *
 * /admin/catalog/subcategories/{slug}:
 *   put:
 *     summary: Rename, move, retire or merge a subcategory
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       Sending `category` **moves** it, and every listing under it is re-pointed in the same
 *       operation — `item.taxonomy` stores all three levels, so a move that did not would leave
 *       listings filed under a category they are no longer in.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated }
 *
 * /admin/catalog/item-types:
 *   post:
 *     summary: Add an item type
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       `eligibility` is `allowed`, `conditional`, `under_review` or `prohibited`, and it is
 *       enforced at listing time rather than advisory. `eligibilityNote` is shown to the owner when
 *       a listing is blocked, so it has to say what the problem is.
 *     responses:
 *       201: { description: Created }
 *
 * /admin/catalog/item-types/{slug}:
 *   put:
 *     summary: Rename, move, retire, merge or re-classify an item type
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       Marking something `prohibited` takes effect on the next request — no deploy and no app
 *       release. Existing listings on it are **not** removed: that is a moderation decision, and
 *       this endpoint reports how many there are in `effects.listingsStillUnderIt`.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated }
 *
 * /admin/catalog/aliases:
 *   get:
 *     summary: The alias dictionary
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       `search` matches the **normalised** form, so looking for "Kärcher" finds the row stored as
 *       "karcher".
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: itemType
 *         schema: { type: string }
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [synonym, brand, usage, typo] }
 *       - in: query
 *         name: approved
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Aliases, paginated }
 *   post:
 *     summary: Add a word to the dictionary
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       Live on the next request. This is the endpoint behind the client's requirement that
 *       vocabulary be editable "without releasing a new app version".
 *
 *
 *       **`kind` is the field to get right.** A `synonym` weighs 1.0 and can decide a
 *       classification on its own; a `brand` weighs 0.45 and deliberately cannot, because Kärcher
 *       makes pressure washers, carpet cleaners and steam cleaners. Filing a brand as a synonym is
 *       the easiest way to make the classifier confidently wrong, which is the one thing it is
 *       built not to be.
 *
 *
 *       The same phrase may point at several item types — that is what makes a brand ambiguous —
 *       but not twice at the same one (409).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phrase, itemType]
 *             properties:
 *               phrase: { type: string, example: "laveuse à pression", description: "As a human writes it. The normalised form is derived." }
 *               itemType: { type: string, example: pressure_washer }
 *               language: { type: string, enum: [en, fr, any] }
 *               kind: { type: string, enum: [synonym, brand, usage, typo] }
 *               weight: { type: number, nullable: true, description: "Overrides the default weight for the kind. Leave unset unless there is a reason." }
 *               approved: { type: boolean }
 *     responses:
 *       201: { description: Added }
 *       409: { description: That phrase already points at that item type }
 *
 * /admin/catalog/aliases/{id}:
 *   put:
 *     summary: Edit an alias
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     summary: Remove a word from the dictionary
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       An alias **may** be deleted, unlike a taxonomy node: nothing references it, it describes no
 *       listing, and a bad synonym that cannot be removed makes the dictionary too risky to add to.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed }
 *
 * /admin/catalog/feedback:
 *   get:
 *     summary: What the classifier got wrong
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       The review queue the specification asks for: corrections, and terms nothing matched.
 *       `repeatedTerms` lists phrases that have arrived more than once and nobody has looked at —
 *       the same word arriving ten times is worth more attention than ten words arriving once.
 *     parameters:
 *       - in: query
 *         name: corrected
 *         schema: { type: boolean }
 *         description: Only rows where the owner picked something other than the top suggestion.
 *       - in: query
 *         name: reviewed
 *         schema: { type: boolean }
 *       - in: query
 *         name: unmatchedOnly
 *         schema: { type: boolean }
 *         description: Only terms the classifier had no answer for at all.
 *     responses:
 *       200: { description: Feedback rows, paginated, plus repeatedTerms }
 *
 * /admin/catalog/feedback/{id}/review:
 *   put:
 *     summary: Close a feedback row, optionally teaching the dictionary
 *     tags: [Admin]
 *     security: [{ BearerAuth: [] }]
 *     description: >
 *       Pass `addAlias` and the term from the feedback becomes a synonym for the item type named —
 *       the whole loop in one call, with no chance of mistyping the phrase being fixed.
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
 *               addAlias:
 *                 type: object
 *                 properties:
 *                   itemType: { type: string }
 *                   kind: { type: string, enum: [synonym, brand, usage, typo] }
 *     responses:
 *       200: { description: Reviewed }
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

/**
 * @swagger
 * /admin/refund-requests:
 *   get:
 *     summary: Every refund request, for oversight
 *     description: >
 *       Read-only, deliberately. What happens when an owner declines an early-return refund is an
 *       open question with the client, so no override route has been built here. An administrator
 *       who decides to refund anyway uses `PUT /admin/payments/{id}/refund`, which already exists
 *       and already records who did it.
 *
 *
 *       Each row carries the frozen `context` of the cancellation that opened it, where there was
 *       one, and the booking's own `cancellation` record — which is what explains the tier, the
 *       time zone the window was measured in, and what the owner retained.
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, declined, withdrawn] }
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [cancellation_balance, early_return] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: The requests
 *       403:
 *         description: Admin only
 */


/**
 * @swagger
 * /admin/users/{id}/tax-registration:
 *   put:
 *     summary: Verify, or withdraw verification of, an owner's GST/QST registration
 *     description: >
 *       **A human step, and it cannot be anything else.** The format of a registration number is
 *       checked in code; only the Canada Revenue Agency and Revenu Québec can say whether a number
 *       exists and belongs to this owner, and neither publishes an API for it.
 *
 *
 *       `note` is required in **both** directions. An administrator who withdraws a verification
 *       months later has a reason, and a bare `verified: false` is not something the next person can
 *       act on. The note survives a withdrawal; the verification does not.
 *
 *
 *       Refuses an owner who has not declared a status yet (**400**): there is nothing to verify, and
 *       writing `verifiedAt` onto an empty declaration would make the next reader think they had
 *       answered. Note also that an owner **re-declaring** clears any verification — carrying it over
 *       to a different number would turn a real check into a rubber stamp.
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
 *             required: [verified, note]
 *             properties:
 *               verified: { type: boolean }
 *               note:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 500
 *                 example: Confirmed against the CRA business registry by phone
 *     responses:
 *       200:
 *         description: Recorded
 *       400:
 *         description: This owner has not declared a tax-registration status yet
 *       403:
 *         description: Admin only
 *       404:
 *         description: User not found
 */
