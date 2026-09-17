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
  pricing: {
    dailyRate: number;
    basePrice: number;
    discountPercent: number;
    discountAmount: number;
    subtotal: number;
    serviceFee: number;
    securityDeposit: number;
    totalAmount: number;
  };
  discountCode?: string;
  status: "pending" | "accepted" | "active" | "completed" | "declined" | "cancelled";
  preRentalPhotos: string[];
  postRentalPhotos: string[];
  declineReason?: string;
  cancelReason?: string;
  acceptedAt?: Date;
  cancelledAt?: Date;
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
    pricing: {
      dailyRate: { type: Number, required: true },
      basePrice: { type: Number, required: true },
      discountPercent: { type: Number, default: 0 },
      discountAmount: { type: Number, default: 0 },
      subtotal: { type: Number, required: true },
      serviceFee: { type: Number, required: true },
      securityDeposit: { type: Number, required: true },
      totalAmount: { type: Number, required: true },
    },
    discountCode: String,
    status: {
      type: String,
      enum: ["pending", "accepted", "active", "completed", "declined", "cancelled"],
      default: "pending",
    },
    preRentalPhotos: [{ type: String }],
    postRentalPhotos: [{ type: String }],
    declineReason: String,
    cancelReason: String,
    acceptedAt: Date,
    cancelledAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

BookingSchema.index({ renter: 1, status: 1 });
BookingSchema.index({ owner: 1, status: 1 });
BookingSchema.index({ item: 1, startDate: 1, endDate: 1 });

export const BookingModel = mongoose.model<IBooking>("Booking", BookingSchema);