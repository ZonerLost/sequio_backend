import { Request, Response, NextFunction } from "express";
import { UserService } from "../services/user.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";
import { ReportReason } from "../models/user-report.model";

const userService = new UserService();

export class UserController {
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.getProfile(req.user!.userId);
      sendSuccess(res, "Profile retrieved", user);
    } catch (err) { next(err); }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.updateProfile(req.user!.userId, req.body);
      sendSuccess(res, "Profile updated", user);
    } catch (err) { next(err); }
  }

  async updateProfilePhoto(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: "No file uploaded" });
        return;
      }
      const user = await userService.updateProfilePhoto(
        req.user!.userId,
        req.file.buffer,
        req.file.mimetype
      );
      sendSuccess(res, "Profile photo updated", user);
    } catch (err) { next(err); }
  }

  async uploadIdentityDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: "No file uploaded" });
        return;
      }
      const result = await userService.uploadIdentityDocument(
        req.user!.userId,
        req.file.buffer,
        req.file.mimetype
      );
      sendSuccess(res, result.message);
    } catch (err) { next(err); }
  }

  async blockUser(req: Request, res: Response, next: NextFunction) {
    try {
      await userService.blockUser(req.user!.userId, String(req.params.userId));
      sendSuccess(res, "User blocked");
    } catch (err) { next(err); }
  }

  async unblockUser(req: Request, res: Response, next: NextFunction) {
    try {
      await userService.unblockUser(req.user!.userId, String(req.params.userId));
      sendSuccess(res, "User unblocked");
    } catch (err) { next(err); }
  }

  async getBlockedUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const blocked = await userService.getBlockedUsers(req.user!.userId);
      sendSuccess(res, "Blocked users retrieved", blocked);
    } catch (err) { next(err); }
  }

  async reportUser(req: Request, res: Response, next: NextFunction) {
    try {
      const report = await userService.reportUser(req.user!.userId, String(req.params.userId), {
        reason: req.body.reason as ReportReason,
        description: req.body.description,
        conversationId: req.body.conversationId,
      });
      sendCreated(res, "Report submitted", report);
    } catch (err) { next(err); }
  }
}
