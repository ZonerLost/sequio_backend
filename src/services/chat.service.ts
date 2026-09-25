import { ChatRepository } from "../repository/chat.repository";
import { UserRepository } from "../repository/user.repository";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { buildPagination } from "../helpers/pagination.helper";
import { getId } from "../helpers/id.helper";
import { isConnected, presenceOf } from "../helpers/presence.helper";
import { emitNewMessage, emitToConversation, emitToUser, joinUserToConversation } from "../socket";
import { notifyMessageReceived } from "../helpers/notification.triggers";
import { IConversation, IMessage, MessageType } from "../models/chat.model";
import { deleteFromS3, uploadToS3 } from "../helpers/s3.helper";

const chatRepo = new ChatRepository();
const userRepo = new UserRepository();

interface ParticipantJson {
  _id?: unknown;
  firstName?: string;
  lastName?: string;
  isOnline?: boolean;
  lastSeenAt?: Date | null;
}

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
    const conversationId = conversation._id.toString();

    // The room may not exist yet for sockets that connected before this conversation.
    joinUserToConversation(senderId, conversationId);
    joinUserToConversation(data.participantId, conversationId);

    const message = await this.deliverMessage(
      conversationId,
      senderId,
      [data.participantId],
      { content: data.message }
    );

    return { conversation, message };
  }

  async getConversations(userId: string, archived = false) {
    const conversations = await chatRepo.getConversations(userId, archived);
    return conversations.map((conversation) => this.withPresence(conversation, userId));
  }

  async getMessages(conversationId: string, userId: string, page = 1, limit = 30) {
    const conversation = await chatRepo.getConversationById(conversationId, userId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    const { messages, total } = await chatRepo.getMessages(conversationId, page, limit);
    return { messages, pagination: buildPagination(total, page, limit) };
  }

  async sendMessage(conversationId: string, senderId: string, content: string): Promise<IMessage> {
    const recipientIds = await this.assertCanSend(conversationId, senderId);
    return this.deliverMessage(conversationId, senderId, recipientIds, { content });
  }

  /**
   * Sends an image as a message, with the caption (if any) in `content`.
   *
   * The upload happens before the message row exists, so a failed write would otherwise leave an
   * orphaned S3 object — the object is removed on that path. Everything after the upload is the
   * same code the text path uses, so receipts, socket events and notifications are identical.
   */
  async sendImageMessage(
    conversationId: string,
    senderId: string,
    file: { buffer: Buffer; mimetype: string },
    caption?: string
  ): Promise<IMessage> {
    const recipientIds = await this.assertCanSend(conversationId, senderId);

    const imageUrl = await uploadToS3(file.buffer, file.mimetype, "chat-photos");
    try {
      return await this.deliverMessage(conversationId, senderId, recipientIds, {
        content: caption ?? "",
        type: "image",
        imageUrl,
      });
    } catch (err) {
      await deleteFromS3(imageUrl).catch(() => {});
      throw err;
    }
  }

  /** Membership and block checks shared by every way of sending; returns the other participants. */
  private async assertCanSend(conversationId: string, senderId: string): Promise<string[]> {
    const conversation = await chatRepo.getConversationById(conversationId, senderId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    // participants come back populated, so ids must be read with getId, never toString
    const recipientIds = conversation.participants
      .map((participant) => getId(participant))
      .filter((id) => id && id !== senderId);

    for (const recipientId of recipientIds) {
      if (await userRepo.isBlocked(senderId, recipientId)) {
        throw new AppError("Cannot send messages to this user", HTTP_STATUS.FORBIDDEN);
      }
    }

    return recipientIds;
  }

  /**
   * Stores a message, then pushes it out live: the message itself to the
   * conversation room, a list update to each participant, a delivery receipt to
   * the sender when the recipient is connected, and a notification either way.
   */
  private async deliverMessage(
    conversationId: string,
    senderId: string,
    recipientIds: string[],
    payload: { content: string; type?: MessageType; imageUrl?: string }
  ): Promise<IMessage> {
    const { content, type, imageUrl } = payload;
    const connectedRecipients = recipientIds.filter((id) => isConnected(id));
    const deliveredAt =
      recipientIds.length > 0 && connectedRecipients.length === recipientIds.length
        ? new Date()
        : undefined;

    const message = await chatRepo.createMessage({
      conversationId,
      senderId,
      content,
      recipientIds,
      deliveredAt,
      type,
      imageUrl,
    });

    emitNewMessage(conversationId, message);

    const summary = await chatRepo.getSummary(conversationId);
    for (const participantId of summary?.participants ?? [senderId, ...recipientIds]) {
      emitToUser(participantId, "conversation_updated", {
        type: "conversation",
        conversationId,
        lastMessage: summary?.lastMessage ?? null,
        unreadCount: summary?.unreadCount?.[participantId] ?? 0,
        updatedAt: summary?.updatedAt ?? new Date(),
      });
    }

    if (deliveredAt) {
      for (const recipientId of connectedRecipients) {
        emitToUser(senderId, "messages_delivered", {
          conversationId,
          messageIds: [message._id.toString()],
          deliveredAt,
          recipientId,
        });
      }
    }

    // Only notify recipients who are not connected: a connected client already got
    // new_message, and a stored notification per message would flood the list.
    const sender = message.sender as unknown as ParticipantJson;
    const senderName = `${sender?.firstName ?? ""} ${sender?.lastName ?? ""}`.trim() || "Someone";
    for (const recipientId of recipientIds) {
      if (isConnected(recipientId)) continue;
      notifyMessageReceived(recipientId, senderName, conversationId).catch(() => {});
    }

    return message;
  }

  async markAsRead(conversationId: string, userId: string) {
    const conversation = await chatRepo.getConversationById(conversationId, userId);
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    const receipt = await chatRepo.markAsRead(conversationId, userId);

    if (receipt.messageIds.length) {
      emitToConversation(conversationId, "messages_read", {
        conversationId,
        messageIds: receipt.messageIds,
        readAt: receipt.readAt,
        readerId: userId,
      });
    }

    // the reader's other devices drop the badge for this conversation
    emitToUser(userId, "conversation_updated", {
      type: "conversation",
      conversationId,
      lastMessage: conversation.lastMessage ?? null,
      unreadCount: 0,
      updatedAt: new Date(),
    });

    return { read: receipt.messageIds.length, readAt: receipt.readAt };
  }

  async getUnreadSummary(userId: string) {
    return chatRepo.getUnreadSummary(userId);
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

    // The row is only soft-deleted, but the image is gone from every view of the thread, so the
    // object has no reader left. Best-effort, like every other S3 cleanup in this codebase.
    if (message.type === "image" && message.imageUrl) {
      await deleteFromS3(message.imageUrl).catch(() => {});
    }

    emitToConversation(conversationId, "message_deleted", {
      conversationId,
      messageId,
      deletedBy: userId,
    });

    // Deleting changes the list row too — the preview, and the badge when the message
    // was still unread — so the same conversation_updated every other write sends goes
    // out here as well, and a client needs no special resync path for deletes.
    await chatRepo.reconcileAfterDelete(conversationId, message);
    const summary = await chatRepo.getSummary(conversationId);
    for (const participantId of summary?.participants ?? []) {
      emitToUser(participantId, "conversation_updated", {
        type: "conversation",
        conversationId,
        lastMessage: summary?.lastMessage ?? null,
        unreadCount: summary?.unreadCount?.[participantId] ?? 0,
        updatedAt: summary?.updatedAt ?? new Date(),
      });
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

  /** Adds each participant's live presence and the caller's unread count. */
  private withPresence(conversation: IConversation, userId: string) {
    const json = conversation.toJSON() as Record<string, unknown> & {
      participants?: ParticipantJson[];
      unreadCount?: Record<string, number>;
    };
    const participants = (json.participants ?? []).map((participant) => ({
      ...participant,
      ...presenceOf(getId(participant), participant),
    }));

    return {
      ...json,
      participants,
      unread: json.unreadCount?.[userId] ?? 0,
    };
  }
}
