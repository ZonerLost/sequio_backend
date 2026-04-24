import { ReviewRepository } from "../repository/review.repository";
import { BookingRepository } from "../repository/booking.repository";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { IReview } from "../models/review.model";
import { UserModel } from "../models/user.model";
import { ItemModel } from "../models/item.model";
import { BookingModel } from "../models/booking.model";
import { buildPagination } from "../helpers/pagination.helper";
import mongoose from "mongoose";

const reviewRepo = new ReviewRepository();
const bookingRepo = new BookingRepository();

export class ReviewService {
  async submitReview(
    reviewerId: string,
    data: {
      bookingId: string;
      type: IReview["type"];
      rating: number;
      comment: string;
    }
  ) {
    const booking = await bookingRepo.findById(data.bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (booking.status !== "completed") {
      throw new AppError(
        "Reviews can only be submitted for completed bookings",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const renterId = booking.renter._id.toString();
    const ownerId = booking.owner._id.toString();

    if (
      (data.type === "renter_to_owner" || data.type === "renter_to_item") &&
      reviewerId !== renterId
    ) {
      throw new AppError(
        "Only the renter can submit this review type",
        HTTP_STATUS.FORBIDDEN
      );
    }
    if (data.type === "owner_to_renter" && reviewerId !== ownerId) {
      throw new AppError(
        "Only the owner can submit this review type",
        HTTP_STATUS.FORBIDDEN
      );
    }

    const exists = await reviewRepo.existsByBookingAndType(
      data.bookingId,
      data.type
    );
    if (exists) {
      throw new AppError(
        "You have already submitted this review",
        HTTP_STATUS.CONFLICT
      );
    }

    let revieweeId: string | undefined;
    if (data.type === "renter_to_owner") revieweeId = ownerId;
    if (data.type === "owner_to_renter") revieweeId = renterId;

    const review = await reviewRepo.create({
      booking: new mongoose.Types.ObjectId(data.bookingId),
      reviewer: new mongoose.Types.ObjectId(reviewerId),
      reviewee: revieweeId
        ? new mongoose.Types.ObjectId(revieweeId)
        : undefined,
      item: booking.item._id,
      type: data.type,
      rating: data.rating,
      comment: data.comment,
    });

    // Update averages
    if (revieweeId) {
      const { average, total } = await reviewRepo.getAverageRating(revieweeId);
      await UserModel.findByIdAndUpdate(revieweeId, {
        averageRating: average,
        totalReviews: total,
      });
    }
    if (data.type === "renter_to_item") {
      const itemId = booking.item._id.toString();
      const { average, total } = await reviewRepo.getItemAverageRating(itemId);
      await ItemModel.findByIdAndUpdate(itemId, {
        averageRating: average,
        totalReviews: total,
      });
    }

    return review;
  }

  async getUserReviews(userId: string, page = 1, limit = 10) {
    const { reviews, total } = await reviewRepo.findByReviewee(
      userId,
      page,
      limit
    );
    return { reviews, pagination: buildPagination(total, page, limit) };
  }

  async getItemReviews(itemId: string, page = 1, limit = 10) {
    const { reviews, total } = await reviewRepo.findByItem(
      itemId,
      page,
      limit
    );
    return { reviews, pagination: buildPagination(total, page, limit) };
  }

  async getMyReviews(reviewerId: string, page = 1, limit = 10) {
    const { reviews, total } = await reviewRepo.findByReviewer(
      reviewerId,
      page,
      limit
    );
    return { reviews, pagination: buildPagination(total, page, limit) };
  }

  async getPendingReviews(userId: string) {
    const bookings = await BookingModel.find({
      $or: [{ renter: userId }, { owner: userId }],
      status: "completed",
    })
      .populate("item", "title photos")
      .sort({ completedAt: -1 })
      .limit(50);

    const pending = await Promise.all(
      bookings.map(async (booking) => {
        const isRenter = booking.renter.toString() === userId;
        const isOwner = booking.owner.toString() === userId;
        const pendingTypes: string[] = [];

        if (isRenter) {
          const [hasRTO, hasRTI] = await Promise.all([
            reviewRepo.existsByBookingAndType(
              booking._id.toString(),
              "renter_to_owner"
            ),
            reviewRepo.existsByBookingAndType(
              booking._id.toString(),
              "renter_to_item"
            ),
          ]);
          if (!hasRTO) pendingTypes.push("renter_to_owner");
          if (!hasRTI) pendingTypes.push("renter_to_item");
        }

        if (isOwner) {
          const hasOTR = await reviewRepo.existsByBookingAndType(
            booking._id.toString(),
            "owner_to_renter"
          );
          if (!hasOTR) pendingTypes.push("owner_to_renter");
        }

        if (!pendingTypes.length) return null;
        return { booking, pendingTypes };
      })
    );

    return pending.filter(Boolean);
  }

  async getAllReviews(page = 1, limit = 10) {
    const { reviews, total } = await reviewRepo.findAll(page, limit);
    return { reviews, pagination: buildPagination(total, page, limit) };
  }
}