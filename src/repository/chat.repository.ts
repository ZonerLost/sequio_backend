import { ConversationModel, IConversation, IMessage, MessageModel } from "../models/chat.model";
import { Types } from "mongoose";

// Participants are populated with the fields a chat list needs, presence included.
const PARTICIPANT_FIELDS = "firstName lastName profilePhoto isOnline lastSeenAt";

export interface ReceiptGroup {
  conversationId: string;
  senderId: string;
  messageIds: string[];
}

const toId = (value: unknown): string => String(value);
const objectId = (id: string): Types.ObjectId => new Types.ObjectId(id);

export class ChatRepository {
  async findOrCreateConversation(
    participantA: string,
    participantB: string,
    itemId?: string
  ): Promise<IConversation> {
    const existing = await ConversationModel.findOne({
      participants: { $all: [participantA, participantB] },
      ...(itemId ? { item: itemId } : {}),
    });
    if (existing) return existing;

    return ConversationModel.create({
      participants: [participantA, participantB],
      item: itemId,
      unreadCount: { [participantA]: 0, [participantB]: 0 },
    });
  }

  async getConversations(userId: string, archived = false): Promise<IConversation[]> {
    const filter = archived
      ? { participants: userId, archivedBy: userId }
      : { participants: userId, archivedBy: { $ne: new Types.ObjectId(userId) } };

    return ConversationModel.find(filter)
      .populate("participants", PARTICIPANT_FIELDS)
      .populate("item", "title photos")
      .sort({ updatedAt: -1 });
  }

  async getConversationById(id: string, userId: string): Promise<IConversation | null> {
    return ConversationModel.findOne({
      _id: id,
      participants: userId,
    })
      .populate("participants", PARTICIPANT_FIELDS)
      .populate("item", "title photos");
  }

