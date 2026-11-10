import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * The booking lifecycle.
 *
 * Three states are new in November 2026, covering the part of a rental that nothing used to model:
 * the item changing hands, coming back, and sitting with the owner while they inspect it. Every
 * deadline in the new specification hangs off that middle section — the 24-hour claim window, the
 * deposit release and the owner's payout.
 *
 *   pending
 *     -> accepted                      owner agrees
 *     -> declined                      owner refuses
 *   accepted
 *     -> ready_for_handover            the rental period has arrived and it is paid for
 *     -> cancelled
 *   ready_for_handover
 *     -> active                        handover confirmed; the renter has the item
 *   active
 *     -> awaiting_return               the rental period has ended, item not back yet
 *     -> returned_awaiting_inspection  returned early, or straight back on time
 *   awaiting_return
 *     -> returned_awaiting_inspection  return confirmed; the 24-hour clock starts
 *   returned_awaiting_inspection
 *     -> completed                     owner closed it, or 24 hours passed with no claim
 *
 * **The client's document calls `accepted` "Confirmed" and omits `declined`.** Its list is headed
 * "sample booking states", and renaming `accepted` would break every deployed copy of the Flutter
 * app and the admin panel, which filter on these strings — a breaking change across three codebases
 * to relabel one value. So the lifecycle matches their specification and the vocabulary does not.
 * Map `accepted` to "Confirmed" in the user interface, not in the database.
 */
