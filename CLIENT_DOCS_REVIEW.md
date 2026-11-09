# Client documents, November 2026 — what they answer, what is still missing

Review of the seven documents in `docs/`, against the backend as deployed (commit `717b52c`).
Written 2026-11-09.

## Verdict in one line

**The policy questions are answered — almost all of them, and well. But the client has changed the
pricing model, which invalidates what is already built and live, and three things are still blocking
production.**

This is not a small update. Read "What changed" before anything else.

---

## 1. What changed, and why it matters today

### The Atussa Fee is discontinued

> "The old 3% / CAD $3.99 minimum fee is discontinued. Do not add a further fee on top of the 15%
> renter-side amount."
> — *Combined Developer Requirements, §1*

| | Built and live now | Required now |
|---|---|---|
| Owner side | 15% commission → owner gets 85% | **unchanged** — 15% → owner gets 85% |
| Renter side | Atussa Fee 3%, minimum $3.99 | **15% markup on the base price** |
| On a $100/day item | renter pays $104.59 | renter pays **$115.00** + taxes |
| Atussa gross | $18.99 | **$30.00** |

The owner side is unchanged. The renter side is completely different, and Atussa's revenue on a $100
rental goes from $18.99 to $30.00.

**What this touches:** `pricing.helper.ts` (the only place a price is computed), every stored booking
breakdown, `ATUSSA_FEE_EXPLAINER`, the quote endpoint, `GET /payments/config`, the app's checkout
screen, and the admin panel's finance figures. The 39 pricing tests that currently pass against the
client's own earlier worked example all become wrong.

### The renter must no longer see the breakdown

> "The renter must see ONLY the final rental price of $115 + applicable taxes per day… Do not show
> the $100 base price, the 15% renter-side markup, the owner commission, an itemized service fee, or
> an explanation of our margin in the renter-facing pricing UI."
> — *Combined, §1*

Today `POST /bookings/quote` returns the full itemized breakdown and the app renders an "Atussa Fee"
line with a "?" explainer next to it. **That line has to disappear from the renter's view entirely.**

Note the backend must still *track* every component — "keep price, markup, commission, taxes, hold,
refunds and payout separately traceable internally". So the breakdown stays in the database and stays
visible to the owner and to admins; only the renter-facing response changes. The owner must see
"You earn $85/day" live as they type a price.

### The security deposit is back

It was explicitly removed — `CLAUDE.md` currently records "Security deposit: **none.** Nothing in this
codebase ever refunded one, and the client's model has none", and `securityDeposit` is hard-coded to
`0`. It now returns as a **per-listing, owner-chosen amount, held as a card pre-authorization, never
charged upfront**, with a whole claims process attached.

This is the single largest piece of new work in the set.

---

## 2. What is now answered — the open questions are closed

Every question in `PAYMENT_POLICY_DECISIONS.md` except two now has an answer:

| Our question | Their answer |
|---|---|
| Q1 — cancel before start | **More than 48h: 100% refund** incl. renter markup + refundable taxes, deposit released. **24–48h: 50% of base price automatically**, owner may voluntarily approve the other 50%. **Under 24h: no refund.** |
| Q2 — is the Atussa Fee refundable | **Yes over 48h. No under 48h** (both the 24–48h and under-24h cases), subject to applicable law. |
| Q3 — paid 10 days, cancels on day 5 | **No automatic refund.** The renter may *request* a partial refund; the owner may approve a specified amount or decline. New request/approve flow to build. |
| Q4 — when the owner gets paid | **At the end of the scheduled rental period**, with no extra 24/48h claims wait. This is the change we recommended. |
| Q5 — damage with no deposit | Resolved by reinstating the deposit, as a hold. |
| Owner cancellation (our Part 4) | **Yes, owners can cancel.** Mandatory reason from a fixed category list, free-text required for "Other", evidence permitted. Renter gets 100% back incl. the 15% and taxes; Atussa keeps no commission. **Three unjustified cancellations in a rolling 90 days → temporary suspension**, with admin review and appeal. No automatic financial penalties at launch. |

Also newly specified: the four photo checkpoints, the 24-hour inspection window and its reminder
schedule (12h / 22h / 24h), the claims state machine, and three full state lists for bookings,
deposits and payments.

