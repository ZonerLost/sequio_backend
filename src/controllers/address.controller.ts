import { Request, Response, NextFunction } from "express";
import { AddressService } from "../services/address.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const addressService = new AddressService();

export class AddressController {
  async addAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const address = await addressService.addAddress(req.user!.userId, req.body);
      sendCreated(res, "Address added", address);
    } catch (err) { next(err); }
  }

  async getAddresses(req: Request, res: Response, next: NextFunction) {
    try {
      const addresses = await addressService.getAddresses(req.user!.userId);
      sendSuccess(res, "Addresses retrieved", addresses);
    } catch (err) { next(err); }
  }

  async setDefaultAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const address = await addressService.setDefaultAddress(
        req.user!.userId,
        String(req.params.id)
      );
      sendSuccess(res, "Default address updated", address);
    } catch (err) { next(err); }
  }

  async deleteAddress(req: Request, res: Response, next: NextFunction) {
    try {
      await addressService.deleteAddress(req.user!.userId, String(req.params.id));
      sendSuccess(res, "Address deleted");
    } catch (err) { next(err); }
  }
}
