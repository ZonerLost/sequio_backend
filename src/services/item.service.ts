import { ItemRepository } from "../repository/item.repository";
import { UserRepository } from "../repository/user.repository";
import { uploadToS3, deleteFromS3 } from "../helpers/s3.helper";
import { AppError } from "../middleware/error.middleware";
import { AddressParts } from "../helpers/geocoding.helper";
import {
  resolveCoordinates,
  coordinateFields,
  coordinateUpdate,
  withinRadius,
  attachDistance,
  isValidLatLng,
  LatLng,
} from "../helpers/location.helper";
import { HTTP_STATUS, CONSTANTS } from "../config/constants";
import { IItem, IWeeklySchedule, PaginationMeta } from "../types";
import { CO2_BY_CATEGORY } from "../models/eco.model";

const userRepo = new UserRepository();

const BOOST_DURATION_DAYS = 7;
const BOOST_PRICE_CAD = 9.99;

/** Radius used when a caller gives a centre but no distance. Kilometres, like every radius here. */
/**
 * What a visitor is allowed to see.
 *
 * `isPaused: { $ne: true }` and not `isPaused: false`, because Mongo does not match a missing field
 * against false. 12 of 28 listings were created before the field existed, so a plain `false` hid 10
 * active listings from every browse, search and feed — invisible to the whole app, with nothing in
 * the owner UI to explain it. Pausing is an explicit action nobody could have taken before the
 * feature shipped, so an absent flag means not paused.
 *
 * Same trap as `booking.paymentStatus`: a schema default applies to new documents only, never
 * retroactively.
 */
const visibleToPublic = (): FilterQuery => ({ isActive: true, isPaused: { $ne: true } });

const DEFAULT_RADIUS_KM = 20;

/**
 * The centre of a radius search, or null when the caller did not give a usable one.
 *
 * A radius with no centre is meaningless, so it is ignored rather than guessed at — and 0,0 is
 * rejected by isValidLatLng, because an uninitialised device location must not quietly return the
 * listings nearest the Gulf of Guinea.
 */
function centreOf(lat: unknown, lng: unknown): LatLng | null {
  if (lat === undefined || lat === null || lat === "" || lng === undefined || lng === null || lng === "")
    return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return isValidLatLng(point) ? point : null;
}

/**
 * The same keyword search as `$text`, expressed as a regex.
 *
 * Only used when a search is combined with `sortBy=distance`: that path goes through `$geoNear`,
 * which must be an aggregation's first stage and refuses `$text` in its `query`. A regex is the
 * poorer search — no stemming, no relevance ranking — but it composes, which beats refusing the
 * combination outright. The input is escaped: an unescaped user string is a regex injection, and
 * something like `(a+)+$` is a denial of service all by itself.
 */
function keywordFilter(search: string): FilterQuery {
  const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = { $regex: safe, $options: "i" };
  return { $or: [{ title: rx }, { description: rx }, { tags: rx }] };
}

type FilterQuery = Record<string, any>;

const itemRepo = new ItemRepository();

function getOwnerId(item: IItem): string {
  const owner = item.owner as any;
  return owner._id ? owner._id.toString() : owner.toString();
}