**Two of our questions are still unanswered:** Q6(a), when an accepted-but-unpaid booking should
expire and free the dates, and Q6(b), what marks a rental complete. Q6(b) matters more than before,
because the owner's payout now depends on the rental period ending.

---

## 3. What is still missing — the answer to "is it complete?"

**No. Three hard blockers and eleven specification gaps.**

### Blocker 1 — The tax base is not confirmed, and they say so themselves

> "Based on guidance received **by phone** from Revenu Québec, calculate GST/QST on the applicable
> **total taxable transaction amount, not just Atussa fees**. **Confirm the exact tax-base and
> allocation rules in writing before production.**"
> — *Combined, §3*

This is a fundamental change. Today we tax only the Atussa Fee and the owner commission. Taxing the
total transaction produces different numbers for every booking, changes what Atussa remits, and
changes what an owner is told they earn.

**We cannot write the new pricing engine until this is confirmed in writing.** Building it on a phone
call means rebuilding it. This is the first thing to chase.

Related and also unspecified: owners who are GST/QST registered get tax allocated to them; owners who
are not have it retained by Atussa. We need the field list, the number formats to validate, and what
happens when an owner's registration status changes mid-rental.

### Blocker 2 — A card hold cannot last as long as the rentals they want to support

The deposit depends on a card pre-authorization. Card authorizations expire — the widely documented
default is around **7 days**, and "extended authorization" beyond that is generally restricted to
specific merchant categories such as lodging and car rental. *We have not been able to confirm the
current Stripe figures in this session and must do so before answering formally.*

The problem this creates:

- A rental longer than the hold window cannot be covered by one authorization.
- A booking made weeks in advance cannot be authorized at booking time and still be valid at handover.

The client is aware and asks us to confirm it (§11). But once we do, **the product decision is
theirs**, and they have not made it:

- Authorize at **handover** rather than at booking? (Changes the booking flow — the deposit is not
  secured when the renter books.)
- **Cap rental length** to what a hold can cover?
- **Re-authorize** mid-rental? (Needs the renter present for authentication, and it can be declined.)
- Accept that long rentals have **no deposit guarantee**, and say so plainly?

Their own legal text already hedges this — *"Atussa does not represent that funds are guaranteed"* and
*"may limit or decline the booking rather than promise a hold that cannot be maintained"* — but a
hedge is not an implementation.

**Nothing in §1–§10 says when the authorization is created.** That single missing sentence decides
whether this is a problem at all.

### Blocker 3 — There is no French

Every document is marked "English version for review". But:

- §11 requires user-facing wording **in French and English**.
- The Smart Catalog spec requires `name_fr` on every category, subcategory and item type, plus French
  and Québec-specific aliases for search.
- The deposit tooltip, the "Learn More" page, cancellation conditions and claim wording are all
  renter- and owner-facing.

No French copy has been supplied for any of it. This blocks the catalog module and every user-facing
string.

### The eleven specification gaps

1. **Exact arithmetic for the 24–48h refund.** "Refund 50% of the base rental price" — what happens to
   the taxes on the refunded half, and to the owner's 85% of it? The over-48h case says "plus
   corresponding refundable taxes"; the 24–48h case is silent.
2. **Who absorbs Stripe's processing fee on a full refund.** Stripe does not return it. On a $115
   booking that is roughly $3.60 gone. For an owner cancellation Atussa keeps no commission, so Atussa
   is out of pocket on every one. Confirm that is intended.
3. **How the system learns the actual handover and return times.** The entire 24-hour claim window
   hangs off "actual return time", and the new booking states include "Ready for handover" and
   "Awaiting return". The spec says the app "must record actual handback time reliably and provide a
   resolution process if the parties disagree" — but not who presses what. This is load-bearing for
   money and needs their sign-off, not our invention.
4. **Deposit minimum and maximum.** The owner sets any amount. A $5,000 deposit on a $20 drill will
   fail on most cards and looks abusive. Needs a cap, or a rule tied to item value.
5. **Claims versus the existing Disputes module.** A disputes feature already exists — evidence
   upload, admin resolution, signed evidence URLs. The new claims flow has its own eight states and
   its own 24-hour windows. Are these the same system or two? If separate, what happens when a claim
   is rejected and the renter escalates?
