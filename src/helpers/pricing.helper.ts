/**
 * The one place rental prices are computed. Nothing else may add a fee, a tax or a commission.
 *
 * ## There are two models, and which one runs is an environment variable
 *
 * The client replaced their own pricing model in November 2026: the 3% / $3.99 "Atussa Fee" is
 * **discontinued** and the renter now pays a 15% markup instead. `PRICING_MODEL` selects which set
 * of rules applies to new bookings.
 *
 *   2026-09  (default)  15% commission from the owner, 3%/$3.99 fee from the renter.
 *   2026-11             15% commission from the owner, 15% markup added for the renter.
 *
 * **It defaults to the old model on purpose.** The new one cannot ship yet: the client instructs
 * that GST/QST be calculated "on the applicable total taxable transaction amount, not just Atussa
 * fees", but that came from a phone call with Revenu Québec and their own document says to "confirm
 * the exact tax-base and allocation rules in writing before production". Shipping the new prices
 * with a guessed tax base would charge the right amount and remit the wrong tax, which is worse than
 * charging the old amount. So the code is ready and the switch is off.
 *
 * `PRICING_TAX_BASE` is the other half of that: `fees_only` taxes just Atussa's cut, the way the
 * old model did; `renter_total` taxes everything the renter pays before tax, which is our reading of
 * "total taxable transaction amount". **Both are implemented and neither is confirmed.**
 *
 * ## A booking keeps the price it was agreed at
 *
 * The breakdown is stored on the booking and never recomputed, so a rate change cannot rewrite the
 * price of a rental two people already agreed. Every breakdown records which `model` produced it.
 * There are now three eras in the database: pre-2026-09 bookings with only the original fields,
 * 2026-09 bookings, and 2026-11 ones. **Read a booking's stored breakdown; never recompute it.**
 *
 * ## The 2026-09 model (client-specified 2026-09-29)
 *   - Owner side:  Atussa keeps 15% of the rental amount, so the owner is paid 85% of it, minus the
 *                  taxes on that commission (a commission is a service sold to the owner, so TPS/TVQ
 *                  apply on top of it and Atussa remits them).
 *   - Renter side: an "Atussa Fee" of 3% of the rental amount with a minimum of $3.99, plus taxes.
 *   - Taxes:       Quebec, two of them — TPS 5% and TVQ 9.975%, each on the pre-tax base (QST has not
 *                  been compounded on GST since 2013).
 *   - Delivery:    passes through to the owner untouched. It covers their fuel and time, so neither
 *                  the commission nor the renter fee is charged on it.
 *   - No security deposit under this model.
 *
 * Worked example, $100 rental, no delivery, no discount:
 *   renter pays 100 + 3.99 + 0.20 (TPS) + 0.40 (TVQ) = 104.59
 *   owner gets  100 - 15 - 0.75 (TPS) - 1.50 (TVQ)   =  82.75
 *   Atussa keeps 15 + 3.99 = 18.99 revenue and remits 2.85 of tax.
 *
 * ## The 2026-11 model (client-specified November 2026)
 *
 *   - Owner side:  unchanged at 15%, but the owner receives a clean 85% of the base price. Tax is
 *                  **not** deducted from their payout — the specification says they earn 85%
 *                  "before any applicable tax allocation", and all tax is collected from the renter.
 *   - Renter side: 15% of the base price is added on top. There is no separate fee line and no
 *                  minimum. The renter must see only the final price plus the legally required tax
 *                  line — never the base price, the markup, the commission or any itemisation.
 *   - Delivery:    still passes through to the owner in full.
 *   - Deposit:     a per-listing amount held as a card pre-authorization. Not part of this file —
 *                  it is a separate authorization and never rental revenue.
 *
 * Worked example, $100/day base, no delivery, no discount:
 *   owner receives 85.00, renter pays 115.00 before tax, Atussa keeps 30.00.
 *   With PRICING_TAX_BASE=renter_total: tax is 17.22 and the renter pays 132.22.
 *   With PRICING_TAX_BASE=fees_only:    tax is  4.49 and the renter pays 119.49.
 *   Which of those is right is the open question above.
 *
 * All arithmetic runs in integer cents. Doing it in dollars lets float error creep in and breaks the
 * one invariant that matters: what the renter pays must equal what the owner receives plus what the
 * platform keeps plus the tax collected, to the cent.
 */

