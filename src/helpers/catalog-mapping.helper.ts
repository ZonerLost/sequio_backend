import {
  CategoryModel,
  SubcategoryModel,
  ItemTypeModel,
  ClassificationFeedbackModel,
} from "../models/catalog.model";
import { classify, normalise, Suggestion } from "./classification.helper";

/**
 * Where a listing sits in the catalogue, and how an old listing gets there.
 *
 * Two vocabularies exist in this database and both have to keep working:
 *
 * - **20 flat legacy slugs** (`tools`, `cameras`, `party`, …) in `item.category`, which every
 *   deployed copy of the Flutter app and the admin panel sends on create and filters on. They are
 *   also the keys of `CO2_BY_CATEGORY`.
 * - **The November 2026 taxonomy** — 12 categories, 88 subcategories, 31 item types — in
 *   `item.taxonomy`.
 *
 * `item.category` keeps whatever the client sent, in either vocabulary. `item.taxonomy` is where
 * the listing actually lives. Nothing is rewritten: an owner's own choice is a fact about the
 * listing, and overwriting it to make a report tidier is not a migration, it is data loss.
 */

// ── the legacy map ──────────────────────────────────────────────────────────────────────────────

/**
 * Each legacy slug's place in the new taxonomy.
 *
 * **A subcategory is given only where the legacy slug genuinely *is* that subcategory.** `cameras`
 * means Photography & video and nothing else, so it maps all the way down. `tools` covers eight
 * subcategories at once, so it maps to the category and stops — filing nine listings under
 * "Hand tools" because that sounded plausible would be inventing data, and a wrong subcategory is
 * worse than none: it is indistinguishable from a choice someone made.
 *
 * `other` and `vehicles` map to nothing useful on purpose. `other` never meant anything, and motor
 * vehicles are not in the new taxonomy at all — `travel_transportation` holds trailers and
 * automotive *equipment*. Both are reported as needing a human rather than guessed at.
 */
export const LEGACY_CATEGORY_MAP: Record<
  string,
  { category: string | null; subcategory: string | null }
> = {
  // generic — category only
  tools: { category: "tools_home_improvement", subcategory: null },
  garden: { category: "garden_outdoors", subcategory: null },
  outdoor: { category: "camping_outdoor_recreation", subcategory: null },
  camping: { category: "camping_outdoor_recreation", subcategory: null },
  sports: { category: "sports_fitness", subcategory: null },
  party: { category: "parties_events", subcategory: null },
  electronics: { category: "electronics_technology", subcategory: null },
  kitchen: { category: "home_kitchen", subcategory: null },
  baby: { category: "family_pets", subcategory: null },

  // specific — the legacy slug is a subcategory in the new tree
  power_tools: { category: "tools_home_improvement", subcategory: "power_tools" },
  cleaning: { category: "tools_home_improvement", subcategory: "specialized_cleaning" },
  cameras: { category: "electronics_technology", subcategory: "photography_video" },
  audio: { category: "electronics_technology", subcategory: "audio_sound_systems" },
  music: { category: "electronics_technology", subcategory: "musical_instruments" },
  furniture: { category: "home_kitchen", subcategory: "extra_furniture" },
  cycling: { category: "sports_fitness", subcategory: "cycling" },
  winter_sports: { category: "sports_fitness", subcategory: "winter_sports" },
  water_sports: { category: "camping_outdoor_recreation", subcategory: "water_sports" },

  // no honest answer — a human decides
  vehicles: { category: "travel_transportation", subcategory: null },
  other: { category: null, subcategory: null },
};

/** Legacy slugs that cannot be placed without someone looking at the listing. */
export const UNPLACEABLE_LEGACY_SLUGS = ["other", "vehicles"];

// ── the taxonomy, cached ────────────────────────────────────────────────────────────────────────

