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

export {};