6. **Early return: what if the owner declines the partial refund?** No escalation path. Can an admin
   override, and on what basis?
7. **What makes an owner cancellation "unjustified".** The three-strike suspension depends entirely on
   this word, and nothing defines it. Admins can reverse a strike, but they need a default rule to
   reverse.
8. **The listing's local time zone.** Cancellation windows are calculated in it. Listings have no time
   zone field. Derive it from the coordinates we now store, or ask the owner?
9. **Age 18+** is now a Terms requirement. Date of birth is currently optional and never checked. What
   happens to existing accounts with no date of birth — blocked, prompted, or grandfathered?
10. **Booking expiry and rental completion** — our Q6(a) and Q6(b), still open, and now more important
    because the payout triggers on the rental period ending.
11. **Deposit "Learn More" content is supplied but marked draft.** Document 05 exists, which closes the
    placeholder the combined doc asked for — but like all five policy documents it says "Draft for
    review before publication" and "must be confirmed with the payment provider". We should not ship
    legal text that is still in review.

### Still open from before these documents, and untouched by them

- **The Stripe platform profile's negative-balance liability choice** — it shortens owner onboarding
  and is unrelated to anything in these documents.
- **No owner has completed Stripe onboarding**, so a real end-to-end payout has still never run.

---

## 4. What the client has asked us for

> "Please identify which features already exist, required changes, technical limitations, any
> additional development cost and recommended implementation plan."
> — *Combined, §11*

They want a written gap analysis, an estimate and a plan back from us. That is a deliverable we owe
them, and it is the natural place to answer the Stripe hold questions in §11 formally.

---

## 5. The scale of what is being asked

For context when quoting. Roughly, against what exists today:

| Area | Status |
|---|---|
| Owner 15% commission | **Exists** — unchanged |
| Renter pricing | **Rewrite** — 3%/$3.99 fee becomes a 15% markup |
| Tax calculation | **Rewrite** — new base, plus per-owner allocation by registration status |
| Renter-facing price display | **Change** — must hide the breakdown the app currently shows |
| Cancellation policy and refunds | **New** — nothing exists; refunds today are all-or-nothing and admin-only |
| Partial refunds | **Small** — Stripe supports it, nothing calls it yet |
| Owner payout at rental end | **Medium** — today the owner is paid the instant the renter pays |
| Security deposit: hold, release, partial capture | **New** — largest single item |
| Claims module, 8 states, admin review, appeal | **New** |
| Four photo checkpoints + reminders | **New** — booking photo upload exists and was just fixed; the prompts, timing and reminders do not |
| New booking / deposit / payment state machines | **Rewrite** — today: 6 booking states, 4 payment states, no deposit states |
| Owner cancellation + 3-strike tracking | **New** |
| Scheduler for every timed step | **New infrastructure** — there is still no scheduled job anywhere in the backend, and the deposit release, the reminders, the payout trigger and the booking expiry all need one |
| Smart Rental Catalog (12 categories, subcategories, item types, bilingual aliases, classification engine, admin dictionary, semantic search) | **New module** — today there are 20 flat English category slugs, no subcategories, no translations, no aliases, no eligibility rules |
| Prohibited / restricted item enforcement | **New** — needs per-item-type eligibility status |
| French throughout | **New** |

The Smart Rental Catalog is effectively a second project alongside the payments work, and the two are
independent — they could run in either order.

---

## 6. What we should send back

In priority order:

1. **Get the Revenu Québec tax-base confirmation in writing.** Everything about pricing waits on it.
2. **Answer §11's Stripe questions formally**, and with the answer, put the deposit-timing decision
   back to them: authorize at booking or at handover, and what happens to rentals longer than a hold
   can last.
3. **Ask for the French copy**, and for the eleven gaps above.
4. **Deliver the gap analysis, estimate and plan** they asked for.

One thing worth saying plainly to them: the current live pricing is now wrong by their own
specification. Until the rewrite ships, every booking is charged the old 3% / $3.99 fee. That should
be a scheduling decision they make knowingly, rather than something they discover later.
