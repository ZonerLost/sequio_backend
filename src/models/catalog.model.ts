import mongoose, { Schema, Document } from "mongoose";

/**
 * The rental item catalogue: categories, subcategories, item types and the words people use for
 * them.
 *
 * Before this there were 20 flat English slugs in `CO2_BY_CATEGORY`, no subcategories, no
 * translations, no synonyms and no eligibility rules. The client's specification wants an owner to
 * type "Kärcher to clean the patio" and have the right classification suggested, in French or
 * English, with the vocabulary editable by an administrator **without an app release**.
 *
 * ## Two rules from their specification that are easy to get wrong once and painful to undo
 *
 * 1. **Never use a translated label as an identifier.** Everything references a `slug`, which is
 *    stable, lowercase and never shown to a user. `nameEn`/`nameFr` are display only. Renaming a
 *    category in French must not move a single listing.
 * 2. **Preserve historical listings when something is renamed, moved, merged or deactivated.**
 *    Nothing is ever deleted. `active: false` hides a node from pickers while existing listings keep
 *    resolving, and `mergedInto` points at the survivor so an old slug still leads somewhere.
 *
 * References are by **slug, not ObjectId**, on purpose: a taxonomy is re-seeded, exported, diffed
 * and talked about by humans, and `"power_tools"` survives all of that in a way an ObjectId does not.
 */

interface TaxonomyNode {
  /** Stable, lowercase, never translated, never shown to a user. */
  slug: string;
  nameEn: string;
  /** Null until the client supplies French copy. See CLIENT_DOCS_REVIEW.md. */
  nameFr: string | null;
  sortOrder: number;
  active: boolean;
  /** Slug of the node this one was merged into. Set instead of deleting. */
  mergedInto: string | null;
}

const nodeFields = {
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  nameEn: { type: String, required: true },
  nameFr: { type: String, default: null },
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  mergedInto: { type: String, default: null },
};

// ── categories ──────────────────────────────────────────────────────────────────────────────────

export interface ICategory extends Document, TaxonomyNode {}

const CategorySchema = new Schema<ICategory>({ ...nodeFields }, { timestamps: true });
export const CategoryModel = mongoose.model<ICategory>("Category", CategorySchema);

// ── subcategories ───────────────────────────────────────────────────────────────────────────────

export interface ISubcategory extends Document, TaxonomyNode {
  category: string;
}

const SubcategorySchema = new Schema<ISubcategory>(
  { ...nodeFields, category: { type: String, required: true, lowercase: true } },
  { timestamps: true }
);
SubcategorySchema.index({ category: 1, sortOrder: 1 });
export const SubcategoryModel = mongoose.model<ISubcategory>("Subcategory", SubcategorySchema);

// ── item types ──────────────────────────────────────────────────────────────────────────────────

/**
 * What an owner may list, and under what conditions.
 *
 * `prohibited` and `under_review` are enforced, not advisory: the Prohibited and Restricted Items
 * Policy is a legal document, and "a prohibited item cannot be published by simply renaming it with
 * an alias" is one of the client's own acceptance criteria.
 */
export const ELIGIBILITY_STATUSES = [
  "allowed",
  /** Listable, but the owner must meet stated requirements — compliance, licence, safety gear. */
  "conditional",
  /** Not listable yet; awaiting a decision. */
  "under_review",
  "prohibited",
] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export interface IItemType extends Document, TaxonomyNode {
  subcategory: string;
  eligibility: EligibilityStatus;
  /** Why it is restricted, and what the owner has to satisfy. Shown when a listing is blocked. */
  eligibilityNote: string | null;
}

const ItemTypeSchema = new Schema<IItemType>(
  {
    ...nodeFields,
    subcategory: { type: String, required: true, lowercase: true },
    eligibility: { type: String, enum: ELIGIBILITY_STATUSES, default: "allowed" },
    eligibilityNote: { type: String, default: null },
  },
  { timestamps: true }
);
ItemTypeSchema.index({ subcategory: 1, sortOrder: 1 });
ItemTypeSchema.index({ eligibility: 1 });
export const ItemTypeModel = mongoose.model<IItemType>("ItemType", ItemTypeSchema);

