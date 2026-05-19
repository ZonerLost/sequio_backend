import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import Joi from "joi";

const router = Router();
const ctrl = new AdminController();

const adminGuard = [authenticate, authorize("admin")];

const roleSchema = Joi.object({
  role: Joi.string().valid("user", "admin").required(),
});

const refundSchema = Joi.object({
  reason: Joi.string().max(500).optional(),
});

const featureSchema = Joi.object({
  featuredUntil: Joi.date().optional(),
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().optional(),
  status: Joi.string().optional(),
  role: Joi.string().optional(),
  category: Joi.string().optional(),
  isBanned: Joi.string().valid("true", "false").optional(),
  isActive: Joi.string().valid("true", "false").optional(),
});

// ── Stats ─────────────────────────────────────────────────
router.get("/stats", ...adminGuard, ctrl.getPlatformStats.bind(ctrl));

// ── Users ─────────────────────────────────────────────────
router.get("/users", ...adminGuard, validate(querySchema, "query"), ctrl.getUsers.bind(ctrl));
router.get("/users/:id", ...adminGuard, ctrl.getUserById.bind(ctrl));
router.get("/users/:id/identity-doc", ...adminGuard, ctrl.getIdentityDoc.bind(ctrl));
router.put("/users/:id/role", ...adminGuard, validate(roleSchema), ctrl.updateUserRole.bind(ctrl));
router.put("/users/:id/ban", ...adminGuard, ctrl.banUser.bind(ctrl));
router.put("/users/:id/unban", ...adminGuard, ctrl.unbanUser.bind(ctrl));
router.put("/users/:id/verify-identity", ...adminGuard, ctrl.verifyIdentity.bind(ctrl));
router.delete("/users/:id", ...adminGuard, ctrl.deleteUser.bind(ctrl));

// ── Items ─────────────────────────────────────────────────
router.get("/items", ...adminGuard, validate(querySchema, "query"), ctrl.getItems.bind(ctrl));
router.put("/items/:id/feature", ...adminGuard, validate(featureSchema), ctrl.featureItem.bind(ctrl));
router.put("/items/:id/deactivate", ...adminGuard, ctrl.deactivateItem.bind(ctrl));

// ── Bookings ──────────────────────────────────────────────
router.get("/bookings", ...adminGuard, validate(querySchema, "query"), ctrl.getBookings.bind(ctrl));
router.get("/bookings/:id", ...adminGuard, ctrl.getBookingById.bind(ctrl));

// ── Payments ──────────────────────────────────────────────
router.get("/payments", ...adminGuard, validate(querySchema, "query"), ctrl.getPayments.bind(ctrl));
router.put("/payments/:id/refund", ...adminGuard, validate(refundSchema), ctrl.refundPayment.bind(ctrl));

export default router;