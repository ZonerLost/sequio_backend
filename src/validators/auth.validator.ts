import Joi from "joi";

export const registerSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
    "any.required": "Email is required",
  }),
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters",
      "string.pattern.base":
        "Password must contain uppercase, lowercase and number",
      "any.required": "Password is required",
    }),
  firstName: Joi.string().min(2).max(50).required().messages({
    "any.required": "First name is required",
  }),
  lastName: Joi.string().min(2).max(50).required().messages({
    "any.required": "Last name is required",
  }),
  language: Joi.string().valid("en", "fr").default("en"),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const verifyOtpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
  type: Joi.string()
    .valid("email_verification", "password_reset")
    .required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
  newPassword: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required(),
});

export const googleAuthSchema = Joi.object({
  idToken: Joi.string().required(),
  language: Joi.string().valid("en", "fr").default("en"),
});

export const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters",
      "string.pattern.base": "Password must contain uppercase, lowercase and number",
    }),
});

export const phoneSendOtpSchema = Joi.object({
  phone: Joi.string()
    .pattern(/^\+?[1-9]\d{6,14}$/)
    .required()
    .messages({
      "string.pattern.base": "Phone number must be a valid international format (e.g. +14161234567)",
      "any.required": "Phone number is required",
    }),
});

export const phoneVerifyOtpSchema = Joi.object({
  phone: Joi.string()
    .pattern(/^\+?[1-9]\d{6,14}$/)
    .required()
    .messages({
      "string.pattern.base": "Phone number must be a valid international format",
      "any.required": "Phone number is required",
    }),
  otp: Joi.string().length(6).required().messages({
    "string.length": "OTP must be exactly 6 digits",
    "any.required": "OTP is required",
  }),
  firstName: Joi.string().min(2).max(50).optional(),
  lastName: Joi.string().min(2).max(50).optional(),
});