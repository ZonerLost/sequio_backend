import {
  CategoryModel,
  SubcategoryModel,
  ItemTypeModel,
  ItemAliasModel,
  ClassificationFeedbackModel,
  ALIAS_KINDS,
  AliasKind,
} from "../models/catalog.model";
import { ItemModel } from "../models/item.model";
import { normalise } from "../helpers/classification.helper";
import { invalidateTaxonomyCache } from "../helpers/catalog-mapping.helper";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";

/**
 * The administrator's dictionary.
 *
 * This is the half of the Smart Rental Catalog that makes the other half worth having. The client's
 * requirement is that an administrator can add a synonym, rename a category, mark something
 * prohibited or merge two subcategories **"without releasing a new app version"** — so every
 * vocabulary decision has to be a database write that takes effect on the next request, and none of
 * it may be a constant in this repo.
 *
 * ## Three rules this service exists to enforce
 *
 * 1. **A slug is immutable and a node is never deleted.** Listings reference slugs, so renaming one
 *    orphans every listing that uses it and deleting one orphans them permanently. Renaming is a
 *    `nameEn`/`nameFr` change; removing is `active: false`; replacing is `mergedInto`. There is
 *    deliberately no delete route for a category, subcategory or item type.
 * 2. **Moving a node takes its listings with it.** `item.taxonomy` stores all three levels, so a
 *    subcategory moved to a different category leaves every listing under it pointing at the old
 *    one. The move re-points them in the same operation and reports how many — otherwise the
 *    client's own acceptance criterion ("existing listings stay discoverable after a subcategory is
 *    renamed or merged") would hold for a rename and quietly fail for a move.
 * 3. **An alias may be deleted; a node may not.** An alias is vocabulary — a word someone typed —
 *    and nothing references it. Removing a bad synonym has to be as easy as adding one, or nobody
 *    will risk adding any.
 */

type Level = "category" | "subcategory" | "itemType";

const MODELS = {
  category: CategoryModel,
  subcategory: SubcategoryModel,
  itemType: ItemTypeModel,
} as const;

const LABELS: Record<Level, string> = {
  category: "Category",
  subcategory: "Subcategory",
  itemType: "Item type",
};

const SLUG_PATTERN = /^[a-z0-9_]+$/;

const assertSlug = (slug: string): void => {
  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError(
      "A slug must be lowercase letters, digits and underscores only. It is an identifier, never a display name.",
      HTTP_STATUS.BAD_REQUEST
    );
  }
};

/**
 * Follows `mergedInto` to the node that actually survives.
 *
 * Capped rather than trusted: a cycle created before this check existed would otherwise spin
 * forever inside a request.
 */
const resolveMerge = async (level: Level, slug: string): Promise<string> => {
  let current = slug;
  for (let hop = 0; hop < 10; hop++) {
    const node = await (MODELS[level] as typeof CategoryModel).findOne({ slug: current }).lean();
    if (!node?.mergedInto) return current;
    current = node.mergedInto;
  }
  throw new AppError(
    `${LABELS[level]} "${slug}" is part of a merge cycle and has to be untangled by hand.`,
    HTTP_STATUS.CONFLICT
  );
};

export class CatalogService {
  // ── reading ───────────────────────────────────────────────────────────────────────────────────

