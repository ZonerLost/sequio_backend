/**
 * @swagger
 * tags:
 *   - name: Webhooks
 *     description: Inbound webhooks from third-party services. Not called by the mobile app.
 *
 * /webhooks/revenuecat:
 *   post:
 *     tags: [Webhooks]
 *     summary: RevenueCat purchase webhook
 *     description: |
 *       Called automatically by RevenueCat after every in-app purchase.
 *       **Do not call this endpoint from the app.**
 *
 *       On an `INITIAL_PURCHASE` event for product `boost_7days`, the API adds
 *       1 boost credit to the subscriber's user account. The `app_user_id` in the
 *       payload must match the MongoDB user `_id` (set via `Purchases.logIn(userId)`
 *       in the mobile app).
 *
 *       Verified via the `Authorization` header — value must match
 *       `REVENUECAT_WEBHOOK_SECRET` configured in App Runner environment variables.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     example: INITIAL_PURCHASE
 *                   app_user_id:
 *                     type: string
 *                     example: 6a27d892aa0fcaa11435122f
 *                   product_id:
 *                     type: string
 *                     example: boost_7days
 *                   price:
 *                     type: number
 *                     example: 9.99
 *                   currency:
 *                     type: string
 *                     example: CAD
 *     responses:
 *       200:
 *         description: Webhook received and processed
 *       401:
 *         description: Invalid or missing Authorization header
 */

export {};
