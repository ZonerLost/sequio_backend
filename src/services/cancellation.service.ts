import mongoose from "mongoose";
import { BookingModel } from "../models/booking.model";
import { ItemModel } from "../models/item.model";
import { PaymentModel, chargeModelOf } from "../models/payment.model";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { getId } from "../helpers/id.helper";
import { logger } from "../config/logger";
import { createRefund, stripeConfigured } from "../helpers/stripe.helper";
import { recordMoneyEvent } from "../helpers/money-event.helper";
import { OwnerPayoutService } from "./owner-payout.service";
import {
  CancellationQuote,
  cancellationConditions,
  quoteCancellation,
} from "../helpers/cancellation.helper";

/**
 * The renter-side cancellation policy, wired to money.
 *
 * `cancellation.helper.ts` decides *what* is owed, as a pure function. This decides *when* and
 * carries out the consequences: the Stripe refund, the clawback if the owner has already been paid,
 * the ledger rows, and the record on the booking that the payout job later reads.
 *
 * **Order matters, and it is the same order as an owner cancellation.** The booking is cancelled
 * first and the refund attempted second. If the refund fails the renter has a cancelled booking and
 * a visible `refundOutstanding` that support can retry; failing the whole request instead would
 * leave the booking live, the renter still committed to a rental they have cancelled, and the item
 * blocked for everyone else.
 */

/** A dollar label for a notification body. Never used for arithmetic. */
const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export interface CancellationSettlement {
  /** The whole decision, so a caller can notify and open the balance request without recomputing. */
  quote: CancellationQuote;
  tier: CancellationQuote["tier"];
  refundCents: number;
  /** True when the policy owed the renter money and Stripe did not return it. */
  refundOutstanding: boolean;
  /** Set when a 24–48h cancellation opened a request for the owner to approve the rest. */
  ownerApprovableCents: number;
}

export class CancellationService {
  /**
   * What a cancellation right now would refund, for either party to look at before deciding.
   *
   * Readable by the renter **and** the owner. The renter needs it to decide whether to cancel; the
   * owner needs it because the same numbers say what they would keep, and a policy only one side
   * can see is one the other side will dispute.
   */
  async quote(bookingId: string, userId: string): Promise<CancellationQuote> {
    const booking = await BookingModel.findById(bookingId).lean();
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    if (getId(booking.renter) !== userId && getId(booking.owner) !== userId) {
      throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);
    }

