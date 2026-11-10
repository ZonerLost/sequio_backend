import Joi from "joi";
import { dateOfBirthSchema, taxRegistrationSchema } from "./compliance.validator";
import { REPORT_REASONS } from "../models/user-report.model";

export const updateProfileSchema = Joi.object({
  email: Joi.string().email().lowercase().optional(),
  firstName: Joi.string().min(2).max(50).optional(),
  lastName: Joi.string().min(2).max(50).optional(),
  phone: Joi.string().optional(),
  bio: Joi.string().max(500).optional(),
  /**
   * Validated now, where it used to be accepted unchecked.
   *
   * This is the field an existing account fills in when prompted, so it is the main way the 18+
   * requirement will ever be satisfied for the 37 accounts that have none.
   */
  dateOfBirth: dateOfBirthSchema.optional(),
  language: Joi.string().optional(),
  location: Joi.object({
    address: Joi.string().optional(),
    city: Joi.string().optional(),
    province: Joi.string().optional(),
    country: Joi.string().optional(),
    coordinates: Joi.object({
      lat: Joi.number(),
      lng: Joi.number(),
    }).optional(),
  }).optional(),
  taxRegistration: taxRegistrationSchema.optional(),
});

export const reportUserSchema = Joi.object({
  reason: Joi.string()
    .valid(...REPORT_REASONS)
    .required(),
  description: Joi.string().max(500).optional(),
  conversationId: Joi.string().optional(),
});
