import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { AddressController } from "../controllers/address.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateProfileSchema, reportUserSchema } from "../validators/profile.validator";
import { addAddressSchema } from "../validators/address.validator";
import { upload } from "../middleware/upload.middleware";
import { saveFCMTokenHandler } from "./notification.routes";

const router = Router();
const ctrl = new UserController();
const addressCtrl = new AddressController();

router.use(authenticate);

router.get("/profile", ctrl.getProfile.bind(ctrl));
router.put("/profile", validate(updateProfileSchema), ctrl.updateProfile.bind(ctrl));
router.put("/profile/photo", upload.single("photo"), ctrl.updateProfilePhoto.bind(ctrl));
router.post("/identity-verify", upload.single("document"), ctrl.uploadIdentityDocument.bind(ctrl));
router.post("/fcm-token", ...saveFCMTokenHandler);

// Block / unblock
router.get("/blocked", ctrl.getBlockedUsers.bind(ctrl));
router.post("/block/:userId", ctrl.blockUser.bind(ctrl));
router.delete("/block/:userId", ctrl.unblockUser.bind(ctrl));

// Report
router.post("/:userId/report", validate(reportUserSchema), ctrl.reportUser.bind(ctrl));

// Address management
router.post("/addresses", validate(addAddressSchema), addressCtrl.addAddress.bind(addressCtrl));
router.get("/addresses", addressCtrl.getAddresses.bind(addressCtrl));
router.put("/addresses/:id/default", addressCtrl.setDefaultAddress.bind(addressCtrl));
router.delete("/addresses/:id", addressCtrl.deleteAddress.bind(addressCtrl));

export default router;
