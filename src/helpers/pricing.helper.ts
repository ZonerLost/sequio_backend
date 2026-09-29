/**
 * The one place rental prices are computed. Nothing else may add a fee, a tax or a commission.
 *
 * Atussa's model (client-specified 2026-09-29):
 *   - Owner side:  Atussa keeps 15% of the rental amount, so the owner is paid 85% of it, minus the
 *                  taxes on that commission (a commission is a service sold to the owner, so TPS/TVQ
 *                  apply on top of it and Atussa remits them).
 *   - Renter side: an "Atussa Fee" of 3% of the rental amount with a minimum of $3.99, plus taxes.
 *   - Taxes:       Quebec, two of them — TPS 5% and TVQ 9.975%, each on the pre-tax base (QST has not
 *                  been compounded on GST since 2013).
 *   - Delivery:    passes through to the owner untouched. It covers their fuel and time, so neither
 *                  the commission nor the renter fee is charged on it.
 *   - No security deposit: nothing in this codebase refunds one, and the client's model has none.
 *
 * Worked example, $100 rental, no delivery, no discount:
 *   renter pays 100 + 3.99 + 0.20 (TPS) + 0.40 (TVQ) = 104.59
 *   owner gets  100 - 15 - 0.75 (TPS) - 1.50 (TVQ)   =  82.75
 *   Atussa keeps 15 + 3.99 = 18.99 revenue and remits 2.85 of tax.
 *
 * All arithmetic runs in integer cents. Doing it in dollars lets float error creep in and breaks the
 * one invariant that matters: what the renter pays must equal what the owner receives plus what the
 * platform keeps plus the tax collected, to the cent.
 */

export const PRICING = {
  /** Atussa's cut of the rental, charged to the owner. */
  OWNER_COMMISSION_PERCENT: 15,
  /** The renter-facing "Atussa Fee". */
  RENTER_FEE_PERCENT: 3,
  RENTER_FEE_MINIMUM: 3.99,
  /** Quebec. Kept as a list so another province's rates can be added without touching the maths. */
  TAXES: [
    { code: "TPS", label: "TPS (GST)", rate: 0.05 },
    { code: "TVQ", label: "TVQ (QST)", rate: 0.09975 },
  ],
  CURRENCY: "CAD",
} as const;

/** The exact sentence the app shows behind the "?" next to Atussa Fee. */
export const ATUSSA_FEE_EXPLAINER =
  "The Atussa Fee is 3% of the rental amount, with a minimum fee of $3.99 per transaction, plus applicable taxes.";

export interface TaxLine {
  code: string;
  label: string;
  rate: number;
  amount: number;
  /** Which base this tax was charged on, so an invoice can group it correctly. */
  appliedTo: "atussa_fee" | "owner_commission";
}

export interface PriceBreakdown {
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

export const calculatePriceBreakdown = (input: {
  dailyRate: number;
  totalDays: number;
  deliveryFee?: number;
  discountPercent?: number;
}): PriceBreakdown => {
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
