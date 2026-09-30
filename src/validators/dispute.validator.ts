import Joi from "joi";

export const DISPUTE_STATUSES = [
  "open",
  "under_review",
  "resolved_for_renter",
  "resolved_for_owner",
  "resolved_mutually",
  "closed",
] as const;

export const createDisputeSchema = Joi.object({
  bookingId: Joi.string().required(),
  reason: Joi.string()
    .valid(
      "item_damaged",
      "item_not_returned",
      "item_not_as_described",
      "late_return",
      "no_show",
      "payment_issue",
      "other"
    )
    .required(),
  description: Joi.string().min(20).max(2000).required(),
});

export const resolveDisputeSchema = Joi.object({
  status: Joi.string()
    .valid("resolved_for_renter", "resolved_for_owner", "resolved_mutually", "closed")
    .required(),
  adminNote: Joi.string().max(2000).optional(),
});

export const disputeQuerySchema = Joi.object({
  status: Joi.string()
    .valid(...DISPUTE_STATUSES)
    .optional(),
  // Which side of the dispute: raised by me, raised against me, or both (the default).
  role: Joi.string().valid("reporter", "against", "all").default("all"),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
});

// PUT /disputes/admin/:id/status had no validator: any string was written straight onto the
// document, and one typo hid the dispute from every admin status filter with no error anywhere.
export const updateDisputeStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...DISPUTE_STATUSES)
    .required(),
});