import { ENV } from "../config/env";

export type PricingModel = "2026-09" | "2026-11";
/** Which amount GST/QST applies to. Neither reading is confirmed — see the header. */
export type TaxBase = "fees_only" | "renter_total";

export const PRICING = {
  /** Atussa's cut of the rental, charged to the owner. Unchanged between the two models. */
  OWNER_COMMISSION_PERCENT: 15,
  /** 2026-09 only: the renter-facing "Atussa Fee". Discontinued by the client in November 2026. */
  RENTER_FEE_PERCENT: 3,
  RENTER_FEE_MINIMUM: 3.99,
  /** 2026-11 only: added to the base price to make the renter's price. */
  RENTER_MARKUP_PERCENT: 15,
  /** Quebec. Kept as a list so another province's rates can be added without touching the maths. */
  TAXES: [
    { code: "TPS", label: "TPS (GST)", rate: 0.05 },
    { code: "TVQ", label: "TVQ (QST)", rate: 0.09975 },
  ],
  CURRENCY: "CAD",
} as const;

/**
 * The exact sentence the app shows behind the "?" next to Atussa Fee.
 *
 * **2026-09 only.** Under the new model the renter sees no fee line at all, so there is nothing to
 * explain — `atussaFeeExplainer` comes back empty and the "?" should not be rendered.
 */
export const ATUSSA_FEE_EXPLAINER =
  "The Atussa Fee is 3% of the rental amount, with a minimum fee of $3.99 per transaction, plus applicable taxes.";

/** The model in force for new bookings. Defaults to the old one until the tax base is confirmed. */
export const activeModel = (): PricingModel => ENV.PRICING_MODEL as PricingModel;
export const activeTaxBase = (): TaxBase => ENV.PRICING_TAX_BASE as TaxBase;

/** What the owner earns on a base price, for the live "You earn $85/day" the Add Item screen needs. */
export const ownerEarningsFor = (dailyRate: number, model: PricingModel = activeModel()) => {
  const baseCents = Math.round(dailyRate * 100);
  const commissionCents = Math.round(baseCents * (PRICING.OWNER_COMMISSION_PERCENT / 100));
  if (model === "2026-11") {
    // A clean 85%: no tax is deducted from the payout under this model.
    return parseFloat(((baseCents - commissionCents) / 100).toFixed(2));
  }
  const commissionTaxCents = PRICING.TAXES.reduce(
    (sum, tax) => sum + Math.round(commissionCents * tax.rate),
    0
  );
  return parseFloat(((baseCents - commissionCents - commissionTaxCents) / 100).toFixed(2));
};

/** What a renter is charged per day, before tax. The other half of the Add Item display. */
export const renterPriceFor = (dailyRate: number, model: PricingModel = activeModel()) => {
  const baseCents = Math.round(dailyRate * 100);
  if (model === "2026-11") {
    return parseFloat(
      ((baseCents + Math.round(baseCents * (PRICING.RENTER_MARKUP_PERCENT / 100))) / 100).toFixed(2)
    );
  }
  // Under 2026-09 the fee is per booking, not per day, so there is no honest per-day renter price.
  return parseFloat((baseCents / 100).toFixed(2));
};

export interface TaxLine {
  code: string;
  label: string;
  rate: number;
  amount: number;
  /** Which base this tax was charged on, so an invoice can group it correctly. */
  appliedTo: "atussa_fee" | "owner_commission";
}

export interface PriceBreakdown {
  /** Which set of rules produced this. Stored on the booking so an old price is never misread. */
  model: PricingModel;
  taxBase: TaxBase;
  currency: string;
  dailyRate: number;
  totalDays: number;
  basePrice: number;
  discountPercent: number;
  discountAmount: number;
  /** What the rental itself costs after any discount — the base for the commission and the fee. */
  rentalAmount: number;
  deliveryFee: number;

  /** Kept under the original names so existing clients keep working. */
  subtotal: number;
  serviceFee: number;
  securityDeposit: number;
  /** What the renter is charged, taxes included. */
  totalAmount: number;

  taxes: TaxLine[];
  taxTotal: number;

  renterFee: {
    percent: number;
    minimum: number;
    amount: number;
    taxTotal: number;
    /** True when the 3% came out below the floor, so the minimum was charged instead. */
    minimumApplied: boolean;
  };

