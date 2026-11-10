import { PaymentModel, IPayment, chargeModelOf } from "../models/payment.model";
import { BookingModel } from "../models/booking.model";
import { UserModel } from "../models/user.model";
import {
  createTransfer,
  reverseTransfer,
  getPaymentIntent,
  stripeConfigured,
} from "../helpers/stripe.helper";
import { recordMoneyEvent } from "../helpers/money-event.helper";
import { ENV } from "../config/env";
import { logger } from "../config/logger";

/**
 * Paying the owner, once the rental is over.
 *
 * ## Why this file exists
 *
 * Until now the rental was a **destination charge**: the owner's share left Atussa the instant the
 * renter's card was charged, because that is when a destination charge settles. The client's
 * requirement is that the owner is paid when the rental **ends**, and a destination charge cannot be
 * delayed — so the charge becomes a plain platform charge and this service moves the owner's share
 * afterwards.
 *
 * That ordering is worth more than the requirement itself. Every refund path gets simpler, because
 * until this runs **no money has left Atussa**. Owner cancellation is the clearest case: today it
 * refunds the renter in full and reverses a transfer the owner may already have withdrawn, which
 * can push their Stripe balance negative and block their account. Under this model there is usually
 * nothing to reverse.
 *
 * ## The rules
 *
 * 1. **Claim the row before calling Stripe.** `payoutInitiatedAt` is taken with an atomic
 *    `findOneAndUpdate` that also checks the payout has not happened, so two attempts cannot both
 *    transfer. The scheduler's lease makes a concurrent *run* unlikely; this makes a double
 *    transfer impossible, which is a different and stronger claim.
 * 2. **Always pass `source_transaction`.** Without it the transfer draws on Atussa's available
 *    balance and is refused when that balance is short — which it routinely is, because card funds
 *    sit pending and automatic payouts sweep the rest. With it the transfer waits for that charge to
 *    settle. See `createTransfer`.
 * 3. **A failure is recorded and retried, never swallowed.** `payoutInitiatedAt` goes back to null,
 *    `payoutError` and `payoutAttempts` are written, and the next tick tries again. An owner who is
 *    not yet onboarded fails here every time — which is correct, and visible, rather than a payment
 *    that silently never arrives.
 * 4. **Only ever `platform` rows.** A destination charge already paid the owner; transferring again
 *    would pay them twice. `chargeModelOf()` reads a missing value as `destination`, because every
 *    payment written before November 2026 was one (DO-NOT #13).
 */

/** Why a due payout did not go out. Surfaced in the job result, not just logged. */
export type SkipReason =
  | "stripe_not_configured"
  | "owner_has_no_stripe_account"
  | "owner_payouts_not_enabled"
  | "no_charge_to_transfer_from"
  | "booking_not_payable"
  | "nothing_to_pay";

export interface PayoutOutcome {
  paymentId: string;
  bookingId: string;
  amountCents: number;
  transferId?: string;
  skipped?: SkipReason;
  error?: string;
}

/**
 * When a booking's payout becomes due.
 *
 * Measured from **`returned.at` when the item is actually back**, and from the agreed `endDate`
 * otherwise. `returned.at` is the real end of a rental and is what every other deadline here hangs
 * off; `endDate` is only what was agreed, and an item still out is not a finished rental. Taking the
 * later of the two means an overrun does not pay the owner early.
 *
 * Plus `OWNER_PAYOUT_HOLD_HOURS` — 24 by default, matching the claim window the client specified.
 * Nothing opens a claim yet (Phase 4), but paying out before that window closes is what would make
 * this job wrong later, and a hold costs nothing now.
 */
export const payoutDueAt = (booking: {
  endDate?: Date | null;
  returned?: { at?: Date | null } | null;
}): Date | null => {
  const returnedAt = booking.returned?.at ? new Date(booking.returned.at) : null;
  const endDate = booking.endDate ? new Date(booking.endDate) : null;
  const basis =
    returnedAt && endDate ? new Date(Math.max(returnedAt.getTime(), endDate.getTime()))
    : returnedAt ?? endDate;
  if (!basis) return null;
  return new Date(basis.getTime() + ENV.OWNER_PAYOUT_HOLD_HOURS * 60 * 60 * 1000);
};

/** Bookings in which a payout would be wrong, whatever the dates say. */
const UNPAYABLE_BOOKING_STATUSES = ["cancelled", "declined"];

