import Joi from "joi";

export const PAYMENT_METHOD_TYPES = ["apple_pay", "google_pay", "credit_card", "debit_card"] as const;

// Accepted card brands. Anything was accepted before, so clients had no way to know what was valid.
export const CARD_BRANDS = [
  "visa",
  "mastercard",
  "amex",
  "discover",
  "jcb",
  "unionpay",
  "diners",
  "other",
] as const;

const currentYear = () => new Date().getUTCFullYear();

/** Rejects a card that has already expired — month granularity, evaluated at request time. */
const notExpired: Joi.CustomValidator<{ expiryMonth: number; expiryYear: number }> = (card, helpers) => {
  const now = new Date();
  const expired =
    card.expiryYear < now.getUTCFullYear() ||
    (card.expiryYear === now.getUTCFullYear() && card.expiryMonth < now.getUTCMonth() + 1);
  return expired ? helpers.error("card.expired") : card;
};

const cardSchema = Joi.object({
  last4: Joi.string()
    .length(4)
    .pattern(/^\d{4}$/)
    .required()
    .messages({ "string.pattern.base": "last4 must be 4 digits" }),
  brand: Joi.string()
    .lowercase()
    .valid(...CARD_BRANDS)
    .required(),
  expiryMonth: Joi.number().integer().min(1).max(12).required(),
  // No hardcoded year: a literal like 2024 silently starts accepting expired cards as time passes.
  expiryYear: Joi.number().integer().min(currentYear()).max(currentYear() + 25).required(),
})
  .custom(notExpired)
  .messages({ "card.expired": "This card has already expired" });

export const createPaymentIntentSchema = Joi.object({
  bookingId: Joi.string().required(),
});

export const recordPaymentSchema = Joi.object({
  bookingId: Joi.string().required(),
  paymentIntentId: Joi.string().optional(),
  // Naming a saved method is the precise way to record what was paid with; `method` is then derived
  // from it. Supplying both is fine as long as they agree (the service checks).
  paymentMethodId: Joi.string().optional(),
  method: Joi.string()
    .valid(...PAYMENT_METHOD_TYPES)
    .when("paymentMethodId", {
      is: Joi.exist(),
      then: Joi.optional(),
      otherwise: Joi.when("paymentIntentId", {
        is: Joi.exist(),
        then: Joi.optional(),
        otherwise: Joi.required(),
      }),
    })
    .messages({ "any.required": "Provide either method, paymentMethodId or paymentIntentId" }),
  // A gateway reference when one exists.
  externalReference: Joi.string().max(255).optional(),
});

export const savePaymentMethodSchema = Joi.object({
  type: Joi.string()
    .valid(...PAYMENT_METHOD_TYPES)
    .required(),
  label: Joi.string().trim().min(1).max(100).required(),
  isDefault: Joi.boolean().default(false),
  // A wallet has no card details, so `card` is required for cards and forbidden for wallets.
  card: Joi.when("type", {
    is: Joi.valid("credit_card", "debit_card"),
    then: cardSchema.required(),
    otherwise: Joi.forbidden(),
  }),
});

export const paymentQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  // payer (money out, the default and previous behaviour), payee (money in), or both.
  role: Joi.string().valid("payer", "payee", "all").default("payer"),
});