  ownerPayout: {
    commissionPercent: number;
    commission: number;
    commissionTaxTotal: number;
    /** What the owner actually receives, delivery included. */
    amount: number;
  };

  platform: {
    /** Commission plus the renter fee. Taxes are collected on behalf of the government, not revenue. */
    revenue: number;
    taxCollected: number;
  };
}

const toCents = (dollars: number): number => Math.round(dollars * 100);
const toDollars = (cents: number): number => parseFloat((cents / 100).toFixed(2));
/** Half-up on exact halves, the convention Canadian tax arithmetic expects. */
const applyRate = (cents: number, rate: number): number => Math.round(cents * rate);

export interface PriceInput {
  dailyRate: number;
  totalDays: number;
  deliveryFee?: number;
  discountPercent?: number;
  /** Overridden only by tests and by the pricing comparison script. */
  model?: PricingModel;
  taxBase?: TaxBase;
}

/**
 * The entry point. Dispatches on the pricing model in force.
 *
 * Callers pass no model and get whatever `PRICING_MODEL` says, which is the point: one environment
 * variable moves the whole platform between the two sets of rules, and nothing else changes.
 */
export const calculatePriceBreakdown = (input: PriceInput): PriceBreakdown =>
  (input.model ?? activeModel()) === "2026-11"
    ? markupBreakdown(input)
    : legacyBreakdown(input);

/**
 * The November 2026 model: 15% off the owner, 15% onto the renter, no separate fee.
 *
 * The invariant is the same as ever and is asserted in the tests: what the renter pays equals what
 * the owner receives plus what the platform keeps plus the tax collected, to the cent.
 */
const markupBreakdown = (input: PriceInput): PriceBreakdown => {
  const { dailyRate, totalDays } = input;
  const taxBase = input.taxBase ?? activeTaxBase();
  const discountPercent = input.discountPercent ?? 0;
  const deliveryCents = toCents(input.deliveryFee ?? 0);

  const baseCents = toCents(dailyRate) * totalDays;
  const discountCents = applyRate(baseCents, discountPercent / 100);
  // The discount comes off the owner's price, so both percentages are taken on the reduced amount.
  const rentalCents = baseCents - discountCents;

  const commissionCents = applyRate(rentalCents, PRICING.OWNER_COMMISSION_PERCENT / 100);
  const markupCents = applyRate(rentalCents, PRICING.RENTER_MARKUP_PERCENT / 100);

  /**
   * What tax applies to. `renter_total` is our reading of "the applicable total taxable transaction
   * amount": everything the renter pays before tax, delivery included. `fees_only` keeps the old
   * behaviour of taxing just Atussa's cut. Neither is confirmed in writing yet.
   */
  const taxableCents =
    taxBase === "renter_total"
      ? rentalCents + markupCents + deliveryCents
      : commissionCents + markupCents;

  const taxes: TaxLine[] = PRICING.TAXES.map((tax) => ({
    code: tax.code,
    label: tax.label,
    rate: tax.rate,
    amount: toDollars(applyRate(taxableCents, tax.rate)),
    // One base now, so the old per-component attribution no longer describes anything real.
    appliedTo: "atussa_fee" as const,
  }));
  const taxCents = PRICING.TAXES.reduce((sum, tax) => sum + applyRate(taxableCents, tax.rate), 0);

  const renterTotalCents = rentalCents + markupCents + deliveryCents + taxCents;
  // A clean 85% plus delivery. No tax is deducted: the owner earns 85% "before any applicable tax
  // allocation", and every cent of tax is collected from the renter.
  const payoutCents = rentalCents - commissionCents + deliveryCents;

  return {
    model: "2026-11",
    taxBase,
    currency: PRICING.CURRENCY,
    dailyRate,
    totalDays,
    basePrice: toDollars(baseCents),
    discountPercent,
    discountAmount: toDollars(discountCents),
    rentalAmount: toDollars(rentalCents),
    deliveryFee: toDollars(deliveryCents),

    subtotal: toDollars(rentalCents + markupCents + deliveryCents),
    // Internally the markup; it must NOT be shown to a renter as a fee line. See the display rule.
    serviceFee: toDollars(markupCents),
    securityDeposit: 0,
    totalAmount: toDollars(renterTotalCents),

    taxes,
    taxTotal: toDollars(taxCents),

    renterFee: {
      percent: PRICING.RENTER_MARKUP_PERCENT,
      minimum: 0,
      amount: toDollars(markupCents),
      taxTotal: toDollars(taxCents),
      minimumApplied: false,
    },

    ownerPayout: {
      commissionPercent: PRICING.OWNER_COMMISSION_PERCENT,
      commission: toDollars(commissionCents),
      commissionTaxTotal: 0,
      amount: toDollars(payoutCents),
    },

    platform: {
      revenue: toDollars(commissionCents + markupCents),
      taxCollected: toDollars(taxCents),
    },
  };
};

