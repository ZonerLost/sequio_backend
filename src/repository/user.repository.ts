import { UserModel } from "../models/user.model";
import { IUser } from "../types";
import { UpdateQuery } from "mongoose";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterQuery = Record<string, any>;

export class UserRepository {
  async create(data: Partial<IUser>): Promise<IUser> {
    return UserModel.create(data);
  }

  async findByEmail(email: string, withPassword = false): Promise<IUser | null> {
    const query = UserModel.findOne({ email: email.toLowerCase() });
    if (withPassword) query.select("+password");
    return query.exec();
  }

  async findById(id: string, withPassword = false): Promise<IUser | null> {
    const query = UserModel.findById(id);
    if (withPassword) query.select("+password");
    return query.exec();
  }

  async findByPhone(phone: string): Promise<IUser | null> {
    return UserModel.findOne({ phone }).exec();
  }

  async findByGoogleId(googleId: string): Promise<IUser | null> {
    return UserModel.findOne({ googleId }).exec();
  }

  async findByFacebookId(facebookId: string): Promise<IUser | null> {
    return UserModel.findOne({ facebookId }).exec();
  }

  async findOne(filter: FilterQuery): Promise<IUser | null> {
    return UserModel.findOne(filter).exec();
  }

  async updateById(id: string, data: UpdateQuery<IUser>): Promise<IUser | null> {
    return UserModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async emailExists(email: string): Promise<boolean> {
    const count = await UserModel.countDocuments({ email: email.toLowerCase() });
    return count > 0;
  }

  async blockUser(userId: string, targetId: string): Promise<IUser | null> {
    return UserModel.findByIdAndUpdate(
      userId,
      { $addToSet: { blockedUsers: targetId } },
      { new: true }
    ).exec();
  }

  async unblockUser(userId: string, targetId: string): Promise<IUser | null> {
    return UserModel.findByIdAndUpdate(
      userId,
      { $pull: { blockedUsers: targetId } },
      { new: true }
    ).exec();
  }

  async getBlockedUsers(userId: string): Promise<IUser | null> {
    return UserModel.findById(userId)
      .populate("blockedUsers", "firstName lastName profilePhoto")
      .exec();
  }

  // Single query: true if userId blocked targetId OR targetId blocked userId
  async isBlocked(userId: string, targetId: string): Promise<boolean> {
    const count = await UserModel.countDocuments({
      $or: [
        { _id: userId, blockedUsers: targetId },
        { _id: targetId, blockedUsers: userId },
      ],
    });
    return count > 0;
  }
}
