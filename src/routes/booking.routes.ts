import { Router } from "express";
import { BookingController } from "../controllers/booking.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { upload } from "../middleware/upload.middleware";
import {
  createBookingSchema,
  declineBookingSchema,
  cancelBookingSchema,
  confirmHandoverSchema,
  ownerCancelSchema,
  confirmReturnSchema,
  disputeReturnTimeSchema,
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
/**
 * Multipart so the owner can attach evidence — a photo of the broken item, the damage, the
 * accident. `upload.array` must come before `validate`, because the text fields do not exist on
 * req.body until multer has parsed the form.
 */
router.put(
  "/:id/owner-cancel",
  upload.array("evidence", 5),
  validate(ownerCancelSchema),
  ctrl.ownerCancelBooking.bind(ctrl)
);
router.put("/:id/handover", validate(confirmHandoverSchema), ctrl.confirmHandover.bind(ctrl));
router.put("/:id/return", validate(confirmReturnSchema), ctrl.confirmReturn.bind(ctrl));
router.put(
  "/:id/return/dispute",
  validate(disputeReturnTimeSchema),
  ctrl.disputeReturnTime.bind(ctrl)
);
router.post("/:id/pre-photos", upload.array("photos", 5), ctrl.uploadPrePhotos.bind(ctrl));
router.post("/:id/post-photos", upload.array("photos", 5), ctrl.uploadPostPhotos.bind(ctrl));

export default router;