interface TaxonomySnapshot {
  categories: Set<string>;
  /** subcategory slug → its category slug */
  subcategories: Map<string, string>;
  /** item type slug → where it lives and whether it may be listed */
  itemTypes: Map<
    string,
    { subcategory: string; eligibility: string; eligibilityNote: string | null }
  >;
}

/**
 * Cached for a minute, because this is read on every item search and every listing.
 *
 * A minute is short enough that an administrator renaming something sees it almost at once, and the
 * admin writes call `invalidateTaxonomyCache()` so they see it immediately. The whole catalogue is
 * ~130 small rows; the cache saves three queries per request.
 */
const CACHE_TTL_MS = 60_000;
let cache: { at: number; snapshot: TaxonomySnapshot } | null = null;

export const invalidateTaxonomyCache = (): void => {
  cache = null;
};

export const taxonomySnapshot = async (): Promise<TaxonomySnapshot> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;

  const [cats, subs, types] = await Promise.all([
    CategoryModel.find({}).select("slug").lean(),
    SubcategoryModel.find({}).select("slug category").lean(),
    ItemTypeModel.find({}).select("slug subcategory eligibility eligibilityNote").lean(),
  ]);

  const snapshot: TaxonomySnapshot = {
    categories: new Set(cats.map((c) => c.slug)),
    subcategories: new Map(subs.map((s) => [s.slug, s.category])),
    itemTypes: new Map(
      types.map((t) => [
        t.slug,
        {
          subcategory: t.subcategory,
          eligibility: t.eligibility as string,
          eligibilityNote: t.eligibilityNote ?? null,
        },
      ])
    ),
  };

  cache = { at: Date.now(), snapshot };
  return snapshot;
};

// ── placing a listing ───────────────────────────────────────────────────────────────────────────

export type TaxonomySource = "owner" | "classified" | "legacy_map";

export interface ItemTaxonomy {
  category: string | null;
  subcategory: string | null;
  itemType: string | null;
  source: TaxonomySource;
  classifiedAt: Date | null;
}

export interface Placement {
  taxonomy: ItemTaxonomy;
  /** False only when the listing must be refused. `reason` then says why, in the owner's words. */
  allowed: boolean;
  reason: string | null;
  /** Set when the type is `conditional`: listable, but the owner has requirements to meet. */
  conditions: string | null;
  /** The classifier's view of the title, kept so a correction can be recorded. */
  suggestion: Suggestion | null;
}

/**
 * The confidence at which a classification is allowed to **block** a listing.
 *
 * 0.70 is the "every word of a synonym is present" tier. A brand alias weighs 0.45 and can never
 * reach it on its own, which is the point: refusing someone's listing because "Kärcher" scored 0.45
 * against a prohibited type would be a false accusation dressed up as a policy. Blocking has to be
 * reserved for a title that plainly says what it is.
 */
export const ENFORCEMENT_CONFIDENCE = 0.7;

const refusal = (note: string | null): string =>
  note
    ? `This item cannot be listed on Atussa. ${note}`
    : "This item cannot be listed on Atussa. It is on the prohibited items list.";

const unplaced = (source: TaxonomySource, at: Date | null): ItemTaxonomy => ({
  category: null,
  subcategory: null,
  itemType: null,
  source,
  classifiedAt: at,
});

/**
 * Works out where a listing belongs and whether it may be published.
 *
 * Three sources, in order of authority:
 *
 * 1. **What the owner declared.** An `itemType` picked on the Add Item screen is the answer, and its
 *    eligibility is enforced.
 * 2. **The legacy map**, when only a legacy `category` was sent — which is what every deployed copy
 *    of the app still does.
 * 3. **The classifier**, to fill in what the first two could not, and to catch a plainly prohibited
 *    title filed under an innocent category.
 *
 * ## What it refuses
 *
 * A declared item type that is `prohibited` or `under_review`, and a title that *unambiguously*
 * resolves to one. Nothing else. The second rule is what stops the prohibited list being bypassed
 * by picking "Other" — but it fires only above ENFORCEMENT_CONFIDENCE and never when the classifier
 * itself says the answer is ambiguous.
 *
 * Eligibility is read from the **item type**, never from the words, which is why renaming a child
 * car seat "comfy travel chair" does not get it published.
 */
