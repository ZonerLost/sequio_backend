import mongoose, { Schema, Document } from "mongoose";

export const REPORT_REASONS = [
  "spam",
  "fake_profile",
  "harassment",
  "inappropriate_content",
  "scam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = "pending" | "reviewed" | "dismissed";

export interface IUserReport extends Document {
  _id: mongoose.Types.ObjectId;
  reportedBy: mongoose.Types.ObjectId;
  reportedUser: mongoose.Types.ObjectId;
  reason: ReportReason;
  description?: string;
  conversationId?: mongoose.Types.ObjectId;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
}

const UserReportSchema = new Schema<IUserReport>(
  {
    reportedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reportedUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    description: { type: String, trim: true, maxlength: 500 },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

UserReportSchema.index({ reportedBy: 1, reportedUser: 1 });
UserReportSchema.index({ reportedUser: 1, status: 1 });

export const UserReportModel = mongoose.model<IUserReport>(
  "UserReport",
  UserReportSchema
);