  /**
   * The whole catalogue as an administrator needs to see it: inactive, merged and prohibited nodes
   * included, with the listing count under each.
   *
   * Deliberately different from the public `GET /items/catalog`, which hides all three — a picker
   * that offers a prohibited item type is a bug, and an administrator who cannot see one cannot
   * un-prohibit it.
   */
  async tree() {
    const [categories, subcategories, itemTypes, aliasCounts, listingCounts] = await Promise.all([
      CategoryModel.find({}).sort({ sortOrder: 1, slug: 1 }).lean(),
      SubcategoryModel.find({}).sort({ sortOrder: 1, slug: 1 }).lean(),
      ItemTypeModel.find({}).sort({ sortOrder: 1, slug: 1 }).lean(),
      ItemAliasModel.aggregate([{ $group: { _id: "$itemType", n: { $sum: 1 } } }]),
      ItemModel.aggregate([
        { $match: { "taxonomy.subcategory": { $ne: null } } },
        { $group: { _id: "$taxonomy.subcategory", n: { $sum: 1 } } },
      ]),
    ]);

    const aliasesBy = new Map(aliasCounts.map((a) => [a._id, a.n]));
    const listingsBy = new Map(listingCounts.map((l) => [l._id, l.n]));

    return categories.map((c) => ({
      slug: c.slug,
      nameEn: c.nameEn,
      nameFr: c.nameFr,
      sortOrder: c.sortOrder,
      active: c.active,
      mergedInto: c.mergedInto,
      subcategories: subcategories
        .filter((s) => s.category === c.slug)
        .map((s) => ({
          slug: s.slug,
          nameEn: s.nameEn,
          nameFr: s.nameFr,
          sortOrder: s.sortOrder,
          active: s.active,
          mergedInto: s.mergedInto,
          listings: listingsBy.get(s.slug) ?? 0,
          itemTypes: itemTypes
            .filter((t) => t.subcategory === s.slug)
            .map((t) => ({
              slug: t.slug,
              nameEn: t.nameEn,
              nameFr: t.nameFr,
              sortOrder: t.sortOrder,
              active: t.active,
              mergedInto: t.mergedInto,
              eligibility: t.eligibility,
              eligibilityNote: t.eligibilityNote,
              aliases: aliasesBy.get(t.slug) ?? 0,
            })),
        })),
    }));
  }

  // ── writing a node ────────────────────────────────────────────────────────────────────────────

  async createNode(
    level: Level,
    data: {
      slug: string;
      nameEn: string;
      nameFr?: string | null;
      sortOrder?: number;
      category?: string;
      subcategory?: string;
      eligibility?: string;
      eligibilityNote?: string | null;
    }
  ) {
    assertSlug(data.slug);
    const model = MODELS[level] as typeof CategoryModel;

    if (await model.exists({ slug: data.slug })) {
      throw new AppError(
        `${LABELS[level]} "${data.slug}" already exists. Update it instead — a slug is never reused for something else.`,
        HTTP_STATUS.CONFLICT
      );
    }

    // A child with no parent is invisible everywhere and impossible to debug from the symptom.
    if (level === "subcategory") {
      if (!(await CategoryModel.exists({ slug: data.category }))) {
        throw new AppError(`Unknown category "${data.category}"`, HTTP_STATUS.BAD_REQUEST);
      }
    }
    if (level === "itemType") {
      if (!(await SubcategoryModel.exists({ slug: data.subcategory }))) {
        throw new AppError(`Unknown subcategory "${data.subcategory}"`, HTTP_STATUS.BAD_REQUEST);
      }
    }

    const created = await model.create({ ...data, nameFr: data.nameFr ?? null } as never);
    invalidateTaxonomyCache();
    return created;
  }

