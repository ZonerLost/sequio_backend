import mongoose, { Schema, Document } from "mongoose";

export type PaymentStatus = "pending" | "completed" | "failed" | "refunded";

/**
 * How the renter's card was charged, which decides when and how the owner gets paid.
 *
 * - `destination`: a destination charge. The owner's share transferred at capture — there is
 *   nothing left to pay out, and a refund reverses it with `reverse_transfer`.
 * - `platform`: separate charges and transfers. The money is in Atussa's balance and the owner is
 *   paid later by the `release-owner-payouts` job. A refund here does **not** reverse anything.
 *
 * **A missing value means `destination`.** Every payment written before November 2026 was a
 * destination charge, and a schema default applies to new documents only (DO-NOT #13). Read it with
 * `chargeModelOf()` and never filter on `{ chargeModel: "destination" }`.
 */
export type ChargeModel = "destination" | "platform";
export type PaymentMethod = "apple_pay" | "google_pay" | "credit_card" | "debit_card";

export interface IPaymentMethodCard {
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface ISavedPaymentMethod extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  type: PaymentMethod;
  label: string;
  card?: IPaymentMethodCard;
  isDefault: boolean;
  createdAt: Date;
}

export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  payer: mongoose.Types.ObjectId;
  payee: mongoose.Types.ObjectId;
  /** The saved method this was paid with, when the client names one. */
  paymentMethod?: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  // Mobile app sends this after processing payment natively
  externalReference?: string; // Apple Pay / Google Pay transaction ID
  receiptUrl?: string;
  refundedAt?: Date;
  refundReason?: string;
  /**
   * How much of this payment has been refunded so far, **in dollars like `amount`**.
   *
   * Dollars, not cents, deliberately: the number a reader compares it to is `amount`, a few lines
   * up, and one model holding the same quantity in two units is how a 100x error gets written.
   * Every calculation is done in integer cents and converted here at the boundary.
   *
   * It accumulates, because a booking can be refunded more than once now: half the rental on a
   * 24–48h cancellation, then the other half if the owner approves it. A **partial** refund leaves
   * `status` as `completed` — the payment is still the one completed payment for that booking, and
   * flipping it to `refunded` would free the unique index and let the booking take a second one.
   */
  refundedAmount?: number;
  stripePaymentIntentId?: string;
  stripeClientSecret?: string;
  stripeTransferId?: string;
  stripeRefundId?: string;

  /** Which charge model moved this money. Absent means `destination` — see ChargeModel. */
  chargeModel?: ChargeModel;
  /** The charge the funds came from, needed as a transfer's `source_transaction`. */
  stripeChargeId?: string;
  /**
   * Claimed by the payout job before it calls Stripe, so a retry inside one run cannot transfer
   * twice. Set back to null if the attempt fails, which is what lets the next tick retry.
   */
  payoutInitiatedAt?: Date | null;
  /** When the transfer to the owner actually succeeded. */
  payoutAt?: Date;
  /** The last payout failure, kept so a stuck payout is visible rather than silent. */
  payoutError?: string;
  payoutAttempts?: number;
  /** Set when a transfer was clawed back — owner cancellation after the payout had gone out. */
  transferReversedAt?: Date;
  /**
   * Money that should have come back from the owner and did not, because their balance could not
   * cover the reversal. A real debt for support to chase, not a logging detail.
   */
  reversalOutstanding?: number;

  createdAt: Date;
  updatedAt: Date;
}

/** A missing `chargeModel` means the destination charge that predates the field. */
export const chargeModelOf = (payment: { chargeModel?: ChargeModel } | null | undefined): ChargeModel =>
  payment?.chargeModel === "platform" ? "platform" : "destination";

const SavedPaymentMethodSchema = new Schema<ISavedPaymentMethod>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["apple_pay", "google_pay", "credit_card", "debit_card"],
      required: true,
    },
    label: { type: String, required: true },
    card: {
      last4: String,
      brand: String,
      expiryMonth: Number,
      expiryYear: Number,
    },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const PaymentSchema = new Schema<IPayment>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    payer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    payee: { type: Schema.Types.ObjectId, ref: "User", required: true },
    paymentMethod: { type: Schema.Types.ObjectId, ref: "SavedPaymentMethod" },
    amount: { type: Number, required: true },
    currency: { type: String, default: "CAD" },
    method: {
      type: String,
      enum: ["apple_pay", "google_pay", "credit_card", "debit_card"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    externalReference: { type: String },
    receiptUrl: { type: String },
    refundedAt: { type: Date },
    refundReason: { type: String },
    // No default: a missing value means "nothing refunded", and a default would only apply to new
    // documents anyway (DO-NOT #13). Readers must treat absent as zero.
    refundedAmount: { type: Number },
    stripePaymentIntentId: { type: String, sparse: true, index: true },
    stripeClientSecret: { type: String },
    stripeTransferId: { type: String },
    stripeRefundId: { type: String },

    // Deliberately no schema default on chargeModel: a default would apply to new documents only
    // and would tell you nothing about the thousands that predate it. Absent means destination.
    chargeModel: { type: String, enum: ["destination", "platform"] },
    stripeChargeId: { type: String },
    payoutInitiatedAt: { type: Date, default: null },
    payoutAt: { type: Date },
    payoutError: { type: String },
    payoutAttempts: { type: Number, default: 0 },
    transferReversedAt: { type: Date },
    reversalOutstanding: { type: Number },
  },
  { timestamps: true }
);

PaymentSchema.index({ payer: 1, createdAt: -1 });
PaymentSchema.index({ payee: 1, createdAt: -1 });
PaymentSchema.index({ booking: 1 });
// A booking can carry at most ONE completed payment. The service also checks before inserting, but
// two concurrent requests both pass that check — this is what actually prevents the double row.
// Partial, so failed/refunded attempts on the same booking stay allowed.
PaymentSchema.index(
  { booking: 1 },
  { unique: true, partialFilterExpression: { status: "completed" }, name: "one_completed_per_booking" }
);
/**
 * The payout job's query: completed platform charges with no transfer yet.
 *
 * Sparse on `payoutAt` would not help — the rows it wants are precisely the ones where it is
 * absent. This indexes what the job actually filters on.
 */
PaymentSchema.index({ status: 1, chargeModel: 1, payoutAt: 1 });

SavedPaymentMethodSchema.index({ user: 1 });

export const PaymentModel = mongoose.model<IPayment>("Payment", PaymentSchema);
export const SavedPaymentMethodModel = mongoose.model<ISavedPaymentMethod>(
  "SavedPaymentMethod",
  SavedPaymentMethodSchema
);