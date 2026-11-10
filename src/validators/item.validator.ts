import Joi from "joi";
import { isKnownTimeZone } from "../helpers/timezone.helper";

/**
 * Kilometres. A cap exists so a client that mistakes the unit and sends metres gets a 400 naming
 * the limit, instead of silently receiving the entire database as "nearby".
 */
const MAX_RADIUS_KM = 500;

/**
 * An override for the listing's local time zone — the clock the cancellation windows are measured
 * against.
 *
 * Rarely needed: the zone is derived from the coordinates on every read. It exists for a listing
 * close to a zone boundary, where a longitude band can be an hour out.
 *
 * Checked against the real IANA database here rather than accepted and warned about later. A typo
 * would otherwise move every cancellation deadline on the listing, and the owner would have no way
 * to tell: `timeZoneFor` ignores an unknown value and carries on with the derived one.
 */
const timeZoneSchema = Joi.string()
  .custom((value, helpers) => (isKnownTimeZone(value) ? value : helpers.error("string.timeZone")))
  .messages({
    "string.timeZone": "Not a recognised time zone name — use an IANA name such as America/Toronto",
  });

const deliveryPricingTierSchema = Joi.object({
  radius: Joi.number().min(1).required(),
  fee: Joi.number().min(0).required(),
});

const deliveryOptionsSchema = Joi.object({
  pickup: Joi.boolean().default(true),
  delivery: Joi.boolean().default(false),
  deliveryRadius: Joi.number().min(1).optional(),
  deliveryFee: Joi.number().min(0).optional(),
  deliveryPricing: Joi.array().items(deliveryPricingTierSchema).optional(),
});

export const createItemSchema = Joi.object({
  title: Joi.string().min(5).max(100).required(),
  description: Joi.string().min(20).max(2000).required(),
  category: Joi.string().required(),
  subCategory: Joi.string().optional(),
  /**
   * The taxonomy, as `GET /items/classify` returns it — copy the chosen suggestion's three fields
   * straight across. `category` accepts either vocabulary: one of the 20 legacy slugs the app has
   * always sent, or a slug from the new tree.
   *
   * An `itemType` is what makes eligibility enforceable, so sending one is how an owner gets a
   * clear refusal up front instead of a listing an administrator removes later.
   */
  subcategory: Joi.string().optional(),
  itemType: Joi.string().optional(),
  dailyRate: Joi.number().min(1).required(),
  weeklyRate: Joi.number().min(1).optional(),
  monthlyRate: Joi.number().min(1).optional(),
  depositAmount: Joi.number().min(0).default(0),
  minRentalDays: Joi.number().integer().min(1).default(1),
  maxRentalDays: Joi.number().integer().min(1).optional(),
  quantity: Joi.number().integer().min(1).default(1),
  currency: Joi.string().default("CAD"),
  location: Joi.object({
    address: Joi.string().optional(),
    city: Joi.string().required(),
    province: Joi.string().required(),
    country: Joi.string().default("Canada"),
    coordinates: Joi.object({
      lat: Joi.number().required(),
      lng: Joi.number().required(),
    }).optional(),
    timeZone: timeZoneSchema.optional(),
  }).required(),
  deliveryOptions: deliveryOptionsSchema.default({ pickup: true, delivery: false }),
  availability: Joi.object({
    availableFrom: Joi.date().optional(),
    availableTo: Joi.date().optional(),
  }).optional(),
  bookingType: Joi.string().valid("manual", "instant").default("manual"),
  condition: Joi.string().valid("new", "like_new", "good", "fair").required(),
  tags: Joi.array().items(Joi.string()).optional(),
});

