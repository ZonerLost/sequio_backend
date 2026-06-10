import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";
import { IUser } from "../types";
import { CONSTANTS } from "../config/constants";

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: false, trim: true },
    phone: { type: String, trim: true },
    profilePhoto: { type: String },
    bio: { type: String, trim: true },
    dateOfBirth: { type: Date },
    location: {
      address: { type: String, trim: true },
      city: { type: String },
      province: { type: String },
      country: { type: String, default: "Canada" },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number },
      },
    },
    language: { type: String, default: "en" },
    authProvider: { type: String, enum: ["email", "google", "facebook"], default: "email" },
    googleId: { type: String },
    facebookId: { type: String },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    isIdentityVerified: { type: Boolean, default: false },
    identityDocument: { type: String },
    rentalHistory: [{ type: Schema.Types.ObjectId, ref: "Booking" }],
    lendingHistory: [{ type: Schema.Types.ObjectId, ref: "Booking" }],
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isActive: { type: Boolean, default: true },
    isBanned: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    fcmToken: { type: String },
    boostCredits: { type: Number, default: 0 },
    
  },
  { timestamps: true }
);

UserSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, CONSTANTS.BCRYPT_ROUNDS);
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};


UserSchema.index({ googleId: 1 });
UserSchema.index({ facebookId: 1 });

export const UserModel = mongoose.model<IUser>("User", UserSchema);