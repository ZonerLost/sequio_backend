import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const authService = new AuthService();

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(req.body);
      sendCreated(res, "Registration successful. Please check your email for OTP.", result);
    } catch (err) { next(err); }
  }

  async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp } = req.body;
      const result = await authService.verifyEmail(email, otp);
      sendSuccess(res, result.message, result);
    } catch (err) { next(err); }
  }

  async resendVerification(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.resendVerification(req.body.email);
      sendSuccess(res, result.message);
    } catch (err) { next(err); }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      sendSuccess(res, "Login successful", result);
    } catch (err) { next(err); }
  }

  async googleLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { idToken, language } = req.body;
      const result = await authService.googleLogin(idToken, language);
      sendSuccess(res, "Google login successful", result);
    } catch (err) { next(err); }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.forgotPassword(req.body.email);
      sendSuccess(res, result.message);
    } catch (err) { next(err); }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp, newPassword } = req.body;
      const result = await authService.resetPassword(email, otp, newPassword);
      sendSuccess(res, result.message);
    } catch (err) { next(err); }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = (req as any).user.userId;
      const result = await authService.changePassword(userId, currentPassword, newPassword);
      sendSuccess(res, result.message);
    } catch (err) { next(err); }
  }

  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.refreshTokens(req.body.refreshToken);
      sendSuccess(res, "Tokens refreshed", result);
    } catch (err) { next(err); }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.logout(req.body.refreshToken);
      sendSuccess(res, result.message);
    } catch (err) { next(err); }
  }
}