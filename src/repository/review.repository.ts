import { ReviewModel, IReview } from "../models/review.model";

export class ReviewRepository {
  async create(data: Partial<IReview>): Promise<IReview> {
    return ReviewModel.create(data);
  }

  async existsByBookingAndType(
    bookingId: string,
    type: IReview["type"]
  ): Promise<boolean> {
    const count = await ReviewModel.countDocuments({ booking: bookingId, type });
    return count > 0;
  }

  async findByReviewee(
    revieweeId: string,
    page = 1,
    limit = 10
  ): Promise<{ reviews: IReview[]; total: number }> {
    const [reviews, total] = await Promise.all([
      ReviewModel.find({ reviewee: revieweeId })
        .populate("reviewer", "firstName lastName profilePhoto")
        .populate("item", "title photos")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ReviewModel.countDocuments({ reviewee: revieweeId }),
    ]);
    return { reviews, total };
  }

  async findByItem(
    itemId: string,
    page = 1,
    limit = 10
  ): Promise<{ reviews: IReview[]; total: number }> {
    const [reviews, total] = await Promise.all([
      ReviewModel.find({ item: itemId, type: "renter_to_item" })
        .populate("reviewer", "firstName lastName profilePhoto")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ReviewModel.countDocuments({ item: itemId, type: "renter_to_item" }),
    ]);
    return { reviews, total };
  }

  async findByReviewer(
    reviewerId: string,
    page = 1,
    limit = 10
  ): Promise<{ reviews: IReview[]; total: number }> {
    const [reviews, total] = await Promise.all([
      ReviewModel.find({ reviewer: reviewerId })
        .populate("reviewee", "firstName lastName profilePhoto")
        .populate("item", "title photos")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ReviewModel.countDocuments({ reviewer: reviewerId }),
    ]);
    return { reviews, total };
  }

  async getAverageRating(
    revieweeId: string
  ): Promise<{ average: number; total: number }> {
    const result = await ReviewModel.aggregate([
      { $match: { reviewee: revieweeId } },
      {
        $group: {
          _id: null,
          average: { $avg: "$rating" },
          total: { $sum: 1 },
        },
      },
    ]);
    if (!result.length) return { average: 0, total: 0 };
    return {
      average: parseFloat(result[0].average.toFixed(1)),
      total: result[0].total,
    };
  }

  async getItemAverageRating(
    itemId: string
  ): Promise<{ average: number; total: number }> {
    const result = await ReviewModel.aggregate([
      { $match: { item: itemId, type: "renter_to_item" } },
      {
        $group: {
          _id: null,
          average: { $avg: "$rating" },
          total: { $sum: 1 },
        },
      },
    ]);
    if (!result.length) return { average: 0, total: 0 };
    return {
      average: parseFloat(result[0].average.toFixed(1)),
      total: result[0].total,
    };
  }

  async findAll(
    page = 1,
    limit = 10
  ): Promise<{ reviews: IReview[]; total: number }> {
    const [reviews, total] = await Promise.all([
      ReviewModel.find()
        .populate("reviewer", "firstName lastName profilePhoto")
        .populate("reviewee", "firstName lastName profilePhoto")
        .populate("item", "title photos")
        .populate("booking", "startDate endDate")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ReviewModel.countDocuments(),
    ]);
    return { reviews, total };
  }
}