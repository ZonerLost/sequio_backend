# The rental catalogue — what changes for the app

Backend, November 2026. Everything here is **additive**: the current app keeps working unchanged. You
can adopt it screen by screen.

Three endpoints matter to you. One is new behaviour on an endpoint you already call.

---

## 1. `GET /items/catalog` — the picker

Public, no auth. The whole tree in one call: **12 categories → 88 subcategories → 31 item types**.

```json
[
  {
    "slug": "tools_home_improvement",
    "nameEn": "Tools & Home Improvement",
    "nameFr": null,
    "subcategories": [
      {
        "slug": "specialized_cleaning",
        "nameEn": "Specialized cleaning",
        "nameFr": null,
        "itemTypes": [
          {
            "slug": "pressure_washer",
            "nameEn": "Pressure washer",
            "nameFr": null,
            "eligibility": "allowed",
            "eligibilityNote": null
          }
        ]
      }
    ]
  }
]
```

**Store and compare `slug`, never a name.** The names are display only and the client will be
renaming them. A slug never changes; that is the whole point of it.

**`nameFr` is `null` everywhere right now.** The client has supplied no French display copy — every
document they sent is marked "English version for review". They fill it in through the admin panel,
so it will start appearing **without a backend deploy or an app release**. So: render
`nameFr ?? nameEn` and don't hardcode anything.

Cache it for a session. It is ~15 KB and changes rarely, but it *does* change — don't bake it into
the binary.

---

## 2. `GET /items/classify?title=…` — the suggestion

Public, no auth. Call it as the owner types the title on Add Item, debounced ~400 ms, from 2
characters.

```json
{
  "suggestions": [
    {
      "itemType": "pressure_washer",
      "itemTypeName": "Pressure washer",
      "subcategory": "specialized_cleaning",
      "category": "tools_home_improvement",
      "categoryName": "Tools & Home Improvement",
      "eligibility": "allowed",
      "eligibilityNote": null,
      "confidence": 0.85,
      "matchedOn": "power washer",
      "matchKind": "synonym"
    }
  ],
  "ambiguous": false,
  "unrecognised": false
}
```

### The one field you must respect: `ambiguous`

**When `ambiguous` is `true`, show the choices. Do not pre-select the first one.**

This is not a style preference. "Kärcher" makes pressure washers, carpet cleaners *and* steam
cleaners, so the backend deliberately refuses to pretend it knows which. The client's own acceptance
criterion is that it "returns reasonable options instead of one falsely certain category". If you
auto-select the top suggestion, you have put the falsely certain answer back.

| State | What to show |
|---|---|
| `unrecognised: true` | Nothing matched. Let them pick manually from the catalogue. |
| `ambiguous: true` | A chooser with the 2–3 suggestions. Nothing selected. |
| otherwise | Pre-select the top suggestion, still editable. |

### It works in French and English, in one field

No language switch, no locale parameter. `laveuse à tapis`, `shampouineuse` and `carpet cleaner` all
resolve to the same item type. Accents, case, plurals and single-character typos are handled
(`ponceusse` → sander), and a word inside a sentence is found (`looking to rent a paddleboard for
the weekend` → paddleboard). Mixed languages in one title work too.

### `eligibility` — show it before they finish typing

| Value | What it means | What to do |
|---|---|---|
| `allowed` | Fine | Nothing |
| `conditional` | Listable, but the owner has requirements | **Show `eligibilityNote`.** It says what they have to satisfy — safety gear, a licence, registration |
| `under_review` | Not listable yet | Tell them, with the note |
| `prohibited` | Cannot be listed | Tell them **here**, not after they have filled in six more fields and uploaded photos |

Catching a prohibited item at the title field instead of at submit is the difference between a
two-second correction and a wasted five minutes.

---

## 3. `POST /items` and `PUT /items/:id` — two new optional fields

```json
{
  "title": "Kärcher K5 pressure washer",
  "category": "tools_home_improvement",
  "subcategory": "specialized_cleaning",
  "itemType": "pressure_washer"
}
```

`subcategory` and `itemType` are **new and optional**. They are exactly the fields
`/items/classify` returns, so you can copy the chosen suggestion straight across.

`category` now accepts **either** vocabulary — the 20 legacy slugs you send today (`tools`,
`sports`, `other`…) or a slug from the new catalogue. Both keep working indefinitely. If you send
only a legacy slug, the backend maps it to the new tree as best it honestly can.

