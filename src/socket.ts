import { Server as SocketServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { ENV } from "./config/env";
import { logger } from "./config/logger";
import { JwtPayload } from "./types";
import { UserModel } from "./models/user.model";
import { ChatRepository } from "./repository/chat.repository";
import {
  clearStalePresence,
  markOffline,
  markOnline,
  startHeartbeat,
  stopHeartbeat,
  trackConnect,
  trackDisconnect,
} from "./helpers/presence.helper";

/**
 * Realtime layer. Clients connect with their access token, either as
 * `auth.token` or an `Authorization: Bearer …` header.
 *
 * server -> client
 *   new_message          a message was added to a conversation you are in
 *                        { _id, conversation, sender, content, createdAt, … }
 *   conversation_updated { type: "conversation", conversationId, lastMessage, unreadCount }
 *                        { type: "notification", notification }   (notification service)
 *   messages_delivered   { conversationId, messageIds, deliveredAt, recipientId }
 *   messages_read        { conversationId, messageIds, readAt, readerId }
 *   presence_update      { userId, isOnline, lastSeenAt }
 *   user_typing          { userId, conversationId }
 *   user_stop_typing     { userId, conversationId }
 *
 * client -> server
 *   join_conversation    conversationId, ack? -> { ok: true } | { ok: false, error }
 *   leave_conversation   conversationId
 *   typing               { conversationId }
 *   stop_typing          { conversationId }
 *
 * Rooms: every socket joins its own user id, plus a room per conversation it
 * belongs to. Conversation rooms are joined automatically on connect, so
 * messages arrive whether or not the client sent join_conversation.
 */

const chatRepo = new ChatRepository();

export const conversationRoom = (conversationId: string): string => `conversation:${conversationId}`;

interface SocketUser {
  userId: string;
}

export const initSocket = (httpServer: HttpServer): SocketServer => {
  const server = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
  });

  // Authenticate the handshake, then confirm the account is still usable.
  server.use(async (socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(" ")[1];
      if (!token) return next(new Error("Authentication required"));

      const payload = jwt.verify(token, ENV.JWT_ACCESS_SECRET) as JwtPayload;
      const user = await UserModel.findById(payload.userId).select("isBanned isActive").lean();
      if (!user) return next(new Error("Account not found"));
      if (user.isBanned || user.isActive === false) return next(new Error("Account is not active"));

      (socket.data as SocketUser).userId = payload.userId;
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  server.on("connection", (socket: Socket) => {
    onConnection(server, socket).catch((err: Error) =>
      logger.error("Socket connection setup failed", { message: err.message })
    );
  });

  setIO(server);
  startHeartbeat();
  clearStalePresence().catch((err: Error) =>
    logger.error("Clearing stale presence failed", { message: err.message })
  );

  return server;
};

async function onConnection(server: SocketServer, socket: Socket): Promise<void> {
  const { userId } = socket.data as SocketUser;
  const isFirstSocket = trackConnect(userId, socket.id);
  logger.info(`Socket connected: ${userId}`);

  // personal room (user id) + every conversation this user belongs to
  socket.join(userId);
  const conversationIds = await chatRepo.findConversationIdsForUser(userId);
  for (const id of conversationIds) socket.join(conversationRoom(id));

  registerHandlers(server, socket, userId);

  if (isFirstSocket) {
    const lastSeenAt = await markOnline(userId);
    await broadcastPresence(server, userId, true, lastSeenAt);
    await flushPendingDeliveries(server, userId);
  }
}

function registerHandlers(server: SocketServer, socket: Socket, userId: string): void {
  type Ack = (result: { ok: boolean; error?: string }) => void;

  socket.on("join_conversation", (conversationId: unknown, ack?: Ack) => {
    void (async () => {
      const id = String(conversationId ?? "");
      // A room must never be joined on the client's say-so: check membership first.
      if (!(await chatRepo.isParticipant(id, userId))) {
        ack?.({ ok: false, error: "Not a participant of this conversation" });
        return;
      }
      socket.join(conversationRoom(id));
      ack?.({ ok: true });
    })().catch((err: Error) => {
      logger.error("join_conversation failed", { message: err.message });
      ack?.({ ok: false, error: "Could not join conversation" });
    });
  });

  socket.on("leave_conversation", (conversationId: unknown) => {
    socket.leave(conversationRoom(String(conversationId ?? "")));
  });

  for (const [incoming, outgoing] of [
    ["typing", "user_typing"],
    ["stop_typing", "user_stop_typing"],
  ] as const) {
    socket.on(incoming, (data: { conversationId?: string } | undefined) => {
      const conversationId = String(data?.conversationId ?? "");
      // Only broadcast into rooms this socket actually belongs to.
      if (!conversationId || !socket.rooms.has(conversationRoom(conversationId))) return;
      socket.to(conversationRoom(conversationId)).emit(outgoing, { userId, conversationId });
    });
  }

  socket.on("disconnect", () => {
    void (async () => {
      logger.info(`Socket disconnected: ${userId}`);
      if (!trackDisconnect(userId, socket.id)) return;
      const lastSeenAt = await markOffline(userId);
      await broadcastPresence(server, userId, false, lastSeenAt);
    })().catch((err: Error) => logger.error("Socket disconnect failed", { message: err.message }));
  });
}

/** Tell everyone this user chats with that they came online or went offline. */
async function broadcastPresence(
  server: SocketServer,
  userId: string,
  isOnline: boolean,
  lastSeenAt: Date
): Promise<void> {
  const partnerIds = await chatRepo.findChatPartnerIds(userId);
  const payload = { userId, isOnline, lastSeenAt };
  for (const partnerId of partnerIds) server.to(partnerId).emit("presence_update", payload);
}

/** On reconnect, mark what arrived while away as delivered and tell the senders. */
async function flushPendingDeliveries(server: SocketServer, userId: string): Promise<void> {
  const { groups, deliveredAt } = await chatRepo.markDelivered(userId);
  for (const group of groups) {
    server.to(group.senderId).emit("messages_delivered", {
      conversationId: group.conversationId,
      messageIds: group.messageIds,
      deliveredAt,
      recipientId: userId,
    });
  }
}

export let io: SocketServer;

export const setIO = (socketServer: SocketServer): void => {
  io = socketServer;
};

/** Stops background timers (used on shutdown and in tests). */
export const stopSocket = (): void => stopHeartbeat();

export const emitToUser = (userId: string, event: string, payload: unknown): void => {
  io?.to(userId).emit(event, payload);
};

export const emitToConversation = (
  conversationId: string,
  event: string,
  payload: unknown
): void => {
  io?.to(conversationRoom(conversationId)).emit(event, payload);
};

export const emitNewMessage = (conversationId: string, message: unknown): void =>
  emitToConversation(conversationId, "new_message", message);

export const emitConversationUpdate = (userId: string, payload: unknown): void =>
  emitToUser(userId, "conversation_updated", payload);

/** Pulls a user's open sockets into a conversation room created after they connected. */
export const joinUserToConversation = (userId: string, conversationId: string): void => {
  io?.in(userId).socketsJoin(conversationRoom(conversationId));
};
