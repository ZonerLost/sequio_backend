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
 *     description: >
 *       Either party only — a caller who is neither renter nor owner gets 403.
 *
 *
 *       `preRentalPhotos` and `postRentalPhotos` are returned as **signed URLs valid for 1 hour**,
 *       with `photoUrlsExpireAt` alongside them. The stored URLs are private and answer 403 on
 *       their own. Re-fetch the booking for fresh URLs once they expire. The same applies to
 *       `/bookings/sent` and `/bookings/received`.
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
 *     description: >
 *       Cancels the booking **and settles the money** under the cancellation policy — see
 *       `GET /bookings/{id}/cancellation-quote` for the same numbers in advance, which is what
 *       should be shown before the renter confirms.
 *
 *
 *       Allowed from `pending`, `accepted` and `ready_for_handover`. The response carries a
 *       `cancellation` object with the `tier`, the `refundCents` actually returned,
 *       `ownerApprovableCents` (the other half the owner may still approve, in the 24-48h band)
 *       and `refundOutstanding`.
 *
 *
 *       **The booking is cancelled first and the refund attempted second.** A refund Stripe refuses
 *       leaves a cancelled booking and `refundOutstanding: true` for support to retry, rather than
 *       failing the whole request and leaving the renter still committed to a rental they have
 *       cancelled.
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
 * /bookings/{id}/owner-cancel:
 *   put:
 *     summary: Owner cancels a booking they had accepted
 *     description: >
 *       Owner only, and only while the booking is `accepted` or `ready_for_handover` — once the
 *       renter has the item, cancelling is not the remedy and a dispute is.
 *
 *
 *       **multipart/form-data.** `reason` and `explanation` are both required, in every case and
 *       not only for "other": a bare category is not something an administrator can review weeks
 *       later when the owner appeals. Up to 5 `evidence` files may be attached; they are stored
 *       privately and served as signed URLs, never public.
 *
 *
 *       The renter is refunded **in full** — rental, the renter-side amount and the taxes on both —
 *       and Atussa keeps no commission on a cancelled rental. If the refund fails the cancellation
 *       still stands and `refundOutstanding` is true.
 *
 *
 *       **Every owner cancellation counts as a strike by default.** First = warning, second within
 *       a rolling 90 days = final warning, third = temporary suspension from receiving new bookings.
 *       An administrator can excuse any of them afterwards, which recomputes the count.
 *     tags: [Bookings]
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
 *             required: [reason, explanation]
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: [damaged_or_unavailable, theft, emergency, scheduling_conflict, other]
 *               explanation: { type: string, minLength: 10, maxLength: 1000 }
 *               evidence:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: >
 *           Cancelled. Returns the cancellation record, `outcome`
 *           (none | warning | final_warning | suspension), `strikeNumber` and `refundOutstanding`.
 *       400: { description: The booking is not in a state the owner can cancel }
 *       403: { description: Not the owner }
 *       409: { description: Already cancelled }
 *
 * /bookings/{id}/handover:
 *   put:
 *     summary: Confirm the item actually changed hands
 *     description: >
 *       Either party may confirm — whoever has their phone out at the kerb. Moves the booking to
 *       `active`.
 *
 *
 *       `at` is optional and defaults to now. It may be backdated up to 7 days, because the
 *       confirmation usually happens after the event; every deadline downstream runs from the real
 *       time, not the tap. A future time, or one more than 7 days ago, is refused.
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
 *               at: { type: string, format: date-time }
 *               note: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Handover confirmed }
 *       400: { description: Already confirmed, or the booking is not in a state that can be handed over }
 *       403: { description: Not a party to this booking }
 *
 * /bookings/{id}/return:
 *   put:
 *     summary: Confirm the item actually came back
 *     description: >
 *       Either party may confirm. Moves the booking to `returned_awaiting_inspection` and **starts
 *       the 24-hour inspection window**, which is why the time matters rather than just the fact.
 *
 *
 *       An early return is recorded as what it is — the window runs from the real return time even
 *       when that is before the agreed end date. It does **not** refund anything by itself: a
 *       voluntary early return creates no automatic refund, only the right to ask for one.
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
 *               at: { type: string, format: date-time }
 *               note: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Return confirmed }
 *       400: { description: Already confirmed, never handed over, or a time before the handover }
 *       403: { description: Not a party to this booking }
 *
 * /bookings/{id}/return/dispute:
 *   put:
 *     summary: Contest the recorded return time
 *     description: >
 *       The resolution process for when the parties disagree about when the item came back. Only
 *       the party who did **not** record the time may contest it, and only once.
 *
 *
 *       It deliberately does not change the recorded time — letting one party overwrite the other
 *       would make the record worthless, and the claim window and deposit release both hang off it.
 *       The disagreement is stored for an administrator to settle, and the other party is notified.
 *     tags: [Bookings]
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
 *             required: [claimedAt, reason]
 *             properties:
 *               claimedAt: { type: string, format: date-time }
 *               reason: { type: string, minLength: 3, maxLength: 500 }
 *     responses:
 *       200: { description: Contested }
 *       400: { description: No return recorded, already contested, or you recorded it yourself }
 *       403: { description: Not a party to this booking }
 *
 * /bookings/{id}/pre-photos:
 *   post:
 *     summary: Upload pre-rental photos (owner only)
 *     description: >
 *       Uploads pre-rental condition photos (field `photos`, up to 5). Owner only.
 *
 *
 *       The `bookings/` S3 prefix is **private**: these are damage records and are not
 *       world-readable like catalogue photos. `preRentalPhotos` and `postRentalPhotos` come back as
 *       **signed URLs valid for 1 hour**, alongside `photoUrlsExpireAt`. Use them as-is; do not
 *       store or share them. Past `photoUrlsExpireAt`, re-fetch the booking to get fresh URLs
 *       rather than re-requesting the expired one, which answers 403.
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
 *     description: >
 *       Uploads post-rental condition photos (field `photos`, up to 5). Owner only.
 *
 *
 *       The `bookings/` S3 prefix is **private**: these are damage records and are not
 *       world-readable like catalogue photos. `preRentalPhotos` and `postRentalPhotos` come back as
 *       **signed URLs valid for 1 hour**, alongside `photoUrlsExpireAt`. Use them as-is; do not
 *       store or share them. Past `photoUrlsExpireAt`, re-fetch the booking to get fresh URLs
 *       rather than re-requesting the expired one, which answers 403.
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
 * /bookings/{id}/cancellation-quote:
 *   get:
 *     summary: What cancelling right now would refund
 *     description: >
 *       The cancellation policy applied to this booking at this moment, as numbers. **Show this
 *       before the renter confirms a cancellation** — the requirement is that the refundable amount
 *       is known in advance, not discovered afterwards. Readable by the owner too, because the same
 *       response says what they would keep.
 *
 *
 *       Three tiers, measured against the **listing's local time zone**: more than 48 hours before
 *       the start refunds everything; 24 to 48 hours refunds 50% of the rental automatically and
 *       the owner may approve the rest; under 24 hours refunds nothing.
 *
 *
 *       `timeZoneSource` says where the clock came from — `listing` (an explicit override),
 *       `coordinates` (derived, the normal case), `province` or `default`. `clockSource` says
 *       whether the start time came from the booking's own pickup time or from the assumed 09:00
 *       local. A client showing a deadline should show the local time, not a UTC one.
 *
 *
 *       `refundable: false` with `apportionable: false` on a paid booking means the stored price
 *       breakdown predates the fields this arithmetic needs; it cannot be split and support has to
 *       refund by hand. Every amount is in **integer cents**.
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
 *         description: The quote
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     tier: { type: string, enum: [full, partial, none] }
 *                     startsAt: { type: string, format: date-time }
 *                     startsAtLocal: { type: string, example: "15 Nov 2026, 9:00 a.m." }
 *                     timeZone: { type: string, example: America/Toronto }
 *                     timeZoneSource: { type: string, enum: [listing, coordinates, province, default] }
 *                     clockSource: { type: string, enum: [pickup_time, default_hour] }
 *                     hoursUntilStart: { type: number, example: 36.5 }
 *                     currency: { type: string, example: CAD }
 *                     paidCents: { type: integer, example: 10459 }
 *                     refundable: { type: boolean }
 *                     apportionable: { type: boolean }
 *                     refund:
 *                       type: object
 *                       properties:
 *                         rentalCents: { type: integer }
 *                         deliveryCents: { type: integer }
 *                         feeCents: { type: integer }
 *                         taxCents: { type: integer }
 *                         totalCents: { type: integer }
 *                     retained:
 *                       type: object
 *                       properties:
 *                         ownerCents: { type: integer }
 *                         platformCents: { type: integer }
 *                         totalCents: { type: integer }
 *                     ownerApprovableCents: { type: integer }
 *                     conditions:
 *                       type: array
 *                       items: { type: string }
 *       403:
 *         description: Not a party to this booking
 *       404:
 *         description: Booking not found
 */

