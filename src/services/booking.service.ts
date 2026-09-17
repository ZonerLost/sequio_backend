import { BookingRepository } from "../repository/booking.repository";
import { ItemRepository } from "../repository/item.repository";
import { UserModel } from "../models/user.model";
import { uploadToS3 } from "../helpers/s3.helper";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { IBooking } from "../models/booking.model";
import { buildPagination } from "../helpers/pagination.helper";
import { EcoService } from "./eco.service";
import {
  notifyBookingRequest,
  notifyBookingAccepted,
  notifyBookingDeclined,
  notifyBookingCancelled,
  notifyBookingCompleted,
} from "../helpers/notification.triggers";

const ecoService = new EcoService();
const bookingRepo = new BookingRepository();
const itemRepo = new ItemRepository();

const SERVICE_FEE_PERCENT = 0.05;
const SECURITY_DEPOSIT = 100;
const DELIVERY_RATE_PER_KM = 5;
const MIN_DELIVERY_FEE = 10;

// Safely get ID from either a populated object or raw ObjectId
function getId(value: any): string {
  if (!value) return "";
  if (typeof value === "object" && value._id) return value._id.toString();
  return value.toString();
}

function calculateDeliveryFee(distanceKm?: number): number {
  if (!distanceKm) return MIN_DELIVERY_FEE;
  return Math.max(MIN_DELIVERY_FEE, Math.round(distanceKm * DELIVERY_RATE_PER_KM));
}

function calculatePricing(
  dailyRate: number,
  totalDays: number,
  deliveryFee: number,
  discountPercent = 0
) {
  const basePrice = parseFloat((dailyRate * totalDays).toFixed(2));
  const discountAmount = parseFloat((basePrice * (discountPercent / 100)).toFixed(2));
  const subtotal = parseFloat((basePrice - discountAmount + deliveryFee).toFixed(2));
  const serviceFee = parseFloat((subtotal * SERVICE_FEE_PERCENT).toFixed(2));
  const totalAmount = parseFloat((subtotal + serviceFee + SECURITY_DEPOSIT).toFixed(2));
  return {
    dailyRate, basePrice, discountPercent, discountAmount,
    subtotal, serviceFee, securityDeposit: SECURITY_DEPOSIT, totalAmount,
  };
}

function validateDiscountCode(code?: string): number {
  if (!code) return 0;
  const codes: Record<string, number> = { WELCOME10: 10, ZIP5: 5 };
  return codes[code.toUpperCase()] || 0;
}

export class BookingService {
  async createBooking(
    renterId: string,
    data: {
      itemId: string;
      startDate: Date;
      endDate: Date;
      deliveryType: "pickup" | "delivery";
      deliveryAddress?: IBooking["deliveryAddress"];
      pickupTimeFrom?: string;
      pickupTimeTo?: string;
      discountCode?: string;
    }
  ) {
    const item = await itemRepo.findById(data.itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (!item.isActive || !item.availability.isAvailable) {
      throw new AppError("Item is not available for booking", HTTP_STATUS.BAD_REQUEST);
    }

    const itemOwnerId = getId(item.owner);
    if (itemOwnerId === renterId) {
      throw new AppError("You cannot book your own item", HTTP_STATUS.BAD_REQUEST);
    }

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    const hasConflict = await bookingRepo.hasConflict(data.itemId, start, end);
    if (hasConflict) {
      throw new AppError("Item is already booked for the selected dates", HTTP_STATUS.CONFLICT);
    }

    const blockedDates = item.availability.blockedDates || [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const isBlocked = blockedDates.some(
        (d) => new Date(d).toDateString() === currentDate.toDateString()
      );
      if (isBlocked) {
        throw new AppError("Selected dates include unavailable dates", HTTP_STATUS.BAD_REQUEST);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const discountPercent = validateDiscountCode(data.discountCode);
    const deliveryFee = data.deliveryType === "delivery" ? calculateDeliveryFee() : 0;
    const pricing = calculatePricing(item.dailyRate, totalDays, deliveryFee, discountPercent);

    const booking = await bookingRepo.create({
      item: item._id,
      renter: renterId as any,
      owner: item.owner,
      startDate: start,
      endDate: end,
      totalDays,
      deliveryType: data.deliveryType,
      bookingType: item.bookingType === "instant" ? "instant" : "request",
      deliveryAddress: data.deliveryAddress,
      deliveryFee,
      pickupTimeFrom: data.pickupTimeFrom,
      pickupTimeTo: data.pickupTimeTo,
      pricing,
      discountCode: data.discountCode,
      status: "pending",
    });

    const renter = await UserModel.findById(renterId).select("firstName lastName");
    const renterName = renter ? `${renter.firstName} ${renter.lastName}` : "Someone";
    notifyBookingRequest(itemOwnerId, renterName, item.title, booking._id.toString()).catch(() => {});

    return booking;
  }

  async getSentBookings(renterId: string, status?: string, page = 1, limit = 10) {
    const { bookings, total } = await bookingRepo.findByRenter(renterId, status, page, limit);
    return { bookings, pagination: buildPagination(total, page, limit) };
  }

  async getReceivedBookings(ownerId: string, status?: string, page = 1, limit = 10) {
    const { bookings, total } = await bookingRepo.findByOwner(ownerId, status, page, limit);
    return { bookings, pagination: buildPagination(total, page, limit) };
  }

  async getBookingById(bookingId: string, userId: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    const isParty = getId(booking.renter) === userId || getId(booking.owner) === userId;
    if (!isParty) throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    return booking;
  }

  async acceptBooking(bookingId: string, ownerId: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.owner) !== ownerId) {
      throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    }
    if (booking.status !== "pending") {
      throw new AppError("Booking is no longer pending", HTTP_STATUS.BAD_REQUEST);
    }

    const result = await bookingRepo.updateStatus(bookingId, "accepted", { acceptedAt: new Date() });

    // Use getId to safely extract item ID
    const itemId = getId(booking.item);
    const item = await itemRepo.findById(itemId);
    notifyBookingAccepted(getId(booking.renter), item?.title ?? "your item", bookingId).catch(() => {});

    return result;
  }

  async declineBooking(bookingId: string, ownerId: string, reason?: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.owner) !== ownerId) {
      throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    }
    if (booking.status !== "pending") {
      throw new AppError("Booking is no longer pending", HTTP_STATUS.BAD_REQUEST);
    }

