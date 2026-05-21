import { Router } from "express";
import { ItemController } from "../controllers/item.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  createItemSchema,
  updateItemSchema,
  updateAvailabilitySchema,
  itemQuerySchema,
  feedQuerySchema,
} from "../validators/item.validator";
import { upload } from "../middleware/upload.middleware";
import { CONSTANTS } from "../config/constants";

const router = Router();
const ctrl = new ItemController();

// Public routes
router.get("/", validate(itemQuerySchema, "query"), ctrl.getItems.bind(ctrl));
router.get("/feed", validate(feedQuerySchema, "query"), ctrl.getFeed.bind(ctrl));
router.get("/my-listings", authenticate, ctrl.getMyListings.bind(ctrl));
router.get("/:id", ctrl.getItemById.bind(ctrl));

// Protected routes
router.post("/", authenticate, validate(createItemSchema), ctrl.createItem.bind(ctrl));
router.put("/:id", authenticate, validate(updateItemSchema), ctrl.updateItem.bind(ctrl));
router.delete("/:id", authenticate, ctrl.deleteItem.bind(ctrl));
router.post("/:id/photos", authenticate, upload.array("photos", CONSTANTS.MAX_ITEM_PHOTOS), ctrl.uploadPhotos.bind(ctrl));
router.delete("/:id/photos", authenticate, ctrl.deletePhoto.bind(ctrl));
router.put("/:id/availability", authenticate, validate(updateAvailabilitySchema), ctrl.updateAvailability.bind(ctrl));
router.put("/:id/pause", authenticate, ctrl.pauseListing.bind(ctrl));
router.put("/:id/resume", authenticate, ctrl.resumeListing.bind(ctrl));

export default router;