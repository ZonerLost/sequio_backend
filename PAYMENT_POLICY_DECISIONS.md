# Payments, cancellations and refunds — how it works today, and what we need decided

For the client discussion. Written 2026-10-28 against the live backend.

**The headline: the charging works, but there is no cancellation or refund policy in the system at
all.** A renter who pays for 10 days and cancels on day 5 currently gets **nothing back**, and the
only way to give them anything is for an administrator to notice and refund the whole amount by hand.
There is no middle option.

Nothing in this document is built yet except where it says "today". The decisions in Part 3 are what
we need before building any of it.

---

## Part 1 — How money moves today

1. **Renter requests a booking.** No card is touched. Nothing is charged, nothing is held.
2. **Owner accepts or declines.** Still no money. Declining ends it cleanly.
3. **Renter pays.** They cannot pay before the owner accepts — the system refuses it. This is the
   first and only moment money moves.
4. **The whole amount is taken at once, and the owner is paid immediately.** On a $20/day item for
   10 days: the renter is charged **$206.90**, and **$165.51 lands in the owner's account the same
   second** — before the item has been handed over. Atussa keeps $36.00 and sets aside $5.39 of tax
   to remit.
5. **The rental happens.** Nothing in the system tracks this. No reminders, no automatic start, no
   automatic end.
6. **The owner marks it complete.** Only the owner can do this. If they never do, the booking stays
   open forever. Marking it complete moves no money, because the money already moved at step 4.

**There is no security deposit.** That was decided earlier and matches the agreed pricing model, so
there is no pot of money to draw on if an item comes back damaged.

---

## Part 2 — Every case, and what happens today

| # | Situation | What happens today |
|---|---|---|
| 1 | Renter requests, then changes their mind before the owner responds | Cancels free. Correct. |
| 2 | Owner declines the request | Ends cleanly, no money involved. Correct. |
| 3 | Owner accepts, renter then cancels before paying | Cancels free. Correct. |
| 4 | **Owner accepts, renter simply never pays** | The dates stay blocked indefinitely. Nothing expires, nothing chases them, the owner cannot re-list those dates. **Gap.** |
| 5 | Renter pays, then cancels before the rental starts | **Gets nothing back automatically.** An admin can refund 100% by hand. **Needs a policy.** |
| 6 | **Renter pays for 10 days, cancels on day 5** | **Gets nothing back automatically.** Admin can only refund 100% or 0%. **Needs a policy.** |
| 7 | Owner wants to cancel after accepting — item broke, they changed their mind | **The owner cannot cancel at all.** No button, no endpoint. They have to ask an administrator. **Gap.** |
| 8 | Owner never hands the item over | Renter has paid, owner already has the money. Only route is an admin refunding everything, which pulls the money back out of the owner's account. **Needs a policy.** |
| 9 | Renter doesn't return the item, or returns it damaged | No mechanism. A dispute can be raised and evidence uploaded, but **resolving a dispute moves no money whatsoever** — and with no deposit there is nothing to draw on. **Gap.** |
| 10 | Renter returns the item early and both sides are happy | No way to settle at a lower price. The renter has paid the full amount. **Needs a policy.** |
| 11 | Rental ends normally | The owner marks it complete. Nothing to settle, money already moved. Correct. |
| 12 | Owner never marks it complete | The booking stays open forever. No effect on money, but the records drift and "active rentals" counts are wrong. **Gap.** |
| 13 | Renter tries to pay twice | Properly blocked. Cannot be double-charged. Correct. |

Five of these say **Gap** — they need a decision even if the refund policy stays exactly as it is.

---

## Part 3 — The decisions we need

### Q1. A renter cancels **before** the rental starts. What do they get back?

Using the $20/day × 10 days example, where they paid **$206.90**:

| | Renter gets back | Owner keeps |
|---|---|---|
| **A** — Full refund, any time before the start date | $206.90 | $0 |
| **B** — Full refund if cancelled more than 24h (or 48h) before the start; nothing after that | $206.90 or $0 | $0 or $165.51 |
| **C** — Full refund minus the Atussa Fee and its tax | $200.52 | $0 |

**Our suggestion: B with a 48-hour window, combined with Q2.** An owner who turns down other
bookings and then gets cancelled the night before has a real loss; a renter who changes their mind a
week out does not deserve a penalty.

**If you pick B, we need the window length from you** — 24 hours, 48 hours, or something else.

---

### Q2. Is the **Atussa Fee** (3%, minimum $3.99) refundable?

This is Atussa's own revenue, separate from the owner's money. On the example above it is **$6.00 plus
$0.90 tax**.

| | |
|---|---|
| **A** — Refundable before the rental starts, not after | Renter who cancels early is made whole; once the item has changed hands Atussa has done its job |
| **B** — Never refundable | Better for revenue, but a renter who cancels ten minutes after paying is out $6.90 with nothing to show for it, which reads as a penalty |
| **C** — Always refundable | Friendliest, but Atussa still pays card-processing costs on every cancelled booking and earns nothing |

**Our suggestion: A.**

Note: Atussa pays Stripe's processing fee (roughly 2.9% + 30¢ ≈ **$6.30** on this booking) and
**Stripe does not return it on a refund.** So a full refund costs Atussa real money regardless of
which option you choose. Worth the client knowing.

---

### Q3. A renter cancels **during** the rental — paid 10 days, cancels on day 5. What do they get back?

| | Renter gets back | Owner keeps |
|---|---|---|
| **A** — Charged for the days used, refunded the rest | **$102.31** | $82.75 |
| **B** — Nothing; once the rental starts it is paid in full | $0 | $165.51 |
| **C** — Full refund | $206.90 | $0 |

