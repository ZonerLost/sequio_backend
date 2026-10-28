# Booking condition photos — fixed, and they're signed URLs

For the Flutter team, in reply to `backend-booking-photos-403.md`.
Backend commit `9b895bf`. **Not deployed yet** — see [Status](#status).

You were right on every point, including that it was purely an S3 permissions problem on our side.
Thanks for re-flagging it with a live repro; that made it a five-minute diagnosis instead of an
afternoon.

**The answer to your question: signed URLs, not public-read.** So it's the `identity-docs/` /
dispute-evidence pattern, which means the client handling you flagged as different does apply. Details
below, and it's less work than you might expect.

---

## What you need to change

One thing, and it's small: **URLs expire after 1 hour, so cache them per-session, not forever.**

Every response that contains a booking now also contains `photoUrlsExpireAt`:

```json
{
  "_id": "6ac33a8d5caac1c759b5d403",
  "status": "completed",
  "preRentalPhotos": [
    "https://zonerlost-media.s3.us-east-1.amazonaws.com/bookings/6ac33a.../pre-rental/f5178dd5-...?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=..."
  ],
  "postRentalPhotos": [],
  "photoUrlsExpireAt": "2026-10-28T16:30:00.000Z"
}
```

Rules:

- **Use the URL exactly as given.** Don't strip the query string — the signature lives in it.
- **Don't persist them.** They're dead after an hour. Treat them like a session token, not an asset
  path.
- **Past `photoUrlsExpireAt`, re-fetch the booking**, not the image. Re-requesting an expired URL gives
  you a 403 that looks identical to the bug you just reported. Re-fetching the booking gives you fresh
  URLs.
- `photoUrlsExpireAt` is **absent** when a booking has no photos at all. Don't assume it's there.

Your tap-to-retry change is worth keeping — it's exactly the right fallback — but note it only helps
if the retry re-fetches the *booking*. A retry that just re-requests the same expired URL will fail
forever. If `_bookingPhotoThumb` currently evicts the cache entry and re-requests the stored URL, point
it at a booking refresh instead.

Practically, for your bottom sheet: the URLs are fresh the moment the sheet opens, and an hour is far
longer than anyone keeps a booking detail sheet open. If you want to be thorough, compare
`photoUrlsExpireAt` to `DateTime.now()` when the sheet reopens and refresh the booking if it's past.
If you want to do nothing, the common path already works.

## Which endpoints sign them

All of them. The response shape doesn't depend on which endpoint produced it:

| Endpoint | |
|---|---|
| `GET /bookings/:id` | signed |
| `GET /bookings/sent` | signed |
| `GET /bookings/received` | signed |
| `POST /bookings/:id/pre-photos` | signed in the upload response |
| `POST /bookings/:id/post-photos` | signed in the upload response |
| `PUT /bookings/:id/accept` · `/decline` · `/cancel` · `/complete` | signed |
| `POST /bookings` | no photos yet, but same shape |

So the strip renders immediately after an upload too, which it didn't before — the upload response
carried the same dead raw URL.

Admin panel booking screens get the same treatment.

## Why signed rather than adding `bookings/*` to the bucket policy

You offered both and said either was fine, so here's the reasoning in case it matters to you later.

These are **damage records**. Their whole purpose is to settle an argument about who scratched what,
and in practice they show the inside of someone's home, their car interior, their belongings — the
same category as dispute evidence, which is already private. Quite often the *same photo* ends up
attached to a dispute.

Public-read would have been one line in a bucket policy. But public on S3 means permanent,
unauthenticated and world-readable: anyone who ever sees that URL keeps access forever, and there is no
taking it back. The audience for these is two people and an admin. `item-photos/` and
`profile-photos/` are public because browsing requires it; a photo of the dent in someone's van does
not.

It also means one rule across the codebase instead of two — booking photos and dispute evidence now go
through the same signer, with the same TTL and the same expiry field name pattern
(`photoUrlsExpireAt` / `evidenceUrlsExpireAt`).

## Existing photos

**They work.** Nothing was re-uploaded and nothing moved. The four objects already in the bucket —
including the one from your repro — start rendering the moment this deploys, with no client release,
exactly as you expected. We verified a signed URL for one of your existing objects returns 200 with
the real image.

## What we verified

A new test suite hits **real S3 with real objects**, deliberately, because this is the second time this
class of bug has shipped. Every in-process assertion about this code passed for a month while every
single photo 403'd — the upload returned 200, the database was correct, the response body was correct,
the type-check was clean. Only fetching the URL the API itself returned would have caught it, which is
what your repro did and our tests didn't.

33 checks, all passing, including:

- the raw stored URL still answers **403** — asserted as a *requirement*, not a defect
- the signed URL returns **200** with the object
- `item-photos/` and `profile-photos/` are still public and unchanged
- the database still stores the **raw** URL (storing a signed one would permanently break photo
  deletion, since the delete path recovers the S3 key from the URL)
- signing an already-signed URL is a no-op — otherwise a double-sign produces a 403 that looks exactly
  like the original bug
- a caller who is neither renter nor owner still gets 403 on the booking — that check is what makes
  signing safe in the first place
- and, checked against the source, that **no** booking-returning method forgot the signer. That one
  found a path we'd missed.

## Unrelated, but while we were in there

`POST /bookings/:id/pre-photos` is **owner-only**, and so is `post-photos`. That's unchanged, and
deliberate — the owner documents the condition. But both parties can *read* them, which is the point:
the renter needs to see what they're being held to.

Also unchanged: pre-rental photos require the booking to be `accepted`, post-rental require
`completed`. If you're seeing a 400 on an upload, that's the reason and the message says which.

## Status

**Built, tested and committed — not deployed.** Until the deploy lands, production still returns raw
403ing URLs, so don't take a failure as a regression in your retry logic.

The deploy needs the account owner to run it; it's queued alongside the location/nearby-listings work
(`LOCATION_AND_NEARBY.md`). We'll confirm when both are live.
