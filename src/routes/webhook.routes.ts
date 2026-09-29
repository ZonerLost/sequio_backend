import { Router } from "express";
import { WebhookController } from "../controllers/webhook.controller";

const router = Router();
const ctrl = new WebhookController();

// RevenueCat calls this after every purchase — no JWT auth, verified by shared secret
router.post("/revenuecat", ctrl.revenueCat.bind(ctrl));

// Stripe Connect account updates — no JWT auth, verified by HMAC over the raw body
router.post("/stripe", ctrl.stripe.bind(ctrl));

export default router;