export const BOOKING_STATUSES = [
  "pending",
  "accepted",
  "ready_for_handover",
  "active",
  "awaiting_return",
  "returned_awaiting_inspection",
  "completed",
  "declined",
  "cancelled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses in which the renter still has the item, or is about to. Used for conflict checks. */
export const LIVE_BOOKING_STATUSES: BookingStatus[] = [
  "pending",
  "accepted",
  "ready_for_handover",
  "active",
  "awaiting_return",
  "returned_awaiting_inspection",
];

/**
 * Where a booking's money has got to, tracked **independently of the booking status** because the
 * specification requires it: a cancelled booking can still be awaiting a refund, and a completed one
 * can still be waiting for its payout to land.
 *
 * `unpaid` is the client's "Pending"; `failed` is ours and has no equivalent in their list, which
 * does not mean a card can never be declined.
 *
 * The three payout states are written by the Phase 2 work: the owner is paid when the rental period
 * ends, not when the renter pays, so there is a real gap between "paid" and "paid out" to represent.
 */
export const PAYMENT_LIFECYCLE_STATUSES = [
  "unpaid",
  "paid",
  "failed",
  "payout_pending",
  "payout_initiated",
  "paid_out",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentLifecycleStatus = (typeof PAYMENT_LIFECYCLE_STATUSES)[number];

export interface IBooking extends Document {
  _id: mongoose.Types.ObjectId;
  item: mongoose.Types.ObjectId;
  renter: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  deliveryType: "pickup" | "delivery";
  bookingType: "instant" | "request";
  deliveryAddress?: {
    label: string;
    street: string;
    city: string;
    province: string;
    country: string;
    coordinates?: { lat: number; lng: number };
  };
  deliveryFee: number;
  pickupTimeFrom?: string;
  pickupTimeTo?: string;
  /**
   * Stored as calculated, never recomputed — see the schema note. Everything added on 2026-09-29 is
   * optional because bookings created before then do not have it.
   */
  pricing: {
    currency?: string;
    dailyRate: number;
    totalDays?: number;
    basePrice: number;
    discountPercent: number;
    discountAmount: number;
    rentalAmount?: number;
    deliveryFee?: number;
    subtotal: number;
    serviceFee: number;
    securityDeposit: number;
    totalAmount: number;
    taxes?: Array<{
      code: string;
      label: string;
      rate: number;
      amount: number;
      appliedTo: "atussa_fee" | "owner_commission";
    }>;
    taxTotal?: number;
    renterFee?: {
      percent: number;
      minimum: number;
      amount: number;
      taxTotal: number;
      minimumApplied: boolean;
    };
    ownerPayout?: {
      commissionPercent: number;
      commission: number;
      commissionTaxTotal: number;
      amount: number;
    };
    platform?: { revenue: number; taxCollected: number };
  };
  discountCode?: string;
  status: BookingStatus;
  /**
   * Whether this booking has been paid for. Denormalised onto the booking on purpose.
   *
   * `status` says nothing about money — a paid booking and an unpaid one are both `accepted` — so a
   * client had no way to tell them apart and kept offering "Pay Now" after a successful charge. The
   * renter saw a success message and then the same button, which reads like the payment failed. A
   * second tap is refused with a 409 so no one is double-charged, but the only real fix is for the
   * booking to carry the fact.
   *
   * Written by the Stripe webhook, which is authoritative, and by the record-payment path. Kept here
   * rather than derived from the Payment collection so listing bookings stays one query.
   */
  paymentStatus: PaymentLifecycleStatus;
  handover?: {
    at?: Date;
    confirmedBy?: Types.ObjectId;
    confirmedAt?: Date;
    note?: string;
  };
  returned?: {
    at?: Date;
    confirmedBy?: Types.ObjectId;
    confirmedAt?: Date;
    note?: string;
    disputed?: {
      by?: Types.ObjectId;
      at?: Date;
      claimedAt?: Date;
      reason?: string;
    };
  };
  preRentalPhotos: string[];
  postRentalPhotos: string[];
  declineReason?: string;
  cancelReason?: string;
  /**
   * What the cancellation policy decided, frozen at the moment of cancellation.
   *
   * Stored rather than recomputed, for the same reason `pricing` is: the tier depends on the time
   * the renter cancelled and the time zone the listing was in, and neither is recoverable later.
   * Recomputing a tier from `cancelledAt` next month would also silently re-decide a refund if the
   * policy constants were ever changed.
   */
  cancellation?: {
    tier?: "full" | "partial" | "none";
    cancelledBy?: "renter" | "owner" | "admin";
    timeZone?: string;
    timeZoneSource?: string;
    startsAt?: Date;
    hoursBeforeStart?: number;
    /** True when the policy owed the renter money and Stripe did not return it. Support retries. */
    refundOutstanding?: boolean;
  };
  /**
   * Where this booking's money actually ended up, after everything that has been refunded.
   *
   * **A sibling of `cancellation` rather than a part of it, and deliberately so.** It is written by
   * a cancellation *and* by an owner approving an early-return refund, which is not a cancellation
   * at all — a field called `cancellation.ownerRetainedCents` that is also set when nothing was
   * cancelled is the kind of name that misleads somebody a year from now.
   *
   * `ownerRetainedCents` is load-bearing beyond the audit trail: under the platform charge model the
   * payout job reads it to decide what to transfer, so a stale value pays an owner a share they have
   * already agreed to give up. **Absent means nothing has been refunded** and the owner is owed the
   * payout the booking was priced at.
   */
  settlement?: {
    refundedCents?: number;
    refundBreakdown?: { rental?: number; delivery?: number; fee?: number; tax?: number };
    ownerRetainedCents?: number;
    platformRetainedCents?: number;
  };
  acceptedAt?: Date;
  cancelledAt?: Date;
  /** Set only when an administrator cancelled it, so the audit trail survives. */
  cancelledByAdmin?: mongoose.Types.ObjectId;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>(
  {
    item: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    renter: { type: Schema.Types.ObjectId, ref: "User", required: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true, min: 1 },
    deliveryType: { type: String, enum: ["pickup", "delivery"], required: true },
    bookingType: { type: String, enum: ["instant", "request"], default: "request" },
    deliveryAddress: {
      label: String,
      street: String,
      city: String,
      province: String,
      country: { type: String, default: "Canada" },
      coordinates: { lat: Number, lng: Number },
    },
    deliveryFee: { type: Number, default: 0 },
    pickupTimeFrom: String,
    pickupTimeTo: String,
    // The whole breakdown is stored, never recomputed: a rate change must not rewrite the price of a
    // booking that was already agreed. Bookings created before 2026-09-29 have only the original
    // fields (5% fee, $100 deposit, no owner split) and must be read as-is.
    pricing: {
      /**
       * Which pricing model produced this breakdown, and what tax was applied to.
       *
       * There are three eras in this collection now: pre-2026-09 rows with only the original
       * fields, 2026-09 rows, and 2026-11 ones. A missing `model` means pre-2026-11 — it is not
       * safe to assume the current default applied retroactively (DO-NOT #13).
       */
      model: { type: String },
      taxBase: { type: String },
      currency: { type: String, default: "CAD" },
      dailyRate: { type: Number, required: true },
      totalDays: { type: Number },
      basePrice: { type: Number, required: true },
      discountPercent: { type: Number, default: 0 },
      discountAmount: { type: Number, default: 0 },
      /** The rental itself after discount — the base for commission and the renter fee. */
      rentalAmount: { type: Number },
      deliveryFee: { type: Number, default: 0 },
      subtotal: { type: Number, required: true },
      /** The Atussa Fee. Kept under the original name so existing clients keep rendering it. */
      serviceFee: { type: Number, required: true },
      securityDeposit: { type: Number, required: true },
      /** What the renter pays, taxes included. */
      totalAmount: { type: Number, required: true },
      taxes: [
        {
          code: { type: String },
          label: { type: String },
          rate: { type: Number },
          amount: { type: Number },
          appliedTo: { type: String, enum: ["atussa_fee", "owner_commission"] },
        },
      ],
      taxTotal: { type: Number },
      renterFee: {
        percent: { type: Number },
        minimum: { type: Number },
        amount: { type: Number },
        taxTotal: { type: Number },
        minimumApplied: { type: Boolean },
      },
      ownerPayout: {
        commissionPercent: { type: Number },
        commission: { type: Number },
        commissionTaxTotal: { type: Number },
        amount: { type: Number },
      },
      platform: {
        revenue: { type: Number },
        taxCollected: { type: Number },
      },
    },
    discountCode: String,
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending",
    },
    // Bookings written before 2026-10-07 have no value here. A reader must treat a missing
    // paymentStatus as "unpaid" rather than assuming the default was applied retroactively.
    paymentStatus: {
      type: String,
      enum: PAYMENT_LIFECYCLE_STATUSES,
      default: "unpaid",
    },
    preRentalPhotos: [{ type: String }],
    postRentalPhotos: [{ type: String }],
    /**
     * When the item actually changed hands, and who said so.
     *
     * Not the same thing as `startDate`, which is what was agreed. Every downstream deadline is
     * measured from what actually happened: the 24-hour inspection window runs from `returnedAt`,
     * and the owner's payout is owed once the rental is genuinely over.
     *
     * Either party may confirm — whoever has the phone in their hand at the kerb — and the other may
     * contest the recorded time, which is the "resolution process if the parties disagree on return
     * time" the specification requires.
     */
    handover: {
      at: { type: Date },
      confirmedBy: { type: Schema.Types.ObjectId, ref: "User" },
      confirmedAt: { type: Date },
      note: { type: String, maxlength: 500 },
    },
    returned: {
      at: { type: Date },
      confirmedBy: { type: Schema.Types.ObjectId, ref: "User" },
      confirmedAt: { type: Date },
      note: { type: String, maxlength: 500 },
      /** Set when the other party says the recorded time is wrong. An admin settles it. */
      disputed: {
        by: { type: Schema.Types.ObjectId, ref: "User" },
        at: { type: Date },
        claimedAt: { type: Date },
        reason: { type: String, maxlength: 500 },
      },
    },
    declineReason: String,
    cancelReason: String,
    cancellation: {
      tier: { type: String, enum: ["full", "partial", "none"] },
      cancelledBy: { type: String, enum: ["renter", "owner", "admin"] },
      timeZone: { type: String },
      timeZoneSource: { type: String },
      startsAt: { type: Date },
      hoursBeforeStart: { type: Number },
      refundOutstanding: { type: Boolean },
    },
    // No defaults anywhere here: absent means "nothing has been refunded", and a default would
    // apply to new documents only, saying nothing about the thousands that predate it (DO-NOT #13).
    settlement: {
      refundedCents: { type: Number },
      refundBreakdown: {
        rental: { type: Number },
        delivery: { type: Number },
        fee: { type: Number },
        tax: { type: Number },
      },
      ownerRetainedCents: { type: Number },
      platformRetainedCents: { type: Number },
    },
    acceptedAt: Date,
    cancelledAt: Date,
    // Without this on the schema, strict mode silently drops it and the audit trail is lost.
    cancelledByAdmin: { type: Schema.Types.ObjectId, ref: "User" },
    completedAt: Date,
  },
  { timestamps: true }
);

BookingSchema.index({ renter: 1, status: 1 });
BookingSchema.index({ owner: 1, status: 1 });
BookingSchema.index({ item: 1, startDate: 1, endDate: 1 });

export const BookingModel = mongoose.model<IBooking>("Booking", BookingSchema);