import { ItemRepository } from "../repository/item.repository";
import { uploadToS3, deleteFromS3 } from "../helpers/s3.helper";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS, CONSTANTS } from "../config/constants";
import { IItem, IWeeklySchedule, PaginationMeta } from "../types";
import { CO2_BY_CATEGORY } from "../models/eco.model";

const BOOST_DURATION_DAYS = 7;
const BOOST_PRICE_CAD = 9.99;

type FilterQuery = Record<string, any>;

const itemRepo = new ItemRepository();

function getOwnerId(item: IItem): string {
  const owner = item.owner as any;
  return owner._id ? owner._id.toString() : owner.toString();
}

export class ItemService {
  async createItem(ownerId: string, data: Partial<IItem>): Promise<IItem> {
    return itemRepo.create({
      ...data,
      owner: ownerId as unknown as IItem["owner"],
    });
  }

  async getItems(query: Record<string, unknown>) {
    const {
      page = 1,
      limit = 10,
      category,
      city,
      minPrice,
      maxPrice,
      condition,
      search,
      sortBy,
      sortOrder,
      lat,
      lng,
      radius = 20,
    } = query;

    const filter: FilterQuery = { isActive: true, isPaused: false };
    if (category) filter.category = category;
    if (city) filter["location.city"] = { $regex: city, $options: "i" };
    if (condition) filter.condition = condition;
    if (minPrice || maxPrice) {
      filter.dailyRate = {};
      if (minPrice) filter.dailyRate.$gte = Number(minPrice);
      if (maxPrice) filter.dailyRate.$lte = Number(maxPrice);
    }
    if (search) filter.$text = { $search: search as string };

    if (lat && lng) {
      const latDelta = Number(radius) / 111;
      const lngDelta = Number(radius) / (111 * Math.cos(Number(lat) * Math.PI / 180));
      filter["location.coordinates.lat"] = { $gte: Number(lat) - latDelta, $lte: Number(lat) + latDelta };
      filter["location.coordinates.lng"] = { $gte: Number(lng) - lngDelta, $lte: Number(lng) + lngDelta };
    }

    const { items, total } = await itemRepo.findMany(filter, {
      page: Number(page),
      limit: Math.min(Number(limit), CONSTANTS.MAX_PAGE_SIZE),
      sortBy: sortBy as string,
      sortOrder: sortOrder as "asc" | "desc",
    });

    const totalPages = Math.ceil(total / Number(limit));
    const pagination: PaginationMeta = {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages,
      hasNext: Number(page) < totalPages,
      hasPrev: Number(page) > 1,
    };

    return { items, pagination };
  }

  async getFeed(query: { lat?: number; lng?: number; radius?: number; limit?: number }) {
    const { lat, lng, radius = 20, limit = 10 } = query;
    const baseFilter: FilterQuery = { isActive: true, isPaused: false };

    const nearMeFilter: FilterQuery = { ...baseFilter };
    if (lat && lng) {
      const latDelta = radius / 111;
      const lngDelta = radius / (111 * Math.cos(lat * Math.PI / 180));
      nearMeFilter["location.coordinates.lat"] = { $gte: lat - latDelta, $lte: lat + latDelta };
      nearMeFilter["location.coordinates.lng"] = { $gte: lng - lngDelta, $lte: lng + lngDelta };
    }

    const [nearMe, popular, recent] = await Promise.all([
      lat && lng
        ? itemRepo.findMany(nearMeFilter, { page: 1, limit, sortBy: "createdAt", sortOrder: "desc" })
        : Promise.resolve({ items: [], total: 0 }),
      itemRepo.findMany(baseFilter, { page: 1, limit, sortBy: "totalRentals", sortOrder: "desc" }),
      itemRepo.findMany(baseFilter, { page: 1, limit, sortBy: "createdAt", sortOrder: "desc" }),
    ]);

    return {
      nearMe: nearMe.items,
      popular: popular.items,
      recent: recent.items,
    };
  }

  async getItemById(id: string): Promise<IItem> {
    const item = await itemRepo.findById(id);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    return item;
  }

  async getMyListings(ownerId: string): Promise<IItem[]> {
    return itemRepo.findByOwner(ownerId);
  }

