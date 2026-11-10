/**
 * What a renter gets back when they cancel, and who keeps the rest.
 *
 * The client's policy, verbatim from their Q1 and reproduced in `IMPLEMENTATION_PLAN.md`:
 *
 * | Window | Renter gets | Notes |
 * |---|---|---|
 * | more than 48h before start | 100%, including the 15% and refundable taxes | release the deposit hold |
 * | 24–48h | 50% of base automatically; the owner may approve the other 50% | the 15% is non-refundable |
 * | under 24h | nothing | release the hold, allocate the retained price 85/15 |
 *
 * **Everything here is a pure function of the stored breakdown and two instants.** Nothing reads the
 * current pricing model, because a booking must be refunded under the rules it was priced by — a
 * booking agreed in September does not become a November booking because an environment variable
 * changed. That is the same reason `pricing` is stored on the booking and never recomputed.
 *
 * ## The one thing that makes both pricing models collapse into one calculation
 *
 * Under 2026-09 the renter pays rental + delivery + the Atussa Fee + tax on that fee. Under 2026-11
 * they pay rental + delivery + a 15% markup + tax on the lot. Different fields, different bases —
 * but in **both** models the renter's total is exactly:
 *
 *     rentalAmount + deliveryFee + renterFee.amount + renterFee.taxTotal
 *
 * so the refund arithmetic needs four numbers and no model branch. Note `renterFee.taxTotal`, not
 * `taxTotal`: under 2026-09 the latter also contains the tax on the owner's commission, which the
 * renter never paid and therefore cannot be refunded. Refunding `taxTotal` would hand the renter
 * $2.25 of someone else's tax on the client's own $100 example.
 *
 * ## Decisions taken here that the client has not confirmed
 *
 * Their specification is silent on three points and the money cannot be computed without answering
 * them. Each is isolated to one place so it is a one-line change when they answer — gaps 1 and 8 in
 * `CLIENT_DOCS_REVIEW.md`:
 *
 * 1. **Tax on a partial refund** follows what is refunded: the proportion of the taxable base that
 *    came back. Under `fees_only` the base is the non-refundable fee, so no tax returns; under
 *    `renter_total` the base includes the rental, so half a rental refund returns half that tax.
 *    Internally consistent and derivable from the stored breakdown rather than invented.
 * 2. **Delivery is refunded in full whenever any part of the rental is** — a delivery fee pays for a
 *    journey, and in the 24–48h window the journey has not been made. Retaining payment for a
 *    service nobody performed is the one outcome that is clearly wrong in both directions. In the
 *    under-24h window nothing is refunded, delivery included, because that is what the policy says.
 * 3. **"50% of base" is read as 50% of `rentalAmount`** — the discounted rental the renter actually
 *    paid — not of `basePrice`, which is pre-discount. Refunding half of a price nobody was charged
 *    would over-refund every discounted booking.
 */
import { PRICING } from "./pricing.helper";
import {
  TimeZoneLocation,
  TimeZoneSource,
  calendarDateOf,
  formatInZone,
  instantFromParts,
  parseClockTime,
  timeZoneFor,
} from "./timezone.helper";

export const CANCELLATION_POLICY = {
  /** Strictly more than this many hours before the start: everything comes back. */
  FULL_REFUND_HOURS: 48,
  /** At or after this many hours before the start, up to the boundary above: half the rental. */
  PARTIAL_REFUND_HOURS: 24,
  PARTIAL_REFUND_PERCENT: 50,
  /**
   * The local hour a rental is assumed to begin when the booking carries no pickup time.
   *
   * 09:00, because every one of the 12 bookings in this database that names a pickup time says
   * `"09:00 AM"`. It is an assumption either way, and this one is at least drawn from the data.
   *
   * It also errs in the renter's favour. A later assumed start pushes the 48- and 24-hour
   * boundaries later, so a renter cancelling near a boundary lands in the kinder tier. Where the
   * platform created the ambiguity — by storing a date with no time — the platform should not profit
   * from it.
   */
  DEFAULT_HANDOVER_HOUR: 9,
} as const;

/** `full` and `none` are self-explanatory; `partial` is the 24–48h band. */
export type CancellationTier = "full" | "partial" | "none";

