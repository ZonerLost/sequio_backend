import mongoose from "mongoose";
import { BookingModel, IBooking } from "../models/booking.model";
import { ItemModel } from "../models/item.model";
import { PaymentModel, chargeModelOf } from "../models/payment.model";
import { UserModel } from "../models/user.model";
import {
  IRefundRequest,
  RefundRequestKind,
  RefundRequestModel,
} from "../models/refund-request.model";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { getId } from "../helpers/id.helper";
import { logger } from "../config/logger";
import { createRefund, stripeConfigured } from "../helpers/stripe.helper";
import { recordMoneyEvent } from "../helpers/money-event.helper";
import { OwnerPayoutService } from "./owner-payout.service";
import {
  CancellationQuote,
  RefundSplit,
  isPaidStatus,
  refundableRemainderCents,
  retainedAfterFurtherRefund,
} from "../helpers/cancellation.helper";
import {
  notifyRefundApproved,
  notifyRefundDeclined,
  notifyRefundRequested,
} from "../helpers/notification.triggers";

/**
 * Refunds nobody is entitled to, which somebody has to agree to.
 *
 * Two of the client's answers reduce to this one flow — see `refund-request.model.ts` for why they
 * share a model. The rule underneath both is theirs and is worth restating because it is the part
 * most likely to be "simplified" away later: **an early return creates no automatic refund.** A
 * renter who returns a drill on day 5 of a 10-day rental has the right to ask, and nothing more.
 * Recording the return starts the inspection clock; this is the only thing that moves money.
 */

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const centsOf = (value: unknown): number => Math.round(Number(value ?? 0) * 100);

/** What has already been given back, as a split, so further refunds build on it rather than guess. */
const alreadyRefunded = (booking: Pick<IBooking, "settlement">): RefundSplit => {
  const b = booking.settlement?.refundBreakdown;
  return {
    rentalCents: Number(b?.rental ?? 0),
    deliveryCents: Number(b?.delivery ?? 0),
    feeCents: Number(b?.fee ?? 0),
    taxCents: Number(b?.tax ?? 0),
    totalCents: Number(booking.settlement?.refundedCents ?? 0),
  };
};