**Our suggestion: A.** It is the only one that is defensible to both sides, and it is what a renter
intuitively expects.

**One thing to flag: it is not simply "half".** Because the Atussa Fee has a $3.99 minimum and the
taxes are calculated on the smaller base, a 5-day price is **not** half a 10-day price:

| | 10 days (paid) | 5 days (used) |
|---|---|---|
| Rental | $200.00 | $100.00 |
| Atussa Fee | $6.00 | **$3.99** ← minimum applies |
| Taxes | $5.39 | $2.85 |
| **Renter total** | **$206.90** | **$104.59** |

So the refund has to be recalculated properly, not divided. That is fine to build — it goes through
the one place prices are calculated — but it is why "just refund half" is not an option.

---

### Q4. When should the **owner** actually receive their money?

Today they receive it the instant the renter pays, before the item changes hands.

| | |
|---|---|
| **A** — Keep it as is | No work. But every refund has to pull money back out of the owner's account, and if they have already withdrawn it their Stripe account goes negative and gets **blocked** until it is settled. And an owner who never hands the item over has already been paid. |
| **B** — Atussa holds it until the rental is marked complete | Refunds and disputes become simple arithmetic, because the money has not left Atussa yet. This is how most rental marketplaces work. |

**Our suggestion: B, and we think it is the most important decision in this document.**

Every other refund answer gets easier if the money has not been handed over yet. With A, answering Q3
with "refund $102.31" means clawing $82.76 out of an owner who may have already spent it.

The trade-off: owners wait longer to be paid, and something has to reliably mark rentals complete
(see Q6).

---

### Q5. An item comes back **damaged**, and there is no security deposit. How does the owner get paid?

Right now: they don't. A dispute can be raised with photo evidence, an administrator can read it and
write an outcome — and **no money moves**, ever. There is no deposit to draw on and no way to charge
the renter further.

| | |
|---|---|
| **A** — Reintroduce a security deposit, held and released | Contradicts the agreed pricing model, and raises the price the renter sees |
| **B** — Keep the renter's card on file and charge for damage after an admin upholds a dispute | No upfront cost to the renter. Needs the renter's consent at booking time and will produce card disputes |
| **C** — Accept it: damage is settled between the two people, Atussa does not get involved | Honest and cheapest. But owners will expect Atussa to back them up, and the dispute screens in the app imply that it does |
| **D** — Atussa covers damage up to a limit out of its own revenue | Strong selling point for owners, real and uncapped-in-practice cost |

**No suggestion from us — this is purely a business call.** But it needs an answer, because the app
already shows owners a dispute flow that looks like it will get them money, and it will not.

---

### Q6. Two smaller gaps that need a decision

**(a) A booking can sit accepted-but-unpaid forever** (case 4). The owner's dates stay blocked by
someone who may never pay. Suggestion: the booking expires if unpaid within, say, 24 hours of being
accepted, and the dates free up. **We need a number from you**, and note this requires a scheduled
job, which the backend does not currently have at all.

**(b) Nothing ever marks a rental complete** (case 12). Only the owner can, and many won't. This
matters much more if you pick Q4-B, because that is what releases the owner's money. Suggestion: it
auto-completes a day after the end date unless a dispute is open. Same scheduled-job requirement.

**Both (a) and (b) need a scheduler that does not exist yet.** That is a real piece of work —
genuinely necessary, and worth deciding now rather than after the policy is written.

---

## Part 4 — Can the owner cancel?

Worth raising separately, because it will come up in the client conversation: **an owner currently
cannot cancel a booking they have accepted.** The renter can; the owner cannot. Their only option is
to contact an administrator.

That is almost certainly wrong — an owner's van breaks down, they are ill, the item sold. But giving
owners a cancel button also needs a rule, because an owner cancelling at the last minute is the most
damaging thing that can happen to a renter who has made plans.

**Question:** should owners be able to cancel, and if so, is there a penalty (a visible reliability
score, a fee, a limit per period)?

---

## Part 5 — If you want a single recommendation to react to

The shortest coherent policy, and what we would build if asked to pick:

- Owners are paid **when the rental is marked complete**, not when the renter pays. *(Q4-B)*
- **Free cancellation up to 48 hours** before the start, fully refunded including the Atussa Fee.
  *(Q1-B, Q2-A)*
- **Inside 48 hours but before the start:** rental refunded, Atussa Fee kept.
- **During the rental:** charged for the days used, the rest refunded, recalculated properly.
  *(Q3-A)*
- Unpaid bookings **expire 24 hours after acceptance** and free the dates. *(Q6-a)*
- Rentals **auto-complete one day after the end date** unless a dispute is open. *(Q6-b)*
- Owners **can cancel**, but it is recorded and visible on their profile.
- **Damage is explicitly not covered by Atussa** until a deposit or a card-on-file charge is agreed —
  and the dispute screens get wording that says so, instead of implying otherwise. *(Q5-C for now)*

---

## What it costs to build

Rough shape, so the client can weigh the decisions:

| | Effort |
|---|---|
| Partial / prorated refunds | Small. Stripe already supports it and the price calculator already handles any number of days; nothing calls it yet. |
| A cancellation policy with a time window | Small. |
| Paying the owner at completion instead of at payment | Medium. Changes how the charge is built and adds a transfer step. |
| Letting owners cancel | Small. |
| **A scheduler** (expiring unpaid bookings, auto-completing rentals) | Medium, and it is new infrastructure — there is no scheduled job anywhere in the backend today. |
| Charging a card for damage | Large, and it needs legal wording at booking time. |

The first four are a few days' work once the policy is decided. The scheduler is the one that needs
planning.