    const result = await bookingRepo.updateStatus(bookingId, "declined", { declineReason: reason } as any);

    const itemId = getId(booking.item);
    const item = await itemRepo.findById(itemId);
    notifyBookingDeclined(getId(booking.renter), item?.title ?? "your item", bookingId).catch(() => {});

    return result;
  }

  async cancelBooking(bookingId: string, renterId: string, reason?: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.renter) !== renterId) {
      throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    }
    if (!["pending", "accepted"].includes(booking.status)) {
      throw new AppError("Booking cannot be cancelled at this stage", HTTP_STATUS.BAD_REQUEST);
    }

    const result = await bookingRepo.updateStatus(bookingId, "cancelled", {
      cancelReason: reason,
      cancelledAt: new Date(),
    } as any);

    const itemId = getId(booking.item);
    const item = await itemRepo.findById(itemId);
    const renter = await UserModel.findById(renterId).select("firstName lastName");
    const renterName = renter ? `${renter.firstName} ${renter.lastName}` : "Someone";
    notifyBookingCancelled(getId(booking.owner), renterName, item?.title ?? "your item", bookingId).catch(() => {});

    return result;
  }

  async completeBooking(bookingId: string, ownerId: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.owner) !== ownerId) {
      throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    }
    if (!["active", "accepted"].includes(booking.status)) {
      throw new AppError("Booking is not active", HTTP_STATUS.BAD_REQUEST);
    }

    const updated = await bookingRepo.updateStatus(bookingId, "completed", { completedAt: new Date() } as any);

    const itemId = getId(booking.item);
    const item = await itemRepo.findById(itemId);
    itemRepo.incrementRentals(itemId);
    ecoService.recordEcoImpact(bookingId, itemId).catch((err) => {
      console.error("Eco impact error:", err);
    });
    notifyBookingCompleted(getId(booking.renter), item?.title ?? "your item", bookingId).catch(() => {});

    return updated;
  }

  async uploadRentalPhotos(
    bookingId: string,
    userId: string,
    type: "pre" | "post",
    files: Express.Multer.File[]
  ) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.owner) !== userId) {
      throw new AppError("Only the owner can upload rental photos", HTTP_STATUS.FORBIDDEN);
    }
    if (type === "pre" && booking.status !== "accepted") {
      throw new AppError("Pre-rental photos can only be uploaded after booking is accepted", HTTP_STATUS.BAD_REQUEST);
    }
    if (type === "post" && booking.status !== "completed") {
      throw new AppError("Post-rental photos can only be uploaded after booking is completed", HTTP_STATUS.BAD_REQUEST);
    }

    const urls = await Promise.all(
      files.map((f) => uploadToS3(f.buffer, f.mimetype, `bookings/${bookingId}/${type}-rental`))
    );

    const field = type === "pre" ? "preRentalPhotos" : "postRentalPhotos";
    return bookingRepo.addPhotos(bookingId, field, urls);
  }

  calculateQuote(
    dailyRate: number,
    startDate: Date,
    endDate: Date,
    deliveryType: "pickup" | "delivery",
    discountCode?: string
  ) {
    const totalDays = Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (totalDays < 1) throw new AppError("Invalid date range", HTTP_STATUS.BAD_REQUEST);

    const discountPercent = validateDiscountCode(discountCode);
    const deliveryFee = deliveryType === "delivery" ? calculateDeliveryFee() : 0;
    const pricing = calculatePricing(dailyRate, totalDays, deliveryFee, discountPercent);

    return { totalDays, deliveryFee, pricing };
  }
}