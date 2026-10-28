import { ItemModel } from "../models/item.model";
import { IItem, PaginationQuery } from "../types";
import { UpdateQuery } from "mongoose";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterQuery = Record<string, any>;

export class ItemRepository {
  async create(data: Partial<IItem>): Promise<IItem> {
    return ItemModel.create(data);
  }

  async findById(id: string): Promise<IItem | null> {
    return ItemModel.findById(id)
      .populate("owner", "firstName lastName profilePhoto averageRating")
      .exec();
  }

  async findByOwner(ownerId: string): Promise<IItem[]> {
    return ItemModel.find({ owner: ownerId, isActive: true })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findMany(
    filter: FilterQuery,
    pagination: PaginationQuery
  ): Promise<{ items: IItem[]; total: number }> {
    const { page = 1, limit = 10, sortBy = "createdAt", sortOrder = "desc" } = pagination;
    const skip = (page - 1) * limit;
    const sort: Record<string, 1 | -1> = {
      isBoosted: -1,
      [sortBy]: sortOrder === "asc" ? 1 : -1,
    };
    const [items, total] = await Promise.all([
      ItemModel.find(filter)
        .populate("owner", "firstName lastName profilePhoto averageRating")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      ItemModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Listings within a radius, nearest first.
   *
   * `$geoNear` is the only way to order by distance in the database, and it filters and sorts in
   * one indexed pass. It must be the first stage of the pipeline, which is also its one limitation:
   * `$text` is not allowed in its `query`, so a caller combining a keyword search with distance
   * ordering has that search translated to a regex before it gets here.
   *
   * Unlike `findMany` this does NOT put boosted listings first. "Nearest first" that puts a
   * boosted listing 40 km away above one 200 m away reads as broken; boost still gets its lift in
   * every other sort order, including the default.
   */
  async findManyNearby(
    filter: FilterQuery,
    options: { near: { lat: number; lng: number }; radiusKm: number; page?: number; limit?: number }
  ): Promise<{ items: IItem[]; total: number }> {
    const { near, radiusKm, page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;

    // One pipeline for the page and the count: $geoNear is the expensive stage, and counting with a
    // second query would run it twice.
    const [result] = await ItemModel.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [near.lng, near.lat] },
          distanceField: "distanceMeters",
          maxDistance: radiusKm * 1000,
          query: filter,
          spherical: true,
          key: "location.geo",
        },
      },
      {
        $facet: {
          // $project drops the sort key again — distance reaches the client as `distanceKm`, added
          // by attachDistance, and two fields for one quantity invite them to disagree.
          items: [{ $skip: skip }, { $limit: limit }, { $project: { distanceMeters: 0 } }],
          total: [{ $count: "count" }],
        },
      },
    ]);

    const items = (result?.items ?? []) as IItem[];
    // Aggregation returns plain objects, so .populate() has to be asked for explicitly. The select
    // list must match findMany's — services dereference the populated owner directly (DO-NOT #7).
    await ItemModel.populate(items, {
      path: "owner",
      select: "firstName lastName profilePhoto averageRating",
    });

    return { items, total: result?.total?.[0]?.count ?? 0 };
  }

  async updateById(id: string, data: UpdateQuery<IItem>): Promise<IItem | null> {
    return ItemModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async deleteById(id: string): Promise<void> {
    await ItemModel.findByIdAndUpdate(id, { isActive: false });
  }

  async incrementRentals(id: string): Promise<void> {
    await ItemModel.findByIdAndUpdate(id, { $inc: { totalRentals: 1 } });
  }
}