/** The 2026-09 model, unchanged. Still what runs in production until the tax base is confirmed. */
const legacyBreakdown = (input: PriceInput): PriceBreakdown => {
  const { dailyRate, totalDays } = input;
  const discountPercent = input.discountPercent ?? 0;
  const deliveryCents = toCents(input.deliveryFee ?? 0);

  const baseCents = toCents(dailyRate) * totalDays;
  const discountCents = applyRate(baseCents, discountPercent / 100);
  // The discount reduces the owner's price, so commission and fee are charged on the reduced amount.
  const rentalCents = baseCents - discountCents;

  // ── renter side ────────────────────────────────────────────────────────────────────────────────
  const percentFeeCents = applyRate(rentalCents, PRICING.RENTER_FEE_PERCENT / 100);
  const minimumCents = toCents(PRICING.RENTER_FEE_MINIMUM);
  const feeCents = Math.max(percentFeeCents, minimumCents);

  const feeTaxes: TaxLine[] = PRICING.TAXES.map((tax) => ({
    code: tax.code,
    label: tax.label,
    rate: tax.rate,
    amount: toDollars(applyRate(feeCents, tax.rate)),
    appliedTo: "atussa_fee" as const,
  }));
  const feeTaxCents = PRICING.TAXES.reduce((sum, tax) => sum + applyRate(feeCents, tax.rate), 0);

  const renterTotalCents = rentalCents + deliveryCents + feeCents + feeTaxCents;

  // ── owner side ─────────────────────────────────────────────────────────────────────────────────
  const commissionCents = applyRate(rentalCents, PRICING.OWNER_COMMISSION_PERCENT / 100);
  const commissionTaxes: TaxLine[] = PRICING.TAXES.map((tax) => ({
    code: tax.code,
    label: tax.label,
    rate: tax.rate,
    amount: toDollars(applyRate(commissionCents, tax.rate)),
    appliedTo: "owner_commission" as const,
  }));
  const commissionTaxCents = PRICING.TAXES.reduce(
    (sum, tax) => sum + applyRate(commissionCents, tax.rate),
    0
  );

  // Delivery passes straight through to the owner.
  const payoutCents = rentalCents - commissionCents - commissionTaxCents + deliveryCents;

  return {
    model: "2026-09",
    taxBase: "fees_only",
    currency: PRICING.CURRENCY,
    dailyRate,
    totalDays,
    basePrice: toDollars(baseCents),
    discountPercent,
    discountAmount: toDollars(discountCents),
    rentalAmount: toDollars(rentalCents),
    deliveryFee: toDollars(deliveryCents),

    subtotal: toDollars(rentalCents + deliveryCents),
    serviceFee: toDollars(feeCents),
    securityDeposit: 0,
    totalAmount: toDollars(renterTotalCents),

    taxes: [...feeTaxes, ...commissionTaxes],
    taxTotal: toDollars(feeTaxCents + commissionTaxCents),

    renterFee: {
      percent: PRICING.RENTER_FEE_PERCENT,
      minimum: PRICING.RENTER_FEE_MINIMUM,
      amount: toDollars(feeCents),
      taxTotal: toDollars(feeTaxCents),
      minimumApplied: percentFeeCents < minimumCents,
    },

    ownerPayout: {
      commissionPercent: PRICING.OWNER_COMMISSION_PERCENT,
      commission: toDollars(commissionCents),
      commissionTaxTotal: toDollars(commissionTaxCents),
      amount: toDollars(payoutCents),
    },

    platform: {
      revenue: toDollars(feeCents + commissionCents),
      taxCollected: toDollars(feeTaxCents + commissionTaxCents),
    },
  };
};