export interface RentalStart {
  at: Date;
  timeZone: string;
  timeZoneSource: TimeZoneSource;
  /** Whether the time of day came from the booking or from `DEFAULT_HANDOVER_HOUR`. */
  clockSource: "pickup_time" | "default_hour";
}

export interface StartableBooking {
  startDate: Date | string;
  pickupTimeFrom?: string | null;
}

/**
 * When the rental actually begins, as an instant.
 *
 * The calendar date comes from `startDate` read in UTC — that is how a date picker's choice was
 * recorded — and the time of day comes from `pickupTimeFrom` read in the **listing's** zone. Neither
 * half is usable alone: the stored `startDate` is 00:00 UTC on 18 of 22 bookings, which in Montreal
 * is 19:00 the evening before.
 */
export const rentalStartsAt = (
  booking: StartableBooking,
  location?: TimeZoneLocation | null
): RentalStart => {
  const { timeZone, source } = timeZoneFor(location);
  const date = calendarDateOf(new Date(booking.startDate));
  const clock = parseClockTime(booking.pickupTimeFrom);

  return {
    at: instantFromParts(
      {
        ...date,
        hour: clock?.hour ?? CANCELLATION_POLICY.DEFAULT_HANDOVER_HOUR,
        minute: clock?.minute ?? 0,
      },
      timeZone
    ),
    timeZone,
    timeZoneSource: source,
    clockSource: clock ? "pickup_time" : "default_hour",
  };
};

/**
 * Which tier a cancellation this many hours before the start falls into.
 *
 * The boundaries are closed downwards, which is how the client's table reads: "more than 48h" is
 * strict, so exactly 48 hours is the 50% band, and "24–48h" includes 24 while "under 24h" excludes
 * it. A rental that has already started is `none` — there is nothing left to cancel out of.
 */
export const tierForHoursBeforeStart = (hours: number): CancellationTier => {
  if (hours > CANCELLATION_POLICY.FULL_REFUND_HOURS) return "full";
  if (hours >= CANCELLATION_POLICY.PARTIAL_REFUND_HOURS) return "partial";
  return "none";
};

// ── the money ───────────────────────────────────────────────────────────────────────────────────

const centsOf = (value: unknown): number => Math.round(Number(value ?? 0) * 100);

export interface StoredPricing {
  model?: string;
  taxBase?: string;
  currency?: string;
  basePrice?: number;
  discountAmount?: number;
  rentalAmount?: number;
  deliveryFee?: number;
  serviceFee?: number;
  totalAmount?: number;
  taxTotal?: number;
  renterFee?: { amount?: number; taxTotal?: number };
  ownerPayout?: { amount?: number };
}

/**
 * The four renter-paid components, in integer cents, plus what of it is the owner's.
 *
 * `ownerRentalShareCents` excludes delivery deliberately: delivery passes through to the owner in
 * full under both models, so separating it is what lets a partial refund scale the owner's rental
 * share without touching the pass-through.
 */
interface PaidComponents {
  rentalCents: number;
  deliveryCents: number;
  feeCents: number;
  renterTaxCents: number;
  paidCents: number;
  ownerRentalShareCents: number;
  taxBase: string;
  currency: string;
  /** Whether the four components add up to the total the renter was charged. See `apportionable`. */
  reconciles: boolean;
}

const componentsOf = (pricing: StoredPricing | undefined | null): PaidComponents => {
  const p = pricing ?? {};
  const rentalCents =
    p.rentalAmount !== undefined
      ? centsOf(p.rentalAmount)
      : centsOf(p.basePrice) - centsOf(p.discountAmount);
  const deliveryCents = centsOf(p.deliveryFee);
  // `renterFee.amount` under both current models; `serviceFee` is the same number under a name
  // older clients still render, and the only thing a pre-2026-09 booking has.
  const feeCents = centsOf(p.renterFee?.amount ?? p.serviceFee);
  const renterTaxCents = centsOf(p.renterFee?.taxTotal);
  const paidCents = centsOf(p.totalAmount);
  const ownerPayoutCents = centsOf(p.ownerPayout?.amount);

  return {
    rentalCents,
    deliveryCents,
    feeCents,
    renterTaxCents,
    paidCents,
    ownerRentalShareCents: Math.max(0, ownerPayoutCents - deliveryCents),
    taxBase: String(p.taxBase ?? "fees_only"),
    currency: String(p.currency ?? PRICING.CURRENCY),
    reconciles:
      p.ownerPayout?.amount !== undefined &&
      rentalCents + deliveryCents + feeCents + renterTaxCents === paidCents,
  };
};

