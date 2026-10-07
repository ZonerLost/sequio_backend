import mongoose, { Schema, Document } from "mongoose";
import { NotificationType } from "./notification.model";

/**
 * Platform-wide settings an administrator can change at runtime.
 *
 * A single document, found by the fixed `key`. A singleton collection rather than environment
 * variables because these are operational switches an admin flips in the panel, not deployment
 * configuration — changing one must not need a release.
 *
 * Kept deliberately small. The admin panel used to present a notifications form covering email and
 * SMS channels, editable subject/body templates and a "send photo reminder N hours after end" rule,
 * none of which exist anywhere in this codebase: notifications are in-app only (FCM push is still a
 * stub), their text is built from hardcoded strings in notification.triggers.ts, and there is no
 * scheduler. Storing settings for features that do not exist would make the form look functional
 * while changing nothing, which is what it did before.
 *
 * What is here is what `notificationService.send()` can actually honour.
 */
export interface IPlatformSettings extends Document {
  key: "platform";
  notifications: {
    /** Master switch. Off means no in-app notification is created at all. */
    enabled: boolean;
    /**
     * Types that are muted. A missing type means "send it", so a new notification type added in
     * code is on by default rather than silently suppressed by a stale settings document.
     */
    mutedTypes: NotificationType[];
  };
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, required: true, unique: true, default: "platform" },
    notifications: {
      enabled: { type: Boolean, default: true },
      mutedTypes: { type: [String], default: [] },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const PlatformSettingsModel = mongoose.model<IPlatformSettings>(
  "PlatformSettings",
  PlatformSettingsSchema
);
