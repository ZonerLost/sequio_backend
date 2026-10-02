import { Router } from "express";
import { PaymentController } from "../controllers/payment.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createPaymentIntentSchema,
  recordPaymentSchema,
  savePaymentMethodSchema,
  paymentQuerySchema,
} from "../validators/payment.validator";

const router = Router();
const ctrl = new PaymentController();

router.use(authenticate);

// Payment methods — MUST be before /:id to avoid conflict
router.post("/methods", validate(savePaymentMethodSchema), ctrl.savePaymentMethod.bind(ctrl));
router.get("/methods", ctrl.getMyPaymentMethods.bind(ctrl));
router.delete("/methods/:id", ctrl.deletePaymentMethod.bind(ctrl));
router.put("/methods/:id/default", ctrl.setDefaultPaymentMethod.bind(ctrl));

// Transactions
router.post("/create-intent", validate(createPaymentIntentSchema), ctrl.createPaymentIntent.bind(ctrl));
router.post("/", validate(recordPaymentSchema), ctrl.recordPayment.bind(ctrl));
router.get("/my", validate(paymentQuerySchema, "query"), ctrl.getMyTransactions.bind(ctrl));
router.get("/:id", ctrl.getPaymentById.bind(ctrl));

export default router;