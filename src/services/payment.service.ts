import { PaymentRepository } from "../repository/payment.repository";
import { BookingRepository } from "../repository/booking.repository";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { PaymentMethod } from "../models/payment.model";
import { buildPagination } from "../helpers/pagination.helper";
import { notificationService } from "../services/notification.service";
import mongoose from "mongoose";

const paymentRepo = new PaymentRepository();
const bookingRepo = new BookingRepository();

function getId(value: any): string {
  if (!value) return "";
  if (typeof value === "object" && value._id) return value._id.toString();
  return value.toString();
}

export class PaymentService {
  async recordPayment(
    payerId: string,
    data: {
      bookingId: string;
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

    // A saved method pins down what was actually paid with; `method` alone only records a category.
    let method = data.method;
    let savedMethodId: mongoose.Types.ObjectId | undefined;
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
      throw new AppError("Provide either method or paymentMethodId", HTTP_STATUS.BAD_REQUEST);
    }

    const existing = await paymentRepo.findCompletedByBooking(data.bookingId);
    if (existing) {
      throw new AppError("Payment already recorded for this booking", HTTP_STATUS.CONFLICT);
    }

    let payment;
    try {
      payment = await paymentRepo.create({
        booking: new mongoose.Types.ObjectId(data.bookingId),
        payer: new mongoose.Types.ObjectId(payerId),
        payee: new mongoose.Types.ObjectId(getId(booking.owner)),
        paymentMethod: savedMethodId,
        amount: booking.pricing.totalAmount,
        currency: "CAD",
        method,
        status: "completed",
        externalReference: data.externalReference,
      });
    } catch (err) {
      // Two requests can pass the check above at the same time; the unique partial index on
      // { booking, status: "completed" } is what actually stops the second row.
      if ((err as { code?: number }).code === 11000) {
        throw new AppError("Payment already recorded for this booking", HTTP_STATUS.CONFLICT);
      }
      throw err;
    }

    notificationService.send({
      userId: getId(booking.owner),
      type: "payment_received",
      title: "Payment Received",
      body: `You received $${booking.pricing.totalAmount} CAD for your rental`,
      data: { bookingId: data.bookingId, paymentId: payment._id.toString() },
    }).catch(() => {});

    // Return the same populated shape the GET endpoints return: one resource returning two different
    // shapes is what forces a client to parse `payer` as "string or object" everywhere.
    return (await paymentRepo.findById(payment._id.toString())) ?? payment;
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