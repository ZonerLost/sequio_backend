import { BookingRepository } from "../repository/booking.repository";
import { ItemRepository } from "../repository/item.repository";
import { UserModel } from "../models/user.model";
import { uploadToS3 } from "../helpers/s3.helper";
import {
  withSignedBookingPhotos,
  withSignedBookingPhotosAll,
} from "../helpers/booking-photos.helper";
import { AppError } from "../middleware/error.middleware";
import { logger } from "../config/logger";
import { OwnerCancellationService } from "./owner-cancellation.service";
import { CancellationService } from "./cancellation.service";
import { RefundRequestService } from "./refund-request.service";
import { HTTP_STATUS } from "../config/constants";
import { IBooking } from "../models/booking.model";
import { buildPagination } from "../helpers/pagination.helper";
import { ATUSSA_FEE_EXPLAINER, calculatePriceBreakdown } from "../helpers/pricing.helper";
import { cancellationConditions } from "../helpers/cancellation.helper";
import { EcoService } from "./eco.service";
import {
  notifyBookingRequest,
  notifyBookingAccepted,
  notifyBookingDeclined,
  notifyBookingCancelled,
  notifyBookingCompleted,
  notifyReturnTimeDisputed,
  notifyCancellationSettlement,
} from "../helpers/notification.triggers";

const ecoService = new EcoService();
const ownerCancellationService = new OwnerCancellationService();
const cancellationService = new CancellationService();
const refundRequestService = new RefundRequestService();
const bookingRepo = new BookingRepository();
const itemRepo = new ItemRepository();

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

