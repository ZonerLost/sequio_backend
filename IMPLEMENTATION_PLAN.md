# Implementation plan — November 2026 requirements

Plan for delivering the client's November 2026 documents. Written 2026-11-09 against commit
`eb04ad7`. Read `CLIENT_DOCS_REVIEW.md` first — this plan assumes its findings.

This also answers what the client asked for in §11: what already exists, what has to change, the
technical limitations, and a recommended sequence.

---

## The shape of the problem

Three blockers gate **different** parts of the work, which is the key to sequencing this. Almost
nothing has to wait for all three.

| Blocker | Gates | Does **not** gate |
|---|---|---|
| Tax base unconfirmed | Going live with new prices | Building the pricing engine |
| Deposit hold duration / timing | The deposit and claims flow | Everything else |
| No French copy | Launch of user-facing text | Schema, logic, engine work |

And one piece of infrastructure gates almost everything: **there is no scheduler anywhere in this
backend**, and at least six new behaviours need one.

So: build the scheduler first, build the pricing engine behind a switch while the tax base is being
confirmed, and run the catalog as a parallel track that touches none of it.

---

## Phase 0 — Unblock (no code, start today)

Runs alongside Phase 1. Nothing here is ours to decide.

1. **Get the Revenu Québec tax base in writing.** Their words, not ours: confirm before production.
2. **Confirm Stripe's hold mechanics in writing and answer §11** — authorization validity, extended
   authorization eligibility and any merchant-category restriction, partial capture, expiry
   behaviour, and whether manual capture is usable with Connect destination charges.
3. **Put the deposit timing decision back to them** with the Stripe answer in hand. This is the one
   question that decides whether the deposit works at all for long or far-future rentals:
   authorize at booking, or at handover, and what happens when a rental outlasts a hold.
4. **Request the French copy** for every user-facing string, and the eleven specification gaps.
5. **Confirm claims vs. the existing Disputes module** — one system or two.

**Also unrelated but still outstanding:** the Stripe platform profile's negative-balance liability
choice, and getting one owner through onboarding so a real payout can be proven. The payout change in
Phase 2 cannot be verified end-to-end until an owner reaches `active` with the `transfers` capability.

---

## Phase 1 — Foundations

**Blocked by: nothing. This is the critical path — start here.**

### 1a. The scheduler

Six things need it: the owner payout at rental end, the 24-hour deposit auto-release, the 12h/22h/24h
inspection reminders, the 30-minutes-before-return photo reminder, unpaid-booking expiry, and rental
auto-completion.

**Constraint: no new npm dependency can ship.** A `package.json` change cannot go through the
crane-append deploy; it needs a real image build and this machine has no Docker. That rules out
`node-cron`, `agenda` and `bullmq` unless we change how we deploy.

**Recommended: an in-process interval with a MongoDB lease.** Each job tries to claim a lease
document (`findOneAndUpdate` with an expiry) before running, so only one instance ever executes a
tick. No dependency, no new infrastructure, and it stays correct if App Runner ever scales past one
instance — which today's realtime code already quietly assumes it will not.

The alternative, if we would rather not run timers in the API process, is an EventBridge schedule
calling a protected internal endpoint. Also dependency-free, but it adds infrastructure to maintain.

Either way the jobs must be **idempotent** and must record what they did — these ticks move money.

### 1b. The state machines

Today: 6 booking statuses, 4 payment statuses, no deposit concept. Required: 8 booking states, 7
payment states, 9 deposit states, tracked **independently** of each other.

- Deposit state is new and self-contained.
- Payment state extends the existing field.
- Booking state is the risky one. `pending → accepted` becomes `Pending → Confirmed`, and new states
  (`Ready for handover`, `Awaiting return`, `Returned awaiting inspection`) sit between `Confirmed`
  and `Completed`. **Existing bookings must be read as-is**, the same rule we applied when
  `paymentStatus` was added — a missing value is not the default value. That trap is now DO-NOT #13.

### 1c. Handover and return timestamps

Everything downstream hangs off "actual return time": the 24-hour claim window, the deposit release,
the payout. Nothing records it today and the spec does not say who presses what.

Build it, but get the flow signed off rather than inventing it: who confirms handover, who confirms
return, what happens when the two disagree (the spec requires a resolution process), and what the
fallback is when neither party confirms anything.

### 1d. A money audit trail

The spec requires price, markup, commission, taxes, hold, refunds and payout to be "separately
traceable internally". Today the breakdown is stored on the booking but there is no event log. Every
charge, refund, transfer, hold, capture and release needs a row saying what moved, when, why, and on
whose authority. Build it now, before the things that write to it.

---

## Phase 2 — Pricing and payouts

**Blocked by: Phase 1. Tax base confirmation blocks *shipping*, not *building*.**

