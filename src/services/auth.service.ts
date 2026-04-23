import { UserRepository } from "../repository/user.repository";
import { OtpRepository } from "../repository/otp.repository";
import { RefreshTokenModel } from "../models/refreshToken.model";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../helpers/jwt.helper";
import { generateOTP, getOTPExpiry } from "../helpers/otp.helper";
import {
  sendEmail,
  otpEmailTemplate,
  resetPasswordEmailTemplate,
} from "../helpers/email.helper";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { ENV } from "../config/env";
import { OAuth2Client } from "google-auth-library";
import { IUser } from "../types";

const userRepo = new UserRepository();
const otpRepo = new OtpRepository();
const googleClient = new OAuth2Client(ENV.GOOGLE_CLIENT_ID);

export class AuthService {
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    language: string;
  }) {
    const emailExists = await userRepo.emailExists(data.email);
    if (emailExists)
      throw new AppError("Email already registered", HTTP_STATUS.CONFLICT);

    const user = await userRepo.create({
      email: data.email,
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
      language: (data.language as "en" | "fr") ?? "en",
      authProvider: "email",
    });
    await this.sendVerificationOTP(user);

    return {
      message: "Registration successful. Please verify your email.",
      userId: user._id,
    };
  }

  async sendVerificationOTP(user: IUser) {
    const otp = generateOTP();
    await otpRepo.create({
      userId: user._id,
      email: user.email,
      otp,
      type: "email_verification",
      expiresAt: getOTPExpiry(ENV.OTP_EXPIRES_IN_MINUTES),
    });

    console.log(`\n=============================`);
    console.log(`📧 OTP for ${user.email}: ${otp}`);
    console.log(`=============================\n`);

    if (ENV.NODE_ENV === "development") return;

    try {
      await sendEmail(
        user.email,
        "Verify Your Email - Larissa",
        otpEmailTemplate(otp, user.firstName)
      );
    } catch (emailError) {
      console.error(`Email sending failed for ${user.email}:`, emailError);
    }
  }

  async verifyEmail(email: string, otp: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    if (user.isEmailVerified)
      throw new AppError("Email already verified", HTTP_STATUS.BAD_REQUEST);

    const otpRecord = await otpRepo.findValid(
      user._id.toString(),
      otp,
      "email_verification"
    );
    if (!otpRecord)
      throw new AppError("Invalid or expired OTP", HTTP_STATUS.BAD_REQUEST);

    await otpRepo.markUsed(otpRecord._id.toString());
    await userRepo.updateById(user._id.toString(), { isEmailVerified: true });

    // Re-fetch user to get updated data
    const updatedUser = await userRepo.findById(user._id.toString());
    if (!updatedUser) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);

    const tokens = await this.generateAndSaveTokens(updatedUser);
    return {
      message: "Email verified successfully",
      ...tokens,
      user: this.sanitizeUser(updatedUser),
    };
  }

  async login(email: string, password: string) {
    const user = await userRepo.findByEmail(email, true);
    if (!user)
      throw new AppError("Invalid email or password", HTTP_STATUS.UNAUTHORIZED);
    if (!user.isEmailVerified)
      throw new AppError(
        "Please verify your email first",
        HTTP_STATUS.UNAUTHORIZED
      );
    if (user.isBanned)
      throw new AppError(
        "Your account has been suspended",
        HTTP_STATUS.FORBIDDEN
      );
    if (user.authProvider !== "email")
      throw new AppError(
        `Please login with ${user.authProvider}`,
        HTTP_STATUS.BAD_REQUEST
      );

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid)
      throw new AppError("Invalid email or password", HTTP_STATUS.UNAUTHORIZED);

    await userRepo.updateById(user._id.toString(), { lastLoginAt: new Date() });
    const tokens = await this.generateAndSaveTokens(user);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async googleLogin(idToken: string, language: string = "en") {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: ENV.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email)
      throw new AppError("Invalid Google token", HTTP_STATUS.UNAUTHORIZED);

    let user = await userRepo.findByGoogleId(payload.sub);
    if (!user) user = await userRepo.findByEmail(payload.email);

    if (!user) {
      user = await userRepo.create({
        email: payload.email,
        firstName: payload.given_name || "User",
        lastName: payload.family_name || "",
        profilePhoto: payload.picture,
        googleId: payload.sub,
        authProvider: "google",
        isEmailVerified: true,
        language: language as "en" | "fr",
      });
    } else if (!user.googleId) {
      await userRepo.updateById(user._id.toString(), {
        googleId: payload.sub,
        isEmailVerified: true,
      });
    }

    if (user.isBanned)
      throw new AppError(
        "Your account has been suspended",
        HTTP_STATUS.FORBIDDEN
      );

    await userRepo.updateById(user._id.toString(), { lastLoginAt: new Date() });
    const tokens = await this.generateAndSaveTokens(user);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async forgotPassword(email: string) {
    const user = await userRepo.findByEmail(email);
    if (!user)
      return { message: "If this email exists, a reset code has been sent" };

    const otp = generateOTP();
    await otpRepo.create({
      userId: user._id,
      email: user.email,
      otp,
      type: "password_reset",
      expiresAt: getOTPExpiry(ENV.OTP_EXPIRES_IN_MINUTES),
    });

    console.log(`\n=============================`);
    console.log(`🔑 Password Reset OTP for ${email}: ${otp}`);
    console.log(`=============================\n`);

    if (ENV.NODE_ENV !== "development") {
      try {
        await sendEmail(
          email,
          "Password Reset Code - Larissa",
          resetPasswordEmailTemplate(otp, user.firstName)
        );
      } catch (emailError) {
        console.error(`Password reset email failed for ${email}:`, emailError);
      }
    }

    return { message: "If this email exists, a reset code has been sent" };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);

    const otpRecord = await otpRepo.findValid(
      user._id.toString(),
      otp,
      "password_reset"
    );
    if (!otpRecord)
      throw new AppError("Invalid or expired OTP", HTTP_STATUS.BAD_REQUEST);

    await otpRepo.markUsed(otpRecord._id.toString());
    await userRepo.updateById(user._id.toString(), { password: newPassword });
    await RefreshTokenModel.updateMany(
      { userId: user._id },
      { isRevoked: true }
    );
    return { message: "Password reset successfully. Please login again." };
  }

  async refreshTokens(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    const tokenRecord = await RefreshTokenModel.findOne({
      token: refreshToken,
      isRevoked: false,
    });
    if (!tokenRecord)
      throw new AppError("Invalid refresh token", HTTP_STATUS.UNAUTHORIZED);

    const user = await userRepo.findById(payload.userId);
    if (!user || !user.isActive)
      throw new AppError("User not found", HTTP_STATUS.UNAUTHORIZED);

    await RefreshTokenModel.findByIdAndUpdate(tokenRecord._id, {
      isRevoked: true,
    });
    return this.generateAndSaveTokens(user);
  }

  async logout(refreshToken: string) {
    await RefreshTokenModel.findOneAndUpdate(
      { token: refreshToken },
      { isRevoked: true }
    );
    return { message: "Logged out successfully" };
  }

  async resendVerification(email: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    if (user.isEmailVerified)
      throw new AppError("Email already verified", HTTP_STATUS.BAD_REQUEST);
    await this.sendVerificationOTP(user);
    return { message: "Verification OTP resent successfully" };
  }

  private async generateAndSaveTokens(user: IUser) {
    const payload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await RefreshTokenModel.create({
      userId: user._id,
      token: refreshToken,
      expiresAt,
    });
    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: IUser) {
    return {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePhoto: user.profilePhoto,
      isEmailVerified: user.isEmailVerified,
      isIdentityVerified: user.isIdentityVerified,
      language: user.language,
      role: user.role,
    };
  }
}