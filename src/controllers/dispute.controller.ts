import { Request, Response, NextFunction } from "express";
import { DisputeService } from "../services/dispute.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const disputeService = new DisputeService();

export class DisputeController {
  // ── User endpoints ──────────────────────────────────────

  async createDispute(req: Request, res: Response, next: NextFunction) {
    try {
      const dispute = await disputeService.createDispute(req.user!.userId, req.body);
      sendCreated(res, "Dispute submitted successfully", dispute);
    } catch (err) { next(err); }
  }

  async getMyDisputes(req: Request, res: Response, next: NextFunction) {
    try {
      // status was validated and then silently dropped here, so every filter tab showed the
      // same unfiltered list.
      const { status, role, page, limit } = req.query;
      const result = await disputeService.getMyDisputes(req.user!.userId, {
        status: status as string | undefined,
        role: (role as "reporter" | "against" | "all") || "all",
        page: Number(page) || 1,
        limit: Number(limit) || 10,
      });
      sendSuccess(res, "Disputes retrieved", result.disputes, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getDisputeById(req: Request, res: Response, next: NextFunction) {
    try {
      const dispute = await disputeService.getDisputeById(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Dispute retrieved", dispute);
    } catch (err) { next(err); }
  }

  async uploadEvidence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ success: false, message: "No files uploaded" });
        return;
      }
      const dispute = await disputeService.uploadEvidence(
        String(req.params.id),
        req.user!.userId,
        req.files
      );
      sendSuccess(res, "Evidence uploaded", dispute);
    } catch (err) { next(err); }
  }

  async cancelDispute(req: Request, res: Response, next: NextFunction) {
    try {
      const dispute = await disputeService.cancelDispute(
        String(req.params.id),
        req.user!.userId
      );
      sendSuccess(res, "Dispute cancelled", dispute);
    } catch (err) { next(err); }
  }

  // ── Admin endpoints ─────────────────────────────────────

  async getAllDisputes(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, page, limit } = req.query;
      const result = await disputeService.getAllDisputes(
        status as string,
        Number(page) || 1,
        Number(limit) || 10
      );
      sendSuccess(res, "Disputes retrieved", result.disputes, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async getDisputeByIdAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const dispute = await disputeService.getDisputeByIdAdmin(String(req.params.id));
      sendSuccess(res, "Dispute retrieved", dispute);
    } catch (err) { next(err); }
  }

  async resolveDispute(req: Request, res: Response, next: NextFunction) {
    try {
      const dispute = await disputeService.resolveDispute(
        String(req.params.id),
        req.user!.userId,
        req.body
      );
      sendSuccess(res, "Dispute resolved", dispute);
    } catch (err) { next(err); }
  }

  async updateDisputeStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const dispute = await disputeService.updateDisputeStatus(
        String(req.params.id),
        req.body.status
      );
      sendSuccess(res, "Dispute status updated", dispute);
    } catch (err) { next(err); }
  }
}