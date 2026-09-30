/**
 * @swagger
 * tags:
 *   name: Disputes
 *   description: Trust and safety - dispute management
 */

/**
 * @swagger
 * /disputes:
 *   post:
 *     summary: Submit a dispute for a booking
 *     tags: [Disputes]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId, reason, description]
 *             properties:
 *               bookingId: { type: string }
 *               reason:
 *                 type: string
 *                 enum: [item_damaged, item_not_returned, item_not_as_described, late_return, no_show, payment_issue, other]
 *               description:
 *                 type: string
 *                 minLength: 20
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Dispute submitted
 *       409:
 *         description: Dispute already exists for this booking
 *
 *   get:
 *     summary: Get all disputes (admin only)
 *     description: |
 *       **Evidence URLs are signed and expire after one hour.** The `disputes/` prefix is not
 *       public — evidence is damage claims, not catalogue photos — so each read returns freshly signed
 *       links plus `evidenceUrlsExpireAt`. Re-fetch the dispute for new links rather than caching them.
 *     tags: [Disputes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, under_review, resolved_for_renter, resolved_for_owner, resolved_mutually, closed]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: All disputes retrieved
 */

/**
 * @swagger
 * /disputes/my:
 *   get:
 *     summary: Disputes I am part of (either side)
 *     description: |
 *       Every dispute where the caller is **either** the reporter or the person reported against.
 *       Before 2026-09-30 it returned only disputes the caller had filed, so nobody could see a
 *       dispute raised against them even though they are allowed to read it and add evidence.
 *
 *       Each row carries **`myRole`**: `reporter` or `reported_against`. Both parties are populated,
 *       so a list can name who filed it. Narrow to one side with `role`.
 *
 *       `status` is honoured (it was accepted and then silently ignored, so every filter tab showed
 *       the same list). An unrecognised value answers 400 rather than returning everything.
 *
 *       **Evidence URLs are signed and expire after one hour.** The `disputes/` prefix is not
 *       public — evidence is damage claims, not catalogue photos — so each read returns freshly signed
 *       links plus `evidenceUrlsExpireAt`. Re-fetch the dispute for new links rather than caching them.
 *     tags: [Disputes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, under_review, resolved_for_renter, resolved_for_owner, resolved_mutually, closed]
 *       - in: query
 *         name: role
 *         description: Which side to list. Defaults to both.
 *         schema: { type: string, enum: [reporter, against, all], default: all }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: My disputes retrieved
 *       400:
 *         description: Unknown status or role
 */

/**
 * @swagger
 * /disputes/{id}:
 *   get:
 *     summary: Get dispute details
 *     description: |
 *       Readable by either party. The response carries `myRole` (`reporter` or
 *       `reported_against`).
 *
 *       **Evidence URLs are signed and expire after one hour.** The `disputes/` prefix is not
 *       public — evidence is damage claims, not catalogue photos — so each read returns freshly signed
 *       links plus `evidenceUrlsExpireAt`. Re-fetch the dispute for new links rather than caching them.
 *     tags: [Disputes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Dispute retrieved
 *       403:
 *         description: Access denied
 */

/**
 * @swagger
 * /disputes/{id}/evidence:
 *   post:
 *     summary: Upload evidence photos for a dispute
 *     description: |
 *       Either party, while the dispute is `open` or `under_review`. Up to 5 images per request,
 *       JPEG/PNG/WebP, 5MB each; a wrong field name, an oversized file or a non-image answers 400.
 *
 *       The response is the updated dispute, with **signed** evidence URLs valid for one hour — the
 *       raw S3 URL is stored but is not publicly readable.
 *     tags: [Disputes]
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
 *               evidence:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Evidence uploaded
 */

/**
 * @swagger
 * /disputes/{id}/cancel:
 *   put:
 *     summary: Cancel a dispute (reporter only, open disputes only)
 *     tags: [Disputes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Dispute cancelled
 */

/**
 * @swagger
 * /disputes/admin/{id}:
 *   get:
 *     summary: Get any dispute by ID (admin only)
 *     description: |
 *       **Evidence URLs are signed and expire after one hour.** The `disputes/` prefix is not
 *       public — evidence is damage claims, not catalogue photos — so each read returns freshly signed
 *       links plus `evidenceUrlsExpireAt`. Re-fetch the dispute for new links rather than caching them.
 *     tags: [Disputes]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Dispute retrieved
 */

/**
 * @swagger
 * /disputes/admin/{id}/resolve:
 *   put:
 *     summary: Resolve a dispute (admin only)
 *     tags: [Disputes]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [resolved_for_renter, resolved_for_owner, resolved_mutually, closed]
 *               adminNote: { type: string }
 *     responses:
 *       200:
 *         description: Dispute resolved
 */

/**
 * @swagger
 * /disputes/admin/{id}/status:
 *   put:
 *     summary: Update dispute status (admin only)
 *     description: |
 *       Validated against the status list since 2026-09-30. It previously had **no validator at all**,
 *       so any string was written straight onto the document and a single typo hid the dispute from
 *       every admin status filter with no error anywhere.
 *
 *       Use `PUT /disputes/admin/{id}/resolve` to close a dispute with an outcome and notify both
 *       parties; this route is for moving it to `under_review` and similar.
 *     tags: [Disputes]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, under_review, resolved_for_renter, resolved_for_owner, resolved_mutually, closed]
 *     responses:
 *       200:
 *         description: Status updated
 */