/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Payment records and payment methods
 */

/**
 * @swagger
 * /payments/create-intent:
 *   post:
 *     summary: Create a Stripe PaymentIntent for an accepted booking
 *     description: |
 *       Initializes a real Stripe PaymentIntent with destination charge routing to the owner's
 *       connected Stripe Express account, taking the platform commission and taxes as `application_fee_amount`.
 *
 *       - The booking must be in `accepted` status.
 *       - Only the renter may create the payment intent.
 *       - The owner must have completed Stripe Connect onboarding.
 *       - Returns `clientSecret` and `paymentIntentId` for Stripe Elements / Mobile SDK.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId]
 *             properties:
 *               bookingId: { type: string }
 *     responses:
 *       201:
 *         description: PaymentIntent created successfully
 *       400:
 *         description: Booking is not accepted, or owner has not onboarded Stripe
 *       403:
 *         description: Only the renter can pay
 *       404:
 *         description: Booking not found
 *       409:
 *         description: Payment already completed for this booking
 *       503:
 *         description: Stripe is not configured on this server
 */

/**
 * @swagger
 * /payments/config:
 *   get:
 *     summary: Stripe settings a client needs to initialise checkout
 *     description: |
 *       **Public — no token required.** A Stripe *publishable* key is designed to ship inside client
 *       apps, so serving it keeps one source of truth: switching test to live, or rotating the key,
 *       needs no app release and no rebuild.
 *
 *       Initialise the Stripe SDK with `publishableKey` at launch. When `paymentsEnabled` is false
 *       the server has no usable Stripe configuration — show checkout as unavailable rather than
 *       handing the SDK an empty key.
 *
 *       `mode` reports `test` or `live`, which is worth surfacing in a debug screen so nobody spends
 *       an afternoon wondering why a real card was declined against test keys.
 *     tags: [Payments]
 *     security: []
 *     responses:
 *       200:
 *         description: Payment configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     publishableKey: { type: string, nullable: true, example: pk_test_51... }
 *                     paymentsEnabled: { type: boolean }
 *                     currency: { type: string, example: CAD }
 *                     merchantCountryCode: { type: string, example: CA }
 *                     mode: { type: string, enum: [test, live] }
 */

/**
 * @swagger
 * /payments:
 *   post:
 *     summary: Record a payment against a booking
 *     description: |
 *       Records that a booking was paid for. **No money moves here** — there is no gateway behind
 *       this endpoint; the row is written with `status: "completed"` on the client's word.
 *
 *       - The **booking must be accepted first.** A newly created booking is always `pending`, so
 *         calling this immediately after `POST /bookings` returns 400 naming the current status.
 *       - `amount` is taken from the booking's stored pricing and **cannot be set by the client**
 *         (it includes the service fee and the refundable security deposit).
 *       - Only the **renter** may record it; the owner gets a `payment_received` notification.
 *       - Pass `paymentMethodId` to record *which* saved method was used; `method` is then derived
 *         from it and may be omitted. Supplying both is fine if they agree.
 *       - At most one completed payment per booking, enforced by a unique index, so a duplicate or a
 *         double-tap answers 409.
 *
 *       The response is the same populated shape as `GET /payments/{id}`.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId]
 *             properties:
 *               bookingId: { type: string }
 *               paymentMethodId:
 *                 type: string
 *                 description: A saved method of the caller. Makes `method` optional and links the transaction to it.
 *               method:
 *                 type: string
 *                 enum: [apple_pay, google_pay, credit_card, debit_card]
 *                 description: Required unless `paymentMethodId` is given.
 *               externalReference:
 *                 type: string
 *                 maxLength: 255
 *                 description: A gateway or wallet reference, stored as given and not verified.
 *     responses:
 *       201:
 *         description: Payment recorded (populated booking, payer, payee and paymentMethod)
 *       400:
 *         description: Booking is not accepted yet, or method contradicts paymentMethodId
 *       403:
 *         description: Only the renter can record a payment
 *       404:
 *         description: Booking, or the given paymentMethodId, not found
 *       409:
 *         description: A completed payment already exists for this booking
 */

/**
 * @swagger
 * /payments/my:
 *   get:
 *     summary: Get my transaction history
 *     description: |
 *       Defaults to money **out** (payments this user made). Owners see their income with
 *       `?role=payee`, or both sides with `?role=all`.
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [payer, payee, all], default: payer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Transactions retrieved
 */

/**
 * @swagger
 * /payments/{id}:
 *   get:
 *     summary: Get payment details
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payment retrieved
 */

/**
 * @swagger
 * /payments/methods:
 *   post:
 *     summary: Save a payment method
 *     description: |
 *       `card` is **required** for `credit_card`/`debit_card` and **rejected** for the wallet types.
 *       No full card number or CVV is accepted or stored — only the last four digits and the brand.
 *
 *       - `card.brand` is matched case-insensitively against:
 *         visa, mastercard, amex, discover, jcb, unionpay, diners, other.
 *       - An already-expired card is refused (month granularity).
 *       - The **first** method saved becomes the default automatically, and saving one with
 *         `isDefault: true` clears the flag on the others — a user with any saved method always has
 *         exactly one default.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, label]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [apple_pay, google_pay, credit_card, debit_card]
 *               label: { type: string, example: "My Visa Card" }
 *               isDefault: { type: boolean, default: false }
 *               card:
 *                 type: object
 *                 description: Required only for credit_card and debit_card
 *                 properties:
 *                   last4: { type: string, example: "4242" }
 *                   brand: { type: string, example: "Visa" }
 *                   expiryMonth: { type: integer, example: 12 }
 *                   expiryYear: { type: integer, example: 2027 }
 *     responses:
 *       201:
 *         description: Payment method saved
 *
 *   get:
 *     summary: Get my saved payment methods
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Payment methods retrieved
 */

/**
 * @swagger
 * /payments/methods/{id}:
 *   delete:
 *     summary: Remove a saved payment method
 *     description: |
 *       Answers 404 when the id is not one of the caller's. Deleting the default promotes the most
 *       recently added remaining method, so the "exactly one default" rule holds. `data` is the
 *       remaining list, in the same shape as `GET /payments/methods`.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payment method removed
 */

/**
 * @swagger
 * /payments/methods/{id}/default:
 *   put:
 *     summary: Set a payment method as default
 *     description: |
 *       Answers 404 when the id is not one of the caller's, leaving the existing default untouched.
 *       `data` is the updated method.
 *     tags: [Payments]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Default payment method updated
 */