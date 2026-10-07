import { OtpModel } from "../models/otp.model";
import { IOtp } from "../types";

export class OtpRepository {
  async create(data: Partial<IOtp>): Promise<IOtp> {
    // Deleting first is what makes a code single-outstanding: requesting a new one retires the old,
    // so an abandoned code, or one that reached the wrong inbox, stops working immediately.
    await OtpModel.deleteMany({ userId: data.userId, type: data.type });
    return OtpModel.create(data);
  }

  async findValid(
    userId: string,
    otp: string,
    type: IOtp["type"]
  ): Promise<IOtp | null> {
    return OtpModel.findOne({
      userId,
      otp,
      type,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    }).exec();
  }

  async markUsed(id: string): Promise<void> {
    await OtpModel.findByIdAndUpdate(id, { isUsed: true });
  }
}