  /**
   * Renames, re-sorts, re-parents, deactivates or merges a node — and keeps its listings with it.
   *
   * `slug` is not accepted. Everything else about a node can change; its identifier cannot, because
   * that is the one thing other collections hold.
   */
  async updateNode(
    level: Level,
    slug: string,
    data: {
      nameEn?: string;
      nameFr?: string | null;
      sortOrder?: number;
      active?: boolean;
      mergedInto?: string | null;
      category?: string;
      subcategory?: string;
      eligibility?: string;
      eligibilityNote?: string | null;
    }
  ) {
    const model = MODELS[level] as typeof CategoryModel;
    /**
     * Read loosely on purpose. The three models share `nodeFields` but differ in their parent key
     * (`category` on a subcategory, `subcategory` on an item type), and the cast that lets one
     * variable hold all three narrows that away. The parent is read back below and compared, so a
     * wrong key would show up as "nothing to update", not as a silent write.
     */
    const node = (await model.findOne({ slug }).lean()) as
      | (Record<string, unknown> & { mergedInto: string | null })
      | null;
    if (!node) throw new AppError(`${LABELS[level]} "${slug}" not found`, HTTP_STATUS.NOT_FOUND);

    const set: Record<string, unknown> = {};
    const effects: Record<string, number> = {};

    for (const key of ["nameEn", "nameFr", "sortOrder", "active", "eligibility", "eligibilityNote"] as const) {
      if (data[key] !== undefined) set[key] = data[key];
    }

    // ── a merge ───────────────────────────────────────────────────────────────────────────────
    if (data.mergedInto !== undefined) {
      if (data.mergedInto === null) {
        set.mergedInto = null;
      } else {
        if (data.mergedInto === slug) {
          throw new AppError("A node cannot be merged into itself.", HTTP_STATUS.BAD_REQUEST);
        }
        if (!(await model.exists({ slug: data.mergedInto }))) {
          throw new AppError(
            `Cannot merge into "${data.mergedInto}" — no such ${level}.`,
            HTTP_STATUS.BAD_REQUEST
          );
        }
        // Walk the survivor's own chain: if it leads back here, the merge is a cycle and every
        // later read of either slug would loop.
        const survivor = await resolveMerge(level, data.mergedInto);
        if (survivor === slug) {
          throw new AppError(
            `Cannot merge "${slug}" into "${data.mergedInto}" — that already merges back into "${slug}".`,
            HTTP_STATUS.CONFLICT
          );
        }
        set.mergedInto = data.mergedInto;
        // A merged node must not stay in the pickers; that is what merging means.
        if (data.active === undefined) set.active = false;
        Object.assign(effects, await this.repointListings(level, slug, survivor));
      }
    }

    // ── a move ────────────────────────────────────────────────────────────────────────────────
    if (level === "subcategory" && data.category && data.category !== node.category) {
      if (!(await CategoryModel.exists({ slug: data.category }))) {
        throw new AppError(`Unknown category "${data.category}"`, HTTP_STATUS.BAD_REQUEST);
      }
      set.category = data.category;
      const moved = await ItemModel.updateMany(
        { "taxonomy.subcategory": slug },
        { $set: { "taxonomy.category": data.category } }
      );
      effects.listingsRecategorised = moved.modifiedCount;
    }

    if (level === "itemType" && data.subcategory && data.subcategory !== node.subcategory) {
      const parent = await SubcategoryModel.findOne({ slug: data.subcategory }).lean();
      if (!parent) {
        throw new AppError(`Unknown subcategory "${data.subcategory}"`, HTTP_STATUS.BAD_REQUEST);
      }
      set.subcategory = data.subcategory;
      const moved = await ItemModel.updateMany(
        { "taxonomy.itemType": slug },
        { $set: { "taxonomy.subcategory": data.subcategory, "taxonomy.category": parent.category } }
      );
      effects.listingsRecategorised = moved.modifiedCount;
    }

    if (Object.keys(set).length === 0 && Object.keys(effects).length === 0) {
      throw new AppError("Nothing to update", HTTP_STATUS.BAD_REQUEST);
    }

    /**
     * Deactivating something with live listings under it is allowed and sometimes the point — a
     * category being retired should stop accepting new listings before the old ones are dealt with.
     * It is reported rather than refused, because an administrator cannot see the consequence from
     * the screen they are on.
     */
    if (set.active === false) {
      effects.listingsStillUnderIt = await this.countListings(level, slug);
    }

    const updated = await model.findOneAndUpdate(
      { slug },
      { $set: set },
      { returnDocument: "after" }
    );
    invalidateTaxonomyCache();
    return { node: updated, effects };
  }

  /** How many listings sit on a node, at whichever level it is. */
  private async countListings(level: Level, slug: string): Promise<number> {
    const field =
      level === "category" ? "taxonomy.category"
      : level === "subcategory" ? "taxonomy.subcategory"
      : "taxonomy.itemType";
    return ItemModel.countDocuments({ [field]: slug });
  }

