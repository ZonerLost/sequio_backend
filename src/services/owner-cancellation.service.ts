import mongoose from "mongoose";
import {
  OwnerCancellationModel,
  OwnerCancellationReason,
  SUSPENSION_DAYS,
  STRIKE_WINDOW_DAYS,
} from "../models/owner-cancellation.model";
import { BookingModel } from "../models/booking.model";
import { UserModel } from "../models/user.model";
import { ItemModel } from "../models/item.model";
import { PaymentModel } from "../models/payment.model";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { getId } from "../helpers/id.helper";
import { logger } from "../config/logger";
import { uploadToS3, signUrls } from "../helpers/s3.helper";
import { createRefund, stripeConfigured } from "../helpers/stripe.helper";
import { recordMoneyEvent } from "../helpers/money-event.helper";
import {
  notifyBookingCancelledByOwner,
  notifyOwnerStrike,
} from "../helpers/notification.triggers";

/**
 * Owner-initiated cancellation, and the strike system that keeps it honest.
 *
 * See `owner-cancellation.model.ts` for why every cancellation counts as a strike by default and an
 * administrator excuses it afterwards, rather than the other way round.
 */

const EVIDENCE_URL_TTL_SECONDS = 3600;
const EVIDENCE_PREFIX = "owner-cancellations";

/** Statuses an owner may still cancel from. Once the item is out, cancelling is not the remedy. */
const CANCELLABLE = ["accepted", "ready_for_handover"];

