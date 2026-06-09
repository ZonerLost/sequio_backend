import { UserRepository } from "../repository/user.repository";
import { IUser } from "../types";
import { OtpRepository } from "../repository/otp.repository";
import { uploadToS3, deleteFromS3 } from "../helpers/s3.helper";
import { sendEmail, otpEmailTemplate } from "../helpers/email.helper";
import { generateOTP, getOTPExpiry } from "../helpers/otp.helper";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { ENV } from "../config/env";

const userRepo = new UserRepository();
const otpRepo = new OtpRepository();

export class UserService {
  async getProfile(userId: string) {
    const user = await userRepo.findById(userId);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return this.sanitizeEmail(user);
  }

  private sanitizeEmail(user: IUser) {
    const obj: Record<string, unknown> = (user as any).toObject();
    if (typeof obj.email === "string" && obj.email.endsWith("@placeholder.local")) obj.email = null;
    return obj;
  }

  async updateProfile(userId: string, data: Record<string, unknown>) {
    const update: Record<string, unknown> = {};

    // Handle email — only phone-auth users with a placeholder email can set a real one
    if (data.email) {
      const currentUser = await userRepo.findById(userId);
      if (!currentUser) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);

      const newEmail = (data.email as string).toLowerCase();

      if (!currentUser.email.endsWith("@placeholder.local")) {
        throw new AppError(
          "Email cannot be changed via profile update",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      const conflict = await userRepo.findByEmail(newEmail);
      if (conflict && conflict._id.toString() !== userId) {
        throw new AppError("Email already in use", HTTP_STATUS.CONFLICT);
      }

      update.email = newEmail;
      update.isEmailVerified = false;

      // Send verification OTP for the new email
      const otp = generateOTP();
      await otpRepo.create({
        userId: currentUser._id,
        email: newEmail,
        otp,
        type: "email_verification",
        expiresAt: getOTPExpiry(ENV.OTP_EXPIRES_IN_MINUTES),
      });

      console.log(`\n=============================`);
      console.log(`📧 Email link OTP for ${newEmail}: ${otp}`);
      console.log(`=============================\n`);

      if (ENV.NODE_ENV !== "development") {
        try {
          await sendEmail(
            newEmail,
            "Verify Your Email - Zip Rental",
            otpEmailTemplate(otp, currentUser.firstName)
          );
        } catch (err) {
          console.error(`Verification email failed for ${newEmail}:`, err);
        }
      }
    }

    for (const [key, value] of Object.entries(data)) {
      if (key === "email") continue; // already handled above
      if (key === "location" && value && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k === "coordinates" && v && typeof v === "object") {
            for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
              update[`location.coordinates.${ck}`] = cv;
            }
          } else {
            update[`location.${k}`] = v;
          }
        }
      } else {
        update[key] = value;
      }
    }

    const user = await userRepo.updateById(userId, update);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  async updateProfilePhoto(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string
  ) {
    const user = await userRepo.findById(userId);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    if (user.profilePhoto) {
      await deleteFromS3(user.profilePhoto).catch(() => {});
    }
    const photoUrl = await uploadToS3(fileBuffer, mimeType, "profile-photos");
    return userRepo.updateById(userId, { profilePhoto: photoUrl });
  }

  async uploadIdentityDocument(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string
  ) {
    const docUrl = await uploadToS3(fileBuffer, mimeType, "identity-docs");
    const user = await userRepo.updateById(userId, {
      identityDocument: docUrl,
    });
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return { message: "Identity document uploaded. Verification in progress." };
  }
}