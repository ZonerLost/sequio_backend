import { Router } from "express";
import { ReviewController } from "../controllers/review.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createReviewSchema, reviewQuerySchema } from "../validators/review.validator";

const router = Router();
const ctrl = new ReviewController();

router.get("/user/:userId", validate(reviewQuerySchema, "query"), ctrl.getUserReviews.bind(ctrl));
router.get("/item/:itemId", validate(reviewQuerySchema, "query"), ctrl.getItemReviews.bind(ctrl));

router.use(authenticate);

router.get("/admin/all", validate(reviewQuerySchema, "query"), ctrl.getAllReviews.bind(ctrl)); 
router.post("/", validate(createReviewSchema), ctrl.submitReview.bind(ctrl));
router.get("/my", validate(reviewQuerySchema, "query"), ctrl.getMyReviews.bind(ctrl));
router.get("/pending", ctrl.getPendingReviews.bind(ctrl));

export default router;