export class RefundRequestService {
  /**
   * A renter asking for money back after an early return.
   *
   * Requires the item to actually be back **and** back early. A return on or after the agreed end
   * date is a rental that ran its course, and there is no early-return basis to ask against — the
   * error says so rather than opening a request the owner can only decline.
   */
  async request(
    bookingId: string,
    renterId: string,
    input: { amount: number; reason: string }
  ): Promise<IRefundRequest> {
    const booking = await BookingModel.findById(bookingId).lean();
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.renter) !== renterId) {
      throw new AppError("Only the renter can request a refund", HTTP_STATUS.FORBIDDEN);
    }

    const returnedAt = booking.returned?.at ? new Date(booking.returned.at) : null;
    if (!returnedAt) {
      throw new AppError(
        "Confirm the item has been returned first — an early-return refund is measured from the real return time",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    if (booking.endDate && returnedAt >= new Date(booking.endDate)) {
      throw new AppError(
        "This rental ran to its end date, so there is no early return to refund",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    if (!isPaidStatus(booking.paymentStatus)) {
      throw new AppError("This booking has not been paid for", HTTP_STATUS.BAD_REQUEST);
    }

    const requestedCents = centsOf(input.amount);
    const remainder = refundableRemainderCents(booking.pricing, alreadyRefunded(booking));
    if (requestedCents <= 0) {
      throw new AppError("Ask for an amount above zero", HTTP_STATUS.BAD_REQUEST);
    }
    if (requestedCents > remainder) {
      // Naming the cap rather than silently clamping it: a renter who asked for $80 and gets a
      // request for $60 without being told will read the owner's partial approval as a second cut.
      throw new AppError(
        `The most you can ask for on this booking is ${dollars(remainder)}`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    return this.open({
      booking,
      kind: "early_return",
      requestedCents,
      reason: input.reason,
      notify: true,
    });
  }

  /**
   * Opens the "other 50%" request after a 24–48 hour cancellation.
   *
   * Pre-filled and pre-explained, so the owner's only job is to decide. The renter is not asked to
   * compose a request for an amount the policy already named.
   *
   * **Never throws.** It runs after the cancellation has already happened and the automatic half
   * has already been refunded; failing here must not turn a completed cancellation into an error.
   */
  async openCancellationBalance(
    bookingId: string,
    quote: CancellationQuote
  ): Promise<IRefundRequest | null> {
    if (quote.ownerApprovableCents <= 0) return null;
    try {
      const booking = await BookingModel.findById(bookingId).lean();
      if (!booking) return null;
      return await this.open({
        booking,
        kind: "cancellation_balance",
        requestedCents: quote.ownerApprovableCents,
        reason:
          "The booking was cancelled between 24 and 48 hours before the start. Half the rental was " +
          "refunded automatically; this is the remaining half, which you may approve if you choose to.",
        notify: true,
        context: {
          tier: quote.tier,
          hoursBeforeStart: quote.hoursUntilStart,
          timeZone: quote.timeZone,
          automaticRefundCents: quote.refund.totalCents,
          ownerRetainedCents: quote.retained.ownerCents,
        },
      });
    } catch (err) {
      logger.error(
        `[refund-request] could not open the cancellation balance request for booking ${bookingId}: ${
          (err as Error).message
        }`
      );
      return null;
    }
  }

  private async open(input: {
    booking: IBooking | (Record<string, unknown> & { _id: mongoose.Types.ObjectId });
    kind: RefundRequestKind;
    requestedCents: number;
    reason: string;
    notify: boolean;
    context?: Record<string, unknown>;
  }): Promise<IRefundRequest> {
    const booking = input.booking as IBooking;
    const payment = await PaymentModel.findOne({ booking: booking._id, status: "completed" })
      .select("_id")
      .lean();

    let request: IRefundRequest;
    try {
      request = await RefundRequestModel.create({
        booking: booking._id,
        renter: booking.renter,
        owner: booking.owner,
        ...(payment ? { payment: payment._id } : {}),
        kind: input.kind,
        requestedCents: input.requestedCents,
        reason: input.reason,
        ...(input.context ? { context: input.context } : {}),
      });
    } catch (err) {
      // The unique partial index is what actually stops two requests; the check a caller might make
      // first can be passed by both of two concurrent taps.
      if ((err as { code?: number }).code === 11000) {
        throw new AppError(
          "There is already a refund request waiting on this booking",
          HTTP_STATUS.CONFLICT
        );
      }
      throw err;
    }

    if (input.notify) {
      const [item, renter] = await Promise.all([
        ItemModel.findById(getId(booking.item)).select("title").lean(),
        UserModel.findById(getId(booking.renter)).select("firstName lastName").lean(),
      ]);
      const renterName = renter
        ? `${(renter as { firstName?: string }).firstName ?? ""} ${
            (renter as { lastName?: string }).lastName ?? ""
          }`.trim() || "The renter"
        : "The renter";
      notifyRefundRequested(
        getId(booking.owner),
        renterName,
        (item as { title?: string } | null)?.title ?? "your item",
        String(booking._id),
        String(request._id),
        dollars(input.requestedCents)
      ).catch(() => {});
    }

    return request;
  }

  /**
   * The owner's decision.
   *
   * They may approve the whole amount, approve less, or decline. Approving less is explicitly in the
   * client's answer — *"the owner may approve a specified amount or decline"* — and is the reason
   * `approvedCents` exists separately from `requestedCents`.
   *
   * **A decline is final here.** Their specification gives no escalation path (gap 6 in
   * `CLIENT_DOCS_REVIEW.md`), so none is invented: the request is recorded, the renter is told what
   * the owner said, and administrators can see it and still refund by hand through
   * `PUT /admin/payments/:id/refund` if they decide to. Telling a renter "this will be reviewed"
   * when no review process exists would be worse than telling them no.
   */
  async decide(
    requestId: string,
    userId: string,
    input: { approve: boolean; amount?: number; note?: string }
  ) {
    const request = await RefundRequestModel.findById(requestId);
    if (!request) throw new AppError("Refund request not found", HTTP_STATUS.NOT_FOUND);
    if (getId(request.owner) !== userId) {
      throw new AppError("Only the owner can decide this request", HTTP_STATUS.FORBIDDEN);
    }
    if (request.status !== "pending") {
      throw new AppError(
        `This request has already been ${request.status}`,
        HTTP_STATUS.CONFLICT
      );
    }

    const booking = await BookingModel.findById(request.booking).lean();
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);

    const item = await ItemModel.findById(getId(booking.item)).select("title").lean();
    const itemTitle = (item as { title?: string } | null)?.title ?? "your booking";

    if (!input.approve) {
      /**
       * Claimed atomically. Two taps on "Decline" are harmless, but a decline racing an approval is
       * not — the filter on `status: "pending"` is what makes exactly one of them win.
       */
      const declined = await RefundRequestModel.findOneAndUpdate(
        { _id: request._id, status: "pending" },
        {
          $set: {
            status: "declined",
            approvedCents: 0,
            decision: {
              by: new mongoose.Types.ObjectId(userId),
              actor: "owner",
              at: new Date(),
              ...(input.note ? { note: input.note } : {}),
            },
          },
        },
        { returnDocument: "after" }
      );
      if (!declined) {
        throw new AppError("This request has already been decided", HTTP_STATUS.CONFLICT);
      }

      notifyRefundDeclined(
        getId(booking.renter),
        itemTitle,
        String(booking._id),
        String(request._id),
        input.note
      ).catch(() => {});

      return { request: declined, refunded: false, refundedCents: 0 };
    }

    const approvedCents =
      input.amount === undefined
        ? request.requestedCents
        : Math.min(centsOf(input.amount), request.requestedCents);
    if (approvedCents <= 0) {
      throw new AppError(
        "Approve an amount above zero, or decline the request",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const claimed = await RefundRequestModel.findOneAndUpdate(
      { _id: request._id, status: "pending" },
      {
        $set: {
          status: "approved",
          approvedCents,
          decision: {
            by: new mongoose.Types.ObjectId(userId),
            actor: "owner",
            at: new Date(),
            ...(input.note ? { note: input.note } : {}),
          },
          "refund.attempted": true,
        },
      },
      { returnDocument: "after" }
    );
    if (!claimed) {
      throw new AppError("This request has already been decided", HTTP_STATUS.CONFLICT);
    }

    const outcome = await this.payOut(booking, claimed, approvedCents);

    notifyRefundApproved(
      getId(booking.renter),
      itemTitle,
      String(booking._id),
      String(request._id),
      dollars(approvedCents),
      approvedCents < request.requestedCents
    ).catch(() => {});

    return {
      request: await RefundRequestModel.findById(request._id),
      refunded: outcome.succeeded,
      refundedCents: outcome.succeeded ? approvedCents : 0,
      // The approval stands even if Stripe failed. Support retries the money, not the decision.
      refundOutstanding: !outcome.succeeded,
    };
  }

  /**
   * Moves the money for an approved request. **Never throws.**
   *
   * The owner's decision is already recorded by the time this runs, and it must stay recorded: an
   * owner who agreed to refund a renter has agreed, whatever Stripe says a second later. A failure
   * is written to `refund.error` where support can see it and retried by hand.
   */
  private async payOut(
    booking: IBooking,
    request: IRefundRequest,
    approvedCents: number
  ): Promise<{ succeeded: boolean }> {
    const payment = await PaymentModel.findOne({ booking: booking._id, status: "completed" });
    if (!payment) {
      await RefundRequestModel.updateOne(
        { _id: request._id },
        { $set: { "refund.succeeded": false, "refund.error": "no completed payment to refund" } }
      );
      logger.warn("[refund-request] approved with no completed payment to refund", {
        bookingId: String(booking._id),
      });
      return { succeeded: false };
    }

    /**
     * Re-run the same arithmetic the cancellation used, with this approval folded in. One function
     * decides what the owner keeps, so an approval here and a tier refund there cannot disagree.
     */
    const { refund, retained } = retainedAfterFurtherRefund(
      booking.pricing,
      alreadyRefunded(booking),
      approvedCents
    );

    const model = chargeModelOf(payment);
    const paidCents = centsOf(booking.pricing?.totalAmount);
    const refundedSoFar = centsOf(payment.refundedAmount);
    const isNowFull = refundedSoFar + approvedCents >= paidCents && paidCents > 0;
    let stripeRefundId: string | undefined;

    try {
      if (payment.stripePaymentIntentId && stripeConfigured()) {
        const stripeRefund = await createRefund({
          paymentIntentId: payment.stripePaymentIntentId,
          amount: approvedCents,
          ...(model === "destination"
            ? { reverseTransfer: true, refundApplicationFee: true }
            : {}),
          reason: "requested_by_customer",
          // One key per request, forever: a retry replays Stripe's answer rather than refunding
          // the same approval twice.
          idempotencyKey: `refund-request-${String(request._id)}`,
        });
        stripeRefundId = stripeRefund.id;
      }

      // Under the platform model, claw back whatever of this the owner has already been paid.
      if (model === "platform" && payment.stripeTransferId && stripeConfigured()) {
        const alreadyRetained = Number(booking.settlement?.ownerRetainedCents ?? NaN);
        const previousOwnerShare = Number.isFinite(alreadyRetained)
          ? alreadyRetained
          : centsOf(booking.pricing?.ownerPayout?.amount);
        const toReverse = Math.max(0, previousOwnerShare - retained.ownerCents);
        if (toReverse > 0) {
          const reversal = await new OwnerPayoutService().reverse(payment._id.toString(), {
            amountCents: toReverse,
            reason: `Owner-approved refund (${request.kind})`,
          });
          if (!reversal.reversed) {
            logger.error("[refund-request] the owner's share could not be clawed back", {
              bookingId: String(booking._id),
              requestId: String(request._id),
              outstandingCents: reversal.amountCents,
              message: reversal.error,
            });
          }
        }
      }
    } catch (err) {
      const message = (err as Error).message;
      await RefundRequestModel.updateOne(
        { _id: request._id },
        { $set: { "refund.succeeded": false, "refund.error": message.slice(0, 500) } }
      );
      logger.error("[refund-request] refund failed — the renter is owed an approved amount", {
        bookingId: String(booking._id),
        requestId: String(request._id),
        message,
      });
      return { succeeded: false };
    }

    await PaymentModel.updateOne(
      { _id: payment._id },
      {
        $set: {
          ...(isNowFull ? { status: "refunded" } : {}),
          refundedAmount: (refundedSoFar + approvedCents) / 100,
          refundedAt: new Date(),
          refundReason: `Owner-approved refund (${request.kind})`,
          ...(stripeRefundId ? { stripeRefundId } : {}),
        },
      }
    );

    /**
     * The settlement is updated too, and `ownerRetainedCents` is the reason it matters beyond the
     * audit trail: under the platform charge model the payout job reads that number to decide what
     * to transfer.
     *
     * **Leaving it stale is a real money bug, not an untidy record.** The owner would be paid the
     * full share the booking was priced at while the renter's refund came out of Atussa's balance —
     * so saying yes would have cost the owner nothing, which is not what either of them agreed to.
     */
    await BookingModel.updateOne(
      { _id: booking._id },
      {
        $set: {
          paymentStatus: isNowFull ? "refunded" : "partially_refunded",
          "settlement.refundedCents": refund.totalCents,
          "settlement.refundBreakdown": {
            rental: refund.rentalCents,
            delivery: refund.deliveryCents,
            fee: refund.feeCents,
            tax: refund.taxCents,
          },
          "settlement.ownerRetainedCents": retained.ownerCents,
          "settlement.platformRetainedCents": retained.platformCents,
        },
      }
    );

    await RefundRequestModel.updateOne(
      { _id: request._id },
      {
        $set: {
          "refund.succeeded": true,
          "refund.at": new Date(),
          ...(stripeRefundId ? { "refund.stripeRefundId": stripeRefundId } : {}),
        },
        $unset: { "refund.error": "" },
      }
    );

    await recordMoneyEvent({
      bookingId: booking._id,
      paymentId: payment._id,
      type: "refund",
      amountCents: approvedCents,
      balanceEffect: "out",
      currency: String(booking.pricing?.currency ?? "CAD"),
      component: "rental",
      actor: { kind: "owner", id: getId(booking.owner) },
      reason: `Owner-approved refund (${request.kind})`,
      stripeId: stripeRefundId,
      idempotencyKey: `refund-request-${String(request._id)}`,
    });

    return { succeeded: true };
  }

  /** A renter changing their mind before the owner has decided. */
  async withdraw(requestId: string, renterId: string) {
    const withdrawn = await RefundRequestModel.findOneAndUpdate(
      { _id: requestId, renter: renterId, status: "pending" },
      {
        $set: {
          status: "withdrawn",
          decision: {
            by: new mongoose.Types.ObjectId(renterId),
            actor: "renter",
            at: new Date(),
          },
        },
      },
      { returnDocument: "after" }
    );
    if (!withdrawn) {
      // One message for "not yours", "not found" and "already decided" on purpose: the three are
      // indistinguishable to someone who should not be able to tell them apart.
      throw new AppError(
        "No pending refund request of yours was found on this booking",
        HTTP_STATUS.NOT_FOUND
      );
    }
    return withdrawn;
  }

  /** Every request on one booking, readable by either party to it. */
  async listForBooking(bookingId: string, userId: string) {
    const booking = await BookingModel.findById(bookingId).select("renter owner").lean();
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.renter) !== userId && getId(booking.owner) !== userId) {
      throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    }
    return RefundRequestModel.find({ booking: bookingId }).sort({ createdAt: -1 }).lean();
  }

  /**
   * The caller's own requests, from whichever side they are on.
   *
   * Both sides, like `GET /disputes/my`: an owner with a decision to make and a renter waiting on
   * one are looking at the same row, and a list that showed only the renter's side would leave the
   * owner with a notification and nowhere to go. `myRole` says which side the caller is.
   */
  async listMine(
    userId: string,
    filters: { status?: string; role?: "renter" | "owner"; page?: number; limit?: number } = {}
  ) {
    const { status, role, page = 1, limit = 20 } = filters;
    const sides =
      role === "renter" ? [{ renter: userId }] : role === "owner" ? [{ owner: userId }] : [{ renter: userId }, { owner: userId }];
    const filter: Record<string, unknown> = { $or: sides };
    if (status) filter.status = status;

    const [rows, total] = await Promise.all([
      RefundRequestModel.find(filter)
        .populate("booking", "startDate endDate status paymentStatus pricing")
        .populate("renter", "firstName lastName")
        .populate("owner", "firstName lastName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      RefundRequestModel.countDocuments(filter),
    ]);

    return {
      requests: rows.map((r) => ({
        ...r,
        myRole: getId((r as { renter?: unknown }).renter) === userId ? "renter" : "owner",
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * The administrator's list.
   *
   * Read-only, deliberately. A declined request is the open question with the client, and the honest
   * answer today is that an administrator can *see* it and use the refund endpoint that already
   * exists — not that a parallel override path has been invented here.
   */
  async listForAdmin(
    filters: { status?: string; kind?: string; page?: number; limit?: number } = {}
  ) {
    const { status, kind, page = 1, limit = 20 } = filters;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (kind) filter.kind = kind;

    const [rows, total] = await Promise.all([
      RefundRequestModel.find(filter)
        .populate("booking", "startDate endDate status paymentStatus pricing cancellation")
        .populate("renter", "firstName lastName email")
        .populate("owner", "firstName lastName email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      RefundRequestModel.countDocuments(filter),
    ]);

    return { requests: rows, total, page, limit };
  }
}
