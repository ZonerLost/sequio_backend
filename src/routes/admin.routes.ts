import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import Joi from "joi";

const router = Router();
const ctrl = new AdminController();

const adminGuard = [authenticate, authorize("admin")];

const notificationSettingsSchema = Joi.object({
  enabled: Joi.boolean().optional(),
  // Validated against the real type list in the service, so an unknown type is a 400 rather than a
  // silently stored value that mutes nothing.
  mutedTypes: Joi.array().items(Joi.string()).optional(),
}).or("enabled", "mutedTypes");

const notificationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  type: Joi.string().optional(),
  search: Joi.string().allow("").optional(),
});

const cancelBookingSchema = Joi.object({
  // Required, and shown to both parties, so it has to be something a person can read.
  reason: Joi.string().trim().min(3).max(500).required(),
});

const roleSchema = Joi.object({
  role: Joi.string().valid("user", "admin").required(),
});

const refundSchema = Joi.object({
  reason: Joi.string().max(500).optional(),
});

const featureSchema = Joi.object({
  featuredUntil: Joi.date().optional(),
});

const statsQuerySchema = Joi.object({
  start: Joi.date().optional(),
  end: Joi.date().optional(),
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
router.get("/stats", ...adminGuard, validate(statsQuerySchema, "query"), ctrl.getPlatformStats.bind(ctrl));

// ── Notifications ─────────────────────────────────────────
// "settings" before ":id"-style routes is not an issue here (there is no /notifications/:id), but
// the order is kept deliberate in case one is added.
router.get("/notifications/settings", ...adminGuard, ctrl.getNotificationSettings.bind(ctrl));
router.put("/notifications/settings", ...adminGuard, validate(notificationSettingsSchema), ctrl.saveNotificationSettings.bind(ctrl));
router.get("/notifications", ...adminGuard, validate(notificationQuerySchema, "query"), ctrl.listNotifications.bind(ctrl));

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
// Before /bookings/:id, or "series" is read as an id.
router.get("/bookings/series", ...adminGuard, validate(statsQuerySchema, "query"), ctrl.getBookingSeries.bind(ctrl));
router.get("/bookings/:id", ...adminGuard, ctrl.getBookingById.bind(ctrl));
router.put("/bookings/:id/cancel", ...adminGuard, validate(cancelBookingSchema), ctrl.cancelBooking.bind(ctrl));

// ── Payments ──────────────────────────────────────────────
router.get("/payments", ...adminGuard, validate(querySchema, "query"), ctrl.getPayments.bind(ctrl));
router.put("/payments/:id/refund", ...adminGuard, validate(refundSchema), ctrl.refundPayment.bind(ctrl));

export default router;