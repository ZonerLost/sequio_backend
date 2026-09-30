import { Router } from "express";
import { DisputeController } from "../controllers/dispute.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { upload } from "../middleware/upload.middleware";
import {
  createDisputeSchema,
  resolveDisputeSchema,
  disputeQuerySchema,
  updateDisputeStatusSchema,
} from "../validators/dispute.validator";

const router = Router();
const ctrl = new DisputeController();

router.use(authenticate);

// ── User routes ──────────────────────────────────────────
router.post("/", validate(createDisputeSchema), ctrl.createDispute.bind(ctrl));
router.get("/my", validate(disputeQuerySchema, "query"), ctrl.getMyDisputes.bind(ctrl));
router.get("/:id", ctrl.getDisputeById.bind(ctrl));
router.post("/:id/evidence", upload.array("evidence", 5), ctrl.uploadEvidence.bind(ctrl));
router.put("/:id/cancel", ctrl.cancelDispute.bind(ctrl));

// ── Admin routes ─────────────────────────────────────────
router.get("/", authorize("admin"), validate(disputeQuerySchema, "query"), ctrl.getAllDisputes.bind(ctrl));
router.get("/admin/:id", authorize("admin"), ctrl.getDisputeByIdAdmin.bind(ctrl));
router.put("/admin/:id/resolve", authorize("admin"), validate(resolveDisputeSchema), ctrl.resolveDispute.bind(ctrl));
router.put(
  "/admin/:id/status",
  authorize("admin"),
  validate(updateDisputeStatusSchema),
  ctrl.updateDisputeStatus.bind(ctrl)
);

export default router;