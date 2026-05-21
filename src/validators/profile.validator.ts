import Joi from "joi";

export const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).optional(),
  lastName: Joi.string().min(2).max(50).optional(),
  phone: Joi.string().optional(),
  bio: Joi.string().max(500).optional(),
  dateOfBirth: Joi.date().optional(),
  language: Joi.string().valid("en", "fr").optional(),
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
});