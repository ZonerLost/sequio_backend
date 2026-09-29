import { Request, Response, NextFunction } from "express";
import { WebhookService } from "../services/webhook.service";
import { sendSuccess } from "../helpers/response.helper";
import { verifyStripeWebhook, StripeConnectAccount } from "../helpers/stripe.helper";
import { payoutService } from "../services/payout.service";
import { logger } from "../config/logger";

const webhookService = new WebhookService();

export class WebhookController {
  /**
   * Stripe events. The signature is checked against the exact bytes Stripe signed, so this needs
   * req.rawBody (captured in app.ts) — a re-serialised body produces a different hash and would fail.
   *
   * Unknown event types are acknowledged rather than rejected: Stripe retries a non-2xx, and there is
   * nothing to retry for an event this app does not act on.
   */
  async stripe(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      const event = verifyStripeWebhook<{ type: string; data: { object: StripeConnectAccount } }>(
        raw ?? JSON.stringify(req.body),
        req.headers["stripe-signature"] as string | undefined
      );

      if (event.type === "account.updated") {
        const applied = await payoutService.applyAccountUpdate(event.data.object);
        logger.info("Stripe account.updated processed", { accountId: event.data.object.id, applied });
      }

      sendSuccess(res, "Webhook received");
    } catch (err) {
      next(err);
    }
  }

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
