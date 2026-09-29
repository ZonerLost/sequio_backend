import { Request, Response, NextFunction } from "express";
import { payoutService } from "../services/payout.service";
import { sendSuccess } from "../helpers/response.helper";

export class PayoutController {
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await payoutService.getStatus(req.user!.userId);
      sendSuccess(res, "Payout account status retrieved", status);
    } catch (err) { next(err); }
  }

  async createOnboardingLink(req: Request, res: Response, next: NextFunction) {
    try {
      const link = await payoutService.createOnboardingLink(req.user!.userId);
      sendSuccess(res, "Onboarding link created", link);
    } catch (err) { next(err); }
  }
}
