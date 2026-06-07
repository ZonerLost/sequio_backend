import Joi from "joi";

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
  category: Joi.string().optional(),
  city: Joi.string().optional(),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().optional(),
  condition: Joi.string().valid("new", "like_new", "good", "fair").optional(),
  search: Joi.string().optional(),
  sortBy: Joi.string()
    .valid("dailyRate", "createdAt", "averageRating", "totalRentals")
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
  lat: Joi.number().optional(),
  lng: Joi.number().optional(),
  radius: Joi.number().min(1).default(20),
});

export const feedQuerySchema = Joi.object({
  lat: Joi.number().optional(),
  lng: Joi.number().optional(),
  radius: Joi.number().min(1).default(20),
  limit: Joi.number().integer().min(1).max(20).default(10),
});