export class OwnerCancellationService {
  /**
   * Cancels a booking at the owner's request.
   *
   * Order matters here. The booking is cancelled and the strike recorded **first**, then the refund
   * is attempted. If the refund fails, the renter still has a cancelled booking and a visible
   * `refundOutstanding`, and support can retry — whereas failing the whole request would leave the
   * booking live, the renter expecting an item nobody is going to deliver, and the owner convinced
   * they had cancelled it.
   */
  async cancel(
    bookingId: string,
    ownerId: string,
    input: {
      reason: OwnerCancellationReason;
      explanation: string;
      evidenceFiles?: Express.Multer.File[];
    }
  ) {
    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.owner) !== ownerId) {
      throw new AppError("Only the owner can cancel this booking", HTTP_STATUS.FORBIDDEN);
    }
    if (!CANCELLABLE.includes(booking.status)) {
      throw new AppError(
        booking.status === "active" || booking.status === "awaiting_return"
          ? "The renter already has this item — cancelling is not the remedy. Raise a dispute instead."
          : `A ${booking.status} booking cannot be cancelled`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Evidence lands under a private prefix, like dispute evidence and booking condition photos.
    // It is never in the bucket policy; reads are signed. See the Private media section of CLAUDE.md.
    let evidence: string[] = [];
    if (input.evidenceFiles?.length) {
      evidence = await Promise.all(
        input.evidenceFiles.map((f) =>
          uploadToS3(f.buffer, f.mimetype, `${EVIDENCE_PREFIX}/${bookingId}`)
        )
      );
    }

    const { strikeNumber, outcome } = await this.applyStrike(ownerId);

    let record;
    try {
      record = await OwnerCancellationModel.create({
        booking: booking._id,
        owner: booking.owner,
        renter: booking.renter,
        reason: input.reason,
        explanation: input.explanation,
        evidence,
        countsAsStrike: true,
        outcome,
        strikeNumber,
      });
    } catch (err) {
      // The unique index on `booking` is what actually stops two simultaneous cancellations; the
      // status check above can be passed by both.
      if ((err as { code?: number }).code === 11000) {
        throw new AppError("This booking has already been cancelled", HTTP_STATUS.CONFLICT);
      }
      throw err;
    }

    await BookingModel.findByIdAndUpdate(bookingId, {
      status: "cancelled",
      cancelReason: `[owner: ${input.reason}] ${input.explanation}`,
      cancelledAt: new Date(),
    });

    const item = await ItemModel.findById(getId(booking.item)).select("title").lean();
    const refund = await this.refundInFull(booking, record._id.toString(), input.reason);

    notifyBookingCancelledByOwner(
      getId(booking.renter),
      item?.title ?? "your booking",
      bookingId,
      input.explanation,
      refund.succeeded
    ).catch(() => {});

    if (outcome !== "none") {
      notifyOwnerStrike(ownerId, outcome, strikeNumber, SUSPENSION_DAYS).catch(() => {});
    }

    return {
      cancellation: record,
      outcome,
      strikeNumber,
      // The panel and the app both need to know a cancellation happened but the money did not move.
      refundOutstanding: refund.attempted && !refund.succeeded,
    };
  }

  /**
   * Refunds the renter in full: the rental, the renter-side fee and the taxes on both.
   *
   * `reverse_transfer` claws the owner's share back out of their connected account and
   * `refund_application_fee` returns Atussa's — which is what "Atussa retains no commission on the
   * cancelled rental" means in Stripe's vocabulary.
   *
   * **This is the operation that argues hardest for paying owners at the end of a rental rather than
   * at charge time.** Today the owner already has the money and may have withdrawn it, so reversing
   * the transfer can push their balance negative and block their account. Once Phase 2 lands, there
   * is nothing to claw back because nothing has left the platform yet.
   *
   * Never throws. The cancellation stands either way; a failed refund is recorded and surfaced.
   */
  private async refundInFull(
    booking: { _id: mongoose.Types.ObjectId; paymentStatus?: string },
    cancellationId: string,
    reason: string
  ): Promise<{ attempted: boolean; succeeded: boolean }> {
    if (booking.paymentStatus !== "paid") {
      return { attempted: false, succeeded: false };
    }

    const payment = await PaymentModel.findOne({
      booking: booking._id,
      status: "completed",
    });
    if (!payment) {
      logger.warn("Booking is marked paid but has no completed payment to refund", {
        bookingId: booking._id.toString(),
      });
      return { attempted: false, succeeded: false };
    }

    let succeeded = false;
    let error: string | undefined;
    let stripeRefundId: string | undefined;

    try {
      if (payment.stripePaymentIntentId && stripeConfigured()) {
        const refund = await createRefund({
          paymentIntentId: payment.stripePaymentIntentId,
          reverseTransfer: true,
          refundApplicationFee: true,
          reason: "requested_by_customer",
          idempotencyKey: `owner-cancel-${payment._id.toString()}`,
        });
        stripeRefundId = refund.id;
      }
      succeeded = true;
    } catch (err) {
      error = (err as Error).message;
      logger.error("Owner cancellation refund failed — renter is owed money", {
        bookingId: booking._id.toString(),
        paymentId: payment._id.toString(),
        message: error,
      });
    }

    if (succeeded) {
      await PaymentModel.findByIdAndUpdate(payment._id, {
        status: "refunded",
        refundedAt: new Date(),
        refundReason: `Owner cancellation: ${reason}`,
        ...(stripeRefundId ? { stripeRefundId } : {}),
      });
      await BookingModel.findByIdAndUpdate(booking._id, { paymentStatus: "refunded" });

      await recordMoneyEvent({
        bookingId: booking._id.toString(),
        paymentId: payment._id.toString(),
        type: "refund",
        amountCents: Math.round(Number(payment.amount ?? 0) * 100),
        balanceEffect: "out",
        actor: { kind: "owner" },
        reason: `Owner cancellation: ${reason}`,
        stripeId: stripeRefundId,
        idempotencyKey: `owner-cancel-refund-${payment._id.toString()}`,
      });
    }

    await OwnerCancellationModel.findByIdAndUpdate(cancellationId, {
      "refund.attempted": true,
      "refund.succeeded": succeeded,
      ...(error ? { "refund.error": error.slice(0, 500) } : {}),
    });

    return { attempted: true, succeeded };
  }

  /**
   * Counts the owner's strikes in the rolling window and applies the consequence.
   *
   * Called **before** the new row is written, so the number it returns is the strike this
   * cancellation is about to become.
   */
  private async applyStrike(
    ownerId: string
  ): Promise<{ strikeNumber: number; outcome: "none" | "warning" | "final_warning" | "suspension" }> {
    const since = new Date(Date.now() - STRIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const previous = await OwnerCancellationModel.countDocuments({
      owner: ownerId,
      countsAsStrike: true,
      createdAt: { $gte: since },
    });

    const strikeNumber = previous + 1;
    const outcome =
      strikeNumber === 1 ? "warning" : strikeNumber === 2 ? "final_warning" : "suspension";

    if (outcome === "suspension") {
      await UserModel.findByIdAndUpdate(ownerId, {
        ownerSuspendedUntil: new Date(Date.now() + SUSPENSION_DAYS * 24 * 60 * 60 * 1000),
        ownerSuspendedAt: new Date(),
      });
    }

    return { strikeNumber, outcome };
  }

  /**
   * Whether this owner may receive new bookings right now.
   *
   * Read at booking time rather than stored as a flag, so a suspension lapses on its own without a
   * scheduled job to un-set it. A stale `ownerSuspendedUntil` in the past is simply not a suspension.
   */
  async isSuspended(ownerId: string): Promise<Date | null> {
    const user = await UserModel.findById(ownerId).select("ownerSuspendedUntil").lean();
    const until = (user as { ownerSuspendedUntil?: Date } | null)?.ownerSuspendedUntil;
    return until && new Date(until) > new Date() ? new Date(until) : null;
  }

  // ── administration ────────────────────────────────────────────────────────────────────────────

  /**
   * Excuses a cancellation, or puts the strike back.
   *
   * Excusing does not delete the row — the history of a decision has to survive the decision being
   * changed. It flips `countsAsStrike`, which is what the rolling count reads, and records who
   * decided and why.
   *
   * A suspension is lifted when excusing drops the owner below three live strikes. It is **not**
   * re-imposed automatically when a strike is reinstated: that is a decision for the administrator
   * who is already looking at the case, not a side effect.
   */
  async review(cancellationId: string, adminId: string, excused: boolean, note: string) {
    const record = await OwnerCancellationModel.findById(cancellationId);
    if (!record) throw new AppError("Cancellation not found", HTTP_STATUS.NOT_FOUND);

    record.countsAsStrike = !excused;
    record.review = { by: new mongoose.Types.ObjectId(adminId), at: new Date(), note, excused };
    await record.save();

    const ownerId = getId(record.owner);
    const since = new Date(Date.now() - STRIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const live = await OwnerCancellationModel.countDocuments({
      owner: ownerId,
      countsAsStrike: true,
      createdAt: { $gte: since },
    });

    if (excused && live < 3) {
      await UserModel.findByIdAndUpdate(ownerId, {
        $unset: { ownerSuspendedUntil: "", ownerSuspendedAt: "" },
      });
    }

    return { cancellation: record, liveStrikes: live };
  }

  /** Lifts a suspension without touching the strikes behind it — the appeal outcome. */
  async liftSuspension(ownerId: string) {
    const user = await UserModel.findByIdAndUpdate(
      ownerId,
      { $unset: { ownerSuspendedUntil: "", ownerSuspendedAt: "" } },
      { new: true }
    ).select("firstName lastName ownerSuspendedUntil");
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  /** The admin list, newest first, with evidence signed for reading. */
  async list(filters: { ownerId?: string; page?: number; limit?: number } = {}) {
    const { ownerId, page = 1, limit = 20 } = filters;
    const filter: Record<string, unknown> = {};
    if (ownerId) filter.owner = ownerId;

    const [rows, total] = await Promise.all([
      OwnerCancellationModel.find(filter)
        .populate("owner", "firstName lastName email")
        .populate("renter", "firstName lastName email")
        .populate("booking", "startDate endDate pricing status")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      OwnerCancellationModel.countDocuments(filter),
    ]);

    const signed = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        evidence: await signUrls(r.evidence as string[], EVIDENCE_URL_TTL_SECONDS),
        evidenceUrlsExpireAt: r.evidence?.length
          ? new Date(Date.now() + EVIDENCE_URL_TTL_SECONDS * 1000)
          : undefined,
      }))
    );

    return { cancellations: signed, total, page, limit };
  }
}
