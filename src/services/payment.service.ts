import { PaymentRepository } from "../repository/payment.repository";
import { BookingRepository } from "../repository/booking.repository";
import { UserRepository } from "../repository/user.repository";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { ENV } from "../config/env";
import { PaymentMethod } from "../models/payment.model";
import { buildPagination } from "../helpers/pagination.helper";
import { notificationService } from "../services/notification.service";
import {
  createPaymentIntent,
  getPaymentIntent,
  stripeConfigured,
  StripePaymentIntent,
} from "../helpers/stripe.helper";
import { logger } from "../config/logger";
import mongoose from "mongoose";

const paymentRepo = new PaymentRepository();
const bookingRepo = new BookingRepository();
const userRepo = new UserRepository();

function getId(value: any): string {
  if (!value) return "";
  if (typeof value === "object" && value._id) return value._id.toString();
  return value.toString();
}

export class PaymentService {
  /**
   * Generates a Stripe PaymentIntent for an accepted booking with destination charge and application fee.
   */
  /**
   * What a client needs to initialise Stripe. The publishable key is not a secret — it is meant to
   * live in client code — so serving it keeps one source of truth and lets a test-to-live switch or
   * a key rotation happen without an app release.
   */
  getClientConfig() {
    return {
      publishableKey: ENV.STRIPE_PUBLISHABLE_KEY || null,
      paymentsEnabled: stripeConfigured() && Boolean(ENV.STRIPE_PUBLISHABLE_KEY),
      currency: "CAD",
      merchantCountryCode: "CA",
      mode: ENV.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test",
    };
  }

