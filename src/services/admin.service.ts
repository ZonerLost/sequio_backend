import { UserModel } from "../models/user.model";
import { getPresignedUrl } from "../helpers/s3.helper";
import { ItemModel } from "../models/item.model";
import { BookingModel } from "../models/booking.model";
import { PaymentModel } from "../models/payment.model";
import { EcoImpactModel } from "../models/eco.model";
import { ReviewModel } from "../models/review.model";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { buildPagination } from "../helpers/pagination.helper";
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

  async updateUserRole(userId: string, role: "user" | "admin") {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    ).select("-password");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
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

  async refundPayment(paymentId: string, reason: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", HTTP_STATUS.NOT_FOUND);
    if (payment.status !== "completed") {
      throw new AppError("Only completed payments can be refunded", HTTP_STATUS.BAD_REQUEST);
    }

    const updated = await PaymentModel.findByIdAndUpdate(
      paymentId,
      {
        status: "refunded",
        refundedAt: new Date(),
        refundReason: reason,
      },
      { new: true }
    );

    // TODO: Process actual refund via Stripe when integrated
    return updated;
  }

  // ── Platform Stats ────────────────────────────────────────

  async getPlatformStats() {
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
    ]);

    const bookingStatusMap = Object.fromEntries(
      bookingsByStatus.map((s: any) => [s._id, s.count])
    );

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        banned: bannedUsers,
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