  /**
   * Moves every listing on a merged node onto the survivor.
   *
   * The alternative — leaving them on the dead slug and chasing `mergedInto` on every read — means
   * every search, feed and filter has to know about merges forever, and one that forgets silently
   * returns nothing. `mergedInto` stays on the node as the record of where they went, so an old
   * slug in a bookmark or a deep link still leads somewhere.
   */
  private async repointListings(
    level: Level,
    from: string,
    to: string
  ): Promise<Record<string, number>> {
    if (level === "category") {
      const res = await ItemModel.updateMany(
        { "taxonomy.category": from },
        { $set: { "taxonomy.category": to } }
      );
      return { listingsMoved: res.modifiedCount };
    }

    if (level === "subcategory") {
      const parent = await SubcategoryModel.findOne({ slug: to }).lean();
      const res = await ItemModel.updateMany(
        { "taxonomy.subcategory": from },
        { $set: { "taxonomy.subcategory": to, "taxonomy.category": parent?.category ?? null } }
      );
      // The item types underneath move too, or they would point at a subcategory nobody can reach.
      const types = await ItemTypeModel.updateMany(
        { subcategory: from },
        { $set: { subcategory: to } }
      );
      return { listingsMoved: res.modifiedCount, itemTypesMoved: types.modifiedCount };
    }

    const target = await ItemTypeModel.findOne({ slug: to }).lean();
    const parent = target ? await SubcategoryModel.findOne({ slug: target.subcategory }).lean() : null;
    const res = await ItemModel.updateMany(
      { "taxonomy.itemType": from },
      {
        $set: {
          "taxonomy.itemType": to,
          "taxonomy.subcategory": target?.subcategory ?? null,
          "taxonomy.category": parent?.category ?? null,
        },
      }
    );
    // The words that pointed at the dead type now point at the survivor, or the merge loses them.
    const aliases = await ItemAliasModel.updateMany({ itemType: from }, { $set: { itemType: to } });
    return { listingsMoved: res.modifiedCount, aliasesMoved: aliases.modifiedCount };
  }

  // ── the alias dictionary ──────────────────────────────────────────────────────────────────────

