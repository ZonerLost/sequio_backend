import { AddressModel, IAddress } from "../models/address.model";

export class AddressRepository {
  async create(data: Partial<IAddress>): Promise<IAddress> {
    return AddressModel.create(data);
  }

  async findByUser(userId: string): Promise<IAddress[]> {
    return AddressModel.find({ userId }).sort({ isDefault: -1, createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<IAddress | null> {
    return AddressModel.findById(id).exec();
  }

  async findDefault(userId: string): Promise<IAddress | null> {
    return AddressModel.findOne({ userId, isDefault: true }).exec();
  }

  async setDefault(userId: string, addressId: string): Promise<void> {
    await AddressModel.updateMany({ userId }, { isDefault: false });
    await AddressModel.findByIdAndUpdate(addressId, { isDefault: true });
  }

  async deleteById(id: string): Promise<void> {
    await AddressModel.findByIdAndDelete(id);
  }

  async countByUser(userId: string): Promise<number> {
    return AddressModel.countDocuments({ userId });
  }
}
