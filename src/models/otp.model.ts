import mongoose, { Schema } from "mongoose";
import { IOtp } from "../types";

const OtpSchema = new Schema<IOtp>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, lowercase: true },
    phone: { type: String },
    otp: { type: String, required: true },
    type: {
      type: String,
      enum: ["email_verification", "password_reset", "phone_verification"],
      required: true,
    },
    expiresAt: { type: Date, required: true },
    isUsed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OtpSchema.index({ userId: 1, type: 1 });

export const OtpModel = mongoose.model<IOtp>("Otp", OtpSchema);
