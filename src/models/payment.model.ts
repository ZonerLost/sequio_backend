import mongoose, { Schema, Document } from "mongoose";

export type PaymentStatus = "pending" | "completed" | "failed" | "refunded";
export type PaymentMethod = "apple_pay" | "google_pay" | "credit_card" | "debit_card";

export interface IPaymentMethodCard {
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface ISavedPaymentMethod extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  type: PaymentMethod;
  label: string;
  card?: IPaymentMethodCard;
  isDefault: boolean;
  createdAt: Date;
}

export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  payer: mongoose.Types.ObjectId;
  payee: mongoose.Types.ObjectId;
  /** The saved method this was paid with, when the client names one. */
  paymentMethod?: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  // Mobile app sends this after processing payment natively
  externalReference?: string; // Apple Pay / Google Pay transaction ID
  receiptUrl?: string;
  refundedAt?: Date;
  refundReason?: string;
  // TODO: Stripe/payment gateway integration pending
  // stripePaymentIntentId?: string;
  // stripeChargeId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SavedPaymentMethodSchema = new Schema<ISavedPaymentMethod>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["apple_pay", "google_pay", "credit_card", "debit_card"],
      required: true,
    },
    label: { type: String, required: true },
    card: {
      last4: String,
      brand: String,
      expiryMonth: Number,
      expiryYear: Number,
    },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const PaymentSchema = new Schema<IPayment>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    payer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    payee: { type: Schema.Types.ObjectId, ref: "User", required: true },
    paymentMethod: { type: Schema.Types.ObjectId, ref: "SavedPaymentMethod" },
    amount: { type: Number, required: true },
    currency: { type: String, default: "CAD" },
    method: {
      type: String,
      enum: ["apple_pay", "google_pay", "credit_card", "debit_card"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    externalReference: { type: String },
    receiptUrl: { type: String },
    refundedAt: { type: Date },
    refundReason: { type: String },
  },
  { timestamps: true }
);

PaymentSchema.index({ payer: 1, createdAt: -1 });
PaymentSchema.index({ payee: 1, createdAt: -1 });
PaymentSchema.index({ booking: 1 });
// A booking can carry at most ONE completed payment. The service also checks before inserting, but
// two concurrent requests both pass that check — this is what actually prevents the double row.
// Partial, so failed/refunded attempts on the same booking stay allowed.
PaymentSchema.index(
  { booking: 1 },
  { unique: true, partialFilterExpression: { status: "completed" }, name: "one_completed_per_booking" }
);
SavedPaymentMethodSchema.index({ user: 1 });

export const PaymentModel = mongoose.model<IPayment>("Payment", PaymentSchema);
export const SavedPaymentMethodModel = mongoose.model<ISavedPaymentMethod>(
  "SavedPaymentMethod",
  SavedPaymentMethodSchema
);