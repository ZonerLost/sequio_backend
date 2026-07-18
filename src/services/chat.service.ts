import { ChatRepository } from "../repository/chat.repository";
import { UserRepository } from "../repository/user.repository";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { buildPagination } from "../helpers/pagination.helper";

const chatRepo = new ChatRepository();
const userRepo = new UserRepository();

export class ChatService {
  async startConversation(
    senderId: string,
    data: { participantId: string; itemId?: string; message: string }
  ) {
    if (senderId === data.participantId) {
      throw new AppError("Cannot start a conversation with yourself", HTTP_STATUS.BAD_REQUEST);
    }

    const blocked = await userRepo.isBlocked(senderId, data.participantId);
    if (blocked) {
      throw new AppError("Cannot start a conversation with this user", HTTP_STATUS.FORBIDDEN);
    }

    const conversation = await chatRepo.findOrCreateConversation(
      senderId,
      data.participantId,
      data.itemId
    );

    const message = await chatRepo.createMessage({
      conversationId: conversation._id.toString(),
      senderId,
      content: data.message,
    });

    return { conversation, message };
  }

  async getConversations(userId: string, archived = false) {
    return chatRepo.getConversations(userId, archived);
  }

  async getMessages(conversationId: string, userId: string, page = 1, limit = 30) {
    const conversation = await chatRepo.getConversationById(conversationId, userId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    const { messages, total } = await chatRepo.getMessages(conversationId, page, limit);
    return { messages, pagination: buildPagination(total, page, limit) };
  }

  async sendMessage(conversationId: string, senderId: string, content: string) {
    const conversation = await chatRepo.getConversationById(conversationId, senderId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    const otherParticipant = conversation.participants.find(
      (p) => p.toString() !== senderId
    );
    if (otherParticipant) {
      const blocked = await userRepo.isBlocked(senderId, otherParticipant.toString());
      if (blocked) {
        throw new AppError("Cannot send messages to this user", HTTP_STATUS.FORBIDDEN);
      }
    }

    return chatRepo.createMessage({ conversationId, senderId, content });
  }

  async markAsRead(conversationId: string, userId: string) {
    const conversation = await chatRepo.getConversationById(conversationId, userId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }
    await chatRepo.markAsRead(conversationId, userId);
  }

  async deleteMessage(conversationId: string, messageId: string, userId: string) {
    const conversation = await chatRepo.getConversationById(conversationId, userId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    const message = await chatRepo.deleteMessage(messageId, userId);
    if (!message) {
      throw new AppError("Message not found or you are not the sender", HTTP_STATUS.NOT_FOUND);
    }
    return message;
  }

  async archiveConversation(conversationId: string, userId: string) {
    const conversation = await chatRepo.archiveConversation(conversationId, userId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }
    return conversation;
  }

  async unarchiveConversation(conversationId: string, userId: string) {
    const conversation = await chatRepo.unarchiveConversation(conversationId, userId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }
    return conversation;
  }
}
