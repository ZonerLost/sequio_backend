import { UserModel } from "../models/user.model";
import { getPresignedUrl } from "../helpers/s3.helper";
import { ItemModel } from "../models/item.model";
import { BookingModel } from "../models/booking.model";
import { PaymentModel } from "../models/payment.model";
import { EcoImpactModel } from "../models/eco.model";
import { ReviewModel } from "../models/review.model";
import { getId } from "../helpers/id.helper";
import { notifyBookingCancelledByAdmin } from "../helpers/notification.triggers";
import { PlatformSettingsModel } from "../models/platform-settings.model";
import {
  NotificationModel,
  NOTIFICATION_TYPES,
  NotificationType,
} from "../models/notification.model";
import { invalidateNotificationSettingsCache } from "./notification.service";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { buildPagination } from "../helpers/pagination.helper";
import { createRefund, stripeConfigured } from "../helpers/stripe.helper";
import mongoose from "mongoose";

export class AdminService {
  // ── User Management ──────────────────────────────────────

  async getUsers(filters: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isBanned?: boolean;
  }) {
    const { page = 1, limit = 10, search, role, isBanned } = filters;
    const filter: Record<string, any> = {};
    if (role) filter.role = role;
    if (isBanned !== undefined) filter.isBanned = isBanned;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      UserModel.countDocuments(filter),
    ]);

    return { users, pagination: buildPagination(total, page, limit) };
  }

  async getUserById(userId: string) {
    const user = await UserModel.findById(userId).select("-password");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  /**
   * Grants or revokes admin access.
   *
   * `actorId` is required so the two lockout cases can be refused. Both of them end the same way —
   * nobody can reach the admin panel and the only fix is editing the database by hand:
   *
   *   1. An admin demoting themselves. Easy to do by accident in a list of users.
   *   2. Demoting the last remaining admin, whoever does it.
   *
   * Promotion is never blocked, and demoting someone else while another admin remains is fine.
   */
  async updateUserRole(userId: string, role: "user" | "admin", actorId: string) {
    if (role === "user") {
      if (actorId === userId) {
        throw new AppError(
          "You cannot remove your own admin access. Ask another admin to do it.",
          HTTP_STATUS.BAD_REQUEST
        );
      }
      const target = await UserModel.findById(userId).select("role").lean();
      if (!target) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
      if (target.role === "admin") {
        const admins = await UserModel.countDocuments({ role: "admin" });
        if (admins <= 1) {
          throw new AppError(
            "This is the last admin account. Promote someone else first.",
            HTTP_STATUS.BAD_REQUEST
          );
        }
      }
    }

    const user = await UserModel.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    ).select("-password");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  /**
   * Cancels a booking as an administrator, for abuse, fraud or a dispute.
   *
   * Deliberately narrow. There is no admin approve or reject, because whether to rent out an item is
   * the owner's decision and an administrator standing in for them would be acting on someone else's
   * behalf without their knowledge. Cancelling is different: it only ever stops something.
   *
   * A reason is required, and both parties are notified with it — an unexplained cancellation from a
   * party you never dealt with is worse than none.
   *
   * Money is NOT touched here. A paid booking keeps its `paymentStatus: "paid"` and the refund stays
   * a separate, deliberate act through `refundPayment`, because the refund policy is a business
   * decision and quietly moving money as a side effect of a status change would be wrong either way.
   * The response says whether a refund is outstanding so the panel can prompt for one.
   */
  async cancelBooking(bookingId: string, reason: string, actorId: string) {
    const trimmed = String(reason || "").trim();
    if (trimmed.length < 3) {
      throw new AppError("A cancellation reason is required", HTTP_STATUS.BAD_REQUEST);
    }

    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (!["pending", "accepted", "active"].includes(booking.status)) {
      throw new AppError(
        `A ${booking.status} booking cannot be cancelled`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const updated = await BookingModel.findByIdAndUpdate(
      bookingId,
      {
        status: "cancelled",
        cancelReason: `[admin] ${trimmed}`,
        cancelledAt: new Date(),
        cancelledByAdmin: actorId,
      },
      { new: true }
    );

    const item = await ItemModel.findById(getId(booking.item)).select("title").lean();
    notifyBookingCancelledByAdmin(
      [getId(booking.renter), getId(booking.owner)],
      item?.title ?? "your item",
      bookingId,
      trimmed
    ).catch(() => {});

    return {
      booking: updated,
      // The panel uses this to decide whether to offer a refund next.
      refundOutstanding: booking.paymentStatus === "paid",
    };
  }

  /**
   * Daily booking counts for the admin charts.
   *
   * One call returns every series the page needs. The alternative the panel had was nine components
   * each fetching separately — and what they fetched was a locally generated row of zeros, so the
   * charts showed a flat line and a "Total 0" caption no matter what the database held.
   *
   * Buckets are by `createdAt` in UTC. Days with no bookings are filled in with zeros rather than
   * omitted, because a chart that silently skips empty days misreads as continuous activity.
   */
  async getBookingSeries(range: { start?: Date; end?: Date } = {}) {
    const end = range.end ? new Date(range.end) : new Date();
    const start = range.start
      ? new Date(range.start)
      : new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
    if (end < start) {
      throw new AppError("end must be on or after start", HTTP_STATUS.BAD_REQUEST);
    }

    const DAY_MS = 24 * 60 * 60 * 1000;
    const days = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
    if (days > 370) {
      throw new AppError("Range is too long; request a year or less", HTTP_STATUS.BAD_REQUEST);
    }

    const rows = await BookingModel.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $lookup: {
          from: "items",
          localField: "item",
          foreignField: "_id",
          as: "itemDoc",
          pipeline: [{ $project: { isBoosted: 1, isFeatured: 1 } }],
        },
      },
      {
        $addFields: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
          onBoosted: {
            $let: {
              vars: { it: { $arrayElemAt: ["$itemDoc", 0] } },
              in: {
                $or: [
                  { $eq: ["$$it.isBoosted", true] },
                  { $eq: ["$$it.isFeatured", true] },
                ],
              },
            },
          },
          // Only meaningful where the owner actually responded.
          responseMs: {
            $cond: [
              { $and: ["$acceptedAt", "$createdAt"] },
              { $subtract: ["$acceptedAt", "$createdAt"] },
              null,
            ],
          },
        },
      },
      {
        $group: {
          _id: "$day",
          total: { $sum: 1 },
          requests: { $sum: { $cond: [{ $eq: ["$bookingType", "request"] }, 1, 0] } },
          instant: { $sum: { $cond: [{ $eq: ["$bookingType", "instant"] }, 1, 0] } },
          accepted: {
            $sum: {
              $cond: [{ $in: ["$status", ["accepted", "active", "completed"]] }, 1, 0],
            },
          },
          notAccepted: {
            $sum: { $cond: [{ $in: ["$status", ["declined", "cancelled"]] }, 1, 0] },
          },
          boosted: { $sum: { $cond: ["$onBoosted", 1, 0] } },
          nonBoosted: { $sum: { $cond: ["$onBoosted", 0, 1] } },
          responseMsTotal: { $sum: { $ifNull: ["$responseMs", 0] } },
          responded: { $sum: { $cond: [{ $ne: ["$responseMs", null] }, 1, 0] } },
        },
      },
    ]);

    const byDay = new Map(rows.map((r) => [r._id, r]));

    // How many listings exist in each bucket. Used to turn boosted/non-boosted booking counts into
    // "bookings per listing", which is what those charts claim to show. This is the count as it
    // stands now, not as it stood on each historical day — the item model keeps no boost history, so
    // a day-accurate figure is not available. Stated here rather than silently implied.
    const [boostedListings, totalListings] = await Promise.all([
      ItemModel.countDocuments({ $or: [{ isBoosted: true }, { isFeatured: true }] }),
      ItemModel.countDocuments({}),
    ]);
    const nonBoostedListings = Math.max(0, totalListings - boostedListings);

    const series = Array.from({ length: days }, (_, i) => {
      const d = new Date(start.getTime() + i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      const r = byDay.get(key);
      const boosted = r?.boosted ?? 0;
      const nonBoosted = r?.nonBoosted ?? 0;
      const round2 = (n: number) => Math.round(n * 100) / 100;
      return {
        date: key,
        total: r?.total ?? 0,
        requests: r?.requests ?? 0,
        instant: r?.instant ?? 0,
        accepted: r?.accepted ?? 0,
        notAccepted: r?.notAccepted ?? 0,
        boosted,
        nonBoosted,
        avgResponseMs: r?.responded ? Math.round(r.responseMsTotal / r.responded) : 0,
        avgPerBoostedListing: boostedListings ? round2(boosted / boostedListings) : 0,
        avgPerNonBoostedListing: nonBoostedListings ? round2(nonBoosted / nonBoostedListings) : 0,
      };
    });

    return {
      series,
      listings: { boosted: boostedListings, nonBoosted: nonBoostedListings, total: totalListings },
      range: { start: start.toISOString(), end: end.toISOString() },
    };
  }

  // ── Notifications ───────────────────────────────────────

  /**
   * The notification switches an administrator can change.
   *
   * `availableTypes` is derived from the code, not stored, so a type added in a release shows up
   * here without a migration — and a type that no longer exists stops being offered.
   */
  async getNotificationSettings() {
    const doc = await PlatformSettingsModel.findOne({ key: "platform" })
      .select("notifications updatedAt")
      .lean();

    // Counts per type over the last 30 days, so an admin muting something can see how noisy it is.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const counts = await NotificationModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$type", count: { $sum: 1 } } },
    ]);
    const countByType = new Map(counts.map((c) => [c._id, c.count]));

    return {
      enabled: doc?.notifications?.enabled ?? true,
      mutedTypes: doc?.notifications?.mutedTypes ?? [],
      updatedAt: doc?.updatedAt ?? null,
      availableTypes: NOTIFICATION_TYPES.map((type) => ({
        type,
        last30Days: countByType.get(type) ?? 0,
      })),
    };
  }

  async saveNotificationSettings(
    input: { enabled?: boolean; mutedTypes?: string[] },
    actorId: string
  ) {
    const unknown = (input.mutedTypes ?? []).filter(
      (t) => !NOTIFICATION_TYPES.includes(t as NotificationType)
    );
    if (unknown.length) {
      throw new AppError(
        `Unknown notification type(s): ${unknown.join(", ")}`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const update: Record<string, unknown> = { updatedBy: actorId };
    if (input.enabled !== undefined) update["notifications.enabled"] = input.enabled;
    if (input.mutedTypes !== undefined) {
      update["notifications.mutedTypes"] = [...new Set(input.mutedTypes)];
    }

    await PlatformSettingsModel.findOneAndUpdate({ key: "platform" }, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    // The sender caches settings, so tell it to re-read rather than waiting out the TTL.
    invalidateNotificationSettingsCache();
    return this.getNotificationSettings();
  }

  /**
   * Every notification on the platform, newest first.
   *
   * The panel used to call `GET /notifications`, which returns the *signed-in admin's own* feed —
   * so the log showed only their notifications and the "recipient" column fell back to a literal
   * "System Admin" for every row. This is the log that screen claims to be.
   */
  async listNotifications(params: {
    page?: number;
    limit?: number;
    type?: string;
    search?: string;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 10));

    const filter: Record<string, unknown> = {};
    if (params.type && params.type !== "all") filter.type = params.type;

    // Search covers the notification text and the recipient. The recipient lives on another
    // collection, so matching users first is what makes it searchable at all — the panel's
    // client-side filter could only ever search the page it had already loaded.
    const search = String(params.search || "").trim();
    if (search) {
      // Strip regex metacharacters rather than escaping them: a search box has no use for them, and
      // an unescaped one from a user is a denial-of-service waiting to happen.
      const safe = search.replace(/[^\w\s@.-]/g, "");
      if (!safe) return { rows: [], pagination: buildPagination(0, page, limit) };
      const rx = new RegExp(safe, "i");
      const userIds = await UserModel.find({
        $or: [{ email: rx }, { firstName: rx }, { lastName: rx }],
      })
        .select("_id")
        .limit(500)
        .lean();
      filter.$or = [
        { title: rx },
        { body: rx },
        ...(userIds.length ? [{ user: { $in: userIds.map((u) => u._id) } }] : []),
      ];
    }

    const [rows, total] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "firstName lastName email")
        .lean(),
      NotificationModel.countDocuments(filter),
    ]);

    // buildPagination, not a hand-rolled object: every other endpoint returns this exact shape and
    // the admin panel reads totalPages/hasNext off it.
    return { rows, pagination: buildPagination(total, page, limit) };
  }

  async banUser(userId: string) {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { isBanned: true, isActive: false },
      { new: true }
    ).select("-password");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  async unbanUser(userId: string) {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { isBanned: false, isActive: true },
      { new: true }
    ).select("-password");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  async getIdentityDoc(userId: string) {
    const user = await UserModel.findById(userId).select("identityDocument firstName lastName");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    if (!user.identityDocument)
      throw new AppError("No identity document uploaded", HTTP_STATUS.NOT_FOUND);
    const signedUrl = await getPresignedUrl(user.identityDocument, 900);
    return { signedUrl, expiresInSeconds: 900 };
  }

  async verifyIdentity(userId: string, action: "approve" | "reject") {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { isIdentityVerified: action === "approve" },
      { new: true }
    ).select("-password");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  async deleteUser(userId: string) {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { isActive: false },
      { new: true }
    );
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
  }

  // ── Item Management ───────────────────────────────────────

  async getItems(filters: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    isActive?: boolean;
  }) {
    const { page = 1, limit = 10, search, category, isActive } = filters;
    const filter: Record<string, any> = {};
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive;
    if (search) filter.$text = { $search: search };

    const [items, total] = await Promise.all([
      ItemModel.find(filter)
        .populate("owner", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ItemModel.countDocuments(filter),
    ]);

    return { items, pagination: buildPagination(total, page, limit) };
  }

  async featureItem(itemId: string, featuredUntil: Date) {
    const item = await ItemModel.findByIdAndUpdate(
      itemId,
      { isFeatured: true, featuredUntil },
      { new: true }
    );
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    return item;
  }

  async deactivateItem(itemId: string) {
    const item = await ItemModel.findByIdAndUpdate(
      itemId,
      { isActive: false, "availability.isAvailable": false },
      { new: true }
    );
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    return item;
  }

  // ── Booking Management ────────────────────────────────────

  async getBookings(filters: {
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const { page = 1, limit = 10, status } = filters;
    const filter: Record<string, any> = {};
    if (status) filter.status = status;

    const [bookings, total] = await Promise.all([
      BookingModel.find(filter)
        .populate("item", "title photos dailyRate")
        .populate("renter", "firstName lastName email")
        .populate("owner", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      BookingModel.countDocuments(filter),
    ]);

    return { bookings, pagination: buildPagination(total, page, limit) };
  }

  async getBookingById(bookingId: string) {
    const booking = await BookingModel.findById(bookingId)
      .populate("item", "title photos dailyRate location")
      .populate("renter", "firstName lastName email phone")
      .populate("owner", "firstName lastName email phone");
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    return booking;
  }

  // ── Payment Management ────────────────────────────────────

  async getPayments(filters: { page?: number; limit?: number; status?: string }) {
    const { page = 1, limit = 10, status } = filters;
    const filter: Record<string, any> = {};
    if (status) filter.status = status;

    const [payments, total] = await Promise.all([
      PaymentModel.find(filter)
        .populate("booking", "startDate endDate totalDays")
        .populate("payer", "firstName lastName email")
        .populate("payee", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      PaymentModel.countDocuments(filter),
    ]);

    return { payments, pagination: buildPagination(total, page, limit) };
  }

  async refundPayment(identifier: string, reason: string) {
    let payment = await PaymentModel.findById(identifier);
    if (!payment && mongoose.isValidObjectId(identifier)) {
      payment = await PaymentModel.findOne({ booking: identifier, status: "completed" });
    }
    if (!payment) throw new AppError("Payment not found", HTTP_STATUS.NOT_FOUND);
    if (payment.status !== "completed") {
      throw new AppError("Only completed payments can be refunded", HTTP_STATUS.BAD_REQUEST);
    }

    let stripeRefundId: string | undefined;
    if (payment.stripePaymentIntentId && stripeConfigured()) {
      const refund = await createRefund({
        paymentIntentId: payment.stripePaymentIntentId,
        reverseTransfer: true,
        refundApplicationFee: true,
        reason,
        idempotencyKey: `refund-${payment._id.toString()}`,
      });
      stripeRefundId = refund.id;
    }

    const updated = await PaymentModel.findByIdAndUpdate(
      payment._id,
      {
        status: "refunded",
        refundedAt: new Date(),
        refundReason: reason,
        ...(stripeRefundId ? { stripeRefundId } : {}),
      },
      { new: true }
    );

    // The booking carries payment state too, and leaving it on "paid" after the money went back
    // would be worse than not having the field: a client would keep hiding Pay Now on a booking
    // nobody has paid for. "refunded" is not "paid", so payment becomes possible again if the
    // booking is still live.
    await BookingModel.findByIdAndUpdate(getId(payment.booking), { paymentStatus: "refunded" });

    return updated;
  }

  // ── Platform Stats ────────────────────────────────────────

  async getPlatformStats(range: { start?: Date; end?: Date } = {}) {
    // users.new and the booking splits count documents created within the range
    // (all-time when omitted); every other figure stays all-time as before.
    const start = range.start ? new Date(range.start) : undefined;
    const end = range.end ? new Date(range.end) : undefined;
    if (start && end && end < start) {
      throw new AppError("end must be on or after start", HTTP_STATUS.BAD_REQUEST);
    }
    const createdAt: Record<string, Date> = {};
    if (start) createdAt.$gte = start;
    if (end) createdAt.$lte = end;
    const rangeMatch: Record<string, unknown> = Object.keys(createdAt).length ? { createdAt } : {};

    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      totalItems,
      activeItems,
      totalBookings,
      bookingsByStatus,
      totalRevenue,
      totalCO2,
      totalReviews,
      newUsers,
      bookingSplits,
    ] = await Promise.all([
      UserModel.countDocuments(),
      UserModel.countDocuments({ isActive: true, isBanned: false }),
      UserModel.countDocuments({ isBanned: true }),
      ItemModel.countDocuments(),
      ItemModel.countDocuments({ isActive: true }),
      BookingModel.countDocuments(),
      BookingModel.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      PaymentModel.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      EcoImpactModel.aggregate([
        { $group: { _id: null, totalCO2: { $sum: "$co2SavedKg" } } },
      ]),
      ReviewModel.countDocuments(),
      UserModel.countDocuments(rangeMatch),
      BookingModel.aggregate([
        { $match: rangeMatch },
        {
          $facet: {
            byDeliveryType: [{ $group: { _id: "$deliveryType", count: { $sum: 1 } } }],
            // Bookings created before bookingType existed were all handled as requests
            byBookingType: [
              { $group: { _id: { $ifNull: ["$bookingType", "request"] }, count: { $sum: 1 } } },
            ],
          },
        },
      ]),
    ]);

    const bookingStatusMap = Object.fromEntries(
      bookingsByStatus.map((s: any) => [s._id, s.count])
    );
    const countsOf = (rows: { _id: string; count: number }[] = []) =>
      Object.fromEntries(rows.map((r) => [r._id, r.count]));
    const byDeliveryType = countsOf(bookingSplits[0]?.byDeliveryType);
    const byBookingType = countsOf(bookingSplits[0]?.byBookingType);

    return {
      range: { start: start ?? null, end: end ?? null },
      users: {
        total: totalUsers,
        active: activeUsers,
        banned: bannedUsers,
        new: newUsers,
      },
      items: {
        total: totalItems,
        active: activeItems,
      },
      bookings: {
        total: totalBookings,
        pending: bookingStatusMap["pending"] ?? 0,
        accepted: bookingStatusMap["accepted"] ?? 0,
        active: bookingStatusMap["active"] ?? 0,
        completed: bookingStatusMap["completed"] ?? 0,
        cancelled: bookingStatusMap["cancelled"] ?? 0,
        declined: bookingStatusMap["declined"] ?? 0,
        byDeliveryType: {
          delivery: byDeliveryType["delivery"] ?? 0,
          pickup: byDeliveryType["pickup"] ?? 0,
        },
        byBookingType: {
          instant: byBookingType["instant"] ?? 0,
          request: byBookingType["request"] ?? 0,
        },
      },
      revenue: {
        total: parseFloat((totalRevenue[0]?.total ?? 0).toFixed(2)),
        currency: "CAD",
      },
      eco: {
        totalCO2Saved: parseFloat((totalCO2[0]?.totalCO2 ?? 0).toFixed(2)),
      },
      reviews: {
        total: totalReviews,
      },
    };
  }
}