### Why send `itemType`

Because **eligibility can only be enforced against an item type**, not against words. Sending one
means the owner gets a clear, specific refusal at submit instead of a listing an administrator
removes a week later with no explanation.

### The new response field: `taxonomy`

```json
{
  "_id": "…",
  "title": "Kärcher K5 pressure washer",
  "category": "tools_home_improvement",
  "taxonomy": {
    "category": "tools_home_improvement",
    "subcategory": "specialized_cleaning",
    "itemType": "pressure_washer",
    "source": "owner",
    "classifiedAt": "2026-11-10T14:22:05.113Z"
  }
}
```

Note the shape difference: you **send** `subcategory`/`itemType` flat, and you **read** them back
under `taxonomy`. (`location.coordinates` and `location.geo` already work this way.)

**Every field inside `taxonomy` can be `null`, and the whole object can be absent** on listings
created before this shipped. A listing whose legacy category was `other` has no honest place in the
new tree, and the backend says so with nulls rather than filing it somewhere plausible. Treat
`taxonomy?.category == null` as "uncategorised", not as an error.

`source` tells you who decided: `owner` (they picked it), `classified` (we worked it out from the
title), `legacy_map` (derived from the old category).

### ⚠️ The one new error you have to handle: **422**

A prohibited or restricted item now gets:

```http
HTTP/1.1 422 Unprocessable Entity

{
  "success": false,
  "message": "This item cannot be listed on Atussa. Child car seats cannot be rented: safety recalls and crash history cannot be verified."
}
```

**Show `message` verbatim.** It is the policy reason and it is the only thing that tells the owner
why. A generic "something went wrong" here is actively worse than nothing — they will try again,
get the same result, and contact support.

422 and not 400 on purpose: the request was perfectly well formed. If your error handling branches
on status code, add 422 alongside 400; if it just reads `message`, you already work.

This applies to `PUT` too — editing a listing into a prohibited item is refused the same way.

---

## 4. `GET /items` — three ways to filter

```
GET /items?category=tools                     ← what you send today, unchanged
GET /items?category=tools_home_improvement    ← new vocabulary
GET /items?subcategory=power_tools            ← new
GET /items?itemType=drill                     ← new, narrowest
```

`category` takes either vocabulary and finds the right listings in both. A precise legacy slug is
translated to the level it actually means: `?category=cameras` returns Photography & video, not the
whole of Electronics & Technology.

`subcategory` and `itemType` combine with `category`, `search`, `city`, price, `condition` and the
location parameters. They are **narrow** — `?itemType=drill` returns only listings placed on exactly
that type.

> **Right now `?subcategory=` and `?itemType=` return nothing**, because the migration that places
> existing listings in the tree has not been run yet. The endpoints are live and correct; the data
> arrives when that script runs. `?category=` works in both vocabularies today. Don't build a
> subcategory filter UI as your only way to browse until that has happened.

---

## Suggested order of work

1. **`nameFr ?? nameEn` everywhere**, and handle `taxonomy` being null or absent. Both are one-liners
   and both will otherwise bite you later.
2. **Handle 422 by showing `message`.** Smallest change, biggest effect on a user who hits it.
3. **`/items/classify` on the title field**, with `ambiguous` respected. This is the feature.
4. **`/items/catalog` as the picker**, replacing the hardcoded 20 categories.
5. **Send `subcategory` + `itemType`** from the chosen suggestion.
6. **Subcategory / item-type filters in search** — last, once the migration has run.

Steps 1 and 2 are worth shipping on their own. Nothing else depends on them and nothing breaks if
the rest waits.

---

## Two things that are not ready, so you can plan around them

- **French display names: none yet.** Search already works in French (the French *synonyms* are
  seeded — those came from the client's own table); only the labels are missing. They arrive through
  the admin panel with no release on either side.
- **The alias dictionary is thin in places.** It holds what the client's specification listed — 53
  entries. Real gaps exist: "Mountain Bike - Trek 820" does not currently classify to `bicycle`,
  because `bike` is not in their table. An administrator adds it and it works on the next request,
  for every installed copy of the app, with no release. If you hit a term that obviously should
  resolve and does not, that is a dictionary entry to request, not a backend bug.
