import { BookingModel, IBooking } from "../models/booking.model";
import mongoose from "mongoose";

export class BookingRepository {
  async create(data: Partial<IBooking>): Promise<IBooking> {
    return BookingModel.create(data);
  }

  async findById(id: string): Promise<IBooking | null> {
    return BookingModel.findById(id)
      .populate("item", "title photos dailyRate location condition owner")
      .populate("renter", "firstName lastName profilePhoto averageRating")
      .populate("owner", "firstName lastName profilePhoto averageRating");
  }

  async findByRenter(
    renterId: string,
    status?: string,
    page = 1,
    limit = 10
  ): Promise<{ bookings: IBooking[]; total: number }> {
    const filter: Record<string, any> = { renter: renterId };
    if (status) filter.status = status;
    const [bookings, total] = await Promise.all([
      BookingModel.find(filter)
        .populate("item", "title photos dailyRate location")
        .populate("owner", "firstName lastName profilePhoto")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      BookingModel.countDocuments(filter),
    ]);
    return { bookings, total };
  }

  async findByOwner(
    ownerId: string,
    status?: string,
    page = 1,
    limit = 10
  ): Promise<{ bookings: IBooking[]; total: number }> {
    const filter: Record<string, any> = { owner: ownerId };
    if (status) filter.status = status;
    const [bookings, total] = await Promise.all([
      BookingModel.find(filter)
        .populate("item", "title photos dailyRate location")
        .populate("renter", "firstName lastName profilePhoto averageRating")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      BookingModel.countDocuments(filter),
    ]);
    return { bookings, total };
  }

  async updateStatus(
    id: string,
    status: IBooking["status"],
    extra: Partial<IBooking> = {}
  ): Promise<IBooking | null> {
    return BookingModel.findByIdAndUpdate(
      id,
      { status, ...extra },
      { new: true }
    );
  }

  /**
   * Records whether a booking has been paid, without touching `status`.
   *
   * Deliberately separate from updateStatus: payment and lifecycle are independent here, and routing
   * this through updateStatus would mean every caller had to restate the current status, which is
   * exactly how a booking gets silently moved backwards.
   */
  async setPaymentStatus(
    id: string,
    paymentStatus: IBooking["paymentStatus"]
  ): Promise<IBooking | null> {
    return BookingModel.findByIdAndUpdate(id, { paymentStatus }, { new: true });
  }

  async hasConflict(
    itemId: string,
    startDate: Date,
    endDate: Date,
    excludeBookingId?: string
  ): Promise<boolean> {
    const filter: Record<string, any> = {
      item: itemId,
      status: { $in: ["pending", "accepted", "active"] },
      $or: [
        { startDate: { $lte: endDate }, endDate: { $gte: startDate } },
      ],
    };
    if (excludeBookingId) {
      filter._id = { $ne: new mongoose.Types.ObjectId(excludeBookingId) };
    }
    const count = await BookingModel.countDocuments(filter);
    return count > 0;
  }

  async addPhotos(
    id: string,
    type: "preRentalPhotos" | "postRentalPhotos",
    urls: string[]
  ): Promise<IBooking | null> {
    return BookingModel.findByIdAndUpdate(
      id,
      { $push: { [type]: { $each: urls } } },
      { new: true }
    );
  }
}