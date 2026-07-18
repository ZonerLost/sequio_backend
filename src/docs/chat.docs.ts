/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: In-app messaging
 */

/**
 * @swagger
 * /chats:
 *   get:
 *     summary: Get my conversations
 *     description: |
 *       Returns conversations the current user is a participant of.
 *       Pass `?archived=true` to retrieve archived conversations instead.
 *       Default (no param) returns only non-archived conversations.
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: archived
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Set to true to fetch archived conversations
 *     responses:
 *       200:
 *         description: Conversations retrieved
 *
 *   post:
 *     summary: Start a new conversation or get existing one
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [participantId, message]
 *             properties:
 *               participantId: { type: string, description: "User ID to start chat with" }
 *               itemId: { type: string, description: "Optional item context" }
 *               message: { type: string, description: "First message to send" }
 *     responses:
 *       201:
 *         description: Conversation started
 *       403:
 *         description: Either participant has blocked the other
 */

/**
 * @swagger
 * /chats/{id}/messages:
 *   get:
 *     summary: Get messages in a conversation
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30 }
 *     responses:
 *       200:
 *         description: Messages retrieved (chronological order)
 *
 *   post:
 *     summary: Send a message in a conversation
 *     description: Blocked participants cannot send messages to each other.
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, maxLength: 2000 }
 *     responses:
 *       201:
 *         description: Message sent
 *       403:
 *         description: Either participant has blocked the other
 */

/**
 * @swagger
 * /chats/{id}/read:
 *   put:
 *     summary: Mark all messages in conversation as read
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Conversation marked as read
 */

/**
 * @swagger
 * /chats/{id}/archive:
 *   put:
 *     summary: Archive a conversation
 *     description: |
 *       Moves the conversation to the caller's archive. The other participant
 *       is unaffected — they still see it in their normal list.
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Conversation archived
 *       404:
 *         description: Conversation not found or user is not a participant
 */

/**
 * @swagger
 * /chats/{id}/unarchive:
 *   put:
 *     summary: Unarchive a conversation
 *     description: Moves the conversation back to the caller's main list.
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Conversation unarchived
 *       404:
 *         description: Conversation not found or user is not a participant
 */

/**
 * @swagger
 * /chats/{id}/messages/{msgId}:
 *   delete:
 *     summary: Delete a message (sender only, soft delete)
 *     tags: [Chat]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: msgId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Message deleted
 */
