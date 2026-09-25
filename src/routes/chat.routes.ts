import { Router } from "express";
import { ChatController } from "../controllers/chat.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { upload } from "../middleware/upload.middleware";
import {
  startConversationSchema,
  sendMessageSchema,
  sendImageMessageSchema,
  messageQuerySchema,
} from "../validators/chat.validator";

const router = Router();
const ctrl = new ChatController();

router.use(authenticate);

router.get("/", ctrl.getConversations.bind(ctrl));
// must stay above the /:id routes so it is not captured as a conversation id
router.get("/unread-count", ctrl.getUnreadSummary.bind(ctrl));
router.post("/", validate(startConversationSchema), ctrl.startConversation.bind(ctrl));
router.get("/:id/messages", validate(messageQuerySchema, "query"), ctrl.getMessages.bind(ctrl));
router.post("/:id/messages", validate(sendMessageSchema), ctrl.sendMessage.bind(ctrl));
// multipart: upload must run before validate, or the caption field is not parsed yet
router.post(
  "/:id/messages/image",
  upload.single("image"),
  validate(sendImageMessageSchema),
  ctrl.sendImageMessage.bind(ctrl)
);
router.put("/:id/read", ctrl.markAsRead.bind(ctrl));
router.put("/:id/archive", ctrl.archiveConversation.bind(ctrl));
router.put("/:id/unarchive", ctrl.unarchiveConversation.bind(ctrl));
router.delete("/:id/messages/:msgId", ctrl.deleteMessage.bind(ctrl));

export default router;
