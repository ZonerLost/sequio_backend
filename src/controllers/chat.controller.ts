import { Request, Response, NextFunction } from "express";
import { ChatService } from "../services/chat.service";
import { sendSuccess, sendCreated } from "../helpers/response.helper";

const chatService = new ChatService();

export class ChatController {
  async startConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await chatService.startConversation(req.user!.userId, req.body);
      sendCreated(res, "Conversation started", result);
    } catch (err) { next(err); }
  }

  async getConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const archived = req.query.archived === "true";
      const conversations = await chatService.getConversations(req.user!.userId, archived);
      sendSuccess(res, "Conversations retrieved", conversations);
    } catch (err) { next(err); }
  }

  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query;
      const result = await chatService.getMessages(
        String(req.params.id),
        req.user!.userId,
        Number(page) || 1,
        Number(limit) || 30
      );
      sendSuccess(res, "Messages retrieved", result.messages, 200, result.pagination);
    } catch (err) { next(err); }
  }

  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const message = await chatService.sendMessage(
        String(req.params.id),
        req.user!.userId,
        req.body.content
      );
      sendCreated(res, "Message sent", message);
    } catch (err) { next(err); }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      await chatService.markAsRead(String(req.params.id), req.user!.userId);
      sendSuccess(res, "Conversation marked as read");
    } catch (err) { next(err); }
  }

  async deleteMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const message = await chatService.deleteMessage(
        String(req.params.id),
        String(req.params.msgId),
        req.user!.userId
      );
      sendSuccess(res, "Message deleted", message);
    } catch (err) { next(err); }
  }

  async archiveConversation(req: Request, res: Response, next: NextFunction) {
    try {
      await chatService.archiveConversation(String(req.params.id), req.user!.userId);
      sendSuccess(res, "Conversation archived");
    } catch (err) { next(err); }
  }

  async unarchiveConversation(req: Request, res: Response, next: NextFunction) {
    try {
      await chatService.unarchiveConversation(String(req.params.id), req.user!.userId);
      sendSuccess(res, "Conversation unarchived");
    } catch (err) { next(err); }
  }
}
