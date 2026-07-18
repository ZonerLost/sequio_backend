import { Router } from "express";
import { ChatController } from "../controllers/chat.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  startConversationSchema,
  sendMessageSchema,
  messageQuerySchema,
} from "../validators/chat.validator";

const router = Router();
const ctrl = new ChatController();

router.use(authenticate);

router.get("/", ctrl.getConversations.bind(ctrl));
router.post("/", validate(startConversationSchema), ctrl.startConversation.bind(ctrl));
router.get("/:id/messages", validate(messageQuerySchema, "query"), ctrl.getMessages.bind(ctrl));
router.post("/:id/messages", validate(sendMessageSchema), ctrl.sendMessage.bind(ctrl));
router.put("/:id/read", ctrl.markAsRead.bind(ctrl));
router.put("/:id/archive", ctrl.archiveConversation.bind(ctrl));
router.put("/:id/unarchive", ctrl.unarchiveConversation.bind(ctrl));
router.delete("/:id/messages/:msgId", ctrl.deleteMessage.bind(ctrl));

export default router;
