import {
  ItemAliasModel,
  ItemTypeModel,
  SubcategoryModel,
  CategoryModel,
  ALIAS_WEIGHTS,
  AliasKind,
  EligibilityStatus,
} from "../models/catalog.model";

/**
 * Turns "Kärcher to clean the patio" into a suggested category, subcategory and item type.
 *
 * ## No machine learning, on purpose
 *
 * The client's acceptance criteria describe synonyms, plurals, misspellings, brand names and a
 * handful of usage phrases — all of which are matching rules. A model would be harder to explain to
 * the administrator who has to correct it, impossible to change "without releasing a new app
 * version", and would turn "why did it pick that" into a research question. Everything here is a
 * lookup against a dictionary an administrator can edit.
 *
 * ## The one thing it must not do
 *
 * **Be confidently wrong.** Their criterion is that *"Kärcher alone returns reasonable choices
 * instead of one falsely certain category"*, because Kärcher makes pressure washers, carpet
 * cleaners and steam cleaners. So brand aliases carry less weight than synonyms, and when the top
 * two candidates are close the result is marked ambiguous and several are returned. An owner
 * correcting a wrong-but-confident suggestion is a worse experience than being asked to choose.
 */

/** Lowercase, accent-stripped, punctuation-stripped, whitespace-collapsed. */
export const normalise = (value: string): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Words carrying no classification signal, in both languages.
 *
 * "machine to clean my couch" has to reduce to "machine clean couch" before a usage alias can match
 * it, and a listing title is full of this ("a", "the", "pour", "de", "my").
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "to", "for", "with", "my", "your", "our", "of", "in", "on", "and", "or",
  "is", "it", "this", "that", "please", "rent", "rental", "hire",
  "le", "la", "les", "un", "une", "des", "du", "de", "pour", "avec", "mon", "ma", "mes",
  "et", "ou", "au", "aux", "ce", "cette", "location", "louer",
]);

const tokens = (value: string): string[] =>
  normalise(value).split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t));

/**
 * Levenshtein distance, capped.
 *
 * Only used for single-token typos, where the strings are short, so the simple matrix is fine. The
 * cap lets it bail early rather than computing a distance nobody will accept.
 */
const editDistance = (a: string, b: string, cap = 2): number => {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, curr[j]);
    }
    if (best > cap) return cap + 1;
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
};

/** Plural and common-ending stripping, crude but bilingual and good enough for a dictionary match. */
const stem = (token: string): string => {
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
};

export interface Suggestion {
  itemType: string;
  itemTypeName: string;
  subcategory: string;
  category: string;
  categoryName: string;
  eligibility: EligibilityStatus;
  eligibilityNote: string | null;
  /** 0 to 1. Above AMBIGUITY_FLOOR and clear of the runner-up, it is offered as the answer. */
  confidence: number;
  /** Which alias produced the match, so an administrator can see why. */
  matchedOn: string;
  matchKind: AliasKind | "name";
}

export interface ClassificationResult {
  suggestions: Suggestion[];
  /** True when nothing matched well enough to offer. The owner picks manually and we log the term. */
  unrecognised: boolean;
  /** True when several candidates are close. Show the choices rather than pre-selecting one. */
  ambiguous: boolean;
}

/** Below this, a match is not worth showing at all. */
const CONFIDENCE_FLOOR = 0.25;
/** If the runner-up is within this of the leader, do not pretend to be sure. */
const AMBIGUITY_MARGIN = 0.18;
const MAX_SUGGESTIONS = 3;

/**
 * Classifies a free-text title.
 *
 * Scoring, highest first:
 *   1.00 x weight  the whole phrase is an alias ("laveuse a pression")
 *   0.85 x weight  an alias appears inside the phrase ("i need a pressure washer today")
 *   0.70 x weight  every token of a multi-word alias is present, in any order
 *   0.45 x weight  a token is one or two edits from an alias token — the typo path
 *
 * Multiple aliases pointing at the same item type reinforce it, with diminishing returns, so a
 * listing mentioning both the brand and the thing beats one mentioning only the brand.
 */