  async listAliases(query: {
    search?: string;
    itemType?: string;
    kind?: string;
    approved?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const filter: Record<string, unknown> = {};

    if (query.itemType) filter.itemType = query.itemType;
    if (query.kind) filter.kind = query.kind;
    if (query.approved !== undefined) filter.approved = query.approved;
    if (query.search) {
      // Matched on the normalised form, because that is what search matches — an administrator
      // looking for "Kärcher" has to find the row stored as "karcher".
      filter.normalized = { $regex: normalise(query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    const [aliases, total] = await Promise.all([
      ItemAliasModel.find(filter)
        .sort({ itemType: 1, normalized: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ItemAliasModel.countDocuments(filter),
    ]);

    return { aliases, page, limit, total };
  }

  /**
   * Adds a word to the dictionary. Live on the next request — no deploy, no app release.
   *
   * The same phrase pointing at several item types is legitimate and is how "Kärcher" stays
   * ambiguous; the same phrase pointing twice at *one* type is a duplicate, and the unique index on
   * `{normalized, itemType}` is what makes that a 409 rather than a second row that quietly doubles
   * its weight.
   */
  async createAlias(data: {
    phrase: string;
    itemType: string;
    language?: "en" | "fr" | "any";
    kind?: AliasKind;
    weight?: number | null;
    approved?: boolean;
    addedBy?: string;
  }) {
    const normalized = normalise(data.phrase);
    if (!normalized) {
      throw new AppError(
        "That phrase normalises to nothing — it is punctuation or accents only.",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    if (!(await ItemTypeModel.exists({ slug: data.itemType }))) {
      throw new AppError(`Unknown item type "${data.itemType}"`, HTTP_STATUS.BAD_REQUEST);
    }
    if (await ItemAliasModel.exists({ normalized, itemType: data.itemType })) {
      throw new AppError(
        `"${data.phrase}" already points at ${data.itemType}.`,
        HTTP_STATUS.CONFLICT
      );
    }

    return ItemAliasModel.create({
      phrase: data.phrase.trim(),
      normalized,
      itemType: data.itemType,
      language: data.language ?? "any",
      kind: data.kind ?? "synonym",
      weight: data.weight ?? null,
      approved: data.approved ?? true,
      addedBy: (data.addedBy as never) ?? null,
    });
  }

  async updateAlias(
    id: string,
    data: {
      phrase?: string;
      itemType?: string;
      language?: "en" | "fr" | "any";
      kind?: AliasKind;
      weight?: number | null;
      approved?: boolean;
    }
  ) {
    const alias = await ItemAliasModel.findById(id);
    if (!alias) throw new AppError("Alias not found", HTTP_STATUS.NOT_FOUND);

    const set: Record<string, unknown> = {};
    if (data.phrase !== undefined) {
      const normalized = normalise(data.phrase);
      if (!normalized) {
        throw new AppError("That phrase normalises to nothing.", HTTP_STATUS.BAD_REQUEST);
      }
      // `normalized` is what the classifier matches on, so it can never be left behind by a
      // `phrase` edit — the row would keep matching the old word and show the new one.
      set.phrase = data.phrase.trim();
      set.normalized = normalized;
    }
    if (data.itemType !== undefined) {
      if (!(await ItemTypeModel.exists({ slug: data.itemType }))) {
        throw new AppError(`Unknown item type "${data.itemType}"`, HTTP_STATUS.BAD_REQUEST);
      }
      set.itemType = data.itemType;
    }
    for (const key of ["language", "kind", "weight", "approved"] as const) {
      if (data[key] !== undefined) set[key] = data[key];
    }
    if (Object.keys(set).length === 0) {
      throw new AppError("Nothing to update", HTTP_STATUS.BAD_REQUEST);
    }

    const normalized = (set.normalized as string) ?? alias.normalized;
    const itemType = (set.itemType as string) ?? alias.itemType;
    const clash = await ItemAliasModel.exists({
      _id: { $ne: alias._id },
      normalized,
      itemType,
    });
    if (clash) {
      throw new AppError(
        `"${normalized}" already points at ${itemType}.`,
        HTTP_STATUS.CONFLICT
      );
    }

    return ItemAliasModel.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after" });
  }

  /**
   * Removes a word from the dictionary.
   *
   * Unlike a taxonomy node, an alias **may** be deleted: nothing references it, it describes no
   * listing, and a bad synonym that cannot be removed makes the whole dictionary too risky to add
   * to. Deactivating it instead would leave a row that looks live in the admin screen and does
   * nothing.
   */
  async deleteAlias(id: string) {
    const alias = await ItemAliasModel.findByIdAndDelete(id);
    if (!alias) throw new AppError("Alias not found", HTTP_STATUS.NOT_FOUND);
    return { phrase: alias.phrase, itemType: alias.itemType };
  }

  // ── the review queue ──────────────────────────────────────────────────────────────────────────

  /**
   * What the classifier got wrong, newest first.
   *
   * The specification asks for review of "zero-result searches, new terms and frequent user
   * corrections". A correction is a human naming the exact phrase that produced the wrong answer,
   * which is the most useful thing a rules-based classifier can be given — so the default view is
   * corrections and unmatched terms that nobody has looked at yet.
   */
  async listFeedback(query: {
    corrected?: boolean;
    reviewed?: boolean;
    unmatchedOnly?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const filter: Record<string, unknown> = {};

    if (query.corrected !== undefined) filter.corrected = query.corrected;
    if (query.reviewed !== undefined) filter.reviewed = query.reviewed;
    // A term the classifier had no answer for at all — the clearest signal that a word is missing.
    if (query.unmatchedOnly) filter.suggested = { $size: 0 };

    const [rows, total, topTerms] = await Promise.all([
      ClassificationFeedbackModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ClassificationFeedbackModel.countDocuments(filter),
      // The same phrase arriving repeatedly is worth more attention than one that arrived once.
      ClassificationFeedbackModel.aggregate([
        { $match: { reviewed: false } },
        { $group: { _id: "$normalized", n: { $sum: 1 }, example: { $first: "$submittedTerm" } } },
        { $match: { n: { $gt: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 20 },
      ]),
    ]);

    return { feedback: rows, page, limit, total, repeatedTerms: topTerms };
  }

  /**
   * Closes a feedback row, optionally by teaching the dictionary what it should have said.
   *
   * This is the loop the specification describes, in one call: an owner corrected us, an
   * administrator agrees, and the word now resolves correctly for everyone on the next request —
   * no deploy, no app release.
   */
  async reviewFeedback(
    id: string,
    data: { addAlias?: { itemType: string; kind?: AliasKind }; adminId?: string }
  ) {
    const row = await ClassificationFeedbackModel.findById(id);
    if (!row) throw new AppError("Feedback not found", HTTP_STATUS.NOT_FOUND);

    let alias = null;
    if (data.addAlias) {
      alias = await this.createAlias({
        phrase: row.submittedTerm,
        itemType: data.addAlias.itemType,
        kind: data.addAlias.kind ?? "synonym",
        approved: true,
        addedBy: data.adminId,
      });
    }

    row.reviewed = true;
    await row.save();
    return { feedback: row, aliasCreated: alias };
  }

  /** The alias kinds and what each one weighs, so the admin screen does not hardcode them. */
  aliasKinds() {
    return ALIAS_KINDS;
  }
}