export const updateItemSchema = Joi.object({
  title: Joi.string().min(5).max(100).optional(),
  description: Joi.string().min(20).max(2000).optional(),
  category: Joi.string().optional(),
  subCategory: Joi.string().optional(),
  subcategory: Joi.string().optional(),
  itemType: Joi.string().optional(),
  dailyRate: Joi.number().min(1).optional(),
  weeklyRate: Joi.number().min(1).optional(),
  monthlyRate: Joi.number().min(1).optional(),
  depositAmount: Joi.number().min(0).optional(),
  minRentalDays: Joi.number().integer().min(1).optional(),
  maxRentalDays: Joi.number().integer().min(1).optional(),
  quantity: Joi.number().integer().min(1).optional(),
  location: Joi.object({
    address: Joi.string().optional(),
    city: Joi.string().optional(),
    province: Joi.string().optional(),
    country: Joi.string().optional(),
    coordinates: Joi.object({
      lat: Joi.number(),
      lng: Joi.number(),
    }).optional(),
    timeZone: timeZoneSchema.allow(null, "").optional(),
  }).optional(),
  deliveryOptions: deliveryOptionsSchema.optional(),
  bookingType: Joi.string().valid("manual", "instant").optional(),
  condition: Joi.string().valid("new", "like_new", "good", "fair").optional(),
  tags: Joi.array().items(Joi.string()).optional(),
});

export const updateAvailabilitySchema = Joi.object({
  isAvailable: Joi.boolean().optional(),
  blockedDates: Joi.array().items(Joi.date()).optional(),
  availableFrom: Joi.date().optional(),
  availableTo: Joi.date().optional(),
});

const daySlotSchema = Joi.object({
  enabled: Joi.boolean().required(),
  allDay: Joi.boolean().default(false),
  startTime: Joi.string()
    .pattern(/^\d{2}:\d{2}$/)
    .optional()
    .messages({ "string.pattern.base": "startTime must be in HH:MM format" }),
  endTime: Joi.string()
    .pattern(/^\d{2}:\d{2}$/)
    .optional()
    .messages({ "string.pattern.base": "endTime must be in HH:MM format" }),
});

const recurringDaysSchema = Joi.object({
  monday: daySlotSchema.optional(),
  tuesday: daySlotSchema.optional(),
  wednesday: daySlotSchema.optional(),
  thursday: daySlotSchema.optional(),
  friday: daySlotSchema.optional(),
  saturday: daySlotSchema.optional(),
  sunday: daySlotSchema.optional(),
}).optional();

export const updateScheduleSchema = Joi.object({
  scheduleType: Joi.string().valid("recurring", "specific_dates").default("recurring"),
  recurringDays: recurringDaysSchema,
  specificDates: Joi.array()
    .items(
      daySlotSchema.keys({
        date: Joi.date().required(),
      })
    )
    .optional(),
});

export const itemQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  /**
   * Either vocabulary. A legacy slug is translated to the most precise taxonomy level it means —
   * `cameras` finds Photography & video, not the whole of Electronics. See categoryFilter().
   */
  category: Joi.string().optional(),
  /** The new levels, for a client that has the catalogue. Narrower than `category`. */
  subcategory: Joi.string().optional(),
  itemType: Joi.string().optional(),
  city: Joi.string().optional(),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().optional(),
  condition: Joi.string().valid("new", "like_new", "good", "fair").optional(),
  search: Joi.string().optional(),
  sortBy: Joi.string()
    // "distance" needs lat+lng; the service falls back to createdAt without them.
    .valid("dailyRate", "createdAt", "averageRating", "totalRentals", "distance")
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  // Kilometres, and deliberately without a Joi default: the service owns the default so that
  // "radius wins over distance" stays decidable, which a default would make impossible.
  radius: Joi.number().min(1).max(MAX_RADIUS_KM).optional(),
  // The app has always sent this name. stripUnknown used to discard it, so it silently did
  // nothing; it is an alias for radius, in kilometres.
  distance: Joi.number().min(1).max(MAX_RADIUS_KM).optional(),
});

/** The Add Item screen asks on each pause in typing, so the title may be a fragment. */
export const classifyQuerySchema = Joi.object({
  title: Joi.string().min(2).max(200).required().messages({
    "string.min": "Type a little more before asking for a suggestion",
  }),
});

export const feedQuerySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  radius: Joi.number().min(1).max(MAX_RADIUS_KM).optional(),
  distance: Joi.number().min(1).max(MAX_RADIUS_KM).optional(),
  limit: Joi.number().integer().min(1).max(20).default(10),
});
