/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     description: Creates a new user account and sends OTP to email for verification
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Verify email with OTP
 *     description: Verifies the user's email using the OTP sent during registration
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyEmailRequest'
 *     responses:
 *       200:
 *         description: Email verified successfully, returns tokens
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         accessToken:
 *                           type: string
 *                         refreshToken:
 *                           type: string
 *                         user:
 *                           type: object
 *       400:
 *         description: Invalid or expired OTP
 *
 * /auth/resend-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Resend email verification OTP
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *     responses:
 *       200:
 *         description: OTP resent successfully
 *
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with email and password
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful, returns access and refresh tokens
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         accessToken:
 *                           type: string
 *                           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                         refreshToken:
 *                           type: string
 *                           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                         user:
 *                           type: object
 *       401:
 *         description: Invalid credentials
 *
 * /auth/google:
 *   post:
 *     tags: [Auth]
 *     summary: Login or register with Google
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GoogleAuthRequest'
 *     responses:
 *       200:
 *         description: Google login successful
 *
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request password reset OTP
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *     responses:
 *       200:
 *         description: Reset OTP sent if email exists
 *
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using OTP
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired OTP
 *
 * /auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: New tokens generated
 *
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password (authenticated users only)
 *     description: Changes the password for the currently logged-in user. Requires access token. No OTP needed.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 example: "OldPass@123"
 *               newPassword:
 *                 type: string
 *                 example: "NewPass@456"
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Current password is incorrect
 *       401:
 *         description: Unauthorized
 *
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout user
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: Logged out successfully
 *
 * /auth/phone/send-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Send OTP to phone number (phone login / registration)
 *     description: >
 *       Sends a 6-digit OTP to the given phone number. If no account is linked to this
 *       number a new account is created automatically. Call verify-otp next to complete login.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PhoneSendOtpRequest'
 *     responses:
 *       200:
 *         description: OTP sent to phone number
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid phone number format
 *       403:
 *         description: Account suspended
 *
 * /auth/phone/verify-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Verify phone OTP and login
 *     description: >
 *       Verifies the OTP and returns access + refresh tokens. For new users,
 *       provide firstName and lastName to complete the profile.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PhoneVerifyOtpRequest'
 *     responses:
 *       200:
 *         description: Phone verified, tokens returned
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         accessToken:
 *                           type: string
 *                         refreshToken:
 *                           type: string
 *                         isNewUser:
 *                           type: boolean
 *                           description: True if this phone number was not previously verified
 *                         user:
 *                           type: object
 *       400:
 *         description: Invalid or expired OTP
 *       404:
 *         description: Phone number not found (call send-otp first)
 *
 * /auth/phone/resend-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Resend OTP to phone number
 *     description: Cancels the previous OTP and sends a fresh one to the same phone number.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PhoneSendOtpRequest'
 *     responses:
 *       200:
 *         description: OTP resent
 *       404:
 *         description: Phone number not found (call send-otp first)
 */

export {};