/**
 * @swagger
 * /bookings/{id}/refund-request:
 *   post:
 *     summary: Ask the owner for a refund after an early return
 *     description: >
 *       **An early return refunds nothing by itself.** A renter who hands the item back on day 5 of
 *       a 10-day rental has the right to ask, and nothing more — this endpoint is that ask. The
 *       owner approves all of it, approves less, or declines.
 *
 *
 *       Requires the return to have been confirmed (`returned.at`) and to be **before** the agreed
 *       end date: a rental that ran its course has no early return to refund. `amount` is in
 *       dollars and is capped at the rental plus delivery not already refunded — the renter-side
 *       service fee is not the owner's to give away. Asking for more than the cap is refused with
 *       the cap named rather than silently reduced.
 *
 *
 *       One pending request per booking, enforced by a unique index: a second returns **409**.
 *     tags: [Bookings]
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
 *             required: [amount, reason]
 *             properties:
 *               amount: { type: number, example: 40.00, description: Dollars }
 *               reason: { type: string, minLength: 10, maxLength: 1000 }
 *     responses:
 *       201:
 *         description: Request sent to the owner
 *       400:
 *         description: Not returned yet, not an early return, unpaid, or above the cap
 *       403:
 *         description: Only the renter may ask
 *       409:
 *         description: A request is already pending on this booking
 */