    return quoteCancellation({
      booking,
      location: await this.locationOf(getId(booking.item)),
      now: new Date(),
    });
  }

  /** The conditions to show before a booking is made, where there is no booking to quote yet. */
  conditions(): string[] {
    return cancellationConditions();
  }

  /**
   * The listing's location, which is where the clock comes from.
   *
   * Only the fields the time zone derivation reads. A booking whose item has been deleted still
   * cancels — it falls back to the platform default zone rather than refusing, because refusing to
   * cancel a booking over a missing listing would trap the renter.
   */
  private async locationOf(itemId: string) {
    if (!itemId || !mongoose.isValidObjectId(itemId)) return null;
    const item = await ItemModel.findById(itemId)
      .select("location.province location.country location.timeZone location.coordinates")
      .lean();
    return (item as { location?: Record<string, unknown> } | null)?.location ?? null;
  }

  /**
   * Carries out the money side of a cancellation.
   *
   * **No money failure throws.** It is called after the booking has already been moved to
   * `cancelled`, so there is nothing left to abort: a refund that Stripe refuses is recorded as
   * `refundOutstanding` and returned, never raised. The one exception is a booking that has
   * vanished between the status write and this call, which is a real fault and not a quiet one.
   */
  async settle(
    bookingId: string,
    cancelledBy: "renter" | "owner" | "admin"
  ): Promise<CancellationSettlement> {
    const booking = await BookingModel.findById(bookingId).lean();
    if (!booking) {
      throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);
    }

    /**
     * The quote is taken against `cancelledAt`, not against "now".
     *
     * Those are the same moment on the happy path, but not if this is ever retried or run from a
     * queue — and a retry that recomputed the tier an hour later could drop a renter from the 50%
     * band into nothing. The decision belongs to the moment the renter cancelled.
     */
    const now = booking.cancelledAt ? new Date(booking.cancelledAt) : new Date();
    const quote = quoteCancellation({
      booking,
      location: await this.locationOf(getId(booking.item)),
      now,
    });

    // The policy decision is recorded whether or not any money moves — it is what explains the
    // outcome to both parties, and `ownerRetainedCents` is what pays the owner later.
    await BookingModel.updateOne(
      { _id: booking._id },
      {
        $set: {
          "cancellation.tier": quote.tier,
          "cancellation.cancelledBy": cancelledBy,
          "cancellation.timeZone": quote.timeZone,
          "cancellation.timeZoneSource": quote.timeZoneSource,
          "cancellation.startsAt": quote.startsAt,
          "cancellation.hoursBeforeStart": quote.hoursUntilStart,
          "settlement.refundedCents": quote.refund.totalCents,
          "settlement.refundBreakdown": {
            rental: quote.refund.rentalCents,
            delivery: quote.refund.deliveryCents,
            fee: quote.refund.feeCents,
            tax: quote.refund.taxCents,
          },
          "settlement.ownerRetainedCents": quote.retained.ownerCents,
          "settlement.platformRetainedCents": quote.retained.platformCents,
        },
      }
    );

    if (!quote.refundable || quote.refund.totalCents <= 0) {
      if (quote.paidCents > 0 && !quote.apportionable && quote.tier === "partial") {
        // The one case where a paid booking gets no automatic refund despite being owed one. Loud,
        // because it needs a human: the stored breakdown predates the fields this arithmetic needs.
        logger.error(
          "[cancellation] a paid booking in the 50% band has a breakdown that cannot be apportioned " +
            `— refund by hand: booking ${String(booking._id)}`
        );
      }
      return {
        quote,
        tier: quote.tier,
        refundCents: 0,
        refundOutstanding: false,
        ownerApprovableCents: quote.ownerApprovableCents,
      };
    }

    const outcome = await this.refund(booking, quote);
    if (!outcome.succeeded) {
      await BookingModel.updateOne(
        { _id: booking._id },
        { $set: { "cancellation.refundOutstanding": true } }
      );
    }

    return {
      quote,
      tier: quote.tier,
      refundCents: outcome.succeeded ? quote.refund.totalCents : 0,
      refundOutstanding: !outcome.succeeded,
      ownerApprovableCents: quote.ownerApprovableCents,
    };
  }

  /**
   * Refunds the renter the tier's amount and claws the owner's share back if it has already gone.
   *
   * Full and partial go down the same path, with one difference that matters: a **partial** refund
   * leaves `payment.status` as `completed`. That payment is still the one completed payment for the
   * booking, and flipping it to `refunded` would release the unique partial index and let the
   * booking take a second completed payment.
   */
  private async refund(
    booking: { _id: mongoose.Types.ObjectId; pricing?: unknown },
    quote: CancellationQuote
  ): Promise<{ succeeded: boolean; stripeRefundId?: string }> {
    const payment = await PaymentModel.findOne({ booking: booking._id, status: "completed" });
    if (!payment) {
      logger.warn("[cancellation] booking is marked paid but has no completed payment to refund", {
        bookingId: String(booking._id),
      });
      return { succeeded: false };
    }

    const model = chargeModelOf(payment);
    const isFull = quote.refund.totalCents >= quote.paidCents;
    let stripeRefundId: string | undefined;

    try {
      if (payment.stripePaymentIntentId && stripeConfigured()) {
        const refund = await createRefund({
          paymentIntentId: payment.stripePaymentIntentId,
          // Omitted on a full refund so Stripe refunds the charge's own amount rather than a
          // figure we computed — the two should agree, and if they ever do not, Stripe is right.
          ...(isFull ? {} : { amount: quote.refund.totalCents }),
          /**
           * Destination-charge parameters, and silent no-ops on a platform charge. Sending them
           * anyway would read in this file exactly like the owner's share coming back, which under
           * the platform model it is not — that is the explicit reversal below.
           *
           * On a *partial* destination refund Stripe reverses a proportional part of the transfer,
           * which is the behaviour wanted: the owner funds their share of the refund.
           */
          ...(model === "destination"
            ? { reverseTransfer: true, refundApplicationFee: true }
            : {}),
          reason: "requested_by_customer",
          // One key per payment per tier: a retry replays Stripe's answer instead of refunding
          // twice, while the owner approving the rest later uses its own key.
          idempotencyKey: `cancel-${quote.tier}-${payment._id.toString()}`,
        });
        stripeRefundId = refund.id;
      }

      /**
       * Under the platform model the refund moved the renter's money and nothing else. If the owner
       * has already been paid — a cancellation after the payout ran — their share of this refund has
       * to be taken back explicitly.
       *
       * **Normally this does nothing**, which is the entire argument for Phase 2c: a cancellation
       * before the rental ends happens before the payout, so there is nothing to reverse.
       */
      if (model === "platform" && payment.stripeTransferId && stripeConfigured()) {
        /**
         * What the owner has to give back: everything of theirs that is no longer theirs — the
         * payout they were priced at, less what the policy says they keep.
         */
        const ownerPayoutCents = Math.round(
          Number(
            (booking as { pricing?: { ownerPayout?: { amount?: number } } }).pricing?.ownerPayout
              ?.amount ?? 0
          ) * 100
        );
        const ownerShareOfRefund = Math.max(0, ownerPayoutCents - quote.retained.ownerCents);
        if (ownerShareOfRefund > 0) {
          const reversal = await new OwnerPayoutService().reverse(payment._id.toString(), {
            amountCents: ownerShareOfRefund,
            reason: `Renter cancellation (${quote.tier} refund)`,
          });
          if (!reversal.reversed) {
            logger.error(
              "[cancellation] the owner's share could not be clawed back after a cancellation",
              {
                bookingId: String(booking._id),
                paymentId: payment._id.toString(),
                outstandingCents: reversal.amountCents,
                message: reversal.error,
              }
            );
          }
        }
      }
    } catch (err) {
      const message = (err as Error).message;
      logger.error("[cancellation] refund failed — the renter is owed money", {
        bookingId: String(booking._id),
        paymentId: payment._id.toString(),
        message,
      });
      return { succeeded: false };
    }

    const refundedCents =
      Math.round(Number(payment.refundedAmount ?? 0) * 100) + quote.refund.totalCents;

    await PaymentModel.updateOne(
      { _id: payment._id },
      {
        $set: {
          ...(isFull ? { status: "refunded" } : {}),
          refundedAmount: refundedCents / 100,
          refundedAt: new Date(),
          refundReason: `Cancellation (${quote.tier})`,
          ...(stripeRefundId ? { stripeRefundId } : {}),
        },
      }
    );
    await BookingModel.updateOne(
      { _id: booking._id },
      { $set: { paymentStatus: isFull ? "refunded" : "partially_refunded" } }
    );

    // After Stripe confirmed, never before. `breakdown` is what makes the ledger able to answer
    // "which part of the price came back", which is the question a partial refund creates.
    await recordMoneyEvent({
      bookingId: booking._id,
      paymentId: payment._id,
      type: "refund",
      amountCents: quote.refund.totalCents,
      balanceEffect: "out",
      currency: quote.currency,
      actor: { kind: "renter" },
      reason: `Cancellation refund (${quote.tier})`,
      breakdown: {
        rental: quote.refund.rentalCents,
        delivery: quote.refund.deliveryCents,
        fee: quote.refund.feeCents,
        tax: quote.refund.taxCents,
      },
      stripeId: stripeRefundId,
      idempotencyKey: `cancel-${quote.tier}-refund-${payment._id.toString()}`,
    });

    return { succeeded: true, stripeRefundId };
  }

  /** The sentence an owner is told about a cancellation, built from the settled numbers. */
  settlementMessage(quote: CancellationQuote, settlement: CancellationSettlement): string {
    if (quote.paidCents <= 0) return "The booking was not paid for, so no money changes hands.";
    if (settlement.tier === "full") {
      return `It was cancelled more than 48 hours before the start, so the renter is refunded in full (${dollars(
        quote.paidCents
      )}) and you keep nothing.`;
    }
    if (settlement.tier === "partial") {
      return (
        `It was cancelled ${Math.round(quote.hoursUntilStart)} hours before the start, so half the rental ` +
        `(${dollars(quote.refund.totalCents)}) is refunded automatically and you keep ` +
        `${dollars(quote.retained.ownerCents)}. You can choose to approve the remaining ` +
        `${dollars(quote.ownerApprovableCents)} if you want to.`
      );
    }
    return `It was cancelled less than 24 hours before the start, so no refund is due and you keep ${dollars(
      quote.retained.ownerCents
    )}.`;
  }
}
