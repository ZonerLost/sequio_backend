import { NotificationRepository } from "../repository/notification.repository";
import { NotificationType } from "../models/notification.model";
import { UserModel } from "../models/user.model";
import { buildPagination } from "../helpers/pagination.helper";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { emitConversationUpdate } from "../socket";
import { PlatformSettingsModel } from "../models/platform-settings.model";
import { logger } from "../config/logger";

const notificationRepo = new NotificationRepository();

/**
 * Settings are read on nearly every notification, so they are cached briefly rather than fetched
 * each time. Ten seconds is short enough that an admin toggling a switch sees the effect while they
 * are still looking at the screen, and long enough that a burst of notifications is one query.
 */
const SETTINGS_TTL_MS = 10_000;
let settingsCache: { at: number; enabled: boolean; muted: Set<string> } | null = null;

export const invalidateNotificationSettingsCache = (): void => {
  settingsCache = null;
};

const loadSettings = async (): Promise<{ enabled: boolean; muted: Set<string> }> => {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache;
  try {
    const doc = await PlatformSettingsModel.findOne({ key: "platform" })
      .select("notifications")
      .lean();
    settingsCache = {
      at: Date.now(),
      // No settings document means nothing has been configured, which must mean "send everything".
      enabled: doc?.notifications?.enabled ?? true,
      muted: new Set(doc?.notifications?.mutedTypes ?? []),
    };
  } catch (err) {
    // Never let a settings read failure swallow a notification — fail open.
    logger.warn("Could not read notification settings; sending anyway", {
      message: (err as Error).message,
    });
    return { enabled: true, muted: new Set<string>() };
  }
  return settingsCache;
};

export class NotificationService {
  // Core method — used internally by other services
  async send(data: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    // An administrator can mute a notification type, or all of them, from the admin panel. Muting
    // means not creating the row at all: a stored-but-hidden notification would still drive unread
    // counts and reappear the moment the switch flipped back.
    const settings = await loadSettings();
    if (!settings.enabled || settings.muted.has(data.type)) return;

    const notification = await notificationRepo.create(data);

    // Emit real-time notification via Socket.io
    emitConversationUpdate(data.userId, {
      type: "notification",
      notification,
    });

    // TODO: Send FCM push notification
    // FCM integration pending — store token is ready via /users/fcm-token
    // Will be implemented when FCM credentials are provided by client
    this.sendFCMPush(data.userId, data.title, data.body, data.data).catch(() => {});
  }

  // Placeholder — implement when FCM server key is available
  private async sendFCMPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    const user = await UserModel.findById(userId).select("fcmToken");
    if (!user || !(user as any).fcmToken) return;
    // TODO: implement FCM push using firebase-admin
    // firebase.messaging().send({ token: user.fcmToken, notification: { title, body }, data })
  }

  async getMyNotifications(userId: string, page = 1, limit = 20) {
    const { notifications, total, unreadCount } =
      await notificationRepo.findByUser(userId, page, limit);
    return {
      notifications,
      unreadCount,
      pagination: buildPagination(total, page, limit),
    };
  }

  async markOneRead(notificationId: string, userId: string) {
    const notification = await notificationRepo.markOneRead(notificationId, userId);
    if (!notification) {
      throw new AppError("Notification not found", HTTP_STATUS.NOT_FOUND);
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<void> {
    await notificationRepo.markAllRead(userId);
  }

  async deleteOne(notificationId: string, userId: string): Promise<void> {
    await notificationRepo.deleteOne(notificationId, userId);
  }

  async saveFCMToken(userId: string, token: string): Promise<void> {
    await UserModel.findByIdAndUpdate(userId, { fcmToken: token });
  }
}

// Export singleton for use across services
export const notificationService = new NotificationService();