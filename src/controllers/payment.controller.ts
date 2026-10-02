import { Request, Response, NextFunction } from "express";
import { PaymentService } from "../services/payment.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const paymentService = new PaymentService();

export class PaymentController {
  async createPaymentIntent(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await paymentService.createPaymentIntent(
        req.user!.userId,
        req.body.bookingId
      );
      sendCreated(res, "Payment intent created successfully", result);
    } catch (err) { next(err); }
  }

  async recordPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const payment = await paymentService.recordPayment(req.user!.userId, req.body);
      sendCreated(res, "Payment recorded successfully", payment);
    } catch (err) { next(err); }
  }

  async getMyTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, role } = req.query;
      const result = await paymentService.getMyTransactions(
        req.user!.userId,
        Number(page) || 1,
        Number(limit) || 10,
        (role as "payer" | "payee" | "all") || "payer"
      );
      sendSuccess(res, "Transactions retrieved", result.payments, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getPaymentById(req: Request, res: Response, next: NextFunction) {
    try {
      const payment = await paymentService.getPaymentById(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Payment retrieved", payment);
    } catch (err) { next(err); }
  }

  async savePaymentMethod(req: Request, res: Response, next: NextFunction) {
    try {
      const method = await paymentService.savePaymentMethod(req.user!.userId, req.body);
      sendCreated(res, "Payment method saved", method);
    } catch (err) { next(err); }
  }

  async getMyPaymentMethods(req: Request, res: Response, next: NextFunction) {
    try {
      const methods = await paymentService.getMyPaymentMethods(req.user!.userId);
      sendSuccess(res, "Payment methods retrieved", methods);
    } catch (err) { next(err); }
  }

  async deletePaymentMethod(req: Request, res: Response, next: NextFunction) {
    try {
      const remaining = await paymentService.deletePaymentMethod(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Payment method removed", remaining);
    } catch (err) { next(err); }
  }

  async setDefaultPaymentMethod(req: Request, res: Response, next: NextFunction) {
    try {
      const method = await paymentService.setDefaultPaymentMethod(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Default payment method updated", method);
    } catch (err) { next(err); }
  }
}