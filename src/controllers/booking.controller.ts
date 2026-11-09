import { Request, Response, NextFunction } from "express";
import { BookingService } from "../services/booking.service";
import { OwnerCancellationService } from "../services/owner-cancellation.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const bookingService = new BookingService();
const ownerCancellationService = new OwnerCancellationService();

export class BookingController {
  async createBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.createBooking(req.user!.userId, req.body);
      sendCreated(res, "Booking request sent successfully", booking);
    } catch (err) { next(err); }
  }

  async getQuote(req: Request, res: Response, next: NextFunction) {
    try {
      const { dailyRate, startDate, endDate, deliveryType, discountCode } = req.body;
      const quote = bookingService.calculateQuote(
        Number(dailyRate),
        new Date(startDate),
        new Date(endDate),
        deliveryType,
        discountCode
      );
      sendSuccess(res, "Quote calculated", quote);
    } catch (err) { next(err); }
  }

  async getSentBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, page, limit } = req.query;
      const result = await bookingService.getSentBookings(
        req.user!.userId,
        status as string,
        Number(page) || 1,
        Number(limit) || 10
      );
      sendSuccess(res, "Bookings retrieved", result.bookings, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getReceivedBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, page, limit } = req.query;
      const result = await bookingService.getReceivedBookings(
        req.user!.userId,
        status as string,
        Number(page) || 1,
        Number(limit) || 10
      );
      sendSuccess(res, "Bookings retrieved", result.bookings, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getBookingById(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.getBookingById(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Booking retrieved", booking);
    } catch (err) { next(err); }
  }

  async acceptBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.acceptBooking(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Booking accepted", booking);
    } catch (err) { next(err); }
  }

  async declineBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.declineBooking(
        String(req.params.id),
        req.user!.userId,
        req.body.reason
      );
      sendSuccess(res, "Booking declined", booking);
    } catch (err) { next(err); }
  }

  async cancelBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.cancelBooking(
        String(req.params.id),
        req.user!.userId,
        req.body.reason
      );
      sendSuccess(res, "Booking cancelled", booking);
    } catch (err) { next(err); }
  }

  async completeBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.completeBooking(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Booking marked as completed", booking);
    } catch (err) { next(err); }
  }

  async confirmHandover(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.confirmHandover(
        String(req.params.id),
        req.user!.userId,
        req.body.at ? new Date(req.body.at) : undefined,
        req.body.note
      );
      sendSuccess(res, "Handover confirmed", booking);
    } catch (err) { next(err); }
  }

  async confirmReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.confirmReturn(
        String(req.params.id),
        req.user!.userId,
        req.body.at ? new Date(req.body.at) : undefined,
        req.body.note
      );
      sendSuccess(res, "Return confirmed", booking);
    } catch (err) { next(err); }
  }

  async disputeReturnTime(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await bookingService.disputeReturnTime(
        String(req.params.id),
        req.user!.userId,
        new Date(req.body.claimedAt),
        String(req.body.reason)
      );
      sendSuccess(res, "Return time contested", booking);
    } catch (err) { next(err); }
  }

  async ownerCancelBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ownerCancellationService.cancel(
        String(req.params.id),
        req.user!.userId,
        {
          reason: req.body.reason,
          explanation: String(req.body.explanation),
          evidenceFiles: req.files as Express.Multer.File[] | undefined,
        }
      );
      sendSuccess(res, "Booking cancelled", result);
    } catch (err) { next(err); }
  }

  async uploadPrePhotos(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ success: false, message: "No files uploaded" });
        return;
      }
      const booking = await bookingService.uploadRentalPhotos(
        String(req.params.id),
        req.user!.userId,
        "pre",
        req.files
      );
      sendSuccess(res, "Pre-rental photos uploaded", booking);
    } catch (err) { next(err); }
  }

  async uploadPostPhotos(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ success: false, message: "No files uploaded" });
        return;
      }
      const booking = await bookingService.uploadRentalPhotos(
        String(req.params.id),
        req.user!.userId,
        "post",
        req.files
      );
      sendSuccess(res, "Post-rental photos uploaded", booking);
    } catch (err) { next(err); }
  }
}