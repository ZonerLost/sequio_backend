# Chat, receipts & presence — app developer guide

Everything an app needs for messaging: live messages, sent/delivered/seen ticks, typing, online and last-seen.

- **API base:** `https://au2p3vkiqi.us-east-1.awsapprunner.com/api/v1`
- **Socket:** same origin (socket.io v4), no path option needed
- **Auth:** the access token from login, on both REST and socket
- **Swagger:** `/api-docs` (the "Chat" tag repeats the event list)

**Changed 2026-09-25** (all additive — nothing that worked before stops working):

1. `new_message` now carries **`conversationId`** as well as `conversation`, so every chat event
   names the conversation the same way. A client reading either key is fine.
2. Deleting a message now also emits **`conversation_updated`**, and the badge no longer counts a
   deleted unread message. A delete-triggered resync is no longer needed.
3. Ungraceful disconnects are detected in ~45 s instead of ~85 s, so an "Online" dot clears
   sooner. `presence_update` with `isOnline: false` always did fire — see §2.

---

## 1. Connect

Send the access token as `auth.token` (or an `Authorization: Bearer …` header).

```js
import { io } from "socket.io-client";

const socket = io("https://au2p3vkiqi.us-east-1.awsapprunner.com", {
  auth: { token: accessToken },
  transports: ["polling"], // the host rejects WebSocket upgrades — see the note below
  upgrade: false,
});

socket.on("connect_error", async (err) => {
  // "Invalid or expired access token" -> refresh, then reconnect with the new one
  if (String(err.message).includes("token")) {
    socket.auth = { token: await refreshAccessToken() };
    socket.connect();
  }
});
```

Dart/Flutter uses the same events via `socket_io_client`:

```dart
final socket = IO.io(origin, IO.OptionBuilder()
    .setTransports(['polling'])          // not ['websocket'] — see the note below
    .setAuth({'token': accessToken})
    .build());
```

> **Use the polling transport.** The API runs on AWS App Runner, which answers a WebSocket
> upgrade with **403**. socket.io then runs over HTTP long-polling, which is what the live
> checks were run against — messages, receipts and presence all work, with about a second of
> latency at worst. Forcing `transports: ['websocket']` fails to connect at all. If the API
> ever moves to a host that allows WebSockets, drop these two options and the client upgrades
> on its own.

On connect the server puts the socket into a room per conversation the user belongs to, so **messages arrive without any join call**. The token is checked at connect time, and banned or deactivated accounts are refused.

---

## 2. Events

### Server → client

**Every event carries `conversationId`.** A message also carries its own `conversation` field
(the REST shape), and on `new_message` the two always hold the same value — read whichever you
prefer, but `conversationId` works on all six events.

| Event | Payload | Use it for |
|---|---|---|
| `new_message` | the message (see §4), plus `conversationId` | append to the open chat; bump the list |
| `conversation_updated` | `{ type: "conversation", conversationId, lastMessage, unreadCount, updatedAt }` | update the conversation list row + badge |
| `conversation_updated` | `{ type: "notification", notification }` | a notification, **not** a chat update — route it elsewhere |
| `messages_delivered` | `{ conversationId, messageIds, deliveredAt, recipientId }` | single tick → double tick |
| `messages_read` | `{ conversationId, messageIds, readAt, readerId }` | double tick → "seen" |
| `message_deleted` | `{ conversationId, messageId, deletedBy }` | remove the bubble |
| `presence_update` | `{ userId, isOnline, lastSeenAt }` | online dot / "last seen …" — fires **both** ways |
| `user_typing` / `user_stop_typing` | `{ userId, conversationId }` | typing indicator |

Real payloads, captured from a running server:

```jsonc
// conversation_updated — a chat update. unreadCount is YOUR count (a number, not a map)
{ "type": "conversation", "conversationId": "6ab0…",
  "lastMessage": { "content": "Hi Bob", "sender": "6ab0…", "createdAt": "2026-09-21T09:56:55.308Z" },
  "unreadCount": 1, "updatedAt": "2026-09-21T09:56:55.309Z" }

// messages_delivered — the recipient is connected, so your ticks go double
{ "conversationId": "6ab0…", "messageIds": ["6ab0…"],
  "deliveredAt": "2026-09-21T09:56:55.307Z", "recipientId": "6ab0…" }

// messages_read — they opened the chat; every listed id is now "seen"
{ "conversationId": "6ab0…", "messageIds": ["6ab0…", "6ab0…"],
  "readAt": "2026-09-21T09:56:55.901Z", "readerId": "6ab0…" }

// presence_update
{ "userId": "6ab0…", "isOnline": true, "lastSeenAt": "2026-09-21T09:56:55.106Z" }
```

