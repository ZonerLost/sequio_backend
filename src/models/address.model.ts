import mongoose, { Schema, Document } from "mongoose";

export interface IAddress extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  label: string;
  addressLine: string;
  city: string;
  province: string;
  country: string;
  postalCode?: string;
  coordinates?: { lat: number; lng: number };
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    label: { type: String, required: true, trim: true, maxlength: 50 },
    addressLine: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    province: { type: String, required: true, trim: true },
    country: { type: String, default: "Canada", trim: true },
    postalCode: { type: String, trim: true },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AddressSchema.index({ userId: 1, createdAt: -1 });
AddressSchema.index({ userId: 1, isDefault: 1 });

export const AddressModel = mongoose.model<IAddress>("Address", AddressSchema);
