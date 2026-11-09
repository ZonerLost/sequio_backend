import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * One row every time an owner cancels a booking they had already accepted.
 *
 * The renter has been able to cancel since the beginning; the owner could not cancel **at all**
 * until November 2026 — no button, no endpoint — so an owner whose van broke down had to email
 * support. Giving them the button needs a counterweight, because an owner cancelling at the last
 * minute is the most damaging thing that can happen to a renter who has made plans around an item.
 *
 * That counterweight is the client's three-strike rule: first = warning, second within a rolling
 * 90 days = second warning, third = temporary suspension from receiving new bookings, with
 * administrator review and appeal.
 *
 * ## "Unjustified" is doing a lot of work, and nobody has defined it
 *
 * The specification says to "track **unjustified** owner cancellations" and, separately, that
 * administrators "can assess legitimate exceptions and **reverse** warnings or suspensions". You can
 * only reverse something that already happened — so the default has to be that a cancellation counts
 * against the owner, and an administrator excuses it afterwards.
 *
 * That is what `countsAsStrike` does, and it defaults to `true`. It is deliberately harsh, and it is
 * the reading the text supports: an owner who genuinely had an emergency is excused by a human, not
 * by the system guessing. **This is an open question with the client** — see CLIENT_DOCS_REVIEW.md.
 * If they define "unjustified" more narrowly, this is the one field that changes.
 *
 * Rows are never deleted. Excusing a cancellation flips `countsAsStrike` and records who did it and
 * why, so the history of a decision survives the decision being changed.
 */

export const OWNER_CANCELLATION_REASONS = [
  "damaged_or_unavailable",
  "theft",
  "emergency",
  "scheduling_conflict",
  "other",
] as const;
export type OwnerCancellationReason = (typeof OWNER_CANCELLATION_REASONS)[number];

/** How long a third strike keeps an owner from receiving new bookings. */
export const SUSPENSION_DAYS = 30;
/** The window the strikes are counted over. */
export const STRIKE_WINDOW_DAYS = 90;

export interface IOwnerCancellation extends Document {
  booking: Types.ObjectId;
  owner: Types.ObjectId;
  renter: Types.ObjectId;
  reason: OwnerCancellationReason;
  /** Required in every case, not only for "other". */
  explanation: string;
  /** Raw S3 URLs under a private prefix. Signed on read, never stored signed. */
  evidence: string[];
  /** False once an administrator has excused it. Drives the rolling count. */
  countsAsStrike: boolean;
  /** What the system did at the time: nothing, a warning, or a suspension. */
  outcome: "none" | "warning" | "final_warning" | "suspension";
  /** Which strike this was, within the window, when it happened. */
  strikeNumber: number;
  review?: {
    by: Types.ObjectId;
    at: Date;
    note: string;
    /** What it was changed to, so a reversal is distinguishable from an original decision. */
    excused: boolean;
  };
  /** Whether the renter actually got their money back, and if not, why not. */
  refund: {
    attempted: boolean;
    succeeded: boolean;
    error?: string;
  };
  createdAt: Date;
}

const OwnerCancellationSchema = new Schema<IOwnerCancellation>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    renter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, enum: OWNER_CANCELLATION_REASONS, required: true },
    explanation: { type: String, required: true, minlength: 10, maxlength: 1000 },
    evidence: [{ type: String }],
    countsAsStrike: { type: Boolean, default: true },
    outcome: {
      type: String,
      enum: ["none", "warning", "final_warning", "suspension"],
      default: "none",
    },
    strikeNumber: { type: Number, default: 0 },
    review: {
      by: { type: Schema.Types.ObjectId, ref: "User" },
      at: { type: Date },
      note: { type: String, maxlength: 500 },
      excused: { type: Boolean },
    },
    refund: {
      attempted: { type: Boolean, default: false },
      succeeded: { type: Boolean, default: false },
      error: { type: String },
    },
  },
  { timestamps: true }
);

// The rolling-window count is the only hot query: this owner's strikes since a date.
OwnerCancellationSchema.index({ owner: 1, countsAsStrike: 1, createdAt: -1 });
// One cancellation record per booking — a booking can only be cancelled once.
OwnerCancellationSchema.index({ booking: 1 }, { unique: true });

export const OwnerCancellationModel = mongoose.model<IOwnerCancellation>(
  "OwnerCancellation",
  OwnerCancellationSchema
);