export class OwnerPayoutService {
  /**
   * Transfers one payment's owner share.
   *
   * Safe to call twice: the second call finds the row already claimed or already paid and returns
   * `nothing_to_pay`.
   */
  async release(paymentId: string, actorKind: "system" | "admin" = "system"): Promise<PayoutOutcome> {
    const base = await PaymentModel.findById(paymentId).lean();
    if (!base) throw new Error(`payment ${paymentId} not found`);

    const bookingId = String(base.booking);
    const result = (extra: Partial<PayoutOutcome>): PayoutOutcome => ({
      paymentId,
      bookingId,
      amountCents: 0,
      ...extra,
    });

    if (!stripeConfigured()) return result({ skipped: "stripe_not_configured" });
    if (chargeModelOf(base) !== "platform" || base.status !== "completed" || base.payoutAt) {
      return result({ skipped: "nothing_to_pay" });
    }

    const booking = await BookingModel.findById(base.booking).lean();
    if (!booking || UNPAYABLE_BOOKING_STATUSES.includes(booking.status)) {
      return result({ skipped: "booking_not_payable" });
    }

    const payoutCents = Math.round((booking.pricing?.ownerPayout?.amount ?? 0) * 100);
    if (payoutCents <= 0) return result({ skipped: "nothing_to_pay" });

    const owner = await UserModel.findById(base.payee).select("stripeAccount").lean();
    const account = owner?.stripeAccount;
    if (!account?.id) return result({ amountCents: payoutCents, skipped: "owner_has_no_stripe_account" });
    /**
     * A transfer needs the destination account's `transfers` capability active. Stripe reports that
     * through `payoutsEnabled`, and an owner who has not finished onboarding fails this — which is
     * the live state of every owner on the platform today. Checking here turns that into a named,
     * countable skip instead of an identical Stripe error on every single tick.
     */
    if (!account.payoutsEnabled) {
      return result({ amountCents: payoutCents, skipped: "owner_payouts_not_enabled" });
    }

    /**
     * The charge the money came from. Stored at charge time; looked up from the intent if an older
     * row does not have it, because without it the transfer would fall back to the available
     * balance and fail whenever that balance is short.
     */
    let chargeId = base.stripeChargeId;
    if (!chargeId && base.stripePaymentIntentId) {
      try {
        chargeId = (await getPaymentIntent(base.stripePaymentIntentId)).latest_charge;
      } catch (err) {
        logger.warn(
          `[owner-payout] could not read the charge for intent ${base.stripePaymentIntentId}: ${(err as Error).message}`
        );
      }
    }
    if (!chargeId) return result({ amountCents: payoutCents, skipped: "no_charge_to_transfer_from" });

    /**
     * Claim it. The filter re-checks everything that makes this payable, so a row another attempt
     * has already taken or already paid cannot be claimed a second time — read-then-write here would
     * let two attempts through and transfer twice.
     */
    const claimed = await PaymentModel.findOneAndUpdate(
      {
        _id: base._id,
        status: "completed",
        chargeModel: "platform",
        // `field: null` matches a null **and** a missing field, which is what is wanted here.
        // That is not the `field: false` trap in DO-NOT #13 — a missing field does not match
        // `false`, but it does match `null`. Both of these are absent on every row until a payout
        // is attempted, so the distinction decides whether this query finds anything at all.
        payoutAt: null,
        payoutInitiatedAt: null,
      },
      { $set: { payoutInitiatedAt: new Date() }, $inc: { payoutAttempts: 1 } },
      { returnDocument: "after" }
    );
    if (!claimed) return result({ amountCents: payoutCents, skipped: "nothing_to_pay" });

    try {
      const transfer = await createTransfer({
        amount: payoutCents,
        currency: base.currency || "CAD",
        destination: account.id,
        sourceTransaction: chargeId,
        transferGroup: bookingId,
        description: `Atussa rental payout for booking ${bookingId}`,
        metadata: { bookingId, paymentId, ownerId: String(base.payee) },
        // One key per payment, forever: this is the only transfer that payment will ever produce,
        // so replaying Stripe's original response is exactly the behaviour wanted.
        idempotencyKey: `transfer-${paymentId}`,
      });

      await PaymentModel.updateOne(
        { _id: base._id },
        {
          $set: { stripeTransferId: transfer.id, payoutAt: new Date(), stripeChargeId: chargeId },
          $unset: { payoutError: "" },
        }
      );
      await BookingModel.updateOne({ _id: base.booking }, { $set: { paymentStatus: "paid_out" } });

      // After Stripe confirmed, never before: a ledger row saying money moved when it did not is
      // worse than a missing one, because nothing contradicts it.
      await recordMoneyEvent({
        bookingId: base.booking,
        paymentId: base._id,
        type: "transfer_to_owner",
        amountCents: payoutCents,
        balanceEffect: "out",
        currency: base.currency || "CAD",
        component: "rental",
        actor: { kind: actorKind },
        stripeId: transfer.id,
        idempotencyKey: `transfer-${paymentId}`,
      });

      return result({ amountCents: payoutCents, transferId: transfer.id });
    } catch (err) {
      const message = (err as Error).message;
      // Release the claim so the next tick retries, and keep the reason where someone can see it.
      await PaymentModel.updateOne(
        { _id: base._id },
        { $set: { payoutInitiatedAt: null, payoutError: message } }
      );
      logger.error(`[owner-payout] transfer failed for payment ${paymentId}: ${message}`);
      return result({ amountCents: payoutCents, error: message });
    }
  }

