import { Request, Response, NextFunction } from "express";
import { AdminService } from "../services/admin.service";
import { sendSuccess } from "../helpers/response.helper";

const adminService = new AdminService();

export class AdminController {
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
        req.body.role
      );
      sendSuccess(res, "User role updated", user);
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

  async getPlatformStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await adminService.getPlatformStats();
      sendSuccess(res, "Platform stats retrieved", stats);
    } catch (err) { next(err); }
  }
}