**Presence fires on the way down too.** `isOnline: false` is emitted when a user's **last**
socket closes, to everyone they have a conversation with, so an online dot does turn back off
without leaving the screen. Two things to expect:

- With several devices, one of them closing emits nothing — the user is still online elsewhere.
- A clean close (app closed, `socket.disconnect()`) is immediate. A device that vanishes without
  a close frame — killed app, tunnel dropped, phone off network — is only noticed when a
  heartbeat goes unanswered, **up to ~45 s**. That is the price of not flapping people offline
  on a brief mobile stall.

**Deleting a message also emits `conversation_updated`**, right after `message_deleted`, so the
list row fixes itself: the preview falls back to the newest surviving message (`lastMessage` is
`null` when the last one is gone) and the badge stops counting a deleted unread message. You do
not need a resync on delete.

### Client → server

| Event | Argument | Notes |
|---|---|---|
| `join_conversation` | `conversationId`, optional ack | Needed **only for typing**. Ack returns `{ ok: true }` or `{ ok: false, error }`; membership is checked server-side. |
| `leave_conversation` | `conversationId` | when the chat screen closes |
| `typing` / `stop_typing` | `{ conversationId }` | ignored unless you joined that conversation |

```js
socket.emit("join_conversation", conversationId, (res) => {
  if (!res.ok) console.warn(res.error); // not a participant
});
socket.emit("typing", { conversationId });
```

---

## 3. REST endpoints

All need `Authorization: Bearer <accessToken>` and answer with `{ success, message, data }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/chats?archived=false` | conversation list (presence + unread included) |
| POST | `/chats` | start (or reuse) a conversation and send the first message — `{ participantId, itemId?, message }` |
| GET | `/chats/{id}/messages?page=1&limit=30` | message history |
| POST | `/chats/{id}/messages` | send — `{ content }` |
| PUT | `/chats/{id}/read` | mark the conversation read → `{ read, readAt }` |
| GET | `/chats/unread-count` | badge → `{ total, conversations }` |
| PUT | `/chats/{id}/archive` | hide the conversation from the default list |
| PUT | `/chats/{id}/unarchive` | bring it back (`GET /chats?archived=true` lists archived ones) |
| DELETE | `/chats/{id}/messages/{msgId}` | soft-delete your own message |
| GET | `/users/{userId}/presence` | `{ userId, isOnline, lastSeenAt }` |

**Message paging:** page 1 is the **most recent** 30 messages, ordered oldest → newest inside the page; page 2 is the 30 before those. `pagination` sits at the top level of the response, next to `data`.

---

## 4. Shapes

> **A field that has not happened yet is absent, not `null`.** A message gains `deliveredAt`
> only once delivered and `readAt` only once read, and `profilePhoto` is missing when the user
> has none. Test with `if (message.deliveredAt)`, never `=== null`.

**Message** — as returned by `POST /chats/{id}/messages` and sent as `new_message`. The
`conversationId` line is added by the **socket event only**; the REST response carries
`conversation` alone, and the two always match:

```json
{
  "_id": "6ab0ff676cb94bb72fa6d942",
  "conversation": "6ab0ff676cb94bb72fa6d932",
  "conversationId": "6ab0ff676cb94bb72fa6d932",
  "sender": { "_id": "6ab0ff666cb94bb72fa6d90d", "firstName": "Alice", "lastName": "T" },
  "content": "Are you free Saturday?",
  "isRead": false,
  "deliveredAt": "2026-09-21T09:56:55.357Z",
  "createdAt": "2026-09-21T09:56:55.358Z",
  "updatedAt": "2026-09-21T09:56:55.358Z",
  "__v": 0
}
```

**Conversation** (`GET /chats` → `data[]`)