export const classify = async (title: string): Promise<ClassificationResult> => {
  const phrase = normalise(title);
  const phraseTokens = tokens(title);

  if (!phrase || phraseTokens.length === 0) {
    return { suggestions: [], unrecognised: true, ambiguous: false };
  }

  // The dictionary is small — hundreds of rows — and read on every Add Item. Loading it whole and
  // scoring in memory is simpler and faster than a query per token, and it is trivially cacheable
  // later if it ever grows.
  const aliases = await ItemAliasModel.find({ approved: true })
    .select("normalized itemType kind weight")
    .lean();

  const scores = new Map<string, { score: number; matchedOn: string; kind: AliasKind | "name" }>();
  const consider = (
    itemType: string,
    score: number,
    matchedOn: string,
    kind: AliasKind | "name"
  ) => {
    const existing = scores.get(itemType);
    if (!existing) {
      scores.set(itemType, { score, matchedOn, kind });
      return;
    }
    // Diminishing returns: a second signal helps, a fifth barely moves it.
    const combined = Math.min(1, existing.score + score * 0.35);
    scores.set(itemType, {
      score: combined,
      matchedOn: score > existing.score ? matchedOn : existing.matchedOn,
      kind: score > existing.score ? kind : existing.kind,
    });
  };

  const stemmedPhraseTokens = new Set(phraseTokens.map(stem));

  for (const alias of aliases) {
    const weight = alias.weight ?? ALIAS_WEIGHTS[alias.kind as AliasKind] ?? 1;
    const aliasNorm = alias.normalized;
    if (!aliasNorm) continue;

    if (phrase === aliasNorm) {
      consider(alias.itemType, 1 * weight, alias.phrase ?? aliasNorm, alias.kind as AliasKind);
      continue;
    }
    // Word-boundary containment, so "sander" does not match inside "salamander".
    if (new RegExp(`(^| )${aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(phrase)) {
      consider(alias.itemType, 0.85 * weight, aliasNorm, alias.kind as AliasKind);
      continue;
    }

    const aliasTokens = aliasNorm.split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    if (aliasTokens.length === 0) continue;

    // Every meaningful word of the alias is somewhere in the phrase, order ignored. This is what
    // catches "machine to clean my couch" against the usage alias "clean couch".
    if (aliasTokens.every((t) => stemmedPhraseTokens.has(stem(t)))) {
      consider(alias.itemType, 0.7 * weight, aliasNorm, alias.kind as AliasKind);
      continue;
    }

    // The typo path, single tokens only — fuzzy-matching a whole phrase produces nonsense.
    if (aliasTokens.length === 1) {
      const target = aliasTokens[0];
      const hit = phraseTokens.some(
        (t) => Math.abs(t.length - target.length) <= 2 && editDistance(t, target) <= (target.length > 6 ? 2 : 1)
      );
      if (hit) consider(alias.itemType, 0.45 * weight, aliasNorm, "typo");
    }
  }

  // The item type's own name counts as an alias nobody had to write down.
  const allTypes = await ItemTypeModel.find({ active: true, mergedInto: null }).lean();
  for (const type of allTypes) {
    for (const name of [type.nameEn, type.nameFr]) {
      if (!name) continue;
      const n = normalise(name);
      if (!n) continue;
      if (phrase === n) consider(type.slug, 1, name, "name");
      else if (n.split(" ").every((t) => stemmedPhraseTokens.has(stem(t)))) {
        consider(type.slug, 0.7, name, "name");
      }
    }
  }

  if (scores.size === 0) {
    return { suggestions: [], unrecognised: true, ambiguous: false };
  }

  // Resolve each candidate up the tree for the response.
  const typeBySlug = new Map(allTypes.map((t) => [t.slug, t]));
  const subs = await SubcategoryModel.find({}).lean();
  const subBySlug = new Map(subs.map((s) => [s.slug, s]));
  const cats = await CategoryModel.find({}).lean();
  const catBySlug = new Map(cats.map((c) => [c.slug, c]));

  const suggestions: Suggestion[] = [];
  for (const [slug, hit] of scores) {
    const type = typeBySlug.get(slug);
    if (!type) continue;
    const sub = subBySlug.get(type.subcategory);
    const cat = sub ? catBySlug.get(sub.category) : undefined;
    if (hit.score < CONFIDENCE_FLOOR) continue;
    suggestions.push({
      itemType: type.slug,
      itemTypeName: type.nameEn,
      subcategory: type.subcategory,
      category: sub?.category ?? "",
      categoryName: cat?.nameEn ?? "",
      eligibility: type.eligibility,
      eligibilityNote: type.eligibilityNote ?? null,
      confidence: Math.round(Math.min(1, hit.score) * 100) / 100,
      matchedOn: hit.matchedOn,
      matchKind: hit.kind,
    });
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  const top = suggestions.slice(0, MAX_SUGGESTIONS);

  const ambiguous =
    top.length > 1 && top[0].confidence - top[1].confidence < AMBIGUITY_MARGIN;

  return { suggestions: top, unrecognised: top.length === 0, ambiguous };
};

/**
 * Whether an item type may be published, and why not.
 *
 * Checked against the **item type**, never against the words the owner typed — otherwise "a
 * prohibited item cannot be published by simply renaming it with an alias" would not hold, which is
 * one of the client's acceptance criteria.
 */
export const checkEligibility = async (
  itemTypeSlug: string
): Promise<{ allowed: boolean; status: EligibilityStatus; note: string | null }> => {
  const type = await ItemTypeModel.findOne({ slug: itemTypeSlug }).lean();
  if (!type) return { allowed: true, status: "allowed", note: null };
  return {
    allowed: type.eligibility === "allowed" || type.eligibility === "conditional",
    status: type.eligibility,
    note: type.eligibilityNote ?? null,
  };
};