// ── aliases ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The words people actually type, mapped to the item type they mean.
 *
 * `kind` matters because the client is explicit that these are not equivalent: *"Brand names (e.g.
 * Kärcher, Thule), usage descriptions, and ambiguous words are not exact synonyms. They are
 * contextual search signals that may refer to multiple item types."* So a brand alias carries less
 * weight than a synonym and cannot by itself produce a confident answer — which is exactly their
 * acceptance criterion that "Kärcher" alone returns reasonable choices rather than one falsely
 * certain category.
 */
export const ALIAS_KINDS = ["synonym", "brand", "usage", "typo"] as const;
export type AliasKind = (typeof ALIAS_KINDS)[number];

/** How much each kind counts towards a match. A brand can suggest; it cannot decide. */
export const ALIAS_WEIGHTS: Record<AliasKind, number> = {
  synonym: 1,
  typo: 0.9,
  usage: 0.75,
  brand: 0.45,
};

export interface IItemAlias extends Document {
  /** As a human wrote it, for the admin screen. */
  phrase: string;
  /** Lowercased, accent-stripped, whitespace-collapsed. This is what is matched and indexed. */
  normalized: string;
  itemType: string;
  language: "en" | "fr" | "any";
  kind: AliasKind;
  /** Admin-adjustable override of the default weight for its kind. */
  weight: number | null;
  /** Unapproved aliases are proposals from the feedback loop and do not affect search yet. */
  approved: boolean;
  /** Who added it, for the audit trail the spec asks for. */
  addedBy: mongoose.Types.ObjectId | null;
}

const ItemAliasSchema = new Schema<IItemAlias>(
  {
    phrase: { type: String, required: true },
    normalized: { type: String, required: true },
    itemType: { type: String, required: true, lowercase: true },
    language: { type: String, enum: ["en", "fr", "any"], default: "any" },
    kind: { type: String, enum: ALIAS_KINDS, default: "synonym" },
    weight: { type: Number, default: null },
    approved: { type: Boolean, default: true },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
// The hot path: look up everything matching a normalised phrase.
ItemAliasSchema.index({ normalized: 1, approved: 1 });
ItemAliasSchema.index({ itemType: 1 });
// The same phrase may legitimately point at several item types — that is what makes "Kärcher"
// ambiguous — but not twice at the same one.
ItemAliasSchema.index({ normalized: 1, itemType: 1 }, { unique: true });

export const ItemAliasModel = mongoose.model<IItemAlias>("ItemAlias", ItemAliasSchema);

// ── what happened when someone listed something ─────────────────────────────────────────────────

/**
 * What was suggested, what the owner chose, and whether they overrode us.
 *
 * The client asks for review of "zero-result searches, new terms and frequent user corrections", and
 * a correction is the single most useful training signal a rules-based classifier has: it is a human
 * telling you the exact phrase that produced the wrong answer.
 */
export interface IClassificationFeedback extends Document {
  submittedTerm: string;
  normalized: string;
  suggested: { itemType: string | null; category: string | null; confidence: number }[];
  chosenCategory: string | null;
  chosenSubcategory: string | null;
  chosenItemType: string | null;
  /** True when the owner picked something other than our top suggestion. */
  corrected: boolean;
  listing: mongoose.Types.ObjectId | null;
  reviewed: boolean;
}

const ClassificationFeedbackSchema = new Schema<IClassificationFeedback>(
  {
    submittedTerm: { type: String, required: true },
    normalized: { type: String, required: true },
    suggested: [
      {
        itemType: { type: String, default: null },
        category: { type: String, default: null },
        confidence: { type: Number, default: 0 },
      },
    ],
    chosenCategory: { type: String, default: null },
    chosenSubcategory: { type: String, default: null },
    chosenItemType: { type: String, default: null },
    corrected: { type: Boolean, default: false },
    listing: { type: Schema.Types.ObjectId, ref: "Item", default: null },
    reviewed: { type: Boolean, default: false },
  },
  { timestamps: true }
);
// The admin review queue: corrections and unrecognised terms first.
ClassificationFeedbackSchema.index({ corrected: 1, reviewed: 1, createdAt: -1 });
ClassificationFeedbackSchema.index({ normalized: 1 });

export const ClassificationFeedbackModel = mongoose.model<IClassificationFeedback>(
  "ClassificationFeedback",
  ClassificationFeedbackSchema
);