export const placeInTaxonomy = async (input: {
  title?: string;
  category?: string | null;
  subcategory?: string | null;
  itemType?: string | null;
}): Promise<Placement> => {
  const tx = await taxonomySnapshot();
  const now = new Date();

  let category: string | null = null;
  let subcategory: string | null = null;
  let itemType: string | null = null;
  let source: TaxonomySource = "legacy_map";

  // 1. What the owner declared.
  if (input.itemType) {
    const type = tx.itemTypes.get(input.itemType);
    if (!type) {
      return {
        taxonomy: unplaced("owner", null),
        allowed: false,
        reason: `Unknown item type "${input.itemType}". Pick one from GET /items/catalog.`,
        conditions: null,
        suggestion: null,
      };
    }
    if (type.eligibility === "prohibited" || type.eligibility === "under_review") {
      return {
        taxonomy: unplaced("owner", null),
        allowed: false,
        reason: refusal(type.eligibilityNote),
        conditions: null,
        suggestion: null,
      };
    }
    itemType = input.itemType;
    subcategory = type.subcategory;
    category = tx.subcategories.get(type.subcategory) ?? null;
    source = "owner";
  }

  // A declared subcategory, with or without a type.
  if (!subcategory && input.subcategory && tx.subcategories.has(input.subcategory)) {
    subcategory = input.subcategory;
    category = tx.subcategories.get(input.subcategory) ?? null;
    source = "owner";
  }

  // 2. The category, from the new vocabulary or through the legacy map.
  if (!category && input.category) {
    if (tx.categories.has(input.category)) {
      category = input.category;
      source = "owner";
    } else if (tx.subcategories.has(input.category)) {
      // A legacy slug that is also a subcategory slug — `power_tools`, `cycling`, `winter_sports`
      // and `water_sports` are all four of them, by happy coincidence.
      subcategory = input.category;
      category = tx.subcategories.get(input.category) ?? null;
      source = "owner";
    } else {
      const mapped = LEGACY_CATEGORY_MAP[input.category];
      if (mapped) {
        category = mapped.category;
        if (!subcategory && mapped.subcategory) subcategory = mapped.subcategory;
        source = "legacy_map";
      }
    }
  }

  // 3. The classifier: fills gaps, and blocks a plainly prohibited title.
  let suggestion: Suggestion | null = null;
  if (input.title) {
    const result = await classify(input.title);
    suggestion = result.suggestions[0] ?? null;
    const confident = Boolean(
      suggestion && !result.ambiguous && suggestion.confidence >= ENFORCEMENT_CONFIDENCE
    );

    if (
      confident &&
      suggestion &&
      (suggestion.eligibility === "prohibited" || suggestion.eligibility === "under_review")
    ) {
      return {
        taxonomy: unplaced("classified", now),
        allowed: false,
        reason: refusal(suggestion.eligibilityNote),
        conditions: null,
        suggestion,
      };
    }

    /**
     * Only fill a gap, never overrule the owner.
     *
     * And only when the suggestion agrees with the category they chose: a listing filed under
     * Home & Kitchen whose title classifies to a pressure washer is a disagreement, and resolving
     * it by moving the listing would silently override a human. The disagreement is recorded as
     * feedback for an administrator instead.
     */
    if (confident && suggestion && (category === null || suggestion.category === category)) {
      if (!itemType) itemType = suggestion.itemType;
      if (!subcategory) subcategory = suggestion.subcategory;
      if (!category) {
        category = suggestion.category || null;
        source = "classified";
      } else if (source === "legacy_map") {
        source = "classified";
      }
    }
  }

  // A conditional type is listable, but the owner has to be told what they are agreeing to.
  const declared = itemType ? tx.itemTypes.get(itemType) : undefined;

  return {
    taxonomy: { category, subcategory, itemType, source, classifiedAt: input.title ? now : null },
    allowed: true,
    reason: null,
    conditions: declared?.eligibility === "conditional" ? declared.eligibilityNote : null,
    suggestion,
  };
};