  /**
   * Finds every payout that is due and releases it.
   *
   * The date filter is on the booking, so the candidates are gathered the other way round: payments
   * first (there are far fewer completed platform charges than bookings), then each one's booking is
   * checked for due-ness. `payoutDueAt` is the single definition of due, shared with the tests.
   */
  async releaseDue(limit = 50): Promise<{
    released: number;
    releasedCents: number;
    failed: number;
    skipped: Record<string, number>;
    outcomes: PayoutOutcome[];
  }> {
    const now = new Date();

    const candidates = await PaymentModel.find({
      status: "completed",
      chargeModel: "platform",
      payoutAt: null,
    })
      .select("_id booking")
      .limit(limit * 4)
      .lean();

    const outcomes: PayoutOutcome[] = [];
    for (const candidate of candidates) {
      if (outcomes.length >= limit) break;
      const booking = await BookingModel.findById(candidate.booking)
        .select("endDate returned status")
        .lean();
      if (!booking) continue;
      const due = payoutDueAt(booking);
      if (!due || due > now) continue;
      outcomes.push(await this.release(String(candidate._id)));
    }

    const skipped: Record<string, number> = {};
    for (const o of outcomes) {
      if (o.skipped) skipped[o.skipped] = (skipped[o.skipped] ?? 0) + 1;
    }

    return {
      released: outcomes.filter((o) => o.transferId).length,
      releasedCents: outcomes.filter((o) => o.transferId).reduce((n, o) => n + o.amountCents, 0),
      failed: outcomes.filter((o) => o.error).length,
      skipped,
      outcomes,
    };
  }

  /**
   * Claws back a payout that has already gone out.
   *
   * Only reachable when a rental is unwound **after** the owner was paid. Under separate charges and
   * transfers a refund does not reverse a transfer — that was a destination-charge convenience — so
   * the renter's refund and this are two separate operations.
   *
   * **It can legitimately fail.** A reversal only works while the owner's balance covers it, and an
   * owner who has withdrawn leaves a real shortfall. That is recorded as `reversalOutstanding` for
   * support to chase rather than thrown away, and it is the exact problem this whole phase exists to
   * make rare: before the payout runs there is nothing to reverse.
   */
  async reverse(
    paymentId: string,
    opts: { amountCents?: number; reason?: string } = {}
  ): Promise<{ reversed: boolean; amountCents: number; error?: string }> {
    const payment = await PaymentModel.findById(paymentId).lean();
    if (!payment?.stripeTransferId) return { reversed: false, amountCents: 0 };
    if (payment.transferReversedAt) return { reversed: true, amountCents: 0 };

    try {
      const reversal = await reverseTransfer({
        transferId: payment.stripeTransferId,
        amount: opts.amountCents,
        metadata: { paymentId, reason: opts.reason ?? "rental unwound after payout" },
        idempotencyKey: `reverse-${paymentId}-${opts.amountCents ?? "full"}`,
      });

      await PaymentModel.updateOne(
        { _id: payment._id },
        { $set: { transferReversedAt: new Date() }, $unset: { reversalOutstanding: "" } }
      );

      await recordMoneyEvent({
        bookingId: payment.booking,
        paymentId: payment._id,
        type: "transfer_reversed",
        amountCents: reversal.amount,
        balanceEffect: "in",
        currency: payment.currency || "CAD",
        component: "rental",
        actor: { kind: "system" },
        reason: opts.reason,
        stripeId: reversal.id,
        idempotencyKey: `reverse-${paymentId}-${opts.amountCents ?? "full"}`,
      });

      return { reversed: true, amountCents: reversal.amount };
    } catch (err) {
      const message = (err as Error).message;
      const outstanding = opts.amountCents ?? Math.round((payment.amount ?? 0) * 100);
      await PaymentModel.updateOne(
        { _id: payment._id },
        { $set: { reversalOutstanding: outstanding / 100, payoutError: message } }
      );
      logger.error(
        `[owner-payout] REVERSAL FAILED for payment ${paymentId} — ${outstanding / 100} ` +
          `${payment.currency || "CAD"} is outstanding from the owner: ${message}`
      );
      return { reversed: false, amountCents: outstanding, error: message };
    }
  }
}
