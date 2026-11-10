import mongoose, { Schema, Document } from "mongoose";

/**
 * A refund the renter has to **ask** for, and the owner decides.
 *
 * Two situations in the client's specification turn out to be the same mechanism, which is why there
 * is one model and not two:
 *
 * - **`cancellation_balance`** — the "other 50%" from their Q1. A cancellation 24–48 hours before
 *   the start refunds half the rental automatically; the owner may voluntarily approve the rest.
 *   Opened by the cancellation itself, pre-filled, so the owner only has to decide.
 * - **`early_return`** — their Q3, answered verbatim: *"No automatic refund. The renter may request
 *   a partial refund; the owner may approve a specified amount or decline."* A renter who hands a
 *   drill back on day 5 of 10 is owed nothing automatically. Recording the early return starts the
 *   inspection clock and nothing else; this is the only thing that moves money.
 *
 * Building one flow for both means the owner sees one screen, the audit trail has one shape, and the
 * arithmetic that decides what the owner keeps cannot be computed two different ways.
 *
 * **What happens when the owner declines is an open question with the client** — gap 6 in
 * `CLIENT_DOCS_REVIEW.md`: *"Early return: what if the owner declines the partial refund? No
 * escalation path. Can an admin override, and on what basis?"* So a decline is **final here and
 * visible to administrators**, who already have `PUT /admin/payments/:id/refund` if they decide to
 * override it. No automatic escalation has been invented: inventing one would be inventing policy,
 * and a renter told "an admin will review this" when no review process exists is worse than a
 * renter told no.
 */

export const REFUND_REQUEST_KINDS = ["cancellation_balance", "early_return"] as const;
export type RefundRequestKind = (typeof REFUND_REQUEST_KINDS)[number];

/**
 * `approved` covers a partial approval too — the owner may approve less than was asked, and
 * `approvedCents` is what they actually agreed to. A separate `partially_approved` status would add
 * a string every client has to learn for information already in the numbers.
 */
export const REFUND_REQUEST_STATUSES = ["pending", "approved", "declined", "withdrawn"] as const;
export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

export interface IRefundRequest extends Document {
  _id: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  renter: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  payment?: mongoose.Types.ObjectId;
  kind: RefundRequestKind;
  status: RefundRequestStatus;
  /** Integer cents throughout, like every other money figure in this codebase. */
  requestedCents: number;
  approvedCents?: number;
  /** The renter's own words. Required: an owner cannot judge a bare number. */
  reason: string;
  decision?: {
    by?: mongoose.Types.ObjectId;
    actor?: "owner" | "admin" | "renter";
    at?: Date;
    note?: string;
  };
  /**
   * What Stripe did about it. Separate from `status` because an approval and the money arriving are
   * two events, and an approval whose refund failed must not read as paid.
   */
  refund?: {
    attempted?: boolean;
    succeeded?: boolean;
    stripeRefundId?: string;
    error?: string;
    at?: Date;
  };
  /**
   * The cancellation quote frozen at the moment the request was opened, for
   * `cancellation_balance` requests.
   *
   * Stored rather than recomputed for the same reason `booking.pricing` is: the owner is approving
   * a specific number that was shown to a specific renter, and a rate change or a clock tick must
   * not silently alter what they agreed to.
   */
  context?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const RefundRequestSchema = new Schema<IRefundRequest>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    renter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    payment: { type: Schema.Types.ObjectId, ref: "Payment" },
    kind: { type: String, enum: REFUND_REQUEST_KINDS, required: true },
    status: { type: String, enum: REFUND_REQUEST_STATUSES, default: "pending" },
    requestedCents: { type: Number, required: true, min: 1 },
    approvedCents: { type: Number, min: 0 },
    reason: { type: String, required: true, maxlength: 1000 },
    decision: {
      by: { type: Schema.Types.ObjectId, ref: "User" },
      actor: { type: String, enum: ["owner", "admin", "renter"] },
      at: { type: Date },
      note: { type: String, maxlength: 1000 },
    },
    refund: {
      attempted: { type: Boolean },
      succeeded: { type: Boolean },
      stripeRefundId: { type: String },
      error: { type: String, maxlength: 500 },
      at: { type: Date },
    },
    context: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

RefundRequestSchema.index({ renter: 1, createdAt: -1 });
RefundRequestSchema.index({ owner: 1, status: 1, createdAt: -1 });
RefundRequestSchema.index({ status: 1, createdAt: -1 });
/**
 * **One pending request per booking, enforced by the database.**
 *
 * The service checks first, but two taps on a slow connection both pass that check — contended
 * writes need an atomic operation, not read-then-write, and this is the atomic operation. Partial,
 * so a booking may hold any number of decided requests: a renter whose early-return request was
 * declined is not barred from asking again if the owner invites it.
 */
RefundRequestSchema.index(
  { booking: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
    name: "one_pending_refund_request_per_booking",
  }
);

export const RefundRequestModel = mongoose.model<IRefundRequest>(
  "RefundRequest",
  RefundRequestSchema
);