### 2a. Rewrite the pricing engine

`pricing.helper.ts` stays the only place a price is computed. The 15% / 15% structure is unambiguous
and can be built now:

```
owner base $100  →  owner receives $85  (15% commission)
                 →  renter pays   $115  (15% markup)
                 →  Atussa gross   $30
```

**Build the tax base as a strategy, not a constant.** We know two things: the base is changing from
"fees only" to "total taxable transaction amount", and allocation depends on whether the owner is
GST/QST registered. Both mean the tax step has to be swappable anyway. Doing that lets the rewrite
proceed now and flip when the written confirmation arrives, instead of waiting and then rebuilding.

Keep every existing guarantee: integer-cent arithmetic, the full breakdown stored on the booking and
never recomputed, and bookings priced under an older model read exactly as they were agreed. There
are now **three** pricing eras — pre-September, the 3%/$3.99 model, and this one.

### 2b. Renter-facing display

The renter sees one number plus the legally required tax line. No base price, no markup, no
commission, no itemized fee, no explainer. The owner sees "You earn $85/day", calculated live as they
type.

The breakdown stays in the database and stays visible to owners and admins — only the renter-facing
response changes. `ATUSSA_FEE_EXPLAINER` is retired.

**This needs a coordinated app release.** The backend cannot hide a line the app renders from its own
copy, and the app cannot show a number the backend no longer sends. Plan them together.

### 2c. Switch from destination charges to separate charges and transfers

This is the architectural change that makes the rest possible, and it is worth stating plainly.

Today the rental is a **destination charge**: the owner's share transfers the instant the renter pays.
The new requirement is that the owner is paid when the rental period ends. A destination charge
cannot be delayed — the transfer happens at capture.

So: charge the renter to the **platform** balance, then create a **transfer** to the owner when the
scheduler fires at the end of the rental period. This also makes every refund scenario clean, because
until that transfer runs, no money has left Atussa and nothing has to be clawed back from an owner who
may already have withdrawn it.

Three things to keep from the current implementation: the per-attempt idempotency key, the refusal to
create a second intent when one is already `succeeded` or `processing`, and the refusal to price a
booking that has no stored owner payout.

### 2d. Cancellation and refunds

| Window | Renter gets | Notes |
|---|---|---|
| > 48h before start | 100% including the 15% and refundable taxes | release the deposit hold |
| 24–48h | 50% of base automatically; owner may approve the other 50% | the 15% is non-refundable |
| < 24h | nothing | release the hold, allocate retained price 85/15 |

Apply the 50% immediately without waiting for the owner, then notify them with the two options. Show
the cancellation conditions **before** booking and the refundable amount **before** cancelling.
Calculate in the **listing's local time zone** — a field that does not exist yet and which we can
derive from the coordinates we now store.

Partial refunds are a small piece of work: Stripe supports them and the price calculator already
handles any number of days; nothing calls either today.

### 2e. Early-return refund requests

Renter requests an amount, owner approves or declines. No automatic refund. Needs commission and tax
adjustment, notifications and an audit trail — and an answer on what happens when the owner declines.

---

## Phase 3 — Security deposit

**Blocked by: the Phase 0 authorization-timing decision. Do not start before it.**

The deposit is a **separate authorization from the rental payment**, and it must **not** carry
`transfer_data` — Atussa holds it, not the owner. That means two PaymentIntents per booking, which
the app has to collect in one checkout flow.

Work: the owner-editable deposit field with a min/max rule, the tooltip and the Learn More link, the
authorization at whatever moment is agreed, the nine deposit states, release on no-claim, partial
capture on an approved claim, and honest handling of expiry, insufficient credit and declines.

Two rules from their own documents that must be enforced in code, not just written in the policy:

- **Never show an expired authorization as a secured deposit.**
- **Never capture the full deposit just because a claim exists.** Capture only a supported amount.

---

## Phase 4 — Claims and photo documentation

**Blocked by: Phase 1 and Phase 3, plus the claims-vs-disputes answer.**

The claims flow is fully specified: the owner's 24 hours from actual return, the structured claim
form, the renter's 24 hours to respond, explicit "silence is not consent", eight claim states, admin
review with partial approval, and an appeal path.

A disputes module already exists with evidence upload, admin resolution and signed evidence URLs. The
cheapest correct answer is probably to **extend it** rather than build a parallel system — but that is
their call, and it changes the estimate.

The four photo checkpoints are mostly prompts and timing rather than new storage. Booking photo upload
already exists and was fixed last week; what is missing is the prompts at each checkpoint, the
reminders, and linking media to uploader and timestamp for claim review. Photos are **encouraged, not
mandatory** at launch.

---

## Phase 5 — Owner cancellation and strike tracking

