import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * An append-only record of every time money moved, or was promised to move.
 *
 * The client's requirement is to "keep price, markup, commission, taxes, hold, refunds and payout
 * separately traceable internally, even though the renter does not see the pricing markup
 * breakdown". The booking already stores what a rental *costs*. This stores what actually *happened*
 * — which is a different question, and the only one that can answer "why is this owner's balance
 * what it is" six months from now.
 *
 * It exists before the things that write to it on purpose. Once deposits are being held and owners
 * are being paid by a background job, reconstructing history from Stripe's dashboard and a status
 * field is not good enough.
 *
 * ## Rules
 *
 * - **Append-only.** Never update a row, never delete one. A correction is a new row of type
 *   `adjustment` that refers to the original. A ledger you can edit is not a ledger.
 * - **Integer cents**, like every other money figure here. Dollar floats break the invariant that
 *   `totalAmount == ownerPayout + platform.revenue + platform.taxCollected`.
 * - **`balanceEffect` says whether money actually moved.** An authorization is a promise, not a
 *   movement: a deposit hold reserves the renter's credit and transfers nothing. Summing rows
 *   without checking this is how a hold gets counted as revenue.
 * - **Writing a row must never fail the request that caused it.** See `recordMoneyEvent`.
 */

/** What happened. `deposit_*` types are written by the work in Phase 3; the rest exist now. */
export const MONEY_EVENT_TYPES = [
  "charge",
  "charge_failed",
  "refund",
  "transfer_to_owner",
  "transfer_reversed",
  "application_fee",
  "deposit_authorized",
  "deposit_authorization_failed",
  "deposit_captured",
  "deposit_released",
  "deposit_expired",
  /** A manual correction. Must carry `reason` and should reference what it corrects. */
  "adjustment",
] as const;
export type MoneyEventType = (typeof MONEY_EVENT_TYPES)[number];

/**
 * Which part of the price this row represents, when it represents only one.
 *
 * A charge covers several at once and leaves this unset, using `breakdown` instead; a transfer to an
 * owner is purely `rental`; an application fee is `platform`.
 */
export const MONEY_COMPONENTS = [
  "rental",
  "renter_markup",
  "owner_commission",
  "tax",
  "delivery",
  "deposit",
  "platform",
] as const;
export type MoneyComponent = (typeof MONEY_COMPONENTS)[number];

export interface IMoneyEvent extends Document {
  booking: Types.ObjectId;
  payment?: Types.ObjectId;
  type: MoneyEventType;
  /** Always positive. `type` and `balanceEffect` carry the direction. */
  amountCents: number;
  currency: string;
  /** `none` means nothing moved — an authorization, or a failed attempt. */
  balanceEffect: "in" | "out" | "none";
  component?: MoneyComponent;
  /** The split, for an event that covers several components at once. Cents. */
  breakdown?: Record<string, number>;
  actor: {
    kind: "renter" | "owner" | "admin" | "system" | "webhook";
    id?: Types.ObjectId;
  };
  reason?: string;
  /** `pi_…`, `re_…`, `tr_…` — whatever Stripe called it, for reconciliation. */
  stripeId?: string;
  /** Dedupes a replayed webhook or a retried job. Unique where present. */
  idempotencyKey?: string;
  occurredAt: Date;
}

const MoneyEventSchema = new Schema<IMoneyEvent>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    payment: { type: Schema.Types.ObjectId, ref: "Payment" },
    type: { type: String, enum: MONEY_EVENT_TYPES, required: true },
    amountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "CAD" },
    balanceEffect: { type: String, enum: ["in", "out", "none"], required: true },
    component: { type: String, enum: MONEY_COMPONENTS },
    breakdown: { type: Schema.Types.Mixed },
    actor: {
      kind: {
        type: String,
        enum: ["renter", "owner", "admin", "system", "webhook"],
        required: true,
      },
      id: { type: Schema.Types.ObjectId, ref: "User" },
    },
    reason: { type: String, maxlength: 500 },
    stripeId: { type: String },
    idempotencyKey: { type: String },
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// The question this collection is built to answer: everything that happened to one booking, in order.
MoneyEventSchema.index({ booking: 1, occurredAt: 1 });
MoneyEventSchema.index({ type: 1, occurredAt: -1 });
MoneyEventSchema.index({ stripeId: 1 }, { sparse: true });
// Partial rather than sparse: a unique sparse index still collides on multiple nulls in some
// drivers, and most rows have no key.
MoneyEventSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

export const MoneyEventModel = mongoose.model<IMoneyEvent>("MoneyEvent", MoneyEventSchema);