  /** Cheap membership check for the realtime layer; tolerates a malformed id. */
  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(conversationId)) return false;
    const found = await ConversationModel.exists({ _id: conversationId, participants: userId });
    return !!found;
  }

  /** Conversation ids a socket should join on connect (most recent first). */
  async findConversationIdsForUser(userId: string, limit = 200): Promise<string[]> {
    const rows = await ConversationModel.find({ participants: userId })
      .select("_id")
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    return rows.map((row) => toId(row._id));
  }

  /** Everyone this user shares a conversation with — the audience for presence updates. */
  async findChatPartnerIds(userId: string, limit = 200): Promise<string[]> {
    const rows = await ConversationModel.find({ participants: userId })
      .select("participants")
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    const partners = new Set<string>();
    for (const row of rows) {
      for (const participant of row.participants ?? []) {
        const id = toId(participant);
        if (id !== userId) partners.add(id);
      }
    }
    return [...partners];
  }

  async getMessages(
    conversationId: string,
    page = 1,
    limit = 30
  ): Promise<{ messages: IMessage[]; total: number }> {
    const [messages, total] = await Promise.all([
      MessageModel.find({
        conversation: conversationId,
        deletedAt: { $exists: false },
      })
        .populate("sender", "firstName lastName profilePhoto")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      MessageModel.countDocuments({
        conversation: conversationId,
        deletedAt: { $exists: false },
      }),
    ]);
    return { messages: messages.reverse(), total };
  }

  /**
   * Stores the message and updates its conversation in a single write:
   * last message preview plus one unread increment per recipient.
   */
  async createMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
    recipientIds: string[];
    deliveredAt?: Date;
  }): Promise<IMessage> {
    const message = await MessageModel.create({
      conversation: data.conversationId,
      sender: data.senderId,
      content: data.content,
      deliveredAt: data.deliveredAt,
    });

    const increments: Record<string, number> = {};
    for (const recipientId of data.recipientIds) increments[`unreadCount.${recipientId}`] = 1;

    await ConversationModel.updateOne({ _id: data.conversationId }, {
      $set: {
        lastMessage: {
          content: data.content,
          sender: objectId(data.senderId),
          createdAt: message.createdAt,
        },
      },
      ...(Object.keys(increments).length ? { $inc: increments } : {}),
    });

    return message.populate("sender", "firstName lastName profilePhoto");
  }

  /**
   * Marks everything the user has not read in one conversation as read.
   * Returns what changed so the senders can be told (read receipts).
   */
  async markAsRead(
    conversationId: string,
    userId: string
  ): Promise<{ messageIds: string[]; senderIds: string[]; readAt: Date }> {
    const pending = await MessageModel.find({
      conversation: conversationId,
      sender: { $ne: objectId(userId) },
      readAt: { $exists: false },
      deletedAt: { $exists: false },
    })
      .select("_id sender")
      .lean();

    const readAt = new Date();
    const ids = pending.map((message) => message._id);

    await Promise.all([
      ids.length
        ? MessageModel.updateMany({ _id: { $in: ids } }, { $set: { isRead: true, readAt } })
        : Promise.resolve(),
      // reading implies delivery, for anything that never got a delivery receipt
      ids.length
        ? MessageModel.updateMany(
            { _id: { $in: ids }, deliveredAt: { $exists: false } },
            { $set: { deliveredAt: readAt } }
          )
        : Promise.resolve(),
      ConversationModel.updateOne(
        { _id: conversationId },
        { $set: { [`unreadCount.${userId}`]: 0 } },
        { timestamps: false }
      ),
    ]);

    return {
      messageIds: ids.map(toId),
      senderIds: [...new Set(pending.map((message) => toId(message.sender)))],
      readAt,
    };
  }

  /**
   * Marks messages waiting for a user as delivered — used when they reconnect.
   * Grouped per conversation and sender so each sender gets one receipt.
   */
  async markDelivered(userId: string, limit = 500): Promise<{ groups: ReceiptGroup[]; deliveredAt: Date }> {
    const conversationIds = await this.findConversationIdsForUser(userId);
    const deliveredAt = new Date();
    if (!conversationIds.length) return { groups: [], deliveredAt };

    const pending = await MessageModel.find({
      conversation: { $in: conversationIds },
      sender: { $ne: objectId(userId) },
      deliveredAt: { $exists: false },
      deletedAt: { $exists: false },
    })
      .select("_id conversation sender")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    if (!pending.length) return { groups: [], deliveredAt };

    await MessageModel.updateMany(
      { _id: { $in: pending.map((message) => message._id) } },
      { $set: { deliveredAt } }
    );

    const grouped = new Map<string, ReceiptGroup>();
    for (const message of pending) {
      const conversationId = toId(message.conversation);
      const senderId = toId(message.sender);
      const key = `${conversationId}:${senderId}`;
      const group = grouped.get(key) ?? { conversationId, senderId, messageIds: [] };
      group.messageIds.push(toId(message._id));
      grouped.set(key, group);
    }
    return { groups: [...grouped.values()], deliveredAt };
  }

  /** Light conversation read for realtime payloads. */
  async getSummary(conversationId: string): Promise<{
    participants: string[];
    lastMessage: IConversation["lastMessage"] | null;
    unreadCount: Record<string, number>;
    updatedAt: Date;
  } | null> {
    const row = await ConversationModel.findById(conversationId)
      .select("participants lastMessage unreadCount updatedAt")
      .lean();
    if (!row) return null;
    return {
      participants: (row.participants ?? []).map(toId),
      lastMessage: row.lastMessage ?? null,
      unreadCount: (row.unreadCount as unknown as Record<string, number>) ?? {},
      updatedAt: row.updatedAt,
    };
  }

  /** Unread totals for a badge: messages and how many conversations they sit in. */
  async getUnreadSummary(userId: string): Promise<{ total: number; conversations: number }> {
    const unread = `$unreadCount.${userId}`;
    const [summary] = await ConversationModel.aggregate<{ total: number; conversations: number }>([
      { $match: { participants: objectId(userId), archivedBy: { $ne: objectId(userId) } } },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: [unread, 0] } },
          conversations: { $sum: { $cond: [{ $gt: [{ $ifNull: [unread, 0] }, 0] }, 1, 0] } },
        },
      },
    ]);
    return { total: summary?.total ?? 0, conversations: summary?.conversations ?? 0 };
  }

  async archiveConversation(conversationId: string, userId: string): Promise<IConversation | null> {
    return ConversationModel.findOneAndUpdate(
      { _id: conversationId, participants: userId },
      { $addToSet: { archivedBy: userId } },
      { new: true }
    );
  }

  async unarchiveConversation(conversationId: string, userId: string): Promise<IConversation | null> {
    return ConversationModel.findOneAndUpdate(
      { _id: conversationId, participants: userId },
      { $pull: { archivedBy: new Types.ObjectId(userId) } },
      { new: true }
    );
  }

  async deleteMessage(messageId: string, userId: string): Promise<IMessage | null> {
    return MessageModel.findOneAndUpdate(
      { _id: messageId, sender: userId },
      { deletedAt: new Date() },
      { new: true }
    );
  }
}