// Pricing lives in one place: src/helpers/pricing.helper.ts. Do not reintroduce a local copy.
function calculatePricing(
  dailyRate: number,
  totalDays: number,
  deliveryFee: number,
  discountPercent = 0
) {
  return calculatePriceBreakdown({ dailyRate, totalDays, deliveryFee, discountPercent });
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

    /**
     * A suspended owner cannot receive new bookings — the third-strike consequence. Checked here
     * rather than by hiding their listings, because hiding a listing is a much bigger hammer and
     * the specification says "suspension from receiving new bookings", not "delisting".
     *
     * The message says nothing about why. Telling a renter that this particular owner has been
     * suspended for repeated cancellations is a disclosure about a third party they have no business
     * receiving.
     */
    const suspendedUntil = await ownerCancellationService.isSuspended(itemOwnerId);
    if (suspendedUntil) {
      throw new AppError(
        "This item is not accepting bookings at the moment",
        HTTP_STATUS.BAD_REQUEST
      );
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

    // A new booking cannot have photos yet, so this only normalises the shape — every method that
    // returns a booking returns the same thing, with no endpoint to remember as an exception.
    return withSignedBookingPhotos(booking);
  }

  async getSentBookings(renterId: string, status?: string, page = 1, limit = 10) {
    const { bookings, total } = await bookingRepo.findByRenter(renterId, status, page, limit);
    return {
      bookings: await withSignedBookingPhotosAll(bookings),
      pagination: buildPagination(total, page, limit),
    };
  }

  async getReceivedBookings(ownerId: string, status?: string, page = 1, limit = 10) {
    const { bookings, total } = await bookingRepo.findByOwner(ownerId, status, page, limit);
    return {
      bookings: await withSignedBookingPhotosAll(bookings),
      pagination: buildPagination(total, page, limit),
    };
  }

  async getBookingById(bookingId: string, userId: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    const isParty = getId(booking.renter) === userId || getId(booking.owner) === userId;
    // This check is what makes signing the photos safe — see booking-photos.helper.ts.
    if (!isParty) throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    return withSignedBookingPhotos(booking);
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

    return withSignedBookingPhotos(result);
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

    return withSignedBookingPhotos(result);
  }

  /**
   * The renter cancels, and the refund policy decides what that costs them.
   *
   * **The order is deliberate and matches the owner-cancellation path**: the booking is cancelled
   * first, then the money is settled. A refund Stripe refuses must not leave the booking live, the
   * renter still committed and the item blocked — it leaves a cancelled booking and a visible
   * `refundOutstanding` that support can retry.
   *
   * `ready_for_handover` is cancellable too. It is the state a booking is in during the hours
   * immediately before pickup, which is exactly the window the under-24h tier describes; refusing
   * there would mean a renter who cannot collect the item has no way out, and the policy already
   * answers what it costs them (nothing comes back).
   */
  async cancelBooking(bookingId: string, renterId: string, reason?: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.renter) !== renterId) {
      throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    }
    if (!["pending", "accepted", "ready_for_handover"].includes(booking.status)) {
      throw new AppError("Booking cannot be cancelled at this stage", HTTP_STATUS.BAD_REQUEST);
    }

    const result = await bookingRepo.updateStatus(bookingId, "cancelled", {
      cancelReason: reason,
      cancelledAt: new Date(),
    } as any);

    const settlement = await cancellationService.settle(bookingId, "renter");

    // The 24-48h band leaves the renter with a claim on the other half that only the owner can
    // grant. Opening it here, pre-filled, is what turns "the owner may approve" into something an
    // owner can actually do.
    if (settlement.tier === "partial" && settlement.ownerApprovableCents > 0) {
      await refundRequestService.openCancellationBalance(bookingId, settlement.quote);
    }

    const itemId = getId(booking.item);
    const item = await itemRepo.findById(itemId);
    const renter = await UserModel.findById(renterId).select("firstName lastName");
    const renterName = renter ? `${renter.firstName} ${renter.lastName}` : "Someone";
    notifyBookingCancelled(getId(booking.owner), renterName, item?.title ?? "your item", bookingId).catch(() => {});
    // A second notification, carrying the money. The first says a booking is off; an owner who
    // keeps part of the price, or is being asked to give the rest back, needs to be told which.
    notifyCancellationSettlement(
      getId(booking.owner),
      item?.title ?? "your item",
      bookingId,
      cancellationService.settlementMessage(settlement.quote, settlement)
    ).catch(() => {});

    // Awaited: `withSignedBookingPhotos` is async, and spreading the promise instead of its value
    // would put `then` on the response and drop every booking field.
    const signed = (await withSignedBookingPhotos(result)) as unknown as Record<string, unknown>;

    return {
      ...signed,
      cancellation: {
        tier: settlement.tier,
        refundCents: settlement.refundCents,
        refundOutstanding: settlement.refundOutstanding,
        ownerApprovableCents: settlement.ownerApprovableCents,
        timeZone: settlement.quote.timeZone,
        hoursBeforeStart: settlement.quote.hoursUntilStart,
      },
    };
  }

  /** What cancelling right now would refund, for either party. See `cancellation.service.ts`. */
  async cancellationQuote(bookingId: string, userId: string) {
    return cancellationService.quote(bookingId, userId);
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

    return withSignedBookingPhotos(updated);
  }

  /**
   * Records that the item actually changed hands.
   *
   * **Either party may confirm**, deliberately. Whoever has their phone out at the kerb does it, and
   * requiring the owner would mean a renter who has the drill in their hands cannot start the clock.
   * Who confirmed it is recorded, so a later disagreement has something to point at.
   *
   * `at` may be backdated up to seven days, because the confirmation usually happens after the
   * event — the handover is at the door, the tap is on the bus home — and every deadline downstream
   * runs from the real time, not the tap.
   */
  async confirmHandover(bookingId: string, userId: string, at?: Date, note?: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);

    const isParty = getId(booking.renter) === userId || getId(booking.owner) === userId;
    if (!isParty) throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);

    if (booking.handover?.at) {
      throw new AppError("Handover was already confirmed for this booking", HTTP_STATUS.BAD_REQUEST);
    }
    if (!["accepted", "ready_for_handover"].includes(booking.status)) {
      throw new AppError(
        `A ${booking.status} booking cannot be handed over`,
        HTTP_STATUS.BAD_REQUEST
      );
    }
    // Not a hard refusal: an owner who hands the item over before the money lands has taken a
    // commercial risk, but refusing to record what physically happened would leave the booking
    // permanently stuck and the renter holding the item with no record of it.
    if (booking.paymentStatus !== "paid") {
      logger.warn("Handover confirmed on a booking that is not paid", {
        bookingId,
        paymentStatus: booking.paymentStatus,
      });
    }

    const actualAt = at ?? new Date();
    const updated = await bookingRepo.updateStatus(bookingId, "active", {
      "handover.at": actualAt,
      "handover.confirmedBy": userId,
      "handover.confirmedAt": new Date(),
      ...(note ? { "handover.note": note } : {}),
    } as Record<string, unknown>);

    return withSignedBookingPhotos(updated);
  }

  /**
   * Records that the item actually came back. **This starts the 24-hour inspection clock**, which is
   * why the time matters rather than just the fact.
   *
   * Either party may confirm, for the same reason as handover. An early return is recorded as what
   * it is — the inspection window runs from the real return time even when that is before the agreed
   * end date — and it does **not** by itself refund anything: the specification is explicit that a
   * voluntary early return creates no automatic refund, only the right to ask for one.
   */
  async confirmReturn(bookingId: string, userId: string, at?: Date, note?: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);

    const isParty = getId(booking.renter) === userId || getId(booking.owner) === userId;
    if (!isParty) throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);

    if (booking.returned?.at) {
      throw new AppError("The return was already confirmed", HTTP_STATUS.BAD_REQUEST);
    }
    if (!["active", "awaiting_return"].includes(booking.status)) {
      throw new AppError(
        `A ${booking.status} booking cannot be returned`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const actualAt = at ?? new Date();
    if (booking.handover?.at && actualAt < booking.handover.at) {
      throw new AppError(
        "The return time cannot be before the handover time",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const updated = await bookingRepo.updateStatus(bookingId, "returned_awaiting_inspection", {
      "returned.at": actualAt,
      "returned.confirmedBy": userId,
      "returned.confirmedAt": new Date(),
      ...(note ? { "returned.note": note } : {}),
    } as Record<string, unknown>);

    return withSignedBookingPhotos(updated);
  }

  /**
   * Contests a return time the other party recorded.
   *
   * The specification requires "a resolution process if the parties disagree on return time", and
   * this is it: the disagreement is recorded against the booking for an administrator to settle. It
   * deliberately does **not** move the recorded time — letting one party overwrite the other's
   * account would make the record worth nothing, and the 24-hour claim window hangs off it.
   *
   * Only the party who did *not* confirm it may contest, and only once.
   */
  async disputeReturnTime(bookingId: string, userId: string, claimedAt: Date, reason: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);

    const isParty = getId(booking.renter) === userId || getId(booking.owner) === userId;
    if (!isParty) throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);

    if (!booking.returned?.at) {
      throw new AppError("No return time has been recorded yet", HTTP_STATUS.BAD_REQUEST);
    }
    if (booking.returned.confirmedBy && getId(booking.returned.confirmedBy) === userId) {
      throw new AppError(
        "You recorded this return time yourself",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    if (booking.returned.disputed?.at) {
      throw new AppError("This return time has already been contested", HTTP_STATUS.BAD_REQUEST);
    }
    if (booking.handover?.at && claimedAt < booking.handover.at) {
      throw new AppError(
        "The time you are claiming is before the item was handed over",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const updated = await bookingRepo.updateById(bookingId, {
      "returned.disputed.by": userId,
      "returned.disputed.at": new Date(),
      "returned.disputed.claimedAt": claimedAt,
      "returned.disputed.reason": reason,
    } as Record<string, unknown>);

    const other =
      getId(booking.renter) === userId ? getId(booking.owner) : getId(booking.renter);
    notifyReturnTimeDisputed(other, bookingId, reason).catch(() => {});

    return withSignedBookingPhotos(updated);
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
    const updated = await bookingRepo.addPhotos(bookingId, field, urls);
    // Signed here too: the app renders the strip straight after an upload, and a raw URL there would
    // 403 exactly like it used to.
    return withSignedBookingPhotos(updated);
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

    // The client renders this behind the "?" next to Atussa Fee; serving it keeps one wording.
    return {
      totalDays,
      deliveryFee,
      pricing,
      // Empty under 2026-11: the renter sees no fee line, so there is nothing to explain and the
      // "?" should not be rendered at all.
      atussaFeeExplainer: pricing.model === "2026-11" ? "" : ATUSSA_FEE_EXPLAINER,
      /**
       * The cancellation conditions, served here because the client's requirement is that they are
       * shown **before** the booking is made — and this endpoint is what the Book screen already
       * calls. One wording from the API rather than three copies in three clients.
       */
      cancellationConditions: cancellationConditions(),
    };
  }
}