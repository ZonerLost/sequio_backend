import mongoose, { Schema } from "mongoose";
import { IItem } from "../types";

const daySlotSchema = {
  enabled: { type: Boolean, default: false },
  allDay: { type: Boolean, default: false },
  startTime: { type: String },
  endTime: { type: String },
};

const weeklyScheduleSchema = {
  scheduleType: { type: String, enum: ["recurring", "specific_dates"], default: "recurring" },
  recurringDays: {
    monday: daySlotSchema,
    tuesday: daySlotSchema,
    wednesday: daySlotSchema,
    thursday: daySlotSchema,
    friday: daySlotSchema,
    saturday: daySlotSchema,
    sunday: daySlotSchema,
  },
  specificDates: [
    {
      date: { type: Date },
      enabled: { type: Boolean, default: false },
      allDay: { type: Boolean, default: false },
      startTime: { type: String },
      endTime: { type: String },
    },
  ],
};

const ItemSchema = new Schema<IItem>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, required: true },
    subCategory: { type: String },
    photos: [{ type: String }],
    dailyRate: { type: Number, required: true, min: 0 },
    weeklyRate: { type: Number, min: 0 },
    monthlyRate: { type: Number, min: 0 },
    depositAmount: { type: Number, default: 0, min: 0 },
    minRentalDays: { type: Number, default: 1, min: 1 },
    maxRentalDays: { type: Number },
    quantity: { type: Number, default: 1, min: 1 },
    currency: { type: String, default: "CAD" },
    location: {
      address: { type: String },
      city: { type: String, required: true },
      province: { type: String, required: true },
      country: { type: String, default: "Canada" },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number },
      },
    },
    availability: {
      isAvailable: { type: Boolean, default: true },
      blockedDates: [{ type: Date }],
      availableFrom: { type: Date },
      availableTo: { type: Date },
    },
    deliveryOptions: {
      pickup: { type: Boolean, default: true },
      delivery: { type: Boolean, default: false },
      deliveryRadius: { type: Number },
      deliveryFee: { type: Number, default: 0 },
      deliveryPricing: [
        {
          radius: { type: Number },
          fee: { type: Number },
        },
      ],
    },
    bookingType: { type: String, enum: ["manual", "instant"], default: "manual" },
    pickupSchedule: weeklyScheduleSchema,
    deliverySchedule: weeklyScheduleSchema,
    isPaused: { type: Boolean, default: false },
    condition: {
      type: String,
      enum: ["new", "like_new", "good", "fair"],
      required: true,
    },
    isFeatured: { type: Boolean, default: false },
    featuredUntil: { type: Date },
    isBoosted: { type: Boolean, default: false },
    boostedAt: { type: Date },
    boostExpiresAt: { type: Date },
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    totalRentals: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    tags: [{ type: String }],
  },
  { timestamps: true }
);

ItemSchema.index({ owner: 1 });
ItemSchema.index({ category: 1 });
ItemSchema.index({ "location.city": 1 });
ItemSchema.index({ isFeatured: 1, isActive: 1 });
ItemSchema.index({ isBoosted: 1, boostExpiresAt: 1 });
ItemSchema.index({ title: "text", description: "text", tags: "text" });

export const ItemModel = mongoose.model<IItem>("Item", ItemSchema);