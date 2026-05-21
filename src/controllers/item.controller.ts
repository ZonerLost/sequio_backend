import { Request, Response, NextFunction } from "express";
import { ItemService } from "../services/item.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const itemService = new ItemService();

export class ItemController {
  async createItem(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await itemService.createItem(req.user!.userId, req.body);
      sendCreated(res, "Item created successfully", item);
    } catch (err) { next(err); }
  }

  async getItems(req: Request, res: Response, next: NextFunction) {
    try {
      const { items, pagination } = await itemService.getItems(req.query);
      sendSuccess(res, "Items retrieved", items, 200, pagination);
    } catch (err) { next(err); }
  }

  async getItemById(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await itemService.getItemById(String(req.params.id));
      sendSuccess(res, "Item retrieved", item);
    } catch (err) { next(err); }
  }

  async getMyListings(req: Request, res: Response, next: NextFunction) {
    try {
      const items = await itemService.getMyListings(req.user!.userId);
      sendSuccess(res, "My listings retrieved", items);
    } catch (err) { next(err); }
  }

  async updateItem(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await itemService.updateItem(
        String(req.params.id),
        req.user!.userId,
        req.body
      );
      sendSuccess(res, "Item updated", item);
    } catch (err) { next(err); }
  }

  async deleteItem(req: Request, res: Response, next: NextFunction) {
    try {
      await itemService.deleteItem(String(req.params.id), req.user!.userId);
      sendSuccess(res, "Item deleted");
    } catch (err) { next(err); }
  }

  async uploadPhotos(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ success: false, message: "No files uploaded" });
        return;
      }
      const item = await itemService.uploadItemPhotos(
        String(req.params.id),
        req.user!.userId,
        req.files
      );
      sendSuccess(res, "Photos uploaded", item);
    } catch (err) { next(err); }
  }

  async deletePhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await itemService.deleteItemPhoto(
        String(req.params.id),
        req.user!.userId,
        req.body.photoUrl
      );
      sendSuccess(res, "Photo deleted", item);
    } catch (err) { next(err); }
  }

  async updateAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await itemService.updateAvailability(
        String(req.params.id),
        req.user!.userId,
        req.body
      );
      sendSuccess(res, "Availability updated", item);
    } catch (err) { next(err); }
  }

  async pauseListing(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await itemService.pauseListing(String(req.params.id), req.user!.userId);
      sendSuccess(res, "Listing paused", item);
    } catch (err) { next(err); }
  }

  async resumeListing(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await itemService.resumeListing(String(req.params.id), req.user!.userId);
      sendSuccess(res, "Listing resumed", item);
    } catch (err) { next(err); }
  }

  async getFeed(req: Request, res: Response, next: NextFunction) {
    try {
      const { lat, lng, radius, limit } = req.query;
      const result = await itemService.getFeed({
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        radius: radius ? Number(radius) : 20,
        limit: limit ? Number(limit) : 10,
      });
      sendSuccess(res, "Feed retrieved", result);
    } catch (err) { next(err); }
  }
}