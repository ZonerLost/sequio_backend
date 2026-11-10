import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import Joi from "joi";
import { reviewCancellationSchema } from "../validators/booking.validator";
import { taxRegistrationReviewSchema } from "../validators/compliance.validator";
import {
  createCategorySchema,
  updateCategorySchema,
  createSubcategorySchema,
  updateSubcategorySchema,
  createItemTypeSchema,
  updateItemTypeSchema,
  createAliasSchema,
  updateAliasSchema,
  aliasQuerySchema,
  feedbackQuerySchema,
  reviewFeedbackSchema,
} from "../validators/catalog.validator";

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

const userProfileSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(60).optional(),
  lastName: Joi.string().trim().min(1).max(60).optional(),
  phone: Joi.string().trim().allow("").max(32).optional(),
  // Email is not accepted on purpose — see updateUserProfile. stripUnknown means a client sending
  // one gets a clear "nothing to update" rather than a silent partial save.
}).or("firstName", "lastName", "phone");

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

// ── Disputes ──────────────────────────────────────────────
router.get("/disputes/:id/messages", ...adminGuard, ctrl.getDisputeMessages.bind(ctrl));

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
router.put("/users/:id", ...adminGuard, validate(userProfileSchema), ctrl.updateUserProfile.bind(ctrl));
router.put("/users/:id/role", ...adminGuard, validate(roleSchema), ctrl.updateUserRole.bind(ctrl));
router.put("/users/:id/ban", ...adminGuard, ctrl.banUser.bind(ctrl));
router.put("/users/:id/unban", ...adminGuard, ctrl.unbanUser.bind(ctrl));
router.put("/users/:id/verify-identity", ...adminGuard, ctrl.verifyIdentity.bind(ctrl));
/**
 * Confirming an owner's GST/QST registration. A human step: the format is checked in code, but only
 * the CRA and Revenu Québec can confirm a number exists, and neither offers an API.
 */
router.put(
  "/users/:id/tax-registration",
  ...adminGuard,
  validate(taxRegistrationReviewSchema),
  ctrl.reviewTaxRegistration.bind(ctrl)
);
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

// ── Owner cancellations ───────────────────────────────────
// Every owner cancellation counts as a strike by default and is excused by a human, because the
// specification says administrators "reverse" warnings — you can only reverse what already
// happened. See owner-cancellation.model.ts.
router.get("/owner-cancellations", ...adminGuard, ctrl.listOwnerCancellations.bind(ctrl));
router.put(
  "/owner-cancellations/:id/review",
  ...adminGuard,
  validate(reviewCancellationSchema),
  ctrl.reviewOwnerCancellation.bind(ctrl)
);
/**
 * Refund requests — read-only. A declined request has no escalation path in the specification, so
 * there is deliberately no admin decision route; `/payments/:id/refund` is the override.
 */
router.get("/refund-requests", ...adminGuard, ctrl.listRefundRequests.bind(ctrl));

/** The appeal outcome: lifts the suspension without touching the strikes behind it. */
router.put("/users/:id/lift-suspension", ...adminGuard, ctrl.liftOwnerSuspension.bind(ctrl));

// ── The rental catalogue ──────────────────────────────────
// The admin dictionary. Everything here takes effect on the next request, which is the whole
// requirement: the client adds a synonym or prohibits an item type **without an app release**.
//
// There is deliberately **no DELETE for a category, subcategory or item type.** Listings reference
// slugs, so a delete orphans them permanently. Retiring a node is `active: false`; replacing one is
// `mergedInto`, which moves its listings onto the survivor. An **alias** may be deleted, because
// nothing references it and a bad synonym that cannot be removed makes the dictionary too risky to
// add to.
router.get("/catalog", ...adminGuard, ctrl.getCatalogTree.bind(ctrl));

router.post("/catalog/categories", ...adminGuard, validate(createCategorySchema), ctrl.createCategory.bind(ctrl));
router.put("/catalog/categories/:slug", ...adminGuard, validate(updateCategorySchema), ctrl.updateCategory.bind(ctrl));

router.post("/catalog/subcategories", ...adminGuard, validate(createSubcategorySchema), ctrl.createSubcategory.bind(ctrl));
router.put("/catalog/subcategories/:slug", ...adminGuard, validate(updateSubcategorySchema), ctrl.updateSubcategory.bind(ctrl));

router.post("/catalog/item-types", ...adminGuard, validate(createItemTypeSchema), ctrl.createItemType.bind(ctrl));
router.put("/catalog/item-types/:slug", ...adminGuard, validate(updateItemTypeSchema), ctrl.updateItemType.bind(ctrl));

// Before /catalog/aliases/:id, or "search" would be read as an id (DO-NOT #1).
router.get("/catalog/aliases", ...adminGuard, validate(aliasQuerySchema, "query"), ctrl.listAliases.bind(ctrl));
router.post("/catalog/aliases", ...adminGuard, validate(createAliasSchema), ctrl.createAlias.bind(ctrl));
router.put("/catalog/aliases/:id", ...adminGuard, validate(updateAliasSchema), ctrl.updateAlias.bind(ctrl));
router.delete("/catalog/aliases/:id", ...adminGuard, ctrl.deleteAlias.bind(ctrl));

/** The review queue: what the classifier got wrong, and the terms it had no answer for. */
router.get("/catalog/feedback", ...adminGuard, validate(feedbackQuerySchema, "query"), ctrl.listClassificationFeedback.bind(ctrl));
router.put("/catalog/feedback/:id/review", ...adminGuard, validate(reviewFeedbackSchema), ctrl.reviewClassificationFeedback.bind(ctrl));

// ── Payments ──────────────────────────────────────────────
router.get("/payments", ...adminGuard, validate(querySchema, "query"), ctrl.getPayments.bind(ctrl));
router.put("/payments/:id/refund", ...adminGuard, validate(refundSchema), ctrl.refundPayment.bind(ctrl));

export default router;