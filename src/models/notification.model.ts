import mongoose, { Schema, Document } from "mongoose";

/**
 * Every notification type, as a runtime value.
 *
 * The union is derived from this array rather than written twice: the admin panel lists the types an
 * administrator can mute, and a hand-maintained second copy would drift the moment someone added a
 * type — leaving it unmutable, or offering one that no longer exists.
 */
export const NOTIFICATION_TYPES = [
  "booking_request",
  "booking_accepted",
  "booking_declined",
  "booking_cancelled",
  "booking_completed",
  "review_received",
  "message_received",
  "dispute_opened",
  "dispute_resolved",
  "payment_received",
  "item_added",
  "account_created",
  "identity_verified",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Map, of: String },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, isRead: 1 });

export const NotificationModel = mongoose.model<INotification>(
  "Notification",
  NotificationSchema
);