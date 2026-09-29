/**
 * @swagger
 * /users/payout-account:
 *   get:
 *     summary: Where my rental income goes (Stripe Connect status)
 *     description: |
 *       Owners are paid through **Stripe Connect Express**, so this API never sees a bank account
 *       number: Stripe collects and holds it, and the platform stores status only.
 *
 *       Refreshed live from Stripe whenever an account exists, so `requirementsDue` is never stale.
 *       If Stripe is unreachable the last known status is served with 200 rather than failing the
 *       screen.
 *
 *       `state` is what the UI should switch on:
 *
 *       | state | meaning | what the app shows |
 *       |---|---|---|
 *       | `not_connected` | no Stripe account yet | "Set up payouts" |
 *       | `pending` | onboarding started, not finished | "Finish setup" |
 *       | `restricted` | details submitted, Stripe still wants something | "Action needed" + `requirementsDue` |
 *       | `active` | payouts enabled | masked bank, no action |
 *
 *       In every state but `active`, `actionRequired` is true and the next step is a fresh onboarding
 *       link. Payouts themselves are made by Stripe on its own schedule, not by this API.
 *     tags: [Payouts]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Payout account status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     state: { type: string, enum: [not_connected, pending, restricted, active] }
 *                     connected: { type: boolean }
 *                     payoutsEnabled: { type: boolean }
 *                     chargesEnabled: { type: boolean }
 *                     detailsSubmitted: { type: boolean }
 *                     actionRequired: { type: boolean }
 *                     requirementsDue:
 *                       type: array
 *                       items: { type: string }
 *                       description: Stripe's own list, e.g. ["individual.verification.document"]
 *                     disabledReason: { type: string }
 *                     country: { type: string }
 *                     currency: { type: string }
 *                     bank:
 *                       type: object
 *                       description: Masked, display only. Absent until Stripe has a bank account on file.
 *                       properties:
 *                         last4: { type: string }
 *                         name: { type: string }
 */

/**
 * @swagger
 * /users/payout-account/onboarding-link:
 *   post:
 *     summary: Start or resume Stripe payout onboarding
 *     description: |
 *       Creates the connected account on first use, then returns a **Stripe-hosted** onboarding URL to
 *       open in a browser or web view. Stripe collects the bank details and identity documents; this
 *       API never receives them.
 *
 *       The URL is **single-use and expires within minutes** — request a new one each time the owner
 *       taps the button rather than caching it. Account creation is idempotency-keyed per user, so a
 *       double tap cannot produce two connected accounts.
 *
 *       Stripe returns the owner to the app's configured deep link when they finish or abandon the
 *       flow; call `GET /users/payout-account` afterwards for the resulting state, and expect
 *       `restricted` to be a normal outcome that needs another link.
 *     tags: [Payouts]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding link created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string, description: Open this in a browser or web view }
 *                     expiresAt: { type: string, format: date-time }
 *                     accountId: { type: string, description: Stripe connected account id (acct_...) }
 *       503:
 *         description: Stripe is not configured on this server, or is unreachable
 */

/**
 * @swagger
 * /webhooks/stripe:
 *   post:
 *     summary: Stripe webhook (Connect account updates)
 *     description: |
 *       Called by Stripe, not by clients. Verified with HMAC-SHA256 over the **raw** request body
 *       against `STRIPE_WEBHOOK_SECRET`, with a five-minute timestamp tolerance so a captured request
 *       cannot be replayed. Fails closed: with no secret configured it answers 503 rather than
 *       trusting the payload.
 *
 *       Handles `account.updated` to keep payout status current. Other event types are acknowledged
 *       with 200 — Stripe retries a non-2xx, and there is nothing to retry for an event this app does
 *       not act on.
 *     tags: [Payouts]
 *     responses:
 *       200:
 *         description: Event received
 *       400:
 *         description: Missing, malformed or expired signature
 *       401:
 *         description: Signature does not match
 */
