import Joi from "joi";
import { OWNER_CANCELLATION_REASONS } from "../models/owner-cancellation.model";

// POST /bookings/quote had no validator, so a malformed body produced a 200 with null prices.
// Deliberately permissive about what the client already sends; it only rejects nonsense.
export const quoteSchema = Joi.object({
  dailyRate: Joi.number().positive().max(100000).required(),
  startDate: Joi.date().required(),
  endDate: Joi.date().greater(Joi.ref("startDate")).required().messages({
    "date.greater": "endDate must be after startDate",
  }),
  deliveryType: Joi.string().valid("pickup", "delivery").default("pickup"),
  discountCode: Joi.string().max(50).allow("", null).optional(),
});

export const createBookingSchema = Joi.object({
  itemId: Joi.string().required(),
  startDate: Joi.date().min("now").required(),
  endDate: Joi.date().greater(Joi.ref("startDate")).required(),
  deliveryType: Joi.string().valid("pickup", "delivery").required(),
  deliveryAddress: Joi.when("deliveryType", {
    is: "delivery",
    then: Joi.object({
      label: Joi.string().optional(),
      street: Joi.string().required(),
      city: Joi.string().required(),
      province: Joi.string().required(),
      country: Joi.string().default("Canada"),
      coordinates: Joi.object({
        lat: Joi.number().optional(),
        lng: Joi.number().optional(),
      }).optional(),
    }).required(),
    otherwise: Joi.forbidden(),
  }),
  pickupTimeFrom: Joi.when("deliveryType", {
    is: "pickup",
    then: Joi.string().optional(),
    otherwise: Joi.forbidden(),
  }),
  pickupTimeTo: Joi.when("deliveryType", {
    is: "pickup",
    then: Joi.string().optional(),
    otherwise: Joi.forbidden(),
  }),
  discountCode: Joi.string().optional(),
});

export const declineBookingSchema = Joi.object({
  reason: Joi.string().max(500).optional(),
});

export const cancelBookingSchema = Joi.object({
  reason: Joi.string().max(500).optional(),
});

/**
 * Confirming a handover or a return.
 *
 * `at` is optional and defaults to now. It exists because the confirmation often happens later than
 * the event — the renter hands the drill back at the door and remembers to tap the button on the
 * bus home — and every deadline downstream runs from the real time, not the tap.
 *
 * It cannot be in the future, and it cannot be more than 7 days ago: a plausible correction, not a
 * free hand to rewrite history and reopen a closed claim window.
 */
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

const actualTimeSchema = Joi.date()
  .max("now")
  // Computed per request, not once at module load: a bound built from Date.now() at startup would
  // drift further out of date every day the process stays up.
  .custom((value, helpers) =>
    new Date(value).getTime() < Date.now() - MAX_BACKDATE_MS
      ? helpers.error("date.tooOld")
      : value
  )
  .optional()
  .messages({
    "date.max": "The time cannot be in the future",
    "date.tooOld": "The time cannot be more than 7 days ago — contact support to correct it",
  });

export const confirmHandoverSchema = Joi.object({
  at: actualTimeSchema,
  note: Joi.string().max(500).optional(),
});

export const confirmReturnSchema = Joi.object({
  at: actualTimeSchema,
  note: Joi.string().max(500).optional(),
});

/** Contesting a return time the other party recorded. */
export const disputeReturnTimeSchema = Joi.object({
  claimedAt: Joi.date().max("now").required().messages({
    "date.max": "The time you are claiming cannot be in the future",
    "any.required": "Say when you believe the item was actually returned",
  }),
  reason: Joi.string().min(3).max(500).required(),
});

/**
 * An owner cancelling a booking they had already accepted.
 *
 * The explanation is required in **every** case, not only for "other". The specification asks for
 * "categories ... plus a required written explanation", and a bare category is not something an
 * administrator can review three weeks later when the owner appeals their suspension.
 */
export const ownerCancelSchema = Joi.object({
  reason: Joi.string()
    .valid(...OWNER_CANCELLATION_REASONS)
    .required()
    .messages({ "any.only": "Choose one of the listed cancellation reasons" }),
  explanation: Joi.string().min(10).max(1000).required().messages({
    "string.min": "Explain what happened in at least a few words — this is reviewed if you appeal",
    "any.required": "An explanation is required",
  }),
});

export const reviewCancellationSchema = Joi.object({
  excused: Joi.boolean().required(),
  note: Joi.string().min(3).max(500).required(),
});

export const bookingQuerySchema = Joi.object({
  status: Joi.string()
    .valid("pending", "accepted", "active", "completed", "declined", "cancelled")
    .optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
});