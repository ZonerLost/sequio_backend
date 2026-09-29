import { Router } from "express";
import { BookingController } from "../controllers/booking.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { upload } from "../middleware/upload.middleware";
import {
  createBookingSchema,
  declineBookingSchema,
  cancelBookingSchema,
  bookingQuerySchema,
  quoteSchema,
} from "../validators/booking.validator";

const router = Router();
const ctrl = new BookingController();

router.post("/quote", validate(quoteSchema), ctrl.getQuote.bind(ctrl));
router.use(authenticate);

router.post("/", validate(createBookingSchema), ctrl.createBooking.bind(ctrl));
router.get("/sent", validate(bookingQuerySchema, "query"), ctrl.getSentBookings.bind(ctrl));
router.get("/received", validate(bookingQuerySchema, "query"), ctrl.getReceivedBookings.bind(ctrl));
router.get("/:id", ctrl.getBookingById.bind(ctrl));
router.put("/:id/accept", ctrl.acceptBooking.bind(ctrl));
router.put("/:id/decline", validate(declineBookingSchema), ctrl.declineBooking.bind(ctrl));
router.put("/:id/cancel", validate(cancelBookingSchema), ctrl.cancelBooking.bind(ctrl));
router.put("/:id/complete", ctrl.completeBooking.bind(ctrl));
router.post("/:id/pre-photos", upload.array("photos", 5), ctrl.uploadPrePhotos.bind(ctrl));
router.post("/:id/post-photos", upload.array("photos", 5), ctrl.uploadPostPhotos.bind(ctrl));

export default router;