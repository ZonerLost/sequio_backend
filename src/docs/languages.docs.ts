/**
 * @swagger
 * /languages:
 *   get:
 *     tags: [Languages]
 *     summary: Get supported app languages
 *     description: >
 *       Returns the list of languages supported by the app. No authentication required.
 *       Note: language switching is a client-side concern — the backend stores the user's
 *       language preference in the user profile (language field) and returns it on login.
 *     security: []
 *     responses:
 *       200:
 *         description: Supported languages retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         example: en
 *                       label:
 *                         type: string
 *                         example: English
 *                       nativeLabel:
 *                         type: string
 *                         example: English
 */

export {};
