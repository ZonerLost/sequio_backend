import { Types } from "mongoose";
import {
  MoneyEventModel,
  MoneyEventType,
  MoneyComponent,
  IMoneyEvent,
} from "../models/money-event.model";
import { logger } from "../config/logger";

/**
 * The only way to write to the money ledger.
 *
 * Everything that charges, refunds, transfers, holds, captures or releases goes through here, so the
 * ledger cannot quietly diverge between call sites.
 */

export interface MoneyEventInput {
  bookingId: string | Types.ObjectId;
  paymentId?: string | Types.ObjectId;
  type: MoneyEventType;
  /** Dollars **or** cents is the classic bug here, so this takes cents and nothing else. */
  amountCents: number;
  balanceEffect: "in" | "out" | "none";
  currency?: string;
  component?: MoneyComponent;
  breakdown?: Record<string, number>;
  actor: { kind: "renter" | "owner" | "admin" | "system" | "webhook"; id?: string | Types.ObjectId };
  reason?: string;
  stripeId?: string;
  /**
   * Set this whenever the same real-world event could be reported twice — a replayed Stripe webhook,
   * a retried scheduler job. A duplicate is dropped silently rather than doubling the ledger.
   */
  idempotencyKey?: string;
}

/**
 * Records a money event. **Never throws.**
 *
 * That is a deliberate and slightly uncomfortable choice, so here is the reasoning. This is called
 * *after* the money has already moved — after Stripe confirmed the charge, after the transfer went
 * out. If the ledger write fails and we let that propagate, the caller returns an error for an
 * operation that actually succeeded, and the client retries. A retry at that point can charge the
 * renter a second time. Losing an audit row is bad; double-charging someone is worse.
 *
 * So a failure is logged at `error` level with everything needed to reconstruct the row by hand, and
 * the caller carries on. **Treat one of those log lines as a real incident**, not noise: it means the
 * ledger is incomplete, and the ledger is the thing that answers "where did this money go".
 *
 * The corollary: call this *after* the external call succeeds, never before. A row saying money moved
 * when it did not is worse than a missing row, because nothing contradicts it.
 */
export const recordMoneyEvent = async (
  input: MoneyEventInput
): Promise<IMoneyEvent | null> => {
  try {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
      // Thrown inside the try on purpose — a bad amount is a programming error, and it is better to
      // log it loudly here than to write a nonsense row or take down a payment path over it.
      throw new Error(
        `amountCents must be a non-negative integer, got ${String(input.amountCents)}`
      );
    }

    return await MoneyEventModel.create({
      booking: input.bookingId,
      payment: input.paymentId,
      type: input.type,
      amountCents: input.amountCents,
      currency: input.currency ?? "CAD",
      balanceEffect: input.balanceEffect,
      component: input.component,
      breakdown: input.breakdown,
      actor: input.actor,
      reason: input.reason,
      stripeId: input.stripeId,
      idempotencyKey: input.idempotencyKey,
      occurredAt: new Date(),
    });
  } catch (err) {
    const duplicate = (err as { code?: number }).code === 11000;
    if (duplicate) {
      // The same event reported twice — a replayed webhook. Working as intended, not a problem.
      logger.info("Money event already recorded, ignoring duplicate", {
        type: input.type,
        idempotencyKey: input.idempotencyKey,
      });
      return null;
    }

    // Everything needed to write the row by hand is in this line. It is an incident, not noise.
    logger.error("MONEY EVENT NOT RECORDED — ledger is incomplete", {
      booking: String(input.bookingId),
      type: input.type,
      amountCents: input.amountCents,
      balanceEffect: input.balanceEffect,
      stripeId: input.stripeId,
      message: (err as Error).message,
    });
    return null;
  }
};

/** Everything that happened to one booking, oldest first. */
export const bookingMoneyHistory = (bookingId: string) =>
  MoneyEventModel.find({ booking: bookingId }).sort({ occurredAt: 1 }).lean();

/**
 * Net movement for a booking, in cents, ignoring events where nothing actually moved.
 *
 * A hold is excluded by `balanceEffect: "none"` — counting a deposit authorization as revenue is
 * exactly the mistake this field exists to prevent.
 */
export const bookingNetCents = async (bookingId: string): Promise<number> => {
  const rows = await MoneyEventModel.find({
    booking: bookingId,
    balanceEffect: { $in: ["in", "out"] },
  })
    .select("amountCents balanceEffect")
    .lean();

  return rows.reduce(
    (sum, r) => sum + (r.balanceEffect === "in" ? r.amountCents : -r.amountCents),
    0
  );
};
