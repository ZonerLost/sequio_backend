import Joi from "joi";

export const addAddressSchema = Joi.object({
  label: Joi.string().min(1).max(50).required().messages({
    "any.required": "Address label is required (e.g. Home, Work)",
  }),
  addressLine: Joi.string().min(5).max(200).required().messages({
    "any.required": "Address line is required",
  }),
  city: Joi.string().min(2).max(100).required(),
  province: Joi.string().min(2).max(100).required(),
  country: Joi.string().max(100).default("Canada"),
  postalCode: Joi.string().max(20).optional(),
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).optional(),
});
