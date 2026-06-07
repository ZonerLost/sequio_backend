import { AddressRepository } from "../repository/address.repository";
import { IAddress } from "../models/address.model";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";

const MAX_ADDRESSES_PER_USER = 10;

const addressRepo = new AddressRepository();

export class AddressService {
  async addAddress(userId: string, data: Partial<IAddress>): Promise<IAddress> {
    const count = await addressRepo.countByUser(userId);
    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new AppError(
        `Maximum ${MAX_ADDRESSES_PER_USER} addresses allowed`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const isFirstAddress = count === 0;
    const address = await addressRepo.create({
      ...data,
      userId: userId as unknown as IAddress["userId"],
      isDefault: isFirstAddress,
    });

    return address;
  }

  async getAddresses(userId: string): Promise<IAddress[]> {
    return addressRepo.findByUser(userId);
  }

  async setDefaultAddress(userId: string, addressId: string): Promise<IAddress> {
    const address = await addressRepo.findById(addressId);
    if (!address) throw new AppError("Address not found", HTTP_STATUS.NOT_FOUND);
    if (address.userId.toString() !== userId)
      throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);

    await addressRepo.setDefault(userId, addressId);
    return (await addressRepo.findById(addressId))!;
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const address = await addressRepo.findById(addressId);
    if (!address) throw new AppError("Address not found", HTTP_STATUS.NOT_FOUND);
    if (address.userId.toString() !== userId)
      throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);

    await addressRepo.deleteById(addressId);

    // If deleted address was default, promote the most recently created remaining address
    if (address.isDefault) {
      const remaining = await addressRepo.findByUser(userId);
      if (remaining.length > 0) {
        await addressRepo.setDefault(userId, remaining[0]._id.toString());
      }
    }
  }
}