  async updateItem(itemId: string, ownerId: string, data: Partial<IItem>): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId)
      throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if ((key === "location" || key === "deliveryOptions") && value && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (key === "location" && k === "coordinates" && v && typeof v === "object") {
            for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
              update[`location.coordinates.${ck}`] = cv;
            }
          } else {
            update[`${key}.${k}`] = v;
          }
        }
      } else {
        update[key] = value;
      }
    }
    const updated = await itemRepo.updateById(itemId, update);
    return updated!;
  }

  async deleteItem(itemId: string, ownerId: string): Promise<void> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId)
      throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    await itemRepo.deleteById(itemId);
  }

  async uploadItemPhotos(
    itemId: string,
    ownerId: string,
    files: Express.Multer.File[]
  ): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId)
      throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    if (item.photos.length + files.length > CONSTANTS.MAX_ITEM_PHOTOS) {
      throw new AppError(
        `Maximum ${CONSTANTS.MAX_ITEM_PHOTOS} photos allowed`,
        HTTP_STATUS.BAD_REQUEST
      );
    }
    const uploadedUrls = await Promise.all(
      files.map((f) => uploadToS3(f.buffer, f.mimetype, "item-photos"))
    );
    const updated = await itemRepo.updateById(itemId, {
      $push: { photos: { $each: uploadedUrls } },
    });
    return updated!;
  }

  async deleteItemPhoto(
    itemId: string,
    ownerId: string,
    photoUrl: string
  ): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId)
      throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    await deleteFromS3(photoUrl).catch(() => {});
    const updated = await itemRepo.updateById(itemId, {
      $pull: { photos: photoUrl },
    });
    return updated!;
  }

  async pauseListing(itemId: string, ownerId: string): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId) throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    if (item.isPaused) throw new AppError("Listing is already paused", HTTP_STATUS.BAD_REQUEST);
    return (await itemRepo.updateById(itemId, { isPaused: true }))!;
  }

  async resumeListing(itemId: string, ownerId: string): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId) throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    if (!item.isPaused) throw new AppError("Listing is not paused", HTTP_STATUS.BAD_REQUEST);
    return (await itemRepo.updateById(itemId, { isPaused: false }))!;
  }

  async updateAvailability(
    itemId: string,
    ownerId: string,
    data: { isAvailable?: boolean; blockedDates?: Date[]; availableFrom?: Date; availableTo?: Date }
  ): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId)
      throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    const updated = await itemRepo.updateById(itemId, {
      "availability.isAvailable": data.isAvailable ?? item.availability.isAvailable,
      "availability.blockedDates": data.blockedDates ?? item.availability.blockedDates,
      "availability.availableFrom": data.availableFrom ?? item.availability.availableFrom,
      "availability.availableTo": data.availableTo ?? item.availability.availableTo,
    });
    return updated!;
  }

  async updatePickupSchedule(itemId: string, ownerId: string, data: IWeeklySchedule): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId) throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    const updated = await itemRepo.updateById(itemId, { pickupSchedule: data });
    return updated!;
  }

  async updateDeliverySchedule(itemId: string, ownerId: string, data: IWeeklySchedule): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId) throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    const updated = await itemRepo.updateById(itemId, { deliverySchedule: data });
    return updated!;
  }

  getBoostConfig() {
    return {
      price: BOOST_PRICE_CAD,
      currency: "CAD",
      durationDays: BOOST_DURATION_DAYS,
      description: `Boost your listing for ${BOOST_DURATION_DAYS} days to appear at the top of search results and feed.`,
    };
  }

  async boostListing(itemId: string, ownerId: string): Promise<IItem> {
    const item = await itemRepo.findById(itemId);
    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId) throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    if (!item.isActive) throw new AppError("Cannot boost an inactive listing", HTTP_STATUS.BAD_REQUEST);
    if (item.isPaused) throw new AppError("Cannot boost a paused listing", HTTP_STATUS.BAD_REQUEST);

    const boostExpiresAt = new Date();
    boostExpiresAt.setDate(boostExpiresAt.getDate() + BOOST_DURATION_DAYS);

    const updated = await itemRepo.updateById(itemId, {
      isBoosted: true,
      boostedAt: new Date(),
      boostExpiresAt,
    });
    return updated!;
  }

  getFormConfig() {
    const categories = Object.keys(CO2_BY_CATEGORY).map((cat) => ({
      id: cat,
      label: cat
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    }));

    return {
      categories,
      conditions: [
        { id: "new", label: "New" },
        { id: "like_new", label: "Like New" },
        { id: "good", label: "Good" },
        { id: "fair", label: "Fair" },
      ],
      bookingTypes: [
        { id: "manual", label: "Request to Book", description: "You manually approve each booking request" },
        { id: "instant", label: "Instant Booking", description: "Bookings are automatically confirmed" },
      ],
      rentalOptions: {
        currencies: [{ id: "CAD", label: "Canadian Dollar (CAD)" }],
        minRentalDays: 1,
        maxRentalDays: 365,
      },
    };
  }
}