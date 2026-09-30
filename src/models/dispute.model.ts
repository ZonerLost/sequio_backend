import mongoose, { Schema, Document } from "mongoose";

export type DisputeReason =
  | "item_damaged"
  | "item_not_returned"
  | "item_not_as_described"
  | "late_return"
  | "no_show"
  | "payment_issue"
  | "other";

export type DisputeStatus =
  | "open"
  | "under_review"
  | "resolved_for_renter"
  | "resolved_for_owner"
  | "resolved_mutually"
  | "closed";

export interface IDispute extends Document {
  _id: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  reportedBy: mongoose.Types.ObjectId;
  reportedAgainst: mongoose.Types.ObjectId;
  reason: DisputeReason;
  description: string;
  evidence: string[];
  status: DisputeStatus;
  adminNote?: string;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DisputeSchema = new Schema<IDispute>(
  {
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    reportedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reportedAgainst: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
      type: String,
      enum: ["item_damaged", "item_not_returned", "item_not_as_described", "late_return", "no_show", "payment_issue", "other"],
      required: true,
    },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    evidence: [{ type: String }],
    status: {
      type: String,
      enum: ["open", "under_review", "resolved_for_renter", "resolved_for_owner", "resolved_mutually", "closed"],
      default: "open",
    },
    adminNote: { type: String },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

DisputeSchema.index({ reportedBy: 1, status: 1 });
// GET /disputes/my matches either side, so the second branch of that $or needs its own index.
DisputeSchema.index({ reportedAgainst: 1, status: 1 });
DisputeSchema.index({ booking: 1 });
DisputeSchema.index({ status: 1, createdAt: -1 }); // for admin

export const DisputeModel = mongoose.model<IDispute>("Dispute", DisputeSchema);