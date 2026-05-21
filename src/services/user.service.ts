import { UserRepository } from "../repository/user.repository";
import { uploadToS3, deleteFromS3 } from "../helpers/s3.helper";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";

const userRepo = new UserRepository();

export class UserService {
  async getProfile(userId: string) {
    const user = await userRepo.findById(userId);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    return user;
  }

  async updateProfile(userId: string, data: Record<string, unknown>) {
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
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