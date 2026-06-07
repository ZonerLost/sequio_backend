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