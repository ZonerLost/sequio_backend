# Postman collection

`Atussa-API.postman_collection.json` holds **130 requests** against the **157 routes** in
`src/routes/`, with a filled-in example body on every request that takes one, each checked against
the same Joi schema its route validates with.

> **It is no longer complete, and this is the honest number.** The collection was generated from the
> route table and covered all 115 routes that existed when it was built. It has since fallen ~30
> routes behind — the catalogue admin dictionary (`/admin/catalog/*`), the November booking lifecycle
> (`handover`, `return`, `return/dispute`, `owner-cancel`) and the Stripe charging endpoints are the
> bulk of what is missing. **The generator is gone**: it lived in a session scratchpad that was
> cleared, along with the four verification suites `CLAUDE.md` used to cite. The Phase 2d/2e refund
> requests were added by hand, which is why the count is exact rather than "every route".
>
> Rebuilding the generator from `src/routes/*.ts` is a contained piece of work and is the right fix.
> Until then, treat a missing endpoint as a gap in this file, not as an endpoint that does not exist;
> `/api-docs.json` on the running server is generated and therefore complete.

One request is an extra variant rather than a route: *Browse listings nearby*, because `GET /items`
behaves differently enough with a centre supplied (a radius circle, `distanceKm` on every row,
`sortBy=distance`) to be worth its own request.

## Import

1. Postman → **Import** → drop in all three files.
2. Pick the environment: **Atussa · Production** or **Atussa · Local** (`http://localhost:3000/api/v1`).

## Get a token in under a minute

1. `01 · Auth → Register` — the collection makes up a fresh `qa+<timestamp>@example.com` on the
   first run, so it never collides with an existing account.
2. Read the 6-digit OTP from the email (in development it is also printed to the server log) and
   put it in the `otp` variable.
3. `01 · Auth → Verify email (OTP)` — saves `accessToken` and `refreshToken`.

Every other request inherits `Authorization: Bearer {{accessToken}}` from the collection; the
public ones are marked `noauth`. Running `Login` again refreshes the token.

## It chains

Requests save what they create, so a folder runs top to bottom:

| Request | Saves |
|---|---|
| Login / Verify email / Refresh token | `accessToken`, `refreshToken`, `userId` |
| Browse listings, My conversations | `itemId`, `conversationId`, `otherUserId` (handy without creating anything) |
| Create listing → Create booking → Complete | `itemId`, `bookingId` |
| Start conversation / Send message | `conversationId`, `messageId` |
| Submit review, Open dispute, Record payment, Add address | `reviewId`, `disputeId`, `paymentId`, `addressId` |

A typical end-to-end pass: create a listing → book it → owner accepts → complete → review →
dispute. You need **two accounts** for the parts where owner and renter must differ (a user
cannot book their own listing); sign in as the second account and the same variables carry over.

## Admin folder

`12 · Admin` needs an account whose `role` is `admin`. Sign in with it through
`01 · Auth → Login` and the same `accessToken` is used.

## Upload requests

The six multipart requests (profile photo, identity document, listing photos, booking pre/post
photos, dispute evidence) ship with the right field name and no file attached — pick a file in
Postman's **Body → form-data** tab. JPEG/PNG/WebP, 5 MB each.

## What is not here

- **Sockets.** Realtime chat cannot be exercised from Postman — see [`../CHAT_REALTIME.md`](../CHAT_REALTIME.md).
- **Secrets.** `userPassword` is a throwaway; `revenuecatWebhookSecret` and admin credentials are
  deliberately empty. Fill them in your own environment, do not commit them.

## Regenerating

**The generator no longer exists.** It and its two verification passes (every route covered; every
body and query example valid against its Joi schema) were `build-collection.cjs`,
`validate-bodies.cjs` and `validate-queries.cjs` in a session scratchpad that has been cleared. Do
not go looking for them.

Until one is written again, a new route is added to this JSON by hand, and its example body is
checked against its own Joi schema — `scripts/probe-postman-examples.cjs` does that check for every
body added by hand so far, and it is a couple of dozen lines. Adding a route without doing either is how the gap above opened.

Descriptions call out the traps — the routes with **no validation** (`PUT /disputes/admin/:id/status`,
`POST /bookings/quote`, the RevenueCat webhook), the fields that are stored but never read, and the
endpoints that look like they move money but do not.