/**
 * @swagger
 * /bookings/{id}/refund-requests:
 *   get:
 *     summary: Refund requests on one booking
 *     description: Every request ever made on this booking, newest first. Either party may read it.
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
 *         description: The requests
 *       403:
 *         description: Not a party to this booking
 */

/**
 * @swagger
 * /bookings/refund-requests:
 *   get:
 *     summary: My refund requests, from either side
 *     description: >
 *       Both sides, like `GET /disputes/my`: an owner with a decision to make and a renter waiting
 *       on one are looking at the same row, and each gets **`myRole`** (`renter` | `owner`).
 *       Narrow it with `?role=`.
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, declined, withdrawn] }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [renter, owner] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: The requests
 */

/**
 * @swagger
 * /bookings/refund-requests/{requestId}/decide:
 *   put:
 *     summary: Approve or decline a refund request (owner only)
 *     description: >
 *       The owner's decision. `approve: true` refunds the requested amount, or `amount` instead
 *       when they want to approve less — capped at what was asked for.
 *
 *
 *       **A decline is final.** The specification gives no escalation path, so none is invented: the
 *       renter is told what the owner said, and the request stays visible at
 *       `GET /admin/refund-requests` for an administrator who decides to refund by hand through
 *       `PUT /admin/payments/{id}/refund`.
 *
 *
 *       The decision is recorded **before** Stripe is called and stays recorded if Stripe fails —
 *       an owner who agreed has agreed. `refundOutstanding: true` in the response means the money
 *       has not moved and support must retry it.
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [approve]
 *             properties:
 *               approve: { type: boolean }
 *               amount: { type: number, description: Approve this much instead, in dollars }
 *               note: { type: string, maxLength: 1000 }
 *     responses:
 *       200:
 *         description: Decided
 *       403:
 *         description: Only the owner may decide
 *       409:
 *         description: Already decided
 */

/**
 * @swagger
 * /bookings/refund-requests/{requestId}/withdraw:
 *   put:
 *     summary: Withdraw a pending refund request (renter only)
 *     tags: [Bookings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Withdrawn
 *       404:
 *         description: No pending request of yours on this booking
 */