**Blocked by: nothing beyond Phase 1. Can run early — it is fully specified and independent.**

Mandatory reason from a fixed category list, free text required for "Other", optional evidence, full
log. Renter refunded 100% including the 15% and taxes, hold released, Atussa keeps no commission.

Strikes: first = warning, second within a rolling 90 days = second warning, third = temporary
suspension from receiving new bookings, with admin review and appeal. No automatic financial
penalties at launch.

Needs one answer before building: **what makes a cancellation "unjustified"**, since the whole
mechanism turns on that word.

---

## Phase 6 — Smart Rental Catalog

**Independent track. Can start day one and shares nothing with the payments work.**

Today: 20 flat English category slugs, no subcategories, no translations, no aliases, no eligibility.
Required: 12 top-level categories, subcategories, standardized item types, bilingual aliases including
Québec expressions and common misspellings, a classification engine that suggests a category from a
free-text title, an admin dictionary that changes behaviour **without an app release**, and eligibility
enforcement for prohibited and restricted items.

Buildable now: the schema, the classification and search engine, the admin tooling, and migration of
the existing 20 categories and every live listing onto the new taxonomy.

Blocked only on French display names and aliases for launch.

Two details from their spec worth keeping visible: **never use translated labels as identifiers**, and
**preserve historical listings when a category is renamed, merged or deactivated**. Both are easy to
get wrong once and painful to undo.

---

## Phase 7 — Compliance

- **18+ check.** Now a Terms requirement. Date of birth is optional today and never validated. Needs a
  decision on existing accounts with no date of birth: blocked, prompted on next login, or
  grandfathered.
- **Owner tax registration** — fields, number-format validation, and behaviour when status changes
  mid-rental.
- **Legal pages** served in the app, from final text rather than the current drafts.
- **Bilingual strings** everywhere.

---

## Sequencing

```
Phase 0  Unblock ........... ongoing, no code
Phase 1  Foundations ....... scheduler, states, timestamps, audit trail   ← critical path
Phase 2  Pricing & payouts . needs Phase 1; ships when tax base confirmed
Phase 3  Deposit ........... needs the Phase 0 timing decision
Phase 4  Claims & photos ... needs Phases 1 and 3
Phase 5  Owner cancellation  needs Phase 1 only — can run early
Phase 6  Smart Catalog ..... fully parallel from day one
Phase 7  Compliance ........ anytime
```

### Rough effort

Estimates, not quotes, and they assume one backend developer with the app and admin panel moving in
step. The Smart Catalog assumes no machine-learning work — rules, synonyms and fuzzy matching, which
is what the acceptance criteria actually describe.

| Phase | Estimate |
|---|---|
| 1 — Foundations | 1.5–2 weeks |
| 2 — Pricing & payouts | 2–3 weeks |
| 3 — Deposit | 2–3 weeks |
| 4 — Claims & photos | 2–3 weeks |
| 5 — Owner cancellation | 1 week |
| 6 — Smart Catalog | 3–4 weeks (parallel) |
| 7 — Compliance | 1 week |

Payments track: roughly **9–13 weeks**. With the catalog running in parallel rather than after, the
whole set lands in about the same window.

Excluded: app and admin-panel work, translation, legal review, and any rework if the tax base comes
back structurally different from what we have assumed.

---

## Risks

1. **The tax base changes the maths after we build it.** Mitigated by making it a strategy, not
   mitigated entirely. The written confirmation is worth chasing hard.
2. **The hold duration forces a product change late.** If a single authorization cannot cover their
   rental lengths, the answer is a product decision — cap rental length, authorize at handover, or
   drop the guarantee — and it is much cheaper before Phase 3 than during it.
3. **Backend and app must ship together** for the price display. A backend-only release shows renters
   a stale fee line; an app-only release shows a number the backend is not sending.
4. **No owner has ever completed Stripe onboarding.** The payout change cannot be verified end to end
   until one does, and the `transfers` capability is exactly what is currently restricted. This is a
   quiet blocker on proving Phase 2 works.
5. **The scheduler runs in the API process** under the recommendation above. The Mongo lease makes it
   safe to scale, but the jobs must stay idempotent — a retried tick must not pay an owner twice.
6. **Three pricing eras now coexist.** Every report, refund and payout path has to read a booking's
   stored breakdown rather than recompute it.

---

## What can start tomorrow

Without a single answer from the client:

- The scheduler and its Mongo lease.
- The three state machines and the migration for existing records.
- Handover and return timestamp recording.
- The money audit trail.
- The Smart Catalog schema and classification engine.
- Owner cancellation and strike tracking.

That is Phase 1, Phase 5 and most of Phase 6 — comfortably enough work to run while Phase 0 is
resolved, and all of it is needed whatever the client answers.
