import { Router } from "express";
import { ItemController } from "../controllers/item.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createItemSchema,
  updateItemSchema,
  updateAvailabilitySchema,
  updateScheduleSchema,
  itemQuerySchema,
  feedQuerySchema,
} from "../validators/item.validator";
import { upload } from "../middleware/upload.middleware";
import { CONSTANTS } from "../config/constants";

const router = Router();
const ctrl = new ItemController();

// Static/config routes — must be declared before /:id to avoid parameter capture
router.get("/form-config", ctrl.getFormConfig.bind(ctrl));
router.get("/boost-config", ctrl.getBoostConfig.bind(ctrl));

// Public list routes
router.get("/", validate(itemQuerySchema, "query"), ctrl.getItems.bind(ctrl));
router.get("/feed", validate(feedQuerySchema, "query"), ctrl.getFeed.bind(ctrl));

// Authenticated list routes
router.get("/my-listings", authenticate, ctrl.getMyListings.bind(ctrl));

// Single item routes
router.get("/:id", ctrl.getItemById.bind(ctrl));
router.post("/", authenticate, validate(createItemSchema), ctrl.createItem.bind(ctrl));
router.put("/:id", authenticate, validate(updateItemSchema), ctrl.updateItem.bind(ctrl));
router.delete("/:id", authenticate, ctrl.deleteItem.bind(ctrl));

// Item sub-resource routes
router.post("/:id/photos", authenticate, upload.array("photos", CONSTANTS.MAX_ITEM_PHOTOS), ctrl.uploadPhotos.bind(ctrl));
router.delete("/:id/photos", authenticate, ctrl.deletePhoto.bind(ctrl));
router.put("/:id/availability", authenticate, validate(updateAvailabilitySchema), ctrl.updateAvailability.bind(ctrl));
router.put("/:id/pause", authenticate, ctrl.pauseListing.bind(ctrl));
router.put("/:id/resume", authenticate, ctrl.resumeListing.bind(ctrl));
router.post("/:id/boost", authenticate, ctrl.boostListing.bind(ctrl));
router.put("/:id/pickup-schedule", authenticate, validate(updateScheduleSchema), ctrl.updatePickupSchedule.bind(ctrl));
router.put("/:id/delivery-schedule", authenticate, validate(updateScheduleSchema), ctrl.updateDeliverySchedule.bind(ctrl));

export default router;