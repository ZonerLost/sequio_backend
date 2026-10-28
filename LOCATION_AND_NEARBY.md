# Location & nearby listings — backend answers

For the Flutter team, in reply to `backend-location-and-nearby-listings.md`.
Backend commit `378d144`. **Not deployed yet** — see [Status](#status) at the bottom before you
start testing against production.

Short version: **yes to everything you asked for, and all of it is built.** Two surprises worth
reading even if you skim the rest:

- `GET /items` has accepted `lat`, `lng` and `radius` all along. Nobody told you, and the Postman
  collection did not show it. Your question 4 was already half-answered before we started.
- Your `distance` param was being thrown away silently. It is now a real parameter.

---

## The quick table

| | |
|---|---|
| Radius unit | **kilometres**, on every endpoint, always |
| Default radius | **20 km**, applied server-side when you send a centre and no radius |
| Max radius | **500 km** — above that you get a 400 naming the limit |
| New sort | `sortBy=distance` on `GET /items` |
| New field on every item | `distanceKm` (number, or `null`) |
| New fields on `location` | `geoSource`, `geoPrecision` |
| `distance` param | now a working alias for `radius`, in km |
| Geocoding | automatic on `POST /items`, `PUT /items/:id`, `PUT /users/profile` |

---

## 1. Geocode item location server-side — done

`POST /items` and `PUT /items/:id` now geocode `address` + `city` + `province` + `country` into
coordinates whenever you do **not** send `location.coordinates`. If you do send them, they win and no
lookup happens — the manual-entry path keeps working exactly as it does today.

On `PUT /items/:id` the text you send is merged over what is already stored before the lookup, so
sending only `{ "location": { "city": "Laval" } }` geocodes "Laval, QC, Canada" and not the bare word
"Laval".

Two things to know:

**It can fail, and failure is not an error.** If the geocoder is down or the address does not resolve,
the listing still saves — just without coordinates, exactly as today. You will never get a 500 from
`POST /items` because a third-party geocoder had a bad minute. Check `location.coordinates` in the
response if you want to know whether it worked.

**It is not instant.** The geocoder is rate-limited to one request a second (the provider's policy),
and every result is cached for 90 days. A listing in a city nobody has listed in before adds up to
~1 second to that one `POST /items`; the second listing in that city is free. If you see an occasional
slow create, that is this, and it is deliberate.

## 2. Geocode profile location — done

`PUT /users/profile` does the same thing, with the same merge-over-stored behaviour. So the GPS-denied
fallback you described is now buildable: read the signed-in user's `location.coordinates` from
`GET /users/profile` and use it as the centre for the feed.

Note it will be `null` for existing users until they next save their profile. Only 1 of 37 users had a
point before this. A backfill that derives points for the existing 12 users who have usable city text
is written and ready — ask and it gets run. Build the fallback to tolerate `null`, regardless.

## 3. What `distance` did on `GET /items`

**Nothing.** It was not in the Joi schema for that route, and the validator runs with
`stripUnknown: true`, so it was deleted from the query before any code saw it. No error, no warning,
no effect. That is also why it never complained about having no reference point — it never existed.

**Don't stop sending it.** It is a real parameter now: an alias for `radius`, in kilometres. If you
send both, `radius` wins. Keep sending `distance` if that is less churn for you, but you now have to
send `lat` and `lng` with it for it to mean anything — without a centre there is nothing to measure
from and it is ignored.

## 4. `lat`/`lng`/`radius` + `sortBy=distance` on `GET /items` — yes, and `lat`/`lng`/`radius` were already there

This is the one to read twice.

**`GET /items` has accepted `lat`, `lng` and `radius` since before this request.** It was in the Joi
schema and applied in the service. It was missing from the Postman collection and under-described in
Swagger, which is on us — you had no reasonable way to know. So "fold near-me into the real search and
filter flow" was available the whole time, and it works with every other filter: category, price
range, condition, city, search, pagination, all of it.

What is new:

### A circle instead of a square

The old filter was a bounding box: `radius / 111` degrees of latitude and longitude each way. That is
a square, not a circle. Asking for 20 km returned listings up to **28.2 km** away at the corners — 41%
further than requested — and it did the same thing on `/items/feed`, so your Explore on Map screen has
been showing pins outside its own radius this whole time.

It is now a real great-circle radius, backed by a geospatial index. 20 km means 20 km.

### `sortBy=distance`

```
GET /items?lat=45.5017&lng=-73.5673&radius=20&sortBy=distance&category=tools&maxPrice=50
```

Nearest first. Three things about it:

- **It needs `lat` and `lng`.** Without them it quietly falls back to `createdAt` rather than erroring
  — a map screen that has not got a GPS fix yet should still show listings, not an error dialog.
- **`sortOrder` is ignored.** Furthest-first is not a thing anyone wants.
- **It is the only sort that does not put boosted listings first.** Every other order on this endpoint
  floats boosted listings to the top. For a distance sort that would mean a boosted listing 40 km away
  appearing above one 200 m away, which just reads as a broken sort. Worth knowing if your UI mentions
  promoted listings.

Combining `sortBy=distance` with `search` works, but the keyword match becomes a substring match
rather than a full-text one for that request only — the database cannot do full-text search and
distance ordering in the same query. Practically: no stemming, so `search=drills` will not match
"drill" on that one path. If precise keyword relevance matters more than distance ordering for a given
screen, drop `sortBy=distance` and keep the radius; the radius filter works with full-text search
normally.

### `distanceKm` on every row

Every item in the response carries `distanceKm` whenever you sent `lat`/`lng`:

```json
{
  "_id": "...",
  "title": "Cordless drill",
  "distanceKm": 4.87,
  "location": {
    "city": "Montreal",
    "province": "QC",
    "country": "Canada",
    "coordinates": { "lat": 45.5032, "lng": -73.5698 },
    "geoSource": "geocoded",
    "geoPrecision": "city"
  }
}
```

- It is in **kilometres**, rounded to 2 decimals.
- It is `null` when the listing has no coordinates, or when you did not send a centre. Treat `null` as
  "unknown", not as 0 — a `0.0 km away` label on every card is a worse bug than no label.
- `/items/feed` now carries it on **all three** sections, not only `nearMe`, so you can show "4.9 km
  away" on a Popular or Recent card too.

### `/items/feed` Near Me is now actually ordered by distance

It was a bounding box sorted by `createdAt`, so the first card in "Near Me" was the *newest* listing
in a 40 km square — which could easily be the furthest one in the section. It is nearest-first now.

### One behaviour change to check in your code

`lat=0&lng=0` is now treated as **no location**, and both are ignored. It used to be accepted as a real
coordinate in the Gulf of Guinea, which matched nothing useful but did silently empty the results.
If any code path sends `0, 0` as an "unset" sentinel, it now degrades to an unfiltered list instead of
an empty one — which is almost certainly what you want, but worth knowing. Send nothing at all when
you have no fix, rather than zeros.

## 5. Street address or city-level? — send the street address, and we will tell you how exact it is

**Our recommendation: start sending `location.address` when you have it. Do not build a new screen for
it.**

The reasoning:

- Geocoding accuracy is dramatically better with a street line. City-only means **every listing in
  Montreal gets the identical coordinate** (45.5032, -73.5698 — city hall, effectively). Distances
  between two Montreal listings all read as 0.0 km, and a 5 km radius search either returns all of
  them or none, depending on where the renter is standing. That is not a usable "near me" at city
  precision inside a large city.
- Your privacy instinct is right, and it is a **display** decision, not a storage one. Store the
  precise point, and let the screen decide what to reveal. That is the normal pattern: a circle before
  booking, a pin after.

To make that decision possible without guessing, `location` now carries two extra server-maintained
fields:

| Field | Values | Meaning |
|---|---|---|
| `geoSource` | `"client"` \| `"geocoded"` | whether you sent the point or we derived it |
| `geoPrecision` | `"city"`, `"village"`, `"address"`, `"building"`, `"place"`, … | how exact it is |

So: `geoPrecision: "city"` → draw a circle and label it "Montreal", because that is genuinely all
anyone knows. `"address"` or `"building"` → you *may* draw a pin, and that is where your
reveal-after-booking rule applies.

Both are read-only. They are absent from every validator, so sending them does nothing — the server
maintains them alongside the coordinates so the two cannot drift apart.

If you would rather not touch the Add Item flow at all right now: city-level still works, it is a lot
better than the nothing we had, and the `geoPrecision` field means you can ship the circle today and
the pin later without a server change.

## 6. Radius units and default — kilometres, 20, and keep it client-supplied

- **Kilometres.** Everywhere, on every endpoint, always. It was km before too; it just was not written
  down anywhere, which is a fair complaint.
- **Default 20 km**, applied server-side when you send a centre and no radius. You can stop sending
  `radius=20`; it is the default. Sending it is harmless.
- **Capped at 500 km.** Over that you get a 400 that names the limit. This exists specifically so that
  a client that sends metres by mistake (`radius=20000`) gets told, instead of silently receiving the
  entire database as "nearby" — which is what used to happen.
- **Keep it client-supplied.** A fixed server default would mean we ship a backend change every time a
  screen wants a different radius, and your map screen and your search tab will plausibly want
  different ones. The server default is just the fallback.

---

## Why most listings still have no coordinates, and what we did about it

You were right that it is close to zero: **8 of 28 listings and 1 of 37 users** had a point.

Geocoding fixes it going forward. For what already exists, a backfill script is written. Mirroring
existing points into the new indexed field has been run. Deriving points for the records that have
none is **not yet applied** — it resolves 12 more listings and 3 more users (Montreal, Toronto,
Shefford).

The rest cannot be helped by any geocoder, because the stored text is not a place: `"Islamabad,
Canada"` (×7), `"g txyc"`, `"isb"`, `"ngtjh"`, `"shefford"` with the province field set to `"Canada"`.
Those are test records. They will miss, and that is the correct answer — which brings us to the one
thing we would ask of you.

### Please validate `city` on the client

A wrong coordinate is much worse than no coordinate. A listing with no point is invisible to nearby
search — a missing feature. A listing with a *wrong* point claims to be 20 minutes away and is not —
a broken product and a wasted trip.

We hit this hard. The first version of our geocoder took the provider's first answer, and against the
real database it put **Montreal listings in Costa Rica** and **Toronto listings in Newfoundland**, and
reported both as successes. Two causes:

1. Records here store `province: "Canada"` next to `country: "Canada"`, so the query read
   `"Montreal, Canada, Canada"` — and the provider answered with a neighbourhood called Montreal in
   Costa Rica.
2. Any result type was accepted, so `"Toronto, Canada"` matched Toronto Street Park in St. John's,
   2,000 km out.

Both are guarded now: the query is cleaned, and a city lookup can only ever return a place — never a
bank, a hotel, a park or a school whose name happens to contain the city. The junk above now misses
honestly.

But the cheapest fix is upstream: **a non-empty `city` of a couple of characters is not a city**, and
a `province` that says "Canada" is not a province. A little client-side validation on the Add Item and
Edit Profile forms would stop these from being created at all, and it makes every listing findable
instead of silently invisible.

---

## What this does **not** change

- **No new endpoint.** `GET /items` and `GET /items/feed` are the same two routes with better
  parameters. Nothing you call today breaks.
- **`city` string matching still works** exactly as before, unanchored and case-insensitive. You can
  use it alongside the radius or instead of it.
- **No new required parameters.** Everything above is optional; omitting all of it gives you today's
  behaviour.
- **Boost still floats to the top** on every sort except `sortBy=distance`.

## Status

**Built, type-checked and tested — not deployed.** Verified by 52 checks against the real database,
including the specific 28.2 km case the old bounding box got wrong.

Two things need to be run before you test against production, and both need the account owner:

1. The deploy itself.
2. The optional geocode backfill for the 12 listings and 3 users that have usable city text (your
   testing will be more convincing with it; it is not required for the code to work).

Until the deploy lands, `distance` is still silently dropped and the radius is still a square on
production. Ask for a shout when it is live.

## Suggested order on your side

1. Pull the GPS helper out of `home_explore.dart` and call it from `BrowseItemsController.onInit()`,
   as you planned. Nothing server-side blocks this.
2. Add `lat`/`lng`/`radius`/`sortBy=distance` to `browseItems()` in `item_api_service.dart`. Keep
   `distance` if you prefer the name — just send a centre with it.
3. Read `distanceKm` onto `ItemModel` and show it on the cards. Handle `null`.
4. Read `geoPrecision` and decide circle vs pin per listing.
5. Add the profile-coordinates fallback for GPS-denied. Tolerate `null` — most profiles still have no
   point.
6. Start sending `location.address` from the saved-address path, which already has the field.
7. Validate `city` and `province` on the Add Item and Edit Profile forms.
