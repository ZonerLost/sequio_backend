import { Request, Response, NextFunction } from "express";
import { WebhookService } from "../services/webhook.service";
import { sendSuccess } from "../helpers/response.helper";

const webhookService = new WebhookService();

export class WebhookController {
  async revenueCat(req: Request, res: Response, next: NextFunction) {
    try {
      webhookService.verifyRevenueCatSignature(req.headers.authorization);
      await webhookService.handleRevenueCatEvent(req.body);
      sendSuccess(res, "Webhook received");
    } catch (err) {
      next(err);
    }
  }
}
