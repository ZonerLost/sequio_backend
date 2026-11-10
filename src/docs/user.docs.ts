/**
 * @swagger
 * /users/profile:
 *   get:
 *     tags: [Users]
 *     summary: Get current user profile
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *
 *   put:
 *     tags: [Users]
 *     summary: Update current user profile
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProfileRequest'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
 *
 * /users/profile/photo:
 *   put:
 *     tags: [Users]
 *     summary: Update profile photo
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: JPEG, PNG or WebP image, max 5MB
 *     responses:
 *       200:
 *         description: Photo updated successfully
 *       400:
 *         description: No file uploaded or invalid file type
 *
 * /users/identity-verify:
 *   post:
 *     tags: [Users]
 *     summary: Upload identity document for verification
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: Government ID image, max 5MB
 *     responses:
 *       200:
 *         description: Document uploaded, verification in progress
 *       400:
 *         description: No file uploaded
 *
 * /users/blocked:
 *   get:
 *     tags: [Users]
 *     summary: Get my blocked users list
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Blocked users retrieved
 *
 * /users/block/{userId}:
 *   post:
 *     tags: [Users]
 *     summary: Block a user
 *     description: |
 *       Blocks the specified user. Once blocked, neither party can send
 *       messages to the other until the block is removed.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: User blocked
 *       400:
 *         description: Cannot block yourself
 *       404:
 *         description: User not found
 *
 *   delete:
 *     tags: [Users]
 *     summary: Unblock a user
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: User unblocked
 *       404:
 *         description: User not found
 *
 * /users/{userId}/presence:
 *   get:
 *     summary: Online state and last seen time of a user
 *     description: |
 *       `isOnline` is true while that user holds a live socket. `lastSeenAt` is when they
 *       were last connected. Presence also arrives live via the `presence_update` socket
 *       event and inside the conversation list.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Presence retrieved
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Presence retrieved
 *               data: { userId: 64f..., isOnline: true, lastSeenAt: "2026-09-21T09:44:31.000Z" }
 *       404:
 *         description: User not found
 */

/**
 * @swagger
 * /users/{userId}/report:
 *   post:
 *     tags: [Users]
 *     summary: Report a user
 *     description: |
 *       Submits a moderation report against another user. Only one report
 *       per reporter–target pair is allowed. Reasons: `spam`, `fake_profile`,
 *       `harassment`, `inappropriate_content`, `scam`, `other`.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: [spam, fake_profile, harassment, inappropriate_content, scam, other]
 *               description:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional additional detail
 *               conversationId:
 *                 type: string
 *                 description: Optional conversation context
 *     responses:
 *       201:
 *         description: Report submitted
 *       400:
 *         description: Cannot report yourself or invalid reason
 *       404:
 *         description: User not found
 *       409:
 *         description: Report already submitted against this user
 *
 * /users/addresses:
 *   post:
 *     tags: [Users]
 *     summary: Add a new address
 *     description: >
 *       Adds a saved address for the user. The first address added is automatically
 *       set as default. Maximum 10 addresses per user.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddAddressRequest'
 *     responses:
 *       201:
 *         description: Address added
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Maximum addresses limit reached
 *       401:
 *         description: Unauthorized
 *
 *   get:
 *     tags: [Users]
 *     summary: Get all saved addresses
 *     description: Returns all addresses for the current user, default address listed first.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Addresses retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *
 * /users/addresses/{id}/default:
 *   put:
 *     tags: [Users]
 *     summary: Set an address as default
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Default address updated
 *       403:
 *         description: Forbidden — not your address
 *       404:
 *         description: Address not found
 *
 * /users/addresses/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a saved address
 *     description: >
 *       Deletes the address. If the deleted address was the default, the next
 *       most recent address is automatically promoted to default.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Address deleted
 *       403:
 *         description: Forbidden — not your address
 *       404:
 *         description: Address not found
 */


/**
 * @swagger
 * components:
 *   schemas:
 *     ComplianceStatus:
 *       type: object
 *       description: >
 *         Returned on `GET /users/profile` and on a profile update, as `compliance.age`. It is what
 *         tells a client whether to prompt for a date of birth, and whether the account can rent or
 *         list at all.
 *
 *
 *         **`needsDateOfBirth` is true for every account on the platform today** — the field has
 *         existed since launch, was never required and was never read. `blocked` is false for all of
 *         them, and stays false until the client decides what happens to accounts that predate the
 *         18+ requirement.
 *
 *
 *         Prompt on `needsDateOfBirth`. Refuse on `blocked`. Do not infer either from the other.
 *       properties:
 *         ageVerified:
 *           type: boolean
 *           description: A date of birth is on file **and** it clears the minimum.
 *         needsDateOfBirth:
 *           type: boolean
 *           description: No date of birth at all. Prompt for one; do not block.
 *         blocked:
 *           type: boolean
 *           description: >
 *             Cannot rent or list right now. An account with **no** date of birth is blocked only
 *             under `AGE_VERIFICATION=all`; one whose date of birth is under 18 is blocked always.
 *         minimumAge: { type: integer, example: 18 }
 *         mode:
 *           type: string
 *           enum: [off, new_accounts, all]
 *           description: Which policy is in force, so a refusal can be explained accurately.
 *     TaxRegistration:
 *       type: object
 *       description: >
 *         An owner's GST/HST and QST registration, set through `PUT /users/profile`.
 *
 *
 *         **Nothing in the pricing code reads this yet, deliberately.** The client's tax base is
 *         still unconfirmed in writing, and an allocation rule built on an unconfirmed base collects
 *         the right amount while remitting the wrong tax. The fields are stored, format-validated,
 *         and snapshotted onto each booking so a later change cannot rewrite a rental that already
 *         happened.
 *
 *
 *         `verifiedAt`, `verifiedBy` and `verificationNote` are **read-only** here — an owner
 *         cannot verify their own registration, and sending them is silently discarded. They are set
 *         by `PUT /admin/users/{id}/tax-registration`.
 *       required: [isRegistered]
 *       properties:
 *         isRegistered:
 *           type: boolean
 *           description: >
 *             Required. Absent means the owner was never asked; `false` means they said no. The two
 *             are not the same and must not be conflated.
 *         gstNumber:
 *           type: string
 *           example: 123456789RT0001
 *           description: Nine digits, RT, then four. Spaces, hyphens and lower case are normalised.
 *         qstNumber:
 *           type: string
 *           example: 1234567890TQ0001
 *           description: Ten digits, TQ, then four.
 *         declaredAt: { type: string, format: date-time, readOnly: true }
 *         verifiedAt: { type: string, format: date-time, readOnly: true }
 *         verificationNote: { type: string, readOnly: true }
 */