export interface RefundSplit {
  rentalCents: number;
  deliveryCents: number;
  feeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface RetainedSplit {
  /** What the owner keeps, which is what the payout job must transfer for a cancelled booking. */
  ownerCents: number;
  /**
   * Everything retained that is not the owner's: Atussa's commission and renter fee, plus any tax
   * still to be remitted. Computed as the residual on purpose, so `ownerCents + platformCents`
   * always equals the retained total to the cent however the rounding falls.
   */
  platformCents: number;
  totalCents: number;
}

/**
 * Refunding `rentalRefundCents` of the rental and `deliveryRefundCents` of the delivery, what is
 * left and whose is it.
 *
 * The owner's retained share scales linearly with the retained rental. That is exactly what "50%"
 * means, it is correct at both ends (a full refund leaves the owner nothing, no refund leaves them
 * their whole payout), and it needs no model branch because `ownerRentalShareCents` already encodes
 * whichever commission and tax treatment priced the booking.
 */
const retainedFor = (
  paid: PaidComponents,
  refund: RefundSplit
): RetainedSplit => {
  const retainedRentalCents = paid.rentalCents - refund.rentalCents;
  const retainedDeliveryCents = paid.deliveryCents - refund.deliveryCents;
  const totalCents = Math.max(0, paid.paidCents - refund.totalCents);

  const ownerFromRental =
    paid.rentalCents > 0
      ? Math.round((paid.ownerRentalShareCents * retainedRentalCents) / paid.rentalCents)
      : 0;
  // Clamped so a legacy row with an inconsistent breakdown cannot produce a negative platform
  // share, which would read as Atussa owing money it was never paid.
  const ownerCents = Math.min(Math.max(0, ownerFromRental + retainedDeliveryCents), totalCents);

  return { ownerCents, platformCents: totalCents - ownerCents, totalCents };
};

const noRefund = (): RefundSplit => ({
  rentalCents: 0,
  deliveryCents: 0,
  feeCents: 0,
  taxCents: 0,
  totalCents: 0,
});

/**
 * The tax to return when `rentalRefund + deliveryRefund + feeRefund` of the taxable base comes back.
 *
 * Decision 1 at the top of this file. Under `fees_only` the taxable base was the fee alone, which is
 * non-refundable inside 48 hours, so a partial refund returns no tax at all — not an oversight.
 */
const taxRefundFor = (
  paid: PaidComponents,
  refunded: { rentalCents: number; deliveryCents: number; feeCents: number }
): number => {
  if (paid.renterTaxCents <= 0) return 0;

  const [base, refundedBase] =
    paid.taxBase === "renter_total"
      ? [
          paid.rentalCents + paid.deliveryCents + paid.feeCents,
          refunded.rentalCents + refunded.deliveryCents + refunded.feeCents,
        ]
      : [paid.feeCents, refunded.feeCents];

  if (base <= 0) return 0;
  return Math.min(paid.renterTaxCents, Math.round((paid.renterTaxCents * refundedBase) / base));
};

export interface CancellationQuote {
  tier: CancellationTier;
  /** The reconstructed start instant, and how much of it was inferred. */
  startsAt: Date;
  startsAtLocal: string;
  timeZone: string;
  timeZoneSource: TimeZoneSource;
  clockSource: RentalStart["clockSource"];
  /** Negative once the rental has started. Rounded to two decimals; the tier uses the exact value. */
  hoursUntilStart: number;
  currency: string;
  /** What the renter actually paid, in cents. Zero for an unpaid booking. */
  paidCents: number;
  /**
   * False when there is no money to give back — an unpaid booking — or when the stored breakdown
   * cannot be apportioned. A quote is still returned either way, so the app can show the conditions.
   */
  refundable: boolean;
  /**
   * Whether the breakdown's components add up to what the renter was charged. A pre-2026-09 booking
   * folded a $100 security deposit into its total and carries no owner split, so its parts do not
   * reconcile and a 50% tier cannot be computed honestly. A **full** refund still can: it is the
   * whole total, no apportionment needed.
   */
  apportionable: boolean;
  refund: RefundSplit;
  retained: RetainedSplit;
  /**
   * The rest of the rental the owner may voluntarily approve — the "other 50%" in the client's
   * table. Zero in the other two tiers: nothing is left to ask for after a full refund, and the
   * under-24h tier gives the renter no automatic claim to ask against.
   */
  ownerApprovableCents: number;
  conditions: string[];
}

export interface QuoteInput {
  booking: StartableBooking & {
    pricing?: StoredPricing | null;
    paymentStatus?: string | null;
  };
  location?: TimeZoneLocation | null;
  now?: Date;
}

/**
 * Payment states in which the renter's money has actually been taken.
 *
 * `paid_out` belongs here and is the one most easily left out: a booking whose owner has been paid
 * is emphatically paid. Checking only for `"paid"` is what made the owner-cancellation refund skip
 * silently once the payout job existed.
 */
export const PAID_PAYMENT_STATUSES: readonly string[] = [
  "paid",
  "payout_pending",
  "payout_initiated",
  "paid_out",
];

/** Whether the renter's money has been taken. One predicate, so no caller has to cast. */
export const isPaidStatus = (value: unknown): boolean =>
  typeof value === "string" && PAID_PAYMENT_STATUSES.includes(value);

/**
 * The conditions to show a renter **before** they book and again before they cancel, which the
 * client asks for explicitly. One wording, served by the API, so three clients cannot drift.
 */
export const cancellationConditions = (): string[] => [
  `Cancel more than ${CANCELLATION_POLICY.FULL_REFUND_HOURS} hours before the rental starts and you are refunded in full, including fees and taxes.`,
  `Cancel between ${CANCELLATION_POLICY.PARTIAL_REFUND_HOURS} and ${CANCELLATION_POLICY.FULL_REFUND_HOURS} hours before the start and ${CANCELLATION_POLICY.PARTIAL_REFUND_PERCENT}% of the rental is refunded automatically. The service fee is not refundable. The owner may choose to approve the rest.`,
  `Cancel less than ${CANCELLATION_POLICY.PARTIAL_REFUND_HOURS} hours before the start and no refund is due.`,
  "Times are measured against the listing's local time zone.",
];

/**
 * The whole policy decision for one booking, at one moment, as numbers.
 *
 * Deliberately pure: it reads nothing, writes nothing and calls nothing external, so the same
 * function answers `GET /bookings/:id/cancellation-quote` for a renter deciding whether to cancel
 * and decides what the cancellation itself actually refunds. A quote the renter is shown and a
 * refund computed somewhere else is how the two come to disagree.
 */
export const quoteCancellation = (input: QuoteInput): CancellationQuote => {
  const now = input.now ?? new Date();
  const start = rentalStartsAt(input.booking, input.location);
  const exactHours = (start.at.getTime() - now.getTime()) / 3_600_000;
  const tier = tierForHoursBeforeStart(exactHours);

  const paid = componentsOf(input.booking.pricing);
  const isPaid = isPaidStatus(input.booking.paymentStatus);

  const base = {
    tier,
    startsAt: start.at,
    startsAtLocal: formatInZone(start.at, start.timeZone),
    timeZone: start.timeZone,
    timeZoneSource: start.timeZoneSource,
    clockSource: start.clockSource,
    hoursUntilStart: Math.round(exactHours * 100) / 100,
    currency: paid.currency,
    paidCents: isPaid ? paid.paidCents : 0,
    apportionable: paid.reconciles,
    conditions: cancellationConditions(),
  };

  if (!isPaid || paid.paidCents <= 0) {
    // Nothing was charged, so nothing can come back — but the tier is still the truth about where
    // this cancellation falls, and the app shows the conditions from it.
    return {
      ...base,
      refundable: false,
      refund: noRefund(),
      retained: { ownerCents: 0, platformCents: 0, totalCents: 0 },
      ownerApprovableCents: 0,
    };
  }

  if (tier === "full") {
    /**
     * The whole total, taken from `totalAmount` rather than summed from the parts.
     *
     * That is what the renter was charged and what Stripe will refund, and it is right even for a
     * breakdown whose components do not reconcile — which is precisely the booking a sum would get
     * wrong. The parts are still reported, for the ledger and for the owner's statement.
     */
    const refund: RefundSplit = {
      rentalCents: paid.rentalCents,
      deliveryCents: paid.deliveryCents,
      feeCents: paid.feeCents,
      taxCents: paid.renterTaxCents,
      totalCents: paid.paidCents,
    };
    return {
      ...base,
      refundable: true,
      refund,
      retained: { ownerCents: 0, platformCents: 0, totalCents: 0 },
      ownerApprovableCents: 0,
    };
  }

  if (tier === "partial") {
    if (!paid.reconciles) {
      // A 50% split of a breakdown that does not add up is a guess wearing a number. Refuse it and
      // say so; support can refund by hand with the full admin path.
      return {
        ...base,
        refundable: false,
        refund: noRefund(),
        retained: retainedFor(paid, noRefund()),
        ownerApprovableCents: 0,
      };
    }

    const rentalCents = Math.round(
      (paid.rentalCents * CANCELLATION_POLICY.PARTIAL_REFUND_PERCENT) / 100
    );
    // The fee is explicitly non-refundable inside 48 hours; delivery is decision 2 above.
    const parts = { rentalCents, deliveryCents: paid.deliveryCents, feeCents: 0 };
    const taxCents = taxRefundFor(paid, parts);
    const refund: RefundSplit = {
      ...parts,
      taxCents,
      totalCents: rentalCents + paid.deliveryCents + taxCents,
    };

    return {
      ...base,
      refundable: refund.totalCents > 0,
      refund,
      retained: retainedFor(paid, refund),
      ownerApprovableCents: paid.rentalCents - rentalCents,
    };
  }

  // Under 24 hours: nothing is refunded and the price stays allocated exactly as it was agreed.
  return {
    ...base,
    refundable: false,
    refund: noRefund(),
    retained: retainedFor(paid, noRefund()),
    ownerApprovableCents: 0,
  };
};

/**
 * Re-runs the retained split when a further `extraRentalRefundCents` of the rental is given back.
 *
 * Used by both halves of the voluntary-refund flow: an owner approving "the other 50%" after a
 * 24–48h cancellation, and an owner approving an early-return request. One arithmetic for both, so
 * the owner's share and Atussa's cannot be computed two different ways.
 */
export const retainedAfterFurtherRefund = (
  pricing: StoredPricing | undefined | null,
  alreadyRefunded: RefundSplit,
  extraRentalRefundCents: number
): { refund: RefundSplit; retained: RetainedSplit } => {
  const paid = componentsOf(pricing);
  const rentalCents = Math.min(
    paid.rentalCents,
    alreadyRefunded.rentalCents + Math.max(0, extraRentalRefundCents)
  );
  const parts = {
    rentalCents,
    deliveryCents: alreadyRefunded.deliveryCents,
    feeCents: alreadyRefunded.feeCents,
  };
  const taxCents = taxRefundFor(paid, parts);
  const refund: RefundSplit = {
    ...parts,
    taxCents,
    totalCents: Math.min(paid.paidCents, rentalCents + parts.deliveryCents + parts.feeCents + taxCents),
  };
  return { refund, retained: retainedFor(paid, refund) };
};

/**
 * What is left of the renter's money that an owner could still choose to give back.
 *
 * Takes the whole `RefundSplit` rather than one total on purpose. The base here is tax-exclusive —
 * rental plus delivery — and subtracting a tax-inclusive total from it would quietly shrink the
 * remainder by the tax already returned, which is the sort of unit mismatch that produces a cap
 * nobody can account for.
 *
 * The renter-side fee and its tax stay out of a voluntary refund: that is Atussa's charge, not the
 * owner's to give away, and the policy already calls it non-refundable inside 48 hours.
 */
export const refundableRemainderCents = (
  pricing: StoredPricing | undefined | null,
  alreadyRefunded: RefundSplit
): number => {
  const paid = componentsOf(pricing);
  const spent = Math.max(0, alreadyRefunded.rentalCents) + Math.max(0, alreadyRefunded.deliveryCents);
  return Math.max(0, paid.rentalCents + paid.deliveryCents - spent);
};