  async createPaymentIntent(payerId: string, bookingId: string) {
    if (!stripeConfigured()) {
      throw new AppError(
        "Payment processing is not configured on this server yet",
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }

    const booking = await bookingRepo.findById(bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);

    if (getId(booking.renter) !== payerId) {
      throw new AppError("Only the renter can pay for this booking", HTTP_STATUS.FORBIDDEN);
    }

    if (booking.status !== "accepted") {
      throw new AppError(
        `Payment intent can only be created once the booking is accepted (this one is "${booking.status}")`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const completed = await paymentRepo.findCompletedByBooking(bookingId);
    if (completed) {
      throw new AppError("Payment already recorded for this booking", HTTP_STATUS.CONFLICT);
    }

    const owner = await userRepo.findById(getId(booking.owner));
    if (!owner) throw new AppError("Listing owner not found", HTTP_STATUS.NOT_FOUND);

    const ownerStripeAccountId = owner.stripeAccount?.id;
    if (!ownerStripeAccountId) {
      throw new AppError(
        "The listing owner has not connected their Stripe payout account yet. The owner must complete payout setup before receiving payments.",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    // Bookings priced before 2026-09-29 have no ownerPayout, and their total included a $100
    // security deposit — taking 85% of that would transfer the renter's deposit to the owner. Refuse
    // rather than move the wrong amount; the booking can be re-created at current pricing.
    if (booking.pricing.ownerPayout?.amount === undefined) {
      throw new AppError(
        "This booking was priced before the current commission model and cannot be charged. " +
          "Please cancel it and create a new booking.",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const totalAmountCents = Math.round(booking.pricing.totalAmount * 100);
    const ownerPayoutCents = Math.round(booking.pricing.ownerPayout.amount * 100);
    // Everything the renter pays that is not the owner's payout: commission, the Atussa Fee, and the
    // taxes Atussa remits. Matches the invariant asserted in pricing.helper.ts.
    const applicationFeeCents = Math.max(0, totalAmountCents - ownerPayoutCents);

    // If an existing pending payment has a client_secret, check if it's still usable
    let pending = await paymentRepo.findPendingByBooking(bookingId);
    let replacing: string | undefined;
    if (pending?.stripePaymentIntentId) {
      try {
        const existingIntent = await getPaymentIntent(pending.stripePaymentIntentId);

        // Already paid, or being paid: the row is only still "pending" because the webhook has not
        // landed yet. Creating another intent here is how a renter gets charged twice.
        if (existingIntent.status === "succeeded") {
          await this.handlePaymentIntentSucceeded(existingIntent);
          throw new AppError("Payment already recorded for this booking", HTTP_STATUS.CONFLICT);
        }
        if (existingIntent.status === "processing") {
          throw new AppError(
            "This payment is still being processed by Stripe. Please wait a moment and refresh.",
            HTTP_STATUS.CONFLICT
          );
        }

        // Still payable: hand back the same client secret rather than a second intent.
        if (
          ["requires_payment_method", "requires_confirmation", "requires_action"].includes(
            existingIntent.status
          )
        ) {
          return {
            clientSecret: existingIntent.client_secret,
            paymentIntentId: existingIntent.id,
            amount: booking.pricing.totalAmount,
            currency: "CAD",
            bookingId,
          };
        }

        // Dead (canceled, or requires_capture we do not use): replace it, and remember which one, so
        // the idempotency key below differs from the attempt that produced it.
        replacing = existingIntent.id;
      } catch (err) {
        if (err instanceof AppError) throw err;
        // Stripe could not tell us about it (deleted test data, transient error): start fresh.
        replacing = pending.stripePaymentIntentId;
      }
    }

    const intent = await createPaymentIntent({
      amount: totalAmountCents,
      currency: "cad",
      destinationAccountId: ownerStripeAccountId,
      applicationFeeAmount: applicationFeeCents,
      metadata: {
        bookingId,
        payerId,
        ownerId: getId(booking.owner),
      },
      // Keyed per attempt: a plain booking+amount key would, after an intent was canceled, replay
      // Stripe's original response for 24h and hand the renter back the dead intent forever.
      idempotencyKey: `pi-${bookingId}-${totalAmountCents}-${replacing ?? "first"}`,
    });

    if (pending) {
      pending = (await paymentRepo.updateStatus(pending._id.toString(), "pending", {
        stripePaymentIntentId: intent.id,
        stripeClientSecret: intent.client_secret,
        amount: booking.pricing.totalAmount,
        currency: "CAD",
        method: "credit_card",
      })) as any;
    } else {
      pending = await paymentRepo.create({
        booking: new mongoose.Types.ObjectId(bookingId),
        payer: new mongoose.Types.ObjectId(payerId),
        payee: new mongoose.Types.ObjectId(getId(booking.owner)),
        amount: booking.pricing.totalAmount,
        currency: "CAD",
        method: "credit_card",
        status: "pending",
        stripePaymentIntentId: intent.id,
        stripeClientSecret: intent.client_secret,
      });
    }

    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amount: booking.pricing.totalAmount,
      currency: "CAD",
      bookingId,
    };
  }

  async recordPayment(
    payerId: string,
    data: {
      bookingId: string;
      paymentIntentId?: string;
      method?: PaymentMethod;
      paymentMethodId?: string;
      externalReference?: string;
    }
  ) {
    const booking = await bookingRepo.findById(data.bookingId);
    if (!booking) throw new AppError("Booking not found", HTTP_STATUS.NOT_FOUND);

    if (getId(booking.renter) !== payerId) {
      throw new AppError("Only the renter can record a payment", HTTP_STATUS.FORBIDDEN);
    }

    if (!["accepted", "active", "completed"].includes(booking.status)) {
      // Naming the current status matters: a client that pays straight after creating a booking hits
      // this every time, because a new booking is always "pending" until the owner accepts it.
      throw new AppError(
        `Payment can only be recorded once the booking is accepted (this one is "${booking.status}")`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const existing = await paymentRepo.findCompletedByBooking(data.bookingId);
    if (existing) {
      throw new AppError("Payment already recorded for this booking", HTTP_STATUS.CONFLICT);
    }

    let method = data.method;
    let savedMethodId: mongoose.Types.ObjectId | undefined;
    let stripePaymentIntentId = data.paymentIntentId;

    if (data.paymentIntentId) {
      // Fail closed. Without a key this used to skip verification and write the payment as
      // completed on the client's word, which is exactly what naming an intent is supposed to prove.
      if (!stripeConfigured()) {
        throw new AppError(
          "Payment processing is not configured on this server yet",
          HTTP_STATUS.SERVICE_UNAVAILABLE
        );
      }
      {
        const intent = await getPaymentIntent(data.paymentIntentId);
        if (intent.status !== "succeeded") {
          throw new AppError(
            `Stripe payment has not succeeded yet (status: "${intent.status}")`,
            HTTP_STATUS.BAD_REQUEST
          );
        }
        if (intent.metadata?.bookingId && intent.metadata.bookingId !== data.bookingId) {
          throw new AppError("Payment intent does not belong to this booking", HTTP_STATUS.BAD_REQUEST);
        }
      }
      method = method || "credit_card";
    }

    // A saved method pins down what was actually paid with; `method` alone only records a category.
    if (data.paymentMethodId) {
      const saved = await paymentRepo.findMethodById(data.paymentMethodId, payerId);
      if (!saved) throw new AppError("Payment method not found", HTTP_STATUS.NOT_FOUND);
      if (method && method !== saved.type) {
        throw new AppError(
          `method "${method}" does not match that payment method (${saved.type})`,
          HTTP_STATUS.BAD_REQUEST
        );
      }
      method = saved.type;
      savedMethodId = saved._id;
    }
    if (!method) {
      throw new AppError("Provide either method, paymentMethodId or paymentIntentId", HTTP_STATUS.BAD_REQUEST);
    }

    let payment;
    const pending =
      (stripePaymentIntentId && (await paymentRepo.findByPaymentIntentId(stripePaymentIntentId))) ||
      (await paymentRepo.findPendingByBooking(data.bookingId));

    try {
      if (pending) {
        payment = await paymentRepo.updateStatus(pending._id.toString(), "completed", {
          payer: new mongoose.Types.ObjectId(payerId),
          payee: new mongoose.Types.ObjectId(getId(booking.owner)),
          paymentMethod: savedMethodId,
          amount: booking.pricing.totalAmount,
          currency: "CAD",
          method,
          stripePaymentIntentId: stripePaymentIntentId || pending.stripePaymentIntentId,
          externalReference: data.externalReference || stripePaymentIntentId || pending.stripePaymentIntentId,
        });
      } else {
        payment = await paymentRepo.create({
          booking: new mongoose.Types.ObjectId(data.bookingId),
          payer: new mongoose.Types.ObjectId(payerId),
          payee: new mongoose.Types.ObjectId(getId(booking.owner)),
          paymentMethod: savedMethodId,
          amount: booking.pricing.totalAmount,
          currency: "CAD",
          method,
          status: "completed",
          stripePaymentIntentId,
          externalReference: data.externalReference || stripePaymentIntentId,
        });
      }
    } catch (err) {
      // Two requests can pass the check above at the same time; the unique partial index on
      // { booking, status: "completed" } is what actually stops the second row.
      if ((err as { code?: number }).code === 11000) {
        throw new AppError("Payment already recorded for this booking", HTTP_STATUS.CONFLICT);
      }
      throw err;
    }

    if (!payment) throw new AppError("Failed to record payment", HTTP_STATUS.INTERNAL_SERVER);

    notificationService
      .send({
        userId: getId(booking.owner),
        type: "payment_received",
        title: "Payment Received",
        body: `You received $${booking.pricing.totalAmount} CAD for your rental`,
        data: { bookingId: data.bookingId, paymentId: payment._id.toString() },
      })
      .catch(() => {});

    // Return the same populated shape the GET endpoints return
    return (await paymentRepo.findById(payment._id.toString())) ?? payment;
  }

  async handlePaymentIntentSucceeded(intent: StripePaymentIntent): Promise<boolean> {
    const bookingId = intent.metadata?.bookingId;
    let payment = await paymentRepo.findByPaymentIntentId(intent.id);
    if (!payment && bookingId) {
      payment = await paymentRepo.findPendingByBooking(bookingId);
    }

    if (payment) {
      if (payment.status === "completed") return true;
      await paymentRepo.updateStatus(payment._id.toString(), "completed", {
        stripePaymentIntentId: intent.id,
        externalReference: intent.id,
      });

      notificationService
        .send({
          userId: getId(payment.payee),
          type: "payment_received",
          title: "Payment Received",
          body: `You received $${payment.amount} CAD for your rental`,
          data: { bookingId: getId(payment.booking), paymentId: payment._id.toString() },
        })
        .catch(() => {});

      logger.info("Payment completed via Stripe webhook", {
        paymentId: payment._id.toString(),
        intentId: intent.id,
        bookingId: getId(payment.booking),
      });
      return true;
    }

    if (bookingId) {
      const booking = await bookingRepo.findById(bookingId);
      if (booking) {
        try {
          const created = await paymentRepo.create({
            booking: new mongoose.Types.ObjectId(bookingId),
            payer: new mongoose.Types.ObjectId(getId(booking.renter)),
            payee: new mongoose.Types.ObjectId(getId(booking.owner)),
            amount: booking.pricing.totalAmount,
            currency: "CAD",
            method: "credit_card",
            status: "completed",
            stripePaymentIntentId: intent.id,
            externalReference: intent.id,
          });

          notificationService
            .send({
              userId: getId(booking.owner),
              type: "payment_received",
              title: "Payment Received",
              body: `You received $${booking.pricing.totalAmount} CAD for your rental`,
              data: { bookingId, paymentId: created._id.toString() },
            })
            .catch(() => {});

          logger.info("Payment created and completed via Stripe webhook", {
            paymentId: created._id.toString(),
            intentId: intent.id,
            bookingId,
          });
          return true;
        } catch (err) {
          logger.error("Failed to create payment from Stripe webhook", { err, intentId: intent.id });
        }
      }
    }

    return false;
  }

  async handlePaymentIntentFailed(intent: StripePaymentIntent): Promise<boolean> {
    const payment = await paymentRepo.findByPaymentIntentId(intent.id);
    if (payment && payment.status !== "completed") {
      await paymentRepo.updateStatus(payment._id.toString(), "failed", {
        stripePaymentIntentId: intent.id,
      });
      logger.warn("Payment marked failed via Stripe webhook", {
        paymentId: payment._id.toString(),
        intentId: intent.id,
      });
      return true;
    }
    return false;
  }

  /** role: money out ("payer", the default), money in ("payee"), or both ("all"). */
  async getMyTransactions(
    userId: string,
    page = 1,
    limit = 10,
    role: "payer" | "payee" | "all" = "payer"
  ) {
    const { payments, total } = await paymentRepo.findForUser(userId, role, page, limit);
    return { payments, pagination: buildPagination(total, page, limit) };
  }

  async getPaymentById(paymentId: string, userId: string) {
    const payment = await paymentRepo.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", HTTP_STATUS.NOT_FOUND);

    const isParty =
      getId(payment.payer) === userId ||
      getId(payment.payee) === userId;
    if (!isParty) throw new AppError("Access denied", HTTP_STATUS.FORBIDDEN);

    return payment;
  }

  async savePaymentMethod(
    userId: string,
    data: {
      type: PaymentMethod;
      label: string;
      isDefault: boolean;
      card?: {
        last4: string;
        brand: string;
        expiryMonth: number;
        expiryYear: number;
      };
    }
  ) {
    return paymentRepo.saveMethod({
      user: new mongoose.Types.ObjectId(userId),
      ...data,
    });
  }

  async getMyPaymentMethods(userId: string) {
    return paymentRepo.getMethodsByUser(userId);
  }

  /** Returns what is left, so a picker can refresh without a second request. */
  async deletePaymentMethod(methodId: string, userId: string) {
    const { deleted } = await paymentRepo.deleteMethod(methodId, userId);
    // Without this, deleting someone else's id — or a typo — answered 200 having done nothing.
    if (!deleted) throw new AppError("Payment method not found", HTTP_STATUS.NOT_FOUND);
    return paymentRepo.getMethodsByUser(userId);
  }

  async setDefaultPaymentMethod(methodId: string, userId: string) {
    const updated = await paymentRepo.setDefaultMethod(methodId, userId);
    if (!updated) throw new AppError("Payment method not found", HTTP_STATUS.NOT_FOUND);
    return updated;
  }
}

export const paymentService = new PaymentService();