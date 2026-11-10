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
    /**
     * Optional on the schema and load-bearing for the 18+ requirement, which is an uncomfortable
     * combination worth explaining.
     *
     * It cannot be `required`: all 37 existing accounts have none, and mongoose `required` does not
     * run on the update paths this codebase uses anyway (DO-NOT #4). The rule is enforced in the
     * validators and in `compliance.helper.ts`, which is also where the decision about existing
     * accounts lives. **Absent means "never asked", not "under 18"** — the two must not be
     * conflated, because one is a gap in our data and the other is a reason to refuse service.
     */
    dateOfBirth: { type: Date },
    /**
     * Whether this owner is registered for GST/HST and QST, and their numbers.
     *
     * The client's instruction is that tax allocation depends on it. **Nothing in the pricing code
     * reads this yet, deliberately**: their tax base is still unconfirmed in writing, and building
     * an allocation rule on an unconfirmed base collects the right amount while remitting the wrong
     * tax. The fields exist, are format-validated, and are snapshotted onto each booking so a later
     * change cannot rewrite a rental that has already happened.
     *
     * `verifiedAt` is set by an administrator, never by code: only the CRA and Revenu Québec can
     * confirm a number is real, and neither offers an API. A format check proves shape, not
     * existence.
     *
     * The whole object is absent until the owner answers. Absent is unknown; `isRegistered: false`
     * is them saying no (DO-NOT #13).
     */
    taxRegistration: {
      isRegistered: { type: Boolean },
      gstNumber: { type: String, trim: true },
      qstNumber: { type: String, trim: true },
      declaredAt: { type: Date },
      verifiedAt: { type: Date },
      verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
      verificationNote: { type: String, maxlength: 500 },
    },
    location: {
      address: { type: String, trim: true },
      city: { type: String },
      province: { type: String },
      country: { type: String, default: "Canada" },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number },
      },
      /**
       * The same point in GeoJSON, for indexed geospatial queries. Server-maintained: it is kept
       * in step with `coordinates` by `applyCoordinates()` in location.helper.ts, and no Joi
       * validator accepts it, so a client cannot write one that disagrees.
       *
       * Order is [lng, lat] — GeoJSON's order, the reverse of everything else here.
       */
      geo: {
        type: {
          type: String,
          enum: ["Point"],
        },
        coordinates: {
          type: [Number],
        },
      },
      /**
       * Where the point came from: `client` when the device or the owner supplied it, `geocoded`
       * when the server derived it from the address text. Server-maintained, like `geo`.
       */
      geoSource: {
        type: String,
        enum: ["client", "geocoded"],
      },
      /**
       * How exact the point is, in the geocoder's own words — `city`, `village`, `address`,
       * `building`. A client should draw a circle for a city and a pin for an address.
       */
      geoPrecision: { type: String },
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
    /**
     * Suspended from receiving new bookings after a third owner cancellation in 90 days.
     *
     * A date rather than a flag, read at booking time, so the suspension lapses on its own with no
     * scheduled job to un-set it. A value in the past is simply not a suspension.
     *
     * Note this stops them *renting out*; it does not ban the account. They can still rent from
     * other people, message, and manage their listings.
     */
    ownerSuspendedUntil: { type: Date },
    ownerSuspendedAt: { type: Date },
    lastLoginAt: { type: Date },
    fcmToken: { type: String },
    // Stripe Connect. Status only: the account number and every KYC document live at Stripe, so a
    // breach of this database exposes nothing that could move money. Never add raw bank fields here.
    stripeAccount: {
      id: { type: String },
      chargesEnabled: { type: Boolean },
      payoutsEnabled: { type: Boolean },
      detailsSubmitted: { type: Boolean },
      requirementsDue: [{ type: String }],
      disabledReason: { type: String },
      country: { type: String },
      defaultCurrency: { type: String },
      bankLast4: { type: String },
      bankName: { type: String },
      syncedAt: { type: Date },
    },
    isOnline: { type: Boolean, default: false },
    lastSeenAt: { type: Date },
    boostCredits: { type: Number, default: 0 },
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
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