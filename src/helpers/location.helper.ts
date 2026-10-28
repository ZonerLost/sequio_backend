import { logger } from "../config/logger";
import { geocode, haversineKm, AddressParts } from "./geocoding.helper";

/**
 * The one place that decides a record's coordinates, and the only place that writes them.
 *
 * Two fields hold the same point: `location.coordinates { lat, lng }`, which is the client contract,
 * and `location.geo`, a GeoJSON point that exists so Mongo can index and sort by distance. They must
 * never disagree, so nothing should set one without the other — that is what this file is for.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Where a point came from and how exact it is.
 *
 * Stored alongside the point so a client can tell a city centroid from a rooftop. Every listing in
 * one city shares one coordinate, and drawing that as a precise pin is a claim nobody made.
 */
export interface PointMeta {
  source: "client" | "geocoded";
  precision?: string;
}

const isValidLatLng = (value: unknown): value is LatLng => {
  if (!value || typeof value !== "object") return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    // Rejects the classic 0,0 — a point in the Atlantic that almost always means "unset", and which
    // would otherwise place a listing 5,000 km from anywhere and still match a radius search.
    !(lat === 0 && lng === 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

/**
 * Dot-path updates that set both representations of a point.
 *
 * Dot paths, not a nested object: assigning `{ location: {...} }` to findByIdAndUpdate replaces the
 * whole subdocument and would wipe city, province and country.
 */
export const coordinateUpdate = (
  point: LatLng,
  meta?: PointMeta,
  prefix = "location"
): Record<string, unknown> => ({
  [`${prefix}.coordinates.lat`]: point.lat,
  [`${prefix}.coordinates.lng`]: point.lng,
  // GeoJSON order is [lng, lat].
  [`${prefix}.geo`]: { type: "Point", coordinates: [point.lng, point.lat] },
  ...(meta
    ? {
        [`${prefix}.geoSource`]: meta.source,
        [`${prefix}.geoPrecision`]: meta.precision ?? null,
      }
    : {}),
});

/** The same point in the shape a `create()` call wants, rather than dot paths. */
export const coordinateFields = (point: LatLng, meta?: PointMeta) => ({
  coordinates: { lat: point.lat, lng: point.lng },
  geo: { type: "Point" as const, coordinates: [point.lng, point.lat] },
  ...(meta ? { geoSource: meta.source, geoPrecision: meta.precision } : {}),
});

/**
 * Works out the coordinates for a location, geocoding the text only when it has to.
 *
 * Explicit coordinates always win — if a client sends a point, that is the point, and no lookup
 * happens. This is what the app asked for: they keep sending the text they already collect, and a
 * manual-entry path that sends real numbers still overrides it.
 *
 * Returns null when there is nothing usable, and the caller then saves without coordinates, exactly
 * as it did before any of this existed.
 */
export const resolveCoordinates = async (
  location: (AddressParts & { coordinates?: unknown }) | undefined | null
): Promise<{ point: LatLng; source: "client" | "geocoded"; precision?: string } | null> => {
  if (!location) return null;

  if (isValidLatLng(location.coordinates)) {
    return { point: location.coordinates, source: "client" };
  }

  const hit = await geocode(location);
  if (!hit) return null;

  logger.info("Geocoded a location", {
    city: location.city ?? null,
    precision: hit.precision,
    provider: hit.provider,
    cached: hit.cached,
  });
  return { point: { lat: hit.lat, lng: hit.lng }, source: "geocoded", precision: hit.precision };
};

/** Earth's radius in km, for turning a distance into the radians $centerSphere expects. */
export const EARTH_RADIUS_KM = 6371;

/**
 * A filter matching points within `radiusKm` of a centre — a real circle.
 *
 * Replaces a bounding box of `radius / 111` degrees, which matched a square: asking for 20 km
 * returned listings up to 28 km away at the corners, 41% over. `$centerSphere` takes radians, uses
 * the 2dsphere index, and sits inside an ordinary `find()` filter next to any other condition —
 * including `$text`, which `$geoNear` cannot, because it has to be an aggregation's first stage.
 */
export const withinRadius = (
  centre: LatLng,
  radiusKm: number,
  field = "location.geo"
): Record<string, unknown> => ({
  [field]: {
    $geoWithin: { $centerSphere: [[centre.lng, centre.lat], radiusKm / EARTH_RADIUS_KM] },
  },
});

/**
 * Adds `distanceKm` to each row, measured from `centre`.
 *
 * Computed here rather than in Mongo because it is only needed for the page being returned — at
 * most 50 rows — while the filtering and ordering that actually need an index stay in the database.
 * A row with no coordinates gets `null` rather than being dropped: a listing without a point is
 * still a listing, and only a radius query should exclude it.
 *
 * Returns plain objects, so every caller must treat the result as data and not as a mongoose
 * document — nothing downstream of a list response calls `.save()` on a row.
 */
export const attachDistance = <T>(rows: T[], centre: LatLng | null): Array<Record<string, unknown>> =>
  rows.map((row) => {
    const doc = row as unknown as { toObject?: () => Record<string, unknown> };
    const plain: Record<string, unknown> =
      typeof doc.toObject === "function" ? doc.toObject() : ({ ...row } as Record<string, unknown>);
    const point = (plain.location as { coordinates?: unknown } | undefined)?.coordinates;
    return {
      ...plain,
      distanceKm: centre && isValidLatLng(point) ? haversineKm(centre, point) : null,
    };
  });

export { isValidLatLng };
