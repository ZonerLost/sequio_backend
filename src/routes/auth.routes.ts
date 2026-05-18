import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { validate } from "../middleware/validate.middleware";
import { authenticate } from "../middleware/auth.middleware";
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from "../validators/auth.validator";

const router = Router();
const ctrl = new AuthController();

router.post("/register", validate(registerSchema), ctrl.register.bind(ctrl));
router.post("/verify-email", validate(verifyOtpSchema), ctrl.verifyEmail.bind(ctrl));
router.post("/resend-verification", validate(forgotPasswordSchema), ctrl.resendVerification.bind(ctrl));
router.post("/login", validate(loginSchema), ctrl.login.bind(ctrl));
router.post("/google", validate(googleAuthSchema), ctrl.googleLogin.bind(ctrl));
router.post("/forgot-password", validate(forgotPasswordSchema), ctrl.forgotPassword.bind(ctrl));
router.post("/reset-password", validate(resetPasswordSchema), ctrl.resetPassword.bind(ctrl));
router.post("/refresh-token", validate(refreshTokenSchema), ctrl.refreshToken.bind(ctrl));
router.post("/change-password", authenticate, validate(changePasswordSchema), ctrl.changePassword.bind(ctrl));
router.post("/logout", authenticate, ctrl.logout.bind(ctrl));

export default router;