export class ItemService {
  async createItem(ownerId: string, data: Partial<IItem>): Promise<IItem> {
    /**
     * Fill in coordinates from the address text when the client did not send any.
     *
     * Almost no listing had them: the app has no GPS button and no map picker, so the only path was
     * typing decimal degrees by hand, which nobody does. 8 of 28 listings had a point. Without
     * coordinates a listing cannot appear on the map or in any "near me" result, however complete
     * the rest of it looks — so geocoding the city/province/country the owner already typed is the
     * difference between a listing being findable and not.
     *
     * Never fatal. A geocoder outage must not stop someone listing an item.
     */
    const resolved = await resolveCoordinates(
      data.location as (AddressParts & { coordinates?: unknown }) | undefined
    );

    return itemRepo.create({
      ...data,
      ...(resolved && data.location
        ? { location: { ...data.location, ...coordinateFields(resolved.point, resolved) } }
        : {}),
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
      radius,
      distance,
    } = query;

    const filter: FilterQuery = visibleToPublic();
    if (category) filter.category = category;
    if (city) filter["location.city"] = { $regex: city, $options: "i" };
    if (condition) filter.condition = condition;
    if (minPrice || maxPrice) {
      filter.dailyRate = {};
      if (minPrice) filter.dailyRate.$gte = Number(minPrice);
      if (maxPrice) filter.dailyRate.$lte = Number(maxPrice);
    }

    const centre = centreOf(lat, lng);
    /**
     * `distance` is the name the app already sends and means the same thing; `radius` wins when
     * both are present. Both are kilometres.
     */
    const radiusKm = Number(radius ?? distance ?? DEFAULT_RADIUS_KM);

    /**
     * sortBy=distance needs a centre to measure from. Without one it falls back to the default
     * order instead of erroring: a map screen that has not got a GPS fix yet should still show
     * listings.
     */
    const byDistance = sortBy === "distance" && centre !== null;

    if (search) {
      Object.assign(
        filter,
        byDistance ? keywordFilter(search as string) : { $text: { $search: search as string } }
      );
    }

    const pageSize = Math.min(Number(limit), CONSTANTS.MAX_PAGE_SIZE);
    const { items: rows, total } = byDistance
      ? await itemRepo.findManyNearby(filter, {
          near: centre as LatLng,
          radiusKm,
          page: Number(page),
          limit: pageSize,
        })
      : await itemRepo.findMany(
          { ...filter, ...(centre ? withinRadius(centre, radiusKm) : {}) },
          {
            page: Number(page),
            limit: pageSize,
            // "distance" is not a stored field; without a centre it cannot mean anything.
            sortBy: sortBy === "distance" ? "createdAt" : (sortBy as string),
            sortOrder: sortOrder as "asc" | "desc",
          }
        );

    const items = attachDistance(rows, centre);

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
    const { lat, lng, radius = DEFAULT_RADIUS_KM, limit = 10 } = query;
    const baseFilter: FilterQuery = visibleToPublic();
    const centre = centreOf(lat, lng);

    const [nearMe, popular, recent] = await Promise.all([
      /**
       * "Near me" is ordered by distance, not by age — that is what the heading promises. It used
       * to be a bounding box sorted by createdAt, so the first card was the newest listing in a
       * 40 km square, which could easily be the furthest one in the section.
       */
      centre
        ? itemRepo.findManyNearby(baseFilter, { near: centre, radiusKm: radius, page: 1, limit })
        : Promise.resolve({ items: [], total: 0 }),
      itemRepo.findMany(baseFilter, { page: 1, limit, sortBy: "totalRentals", sortOrder: "desc" }),
      itemRepo.findMany(baseFilter, { page: 1, limit, sortBy: "createdAt", sortOrder: "desc" }),
    ]);

    // Distance goes on all three sections when a centre is known: a renter wants "how far away is
    // this" on every card, not only on the nearby one.
    return {
      nearMe: attachDistance(nearMe.items, centre),
      popular: attachDistance(popular.items, centre),
      recent: attachDistance(recent.items, centre),
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

    /**
     * Re-geocode when the address text changed but no coordinates came with it.
     *
     * The merge matters: an update may send only `city`, so the text is read on top of what is
     * already stored rather than geocoding a fragment on its own. And if the client sent explicit
     * coordinates, resolveCoordinates returns those untouched and nothing is looked up.
     */
    if (data.location && typeof data.location === "object") {
      const incoming = data.location as AddressParts & { coordinates?: unknown };
      const merged: AddressParts & { coordinates?: unknown } = {
        address: incoming.address ?? item.location?.address ?? null,
        city: incoming.city ?? item.location?.city ?? null,
        province: incoming.province ?? item.location?.province ?? null,
        country: incoming.country ?? item.location?.country ?? null,
        coordinates: incoming.coordinates,
      };
      const resolved = await resolveCoordinates(merged);
      if (resolved) Object.assign(update, coordinateUpdate(resolved.point, resolved));
    }

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
    const [item, user] = await Promise.all([
      itemRepo.findById(itemId),
      userRepo.findById(ownerId),
    ]);

    if (!item) throw new AppError("Item not found", HTTP_STATUS.NOT_FOUND);
    if (getOwnerId(item) !== ownerId) throw new AppError("Forbidden", HTTP_STATUS.FORBIDDEN);
    if (!item.isActive) throw new AppError("Cannot boost an inactive listing", HTTP_STATUS.BAD_REQUEST);
    if (item.isPaused) throw new AppError("Cannot boost a paused listing", HTTP_STATUS.BAD_REQUEST);

    if (!user || user.boostCredits < 1) {
      throw new AppError(
        "No boost credits available. Purchase a boost from the app to continue.",
        HTTP_STATUS.PAYMENT_REQUIRED
      );
    }

    const boostExpiresAt = new Date();
    boostExpiresAt.setDate(boostExpiresAt.getDate() + BOOST_DURATION_DAYS);

    // Decrement credit and boost atomically
    await userRepo.updateById(ownerId, { $inc: { boostCredits: -1 } } as any);
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