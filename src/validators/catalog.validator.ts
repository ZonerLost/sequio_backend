import Joi from "joi";
import { ALIAS_KINDS, ELIGIBILITY_STATUSES } from "../models/catalog.model";

/**
 * The admin dictionary's schemas.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 * - **`slug` is accepted on create and refused on update.** `stripUnknown` is what enforces that:
 *   an update body carrying a slug has it silently dropped rather than renaming an identifier that
 *   every listing holds. Renaming is `nameEn`/`nameFr`; replacing is `mergedInto`.
 * - **`nameFr` accepts null.** The client has supplied no French copy, so the field is null across
 *   all 100 nodes and an administrator filling one in has to be able to clear it again. Without
 *   `.allow(null)` Joi would reject the only value it currently holds.
 */

const slug = Joi.string()
  .pattern(/^[a-z0-9_]+$/)
  .min(2)
  .max(60)
  .messages({
    "string.pattern.base":
      "A slug is an identifier, not a label: lowercase letters, digits and underscores only.",
  });

const names = {
  nameEn: Joi.string().trim().min(1).max(120),
  nameFr: Joi.string().trim().min(1).max(120).allow(null),
  sortOrder: Joi.number().integer().min(0).max(9999),
};

export const createCategorySchema = Joi.object({
  slug: slug.required(),
  nameEn: names.nameEn.required(),
  nameFr: names.nameFr.optional(),
  sortOrder: names.sortOrder.optional(),
});

export const createSubcategorySchema = createCategorySchema.keys({
  category: slug.required(),
});

export const createItemTypeSchema = createCategorySchema.keys({
  subcategory: slug.required(),
  eligibility: Joi.string().valid(...ELIGIBILITY_STATUSES).optional(),
  /** Shown to the owner when a listing is blocked, so it has to say what to do about it. */
  eligibilityNote: Joi.string().trim().max(600).allow(null).optional(),
});

const nodeUpdateKeys = {
  nameEn: names.nameEn.optional(),
  nameFr: names.nameFr.optional(),
  sortOrder: names.sortOrder.optional(),
  active: Joi.boolean().optional(),
  /** The surviving slug. `null` undoes a merge. */
  mergedInto: slug.allow(null).optional(),
};

export const updateCategorySchema = Joi.object(nodeUpdateKeys).min(1);

export const updateSubcategorySchema = Joi.object({
  ...nodeUpdateKeys,
  /** Moving a subcategory re-points every listing under it in the same operation. */
  category: slug.optional(),
}).min(1);

export const updateItemTypeSchema = Joi.object({
  ...nodeUpdateKeys,
  subcategory: slug.optional(),
  eligibility: Joi.string().valid(...ELIGIBILITY_STATUSES).optional(),
  eligibilityNote: Joi.string().trim().max(600).allow(null).optional(),
}).min(1);

export const createAliasSchema = Joi.object({
  /** As a human writes it. The normalised form is derived, never supplied. */
  phrase: Joi.string().trim().min(2).max(120).required(),
  itemType: slug.required(),
  language: Joi.string().valid("en", "fr", "any").optional(),
  /**
   * `brand`, `usage` and `typo` weigh less than `synonym` on purpose — a brand can suggest an item
   * type but must never decide one. Picking the wrong kind here is the single easiest way to make
   * the classifier confidently wrong, which is the one thing it is built not to be.
   */
  kind: Joi.string().valid(...ALIAS_KINDS).optional(),
  /** Overrides the default weight for the kind. Leave unset unless there is a reason. */
  weight: Joi.number().min(0).max(1).allow(null).optional(),
  approved: Joi.boolean().optional(),
});

export const updateAliasSchema = Joi.object({
  phrase: Joi.string().trim().min(2).max(120).optional(),
  itemType: slug.optional(),
  language: Joi.string().valid("en", "fr", "any").optional(),
  kind: Joi.string().valid(...ALIAS_KINDS).optional(),
  weight: Joi.number().min(0).max(1).allow(null).optional(),
  approved: Joi.boolean().optional(),
}).min(1);

export const aliasQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").max(120).optional(),
  itemType: slug.optional(),
  kind: Joi.string().valid(...ALIAS_KINDS).optional(),
  approved: Joi.boolean().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});

export const feedbackQuerySchema = Joi.object({
  corrected: Joi.boolean().optional(),
  reviewed: Joi.boolean().optional(),
  /** Terms the classifier had no answer for at all — the clearest sign a word is missing. */
  unmatchedOnly: Joi.boolean().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});

export const reviewFeedbackSchema = Joi.object({
  /**
   * Teaches the dictionary what the answer should have been, in the same call that closes the row.
   * The phrase comes from the feedback itself, so an administrator cannot mistype the term they are
   * fixing.
   */
  addAlias: Joi.object({
    itemType: slug.required(),
    kind: Joi.string().valid(...ALIAS_KINDS).optional(),
  }).optional(),
});
