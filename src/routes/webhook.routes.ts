import { Router } from "express";
import { WebhookController } from "../controllers/webhook.controller";

const router = Router();
const ctrl = new WebhookController();

// RevenueCat calls this after every purchase — no JWT auth, verified by shared secret
router.post("/revenuecat", ctrl.revenueCat.bind(ctrl));

export default router;
