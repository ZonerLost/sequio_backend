import mongoose, { Schema, Document } from "mongoose";

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
  status: "pending" | "accepted" | "active" | "completed" | "declined" | "cancelled";
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
  paymentStatus: "unpaid" | "paid" | "failed" | "refunded";
  preRentalPhotos: string[];
  postRentalPhotos: string[];
  declineReason?: string;
  cancelReason?: string;
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
      enum: ["pending", "accepted", "active", "completed", "declined", "cancelled"],
      default: "pending",
    },
    // Bookings written before 2026-10-07 have no value here. A reader must treat a missing
    // paymentStatus as "unpaid" rather than assuming the default was applied retroactively.
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "failed", "refunded"],
      default: "unpaid",
    },
    preRentalPhotos: [{ type: String }],
    postRentalPhotos: [{ type: String }],
    declineReason: String,
    cancelReason: String,
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