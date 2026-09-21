import { UserModel } from "../models/user.model";
import { logger } from "../config/logger";

/**
 * Presence: "is this user connected right now" and "when were they last seen".
 *
 * Live sockets are tracked in memory, counted per user so several devices work.
 * The same state is mirrored onto the User document so REST callers (and any
 * other process) can read it, refreshed by a heartbeat while a socket is open.
 * Reads treat a stale `isOnline` as offline, so a process that dies without
 * disconnecting its sockets cannot leave users "online" forever.
 */
const STALE_AFTER_MS = 75_000;
const HEARTBEAT_MS = 30_000;

const socketsByUser = new Map<string, Set<string>>();
let heartbeat: NodeJS.Timeout | null = null;

/** Returns true when this is the user's first live socket. */
export function trackConnect(userId: string, socketId: string): boolean {
  const sockets = socketsByUser.get(userId) ?? new Set<string>();
  const isFirst = sockets.size === 0;
  sockets.add(socketId);
  socketsByUser.set(userId, sockets);
  return isFirst;
}

/** Returns true when the user's last live socket has gone. */
export function trackDisconnect(userId: string, socketId: string): boolean {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size > 0) return false;
  socketsByUser.delete(userId);
  return true;
}

export function isConnected(userId: string): boolean {
  return (socketsByUser.get(userId)?.size ?? 0) > 0;
}

export function connectedUserIds(): string[] {
  return [...socketsByUser.keys()];
}

export interface Presence {
  isOnline: boolean;
  lastSeenAt: Date | null;
}

export function presenceOf(
  userId: string,
  user?: { isOnline?: boolean; lastSeenAt?: Date | null } | null
): Presence {
  const lastSeenAt = user?.lastSeenAt ? new Date(user.lastSeenAt) : null;
  if (isConnected(userId)) return { isOnline: true, lastSeenAt: lastSeenAt ?? new Date() };
  const fresh = !!lastSeenAt && Date.now() - lastSeenAt.getTime() < STALE_AFTER_MS;
  return { isOnline: !!user?.isOnline && fresh, lastSeenAt };
}

export async function markOnline(userId: string): Promise<Date> {
  const now = new Date();
  await UserModel.updateOne({ _id: userId }, { $set: { isOnline: true, lastSeenAt: now } });
  return now;
}

export async function markOffline(userId: string): Promise<Date> {
  const now = new Date();
  await UserModel.updateOne({ _id: userId }, { $set: { isOnline: false, lastSeenAt: now } });
  return now;
}

/** Keeps lastSeenAt fresh for connected users so other processes see them online. */
export function startHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    const ids = connectedUserIds();
    if (!ids.length) return;
    UserModel.updateMany({ _id: { $in: ids } }, { $set: { isOnline: true, lastSeenAt: new Date() } }).catch(
      (err: Error) => logger.error("Presence heartbeat failed", { message: err.message })
    );
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

export function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/** Clears flags left behind by a process that died without disconnecting. */
export async function clearStalePresence(): Promise<void> {
  await UserModel.updateMany(
    { isOnline: true, lastSeenAt: { $lt: new Date(Date.now() - STALE_AFTER_MS) } },
    { $set: { isOnline: false } }
  );
}

export const PRESENCE_STALE_AFTER_MS = STALE_AFTER_MS;
