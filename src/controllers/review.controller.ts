import { Request, Response, NextFunction } from "express";
import { ReviewService } from "../services/review.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const reviewService = new ReviewService();

export class ReviewController {
  async submitReview(req: Request, res: Response, next: NextFunction) {
    try {
      const review = await reviewService.submitReview(req.user!.userId, req.body);
      sendCreated(res, "Review submitted successfully", review);
    } catch (err) { next(err); }
  }

  async getUserReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query;
      const result = await reviewService.getUserReviews(
        String(req.params.userId),
        Number(page) || 1,
        Number(limit) || 10
      );
      sendSuccess(res, "Reviews retrieved", result.reviews, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getItemReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query;
      const result = await reviewService.getItemReviews(
        String(req.params.itemId),
        Number(page) || 1,
        Number(limit) || 10
      );
      sendSuccess(res, "Reviews retrieved", result.reviews, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getMyReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query;
      const result = await reviewService.getMyReviews(
        req.user!.userId,
        Number(page) || 1,
        Number(limit) || 10
      );
      sendSuccess(res, "Reviews retrieved", result.reviews, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getPendingReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const pending = await reviewService.getPendingReviews(req.user!.userId);
      sendSuccess(res, "Pending reviews retrieved", pending);
    } catch (err) { next(err); }
  }

  async getAllReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query;
      const result = await reviewService.getAllReviews(
        Number(page) || 1,
        Number(limit) || 10
      );
      sendSuccess(res, "Reviews retrieved", result.reviews, 200, result.pagination);
    } catch (err) { next(err); }
  }
}