```json
{
  "_id": "6ab0ff676cb94bb72fa6d932",
  "participants": [
    { "_id": "6ab0ff666cb94bb72fa6d90d", "firstName": "Alice", "lastName": "T",
      "isOnline": true, "lastSeenAt": "2026-09-21T09:56:54.943Z" },
    { "_id": "6ab0ff666cb94bb72fa6d914", "firstName": "Bob", "lastName": "T",
      "isOnline": false, "lastSeenAt": "2026-09-21T09:56:55.106Z" }
  ],
  "item": { "_id": "6ab0ff666cb94bb72fa6d91a", "title": "Drill", "photos": ["https://…/p.jpg"] },
  "lastMessage": { "content": "Are you free Saturday?", "sender": "6ab0ff666cb94bb72fa6d90d",
                   "createdAt": "2026-09-21T09:56:55.358Z" },
  "unread": 2,
  "unreadCount": { "6ab0ff666cb94bb72fa6d90d": 0, "6ab0ff666cb94bb72fa6d914": 2 },
  "archivedBy": [],
  "updatedAt": "2026-09-21T09:56:55.359Z"
}
```

- `participants` **includes you** — pick the other person by comparing `_id` with your own user id.
- `unread` is already scoped to the caller; prefer it over digging into `unreadCount`.
- `item` is present only when the conversation was started from a listing.

---

## 5. Building the UI

**Ticks.** One state machine per message:

| State | Condition |
|---|---|
| Sending | POST in flight |
| Sent ✓ | POST returned, no `deliveredAt` on the message |
| Delivered ✓✓ | `deliveredAt` set, or a `messages_delivered` carrying its id |
| Seen ✓✓ (blue) | `readAt` set, or a `messages_read` carrying its id |

Delivered means the recipient's app was connected — not that they looked at it. If they were offline, it flips as soon as they reconnect, and you get `messages_delivered` then.

**Chat screen**
1. `GET /chats/{id}/messages` for history.
2. `join_conversation` (for typing).
3. `PUT /chats/{id}/read` on open, and again when new messages arrive while open.
4. Append on `new_message`; update ticks on `messages_delivered` / `messages_read`.
5. `leave_conversation` on close.

**Conversation list.** Render from `GET /chats`, then patch rows on `conversation_updated` (`type: "conversation"`); update the online dot on `presence_update`. Badge: `unread` per row, `GET /chats/unread-count` for the app icon.

**Presence text.** `isOnline` → "Online", otherwise "Last seen {lastSeenAt}". Live updates come from `presence_update`; a value fetched over REST can be up to ~75 s stale after a server restart, which is deliberate so a crash can't leave people stuck "online".

---

## 6. Things that will bite you

- **You receive your own messages.** The sender is in the room too, so `new_message` fires for messages you just sent. De-duplicate by `_id` against what the POST returned.
- **`conversation_updated` carries two shapes.** Always check `type` before reading `conversationId`.
- **Tokens expire (15 min default).** An open socket keeps working, but reconnects fail until you refresh. Handle `connect_error` as in §1.
- **Blocked users:** sending returns **403** `"Cannot send messages to this user"`. Show it as a normal message, not an error dialog.
- **Not a participant:** any conversation endpoint returns **404** `"Conversation not found"`, and `join_conversation` acks `{ ok: false }`.
- **Deleted messages** are soft-deleted: they disappear from history and you get `message_deleted`, followed by a `conversation_updated` for the list row.
- **Presence is per user, not per socket.** A user on two devices only goes offline when the second one closes, and an ungraceful disconnect takes up to ~45 s to register (§2).
- **Never force the websocket transport.** The host refuses the upgrade (403); connect with polling as in §1.
- **A notification row is created only when you are disconnected.** While your socket is live you get `new_message` instead, so the notification list is not filled with one row per message.
- **Push notifications are not sent yet.** `POST /users/fcm-token` stores the token, but the server-side FCM send is still a stub, so nothing arrives while the app is closed. In-app notifications do arrive over the socket as `conversation_updated` with `type: "notification"`.

---

## 7. Quick test

Two accounts, two devices:

1. Both open the app → each sees the other's dot go green (`presence_update`).
2. A sends → B sees it instantly; A's tick goes double straight away.
3. B opens the chat → A's tick turns to seen.
4. Kill B's app, A sends → one tick. Reopen B → A's tick goes double.
5. B's list badge counts up while the chat is closed, and clears when opened.