// ── searching ───────────────────────────────────────────────────────────────────────────────────

/**
 * Turns one `?category=` value, in either vocabulary, into a filter that finds the right listings.
 *
 * Two halves, and the first is not optional:
 *
 * - `{ category: value }` — the raw legacy field, because a listing created between this deploy and
 *   the backfill has no `taxonomy` at all, and Mongo does not match a **missing** field against
 *   anything. That is DO-NOT #13, which hid 10 of 23 active listings the last time it was
 *   forgotten.
 * - the most precise taxonomy field the value maps to. `?category=cameras` becomes
 *   `taxonomy.subcategory = photography_video`, not the whole of Electronics, because that is what
 *   the legacy slug meant.
 */
export const categoryFilter = async (value: string): Promise<Record<string, unknown>> => {
  const tx = await taxonomySnapshot();
  const alternatives: Record<string, unknown>[] = [{ category: value }];

  if (tx.itemTypes.has(value)) alternatives.push({ "taxonomy.itemType": value });
  else if (tx.subcategories.has(value)) alternatives.push({ "taxonomy.subcategory": value });
  else if (tx.categories.has(value)) alternatives.push({ "taxonomy.category": value });
  else {
    const mapped = LEGACY_CATEGORY_MAP[value];
    if (mapped?.subcategory) alternatives.push({ "taxonomy.subcategory": mapped.subcategory });
    else if (mapped?.category) alternatives.push({ "taxonomy.category": mapped.category });
  }

  return alternatives.length === 1 ? alternatives[0] : { $or: alternatives };
};

/**
 * A filter for one taxonomy level, used by `?subcategory=` and `?itemType=`.
 *
 * Unlike `categoryFilter` there is no legacy field to fall back on — these levels never existed
 * before — so an un-backfilled listing genuinely cannot match, and that is honest rather than a
 * silent omission.
 */
export const taxonomyFilter = (
  level: "subcategory" | "itemType",
  value: string
): Record<string, unknown> => ({ [`taxonomy.${level}`]: value });

// ── the feedback loop ───────────────────────────────────────────────────────────────────────────

/**
 * Records what was suggested against what the owner actually chose.
 *
 * The specification asks for review of "zero-result searches, new terms and frequent user
 * corrections", and a correction is the most useful signal a rules-based classifier can get: a
 * human naming the exact phrase that produced the wrong answer.
 *
 * **Never throws.** This is analytics attached to a listing that already exists. Failing the
 * request over it would show the owner an error for an item that was created, and they would tap
 * Submit again.
 */
export const recordClassificationFeedback = async (input: {
  title: string;
  suggestion: Suggestion | null;
  chosen: ItemTaxonomy;
  listing?: unknown;
}): Promise<void> => {
  try {
    await ClassificationFeedbackModel.create({
      submittedTerm: input.title,
      normalized: normalise(input.title),
      suggested: input.suggestion
        ? [
            {
              itemType: input.suggestion.itemType,
              category: input.suggestion.category,
              confidence: input.suggestion.confidence,
            },
          ]
        : [],
      chosenCategory: input.chosen.category,
      chosenSubcategory: input.chosen.subcategory,
      chosenItemType: input.chosen.itemType,
      corrected: Boolean(
        input.suggestion &&
          input.chosen.itemType &&
          input.suggestion.itemType !== input.chosen.itemType
      ),
      listing: (input.listing as never) ?? null,
    });
  } catch (err) {
    console.error("[catalog] could not record classification feedback", err);
  }
};
