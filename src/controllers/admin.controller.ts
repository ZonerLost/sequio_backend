import { Request, Response, NextFunction } from "express";
import { AdminService } from "../services/admin.service";
import { OwnerCancellationService } from "../services/owner-cancellation.service";
import { CatalogService } from "../services/catalog.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const adminService = new AdminService();
const ownerCancellationService = new OwnerCancellationService();
const catalogService = new CatalogService();

/** Joi coerces "true"/"false" on a query string; anything else means the filter was not sent. */
const asBool = (v: unknown): boolean | undefined =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;

export class AdminController {
  // ── Users ─────────────────────────────────────────────────

  // ── The rental catalogue ──────────────────────────────────
  // The admin dictionary: the half of the Smart Rental Catalog that lets the client add a synonym,
  // rename a category or prohibit an item type **without releasing a new app version**.

  async getCatalogTree(_req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, "Catalog retrieved", {
        tree: await catalogService.tree(),
        aliasKinds: catalogService.aliasKinds(),
      });
    } catch (err) { next(err); }
  }

  async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const node = await catalogService.createNode("category", req.body);
      sendCreated(res, "Category created", node);
    } catch (err) { next(err); }
  }

  async updateCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await catalogService.updateNode("category", String(req.params.slug), req.body);
      sendSuccess(res, "Category updated", result);
    } catch (err) { next(err); }
  }

  async createSubcategory(req: Request, res: Response, next: NextFunction) {
    try {
      const node = await catalogService.createNode("subcategory", req.body);
      sendCreated(res, "Subcategory created", node);
    } catch (err) { next(err); }
  }

  async updateSubcategory(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await catalogService.updateNode("subcategory", String(req.params.slug), req.body);
      sendSuccess(res, "Subcategory updated", result);
    } catch (err) { next(err); }
  }

  async createItemType(req: Request, res: Response, next: NextFunction) {
    try {
      const node = await catalogService.createNode("itemType", req.body);
      sendCreated(res, "Item type created", node);
    } catch (err) { next(err); }
  }

  async updateItemType(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await catalogService.updateNode("itemType", String(req.params.slug), req.body);
      sendSuccess(res, "Item type updated", result);
    } catch (err) { next(err); }
  }

  async listAliases(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await catalogService.listAliases({
        search: req.query.search ? String(req.query.search) : undefined,
        itemType: req.query.itemType ? String(req.query.itemType) : undefined,
        kind: req.query.kind ? String(req.query.kind) : undefined,
        approved: asBool(req.query.approved),
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      sendSuccess(res, "Aliases retrieved", result.aliases, 200, {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
        hasNext: result.page * result.limit < result.total,
        hasPrev: result.page > 1,
      });
    } catch (err) { next(err); }
  }

  async createAlias(req: Request, res: Response, next: NextFunction) {
    try {
      const alias = await catalogService.createAlias({
        ...req.body,
        addedBy: req.user?.userId,
      });
      sendCreated(res, "Alias added — live on the next request, with no app release", alias);
    } catch (err) { next(err); }
  }

  async updateAlias(req: Request, res: Response, next: NextFunction) {
    try {
      const alias = await catalogService.updateAlias(String(req.params.id), req.body);
      sendSuccess(res, "Alias updated", alias);
    } catch (err) { next(err); }
  }

  async deleteAlias(req: Request, res: Response, next: NextFunction) {
    try {
      const removed = await catalogService.deleteAlias(String(req.params.id));
      sendSuccess(res, "Alias removed", removed);
    } catch (err) { next(err); }
  }

  async listClassificationFeedback(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await catalogService.listFeedback({
        corrected: asBool(req.query.corrected),
        reviewed: asBool(req.query.reviewed),
        unmatchedOnly: asBool(req.query.unmatchedOnly),
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      sendSuccess(
        res,
        "Classification feedback retrieved",
        { feedback: result.feedback, repeatedTerms: result.repeatedTerms },
        200,
        {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
          hasNext: result.page * result.limit < result.total,
          hasPrev: result.page > 1,
        }
      );
    } catch (err) { next(err); }
  }

  async reviewClassificationFeedback(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await catalogService.reviewFeedback(String(req.params.id), {
        addAlias: req.body.addAlias,
        adminId: req.user?.userId,
      });
      sendSuccess(res, "Feedback reviewed", result);
    } catch (err) { next(err); }
  }

  // ── Users ─────────────────────────────────────────────────

  async getUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, search, role, isBanned } = req.query;
      const result = await adminService.getUsers({
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        search: search as string,
        role: role as string,
        isBanned: isBanned === "true" ? true : isBanned === "false" ? false : undefined,
      });
      sendSuccess(res, "Users retrieved", result.users, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminService.getUserById(String(req.params.id));
      sendSuccess(res, "User retrieved", user);
    } catch (err) { next(err); }
  }

  async updateUserRole(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminService.updateUserRole(
        String(req.params.id),
        req.body.role,
        String(req.user?.userId ?? "")
      );
      sendSuccess(res, "User role updated", user);
    } catch (err) { next(err); }
  }

  async getDisputeMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.getDisputeMessages(String(req.params.id), {
        limit: Number(req.query.limit) || 100,
      });
      sendSuccess(res, "Dispute messages retrieved", result);
    } catch (err) { next(err); }
  }

  async getNotificationSettings(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.getNotificationSettings();
      sendSuccess(res, "Notification settings retrieved", result);
    } catch (err) { next(err); }
  }

  async saveNotificationSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.saveNotificationSettings(
        { enabled: req.body.enabled, mutedTypes: req.body.mutedTypes },
        String(req.user?.userId ?? "")
      );
      sendSuccess(res, "Notification settings saved", result);
    } catch (err) { next(err); }
  }

  async listNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await adminService.listNotifications({
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 10,
        type: req.query.type ? String(req.query.type) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
      });
      sendSuccess(res, "Notifications retrieved", rows, 200, pagination);
    } catch (err) { next(err); }
  }

  async getBookingSeries(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.getBookingSeries({
        start: req.query.start ? new Date(String(req.query.start)) : undefined,
        end: req.query.end ? new Date(String(req.query.end)) : undefined,
      });
      sendSuccess(res, "Booking series retrieved", result);
    } catch (err) { next(err); }
  }

  async cancelBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.cancelBooking(
        String(req.params.id),
        String(req.body.reason ?? ""),
        String(req.user?.userId ?? "")
      );
      sendSuccess(res, "Booking cancelled", result);
    } catch (err) { next(err); }
  }

  async updateUserProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminService.updateUserProfile(String(req.params.id), {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        phone: req.body.phone,
      });
      sendSuccess(res, "User updated", user);
    } catch (err) { next(err); }
  }

  async banUser(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminService.banUser(String(req.params.id));
      sendSuccess(res, "User banned", user);
    } catch (err) { next(err); }
  }

  async unbanUser(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminService.unbanUser(String(req.params.id));
      sendSuccess(res, "User unbanned", user);
    } catch (err) { next(err); }
  }

  async getIdentityDoc(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.getIdentityDoc(String(req.params.id));
      sendSuccess(res, "Identity document URL generated", result);
    } catch (err) { next(err); }
  }

  async verifyIdentity(req: Request, res: Response, next: NextFunction) {
    try {
      const { action } = req.body;
      if (!["approve", "reject"].includes(action)) {
        res.status(400).json({ success: false, message: "action must be approve or reject" });
        return;
      }
      const user = await adminService.verifyIdentity(String(req.params.id), action);
      sendSuccess(res, `Identity ${action === "approve" ? "approved" : "rejected"}`, user);
    } catch (err) { next(err); }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      await adminService.deleteUser(String(req.params.id));
      sendSuccess(res, "User deactivated");
    } catch (err) { next(err); }
  }

  // ── Items ─────────────────────────────────────────────────

  async getItems(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, search, category, isActive } = req.query;
      const result = await adminService.getItems({
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        search: search as string,
        category: category as string,
        isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
      });
      sendSuccess(res, "Items retrieved", result.items, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async featureItem(req: Request, res: Response, next: NextFunction) {
    try {
      const featuredUntil = req.body.featuredUntil
        ? new Date(req.body.featuredUntil)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days default
      const item = await adminService.featureItem(String(req.params.id), featuredUntil);
      sendSuccess(res, "Item featured", item);
    } catch (err) { next(err); }
  }

  async deactivateItem(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await adminService.deactivateItem(String(req.params.id));
      sendSuccess(res, "Item deactivated", item);
    } catch (err) { next(err); }
  }

  // ── Bookings ──────────────────────────────────────────────

  async getBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, status } = req.query;
      const result = await adminService.getBookings({
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        status: status as string,
      });
      sendSuccess(res, "Bookings retrieved", result.bookings, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getBookingById(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await adminService.getBookingById(String(req.params.id));
      sendSuccess(res, "Booking retrieved", booking);
    } catch (err) { next(err); }
  }

  // ── Payments ──────────────────────────────────────────────

  async getPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, status } = req.query;
      const result = await adminService.getPayments({
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        status: status as string,
      });
      sendSuccess(res, "Payments retrieved", result.payments, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async listOwnerCancellations(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ownerCancellationService.list({
        ownerId: req.query.ownerId ? String(req.query.ownerId) : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      });
      sendSuccess(res, "Owner cancellations retrieved", result.cancellations, 200, {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
        hasNext: result.page * result.limit < result.total,
        hasPrev: result.page > 1,
      });
    } catch (err) { next(err); }
  }

  async reviewOwnerCancellation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ownerCancellationService.review(
        String(req.params.id),
        req.user!.userId,
        Boolean(req.body.excused),
        String(req.body.note)
      );
      sendSuccess(
        res,
        req.body.excused ? "Cancellation excused" : "Strike reinstated",
        result
      );
    } catch (err) { next(err); }
  }

  async liftOwnerSuspension(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await ownerCancellationService.liftSuspension(String(req.params.id));
      sendSuccess(res, "Suspension lifted", user);
    } catch (err) { next(err); }
  }

  async refundPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const payment = await adminService.refundPayment(
        String(req.params.id),
        req.body.reason ?? "Admin initiated refund"
      );
      sendSuccess(res, "Payment refunded", payment);
    } catch (err) { next(err); }
  }

  // ── Stats ─────────────────────────────────────────────────

  async getPlatformStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { start, end } = req.query as unknown as { start?: Date; end?: Date };
      const stats = await adminService.getPlatformStats({ start, end });
      sendSuccess(res, "Platform stats retrieved", stats);
    } catch (err) { next(err); }
  }
}