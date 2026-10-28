import { ENV } from "../config/env";
import { logger } from "../config/logger";
import { GeocodeCacheModel } from "../models/geocode-cache.model";

/**
 * Turns an address into coordinates.
 *
 * Built on `fetch` with **no npm dependency**, for the same reason `stripe.helper.ts` is: a
 * `package.json` change cannot ship through the crane-append deploy, which only replaces `dist/`.
 *
 * Three providers, chosen by `GEOCODER`:
 *
 *   nominatim (default)  OpenStreetMap, no API key. Free, and it is where the Flutter app's map
 *                        tiles come from, so the data agrees with what users see. Its usage policy
 *                        demands an identifying User-Agent, at most one request a second, and no
 *                        bulk use — all three are honoured below, and the cache is what makes the
 *                        request volume low enough for this to be legitimate.
 *   mapbox / google      Key required. Faster and higher-limit; switch when volume justifies it.
 *
 * Nothing here ever throws to a caller. A listing that cannot be geocoded is saved without
 * coordinates, exactly as it would have been before this existed — losing a listing because a
 * third-party geocoder had a bad minute would be a far worse failure than a missing map pin.
 *
 * ## A wrong coordinate is worse than no coordinate
 *
 * This is the thing to hold on to when changing anything below. A listing with no point is invisible
 * to nearby search, which is a missing feature. A listing with a *wrong* point is a listing that
 * claims to be 20 minutes away and is not, which is a broken product and a wasted trip.
 *
 * The first version of this file asked for `limit=1` and took whatever came back. Run against the
 * real database it put Montreal listings in **Costa Rica** and Toronto listings in Newfoundland,
 * and it reported both as successes. Two separate causes, both guarded against here:
 *
 * 1. **The query was polluted.** Records in this database have `province: "Canada"` next to
 *    `country: "Canada"`, so the query read `"Montreal, Canada, Canada"` — and Nominatim answered
 *    with a neighbourhood called Montreal in Puerto Cortés, Costa Rica. `normalise()` drops a
 *    province that is really a country name, or that merely repeats the city.
 * 2. **Any result type was accepted.** Even well-formed queries match banks, hotels, parks and
 *    schools whose *name* contains the city: `"Toronto, Canada"` matched Toronto Street Park in
 *    St. John's, 2,000 km from Toronto. `pickBest()` asks for several candidates and takes the best
 *    one whose type is plausible for what was asked, so a city lookup can only return a place.
 *
 * Both failures looked like successes, which is why the type and country checks are not optional
 * polish. If a provider is added or these filters are loosened, re-run
 * `scripts/backfill-location-geo.cjs --geocode` (dry run) and read the output: every line names what
 * was matched, and a wrong one is obvious.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** What the provider actually matched — a rooftop, a street, or just the city. */
  precision: string;
  provider: string;
  /** True when this came from the cache rather than the provider. */
  cached: boolean;
}

export interface AddressParts {
  address?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
}

const CACHE_TTL_DAYS = 90;
const REQUEST_TIMEOUT_MS = 6000;
/** Nominatim's policy is one request per second. Honoured for every provider; it costs nothing. */
const MIN_REQUEST_GAP_MS = 1100;

let lastRequestAt = 0;

/** Serialises outbound requests so two concurrent saves cannot breach the rate limit. */
let queue: Promise<unknown> = Promise.resolve();

const throttle = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  };
  // Chained so the queue keeps moving even when a link rejects.
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
};

/**
 * The countries this marketplace operates in, plus the spellings its data actually contains.
 *
 * Used twice: to constrain the search to that country, and to recognise a `province` that is really
 * a country name and drop it. It does not need to be a complete country list — an unrecognised
 * country is simply passed through unconstrained.
 */
const COUNTRY_CODES: Record<string, string> = {
  canada: "ca",
  ca: "ca",
  can: "ca",
  "united states": "us",
  "united states of america": "us",
  usa: "us",
  us: "us",
};

/** Lowercase, accent-stripped, whitespace-collapsed — so "Montréal" and "montreal" compare equal. */
const norm = (v?: string | null): string =>
  typeof v === "string"
    ? v
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
    : "";

const countryCodeOf = (country?: string | null): string | undefined =>
  COUNTRY_CODES[norm(country)];

interface NormalisedParts {
  address: string;
  city: string;
  province: string;
  country: string;
  /** ISO 3166-1 alpha-2, when the country is one we recognise. */
  countryCode?: string;
}

/**
 * Cleans the address parts before they become a query.
 *
 * Two corrections, both driven by what is actually stored: a `province` holding a country name is
 * dropped (and promoted to `country` if that field is empty), and a `province` that just repeats the
 * city is dropped. Both produced the duplicated queries that returned the wrong continent.
 */
const normalise = (parts: AddressParts): NormalisedParts => {
  const clean = (v?: string | null) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const address = clean(parts.address);
  const city = clean(parts.city);
  let province = clean(parts.province);
  let country = clean(parts.country);

  if (province && countryCodeOf(province)) {
    if (!country) country = province;
    province = "";
  }
  if (province && norm(province) === norm(city)) province = "";
  if (country && norm(country) === norm(city)) country = "";

  return { address, city, province, country, countryCode: countryCodeOf(country) };
};

/**
 * Builds the query string, most specific part first.
 *
 * Exported for the cache key and for tests; callers geocode through `geocode()`.
 */
export const buildQuery = (parts: AddressParts): string => {
  const n = normalise(parts);
  return [n.address, n.city, n.province, n.country].filter(Boolean).join(", ");
};

const cacheKeyFor = (query: string): string => query.toLowerCase();

const isUsable = (query: string): boolean => {
  // Needs something more than a stray token: at least one part of reasonable length.
  const letters = query.replace(/[^a-zA-Z]/g, "");
  return query.length >= 3 && letters.length >= 3;
};

/**
 * Result types that may answer a **city-level** question, best first.
 *
 * Tier 0 is a municipality — what "which city is this listing in" actually means. Tier 1 is a
 * sub-division or a boundary, still inside the right place. Tier 2 is a region or a county: correct
 * but coarse, and only taken when nothing better matched. Anything not listed — a bank, a hotel, a
 * park, a school, a building, a street — cannot answer a city question, however well its name reads.
 */
const PLACE_TIERS: string[][] = [
  ["city", "town", "village", "hamlet", "municipality", "borough", "locality", "township"],
  ["suburb", "city_district", "district", "political", "administrative", "postcode", "quarter"],
  ["county", "state_district", "state", "province", "region"],
];

/**
 * Types that answer a **street-level** question. Preferred over any place type when one was asked.
 *
 * A business type (amenity, shop, office) is deliberately not here. "1200 Rue Sainte-Catherine,
 * Montreal" matching a Bank of Montreal branch 400 km away is exactly the failure this file exists
 * to prevent, and the name preference below would actively favour it, because its name contains the
 * city. An address that resolves to nothing street-level falls back to the city instead, which is
 * approximate but never in the wrong place.
 */
const PRECISE_TYPES = [
  "place",
  "house",
  "house_number",
  "building",
  "address",
  "road",
  "residential",
];

interface Candidate {
  lat: number;
  lng: number;
  /** The provider's own word for what it matched, kept verbatim and reported to the client. */
  precision: string;
  /** ISO 3166-1 alpha-2 of the match, when the provider says. */
  countryCode?: string;
  /** The matched name, for the soft preference below. */
  name?: string;
  /** Provider ranking, used only to break ties. */
  importance?: number;
}

/**
 * Picks the best candidate, or none.
 *
 * Ranked on three things in order: how well the result's *type* answers the question asked, whether
 * its name matches the city (a preference, not a requirement — "Quebec" is a fine answer for
 * "Quebec City"), and the provider's own importance score. A candidate in the wrong country is
 * dropped outright when a country was stated.
 */
const pickBest = (
  candidates: Candidate[],
  parts: NormalisedParts,
  wantPrecise: boolean
): Candidate | null => {
  const allowed = wantPrecise ? [PRECISE_TYPES, ...PLACE_TIERS] : PLACE_TIERS;
  const cityNorm = norm(parts.city);

  let best: { c: Candidate; tier: number; named: number; importance: number } | null = null;

  for (const c of candidates) {
    if (parts.countryCode && c.countryCode && c.countryCode !== parts.countryCode) continue;

    const tier = allowed.findIndex((types) => types.includes(c.precision));
    if (tier === -1) continue;

    const nameNorm = norm(c.name);
    const named = cityNorm && nameNorm && (nameNorm === cityNorm || nameNorm.includes(cityNorm)) ? 0 : 1;
    const importance = c.importance ?? 0;

    if (
      !best ||
      tier < best.tier ||
      (tier === best.tier && named < best.named) ||
      (tier === best.tier && named === best.named && importance > best.importance)
    ) {
      best = { c, tier, named, importance };
    }
  }

  return best?.c ?? null;
};

/** Mapbox and Google each name result kinds their own way; the tiers above speak Nominatim's. */
const MAPBOX_TYPES: Record<string, string> = {
  place: "city",
  neighborhood: "suburb",
};
const GOOGLE_TYPES: Record<string, string> = {
  locality: "city",
  sublocality: "suburb",
  administrative_area_level_1: "state",
  administrative_area_level_2: "county",
  administrative_area_level_3: "district",
  street_address: "address",
  premise: "building",
  subpremise: "building",
  route: "road",
};

const fetchJson = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`geocoder answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

type Provider = (query: string, parts: NormalisedParts) => Promise<Candidate[]>;

/**
 * `addressdetails=1` is what makes the country check possible, and `limit=6` is what makes the type
 * filter possible — with `limit=1` there is nothing to choose between.
 */
const viaNominatim: Provider = async (query, parts) => {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1" +
    (parts.countryCode ? `&countrycodes=${parts.countryCode}` : "") +
    "&q=" +
    encodeURIComponent(query);
  // The policy requires a real identifying User-Agent; a generic one gets blocked, rightly.
  const data = (await fetchJson(url, {
    "User-Agent": ENV.GEOCODER_USER_AGENT,
    "Accept-Language": "en",
  })) as Array<{
    lat?: string;
    lon?: string;
    name?: string;
    addresstype?: string;
    type?: string;
    importance?: number;
    address?: { country_code?: string };
    display_name?: string;
  }>;

  if (!Array.isArray(data)) return [];
  return data
    .map((hit) => ({
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      precision: hit.addresstype || hit.type || "unknown",
      countryCode: hit.address?.country_code,
      name: hit.name || String(hit.display_name || "").split(",")[0],
      importance: hit.importance,
    }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
};

const viaMapbox: Provider = async (query, parts) => {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?limit=6&access_token=${encodeURIComponent(ENV.GEOCODER_API_KEY)}` +
    (parts.countryCode ? `&country=${parts.countryCode}` : "");
  const data = (await fetchJson(url, {})) as {
    features?: Array<{
      center?: [number, number];
      place_type?: string[];
      text?: string;
      relevance?: number;
      context?: Array<{ id?: string; short_code?: string }>;
    }>;
  };
  return (data.features ?? [])
    .map((f) => {
      // Mapbox returns [lng, lat] — the opposite order to everything else here.
      const [lng, lat] = f.center ?? [NaN, NaN];
      const code = f.context?.find((c) => String(c.id).startsWith("country"))?.short_code;
      return {
        lat,
        lng,
        precision: MAPBOX_TYPES[f.place_type?.[0] ?? ""] ?? f.place_type?.[0] ?? "unknown",
        countryCode: code ? code.toLowerCase() : undefined,
        name: f.text,
        importance: f.relevance,
      };
    })
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
};

const viaGoogle: Provider = async (query, parts) => {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(query) +
    (parts.countryCode ? `&components=country:${parts.countryCode.toUpperCase()}` : "") +
    `&key=${encodeURIComponent(ENV.GEOCODER_API_KEY)}`;
  const data = (await fetchJson(url, {})) as {
    status?: string;
    results?: Array<{
      types?: string[];
      formatted_address?: string;
      address_components?: Array<{ types?: string[]; short_name?: string; long_name?: string }>;
      geometry?: { location?: { lat: number; lng: number } };
    }>;
  };
  if (data.status !== "OK") return [];
  return (data.results ?? [])
    .map((r) => {
      const loc = r.geometry?.location;
      const country = r.address_components?.find((c) => c.types?.includes("country"));
      const cityPart = r.address_components?.find((c) => c.types?.includes("locality"));
      return {
        lat: loc?.lat ?? NaN,
        lng: loc?.lng ?? NaN,
        precision: GOOGLE_TYPES[r.types?.[0] ?? ""] ?? r.types?.[0] ?? "unknown",
        countryCode: country?.short_name?.toLowerCase(),
        name: cityPart?.long_name,
      };
    })
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
};

const providerFor = (name: string): Provider => {
  switch (name) {
    case "mapbox":
      return viaMapbox;
    case "google":
      return viaGoogle;
    default:
      return viaNominatim;
  }
};

/**
 * Geocodes an address, or returns null.
 *
 * Reads the cache first, including cached misses — a city string that will never resolve must not be
 * re-queried on every save.
 *
 * When a street address was given and nothing street-level matched, it falls back to the city on a
 * second request. That is deliberate: "123 Nonexistent Ave, Montreal" should land in Montreal rather
 * than nowhere, and the `precision` it reports tells the client which of the two it got.
 */
export const geocode = async (parts: AddressParts): Promise<GeocodeResult | null> => {
  const normalised = normalise(parts);
  const full = buildQuery(parts);
  if (!isUsable(full)) return null;

  const provider = ENV.GEOCODER;
  if (provider !== "nominatim" && !ENV.GEOCODER_API_KEY) {
    logger.warn("GEOCODER is set to a keyed provider but GEOCODER_API_KEY is empty; skipping", {
      provider,
    });
    return null;
  }

  const attempt = await lookup(full, normalised, Boolean(normalised.address), provider);
  if (attempt || !normalised.address || !normalised.city) return attempt;

  // Street level found nothing usable; ask again for the city alone.
  const cityOnly: NormalisedParts = { ...normalised, address: "" };
  const cityQuery = [cityOnly.city, cityOnly.province, cityOnly.country].filter(Boolean).join(", ");
  if (!isUsable(cityQuery)) return null;
  return lookup(cityQuery, cityOnly, false, provider);
};

/** One query against the cache and, if it misses, the provider. */
const lookup = async (
  query: string,
  parts: NormalisedParts,
  wantPrecise: boolean,
  provider: string
): Promise<GeocodeResult | null> => {
  const key = cacheKeyFor(query);

  try {
    const cached = await GeocodeCacheModel.findOne({ key }).lean();
    if (cached) {
      if (!cached.found || cached.lat === undefined || cached.lng === undefined) return null;
      return {
        lat: cached.lat,
        lng: cached.lng,
        precision: cached.precision || "unknown",
        provider: cached.provider,
        cached: true,
      };
    }
  } catch (err) {
    // A cache read failure is not a reason to skip geocoding, only to pay for it again.
    logger.warn("Geocode cache read failed", { message: (err as Error).message });
  }

  let best: Candidate | null = null;
  try {
    const candidates = await throttle(() => providerFor(provider)(query, parts));
    best = pickBest(candidates, parts, wantPrecise);
    if (!best && candidates.length) {
      // Worth seeing: the provider answered, and every answer was the wrong kind of thing. That is
      // the failure that used to be silently written to the database as a coordinate.
      logger.info("Geocoder returned only implausible matches", {
        query,
        rejected: candidates.map((c) => c.precision).slice(0, 6),
      });
    }
  } catch (err) {
    // Not cached: a timeout or a 503 says nothing about whether the address is real, and caching it
    // as a miss would make a transient outage permanent for that address.
    logger.warn("Geocoding failed", { query, provider, message: (err as Error).message });
    return null;
  }

  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  try {
    await GeocodeCacheModel.updateOne(
      { key },
      {
        key,
        query,
        found: Boolean(best),
        ...(best ? { lat: best.lat, lng: best.lng, precision: best.precision } : {}),
        provider,
        expiresAt,
      },
      { upsert: true }
    );
  } catch (err) {
    logger.warn("Geocode cache write failed", { message: (err as Error).message });
  }

  if (!best) return null;
  return {
    lat: best.lat,
    lng: best.lng,
    precision: best.precision,
    provider,
    cached: false,
  };
};

/**
 * Distance between two points in kilometres, on a sphere.
 *
 * Used to report `distanceKm` on results. Mongo does the filtering and ordering with a real
 * geospatial index; this is only for display, on one page of results at a time.
 */
export const haversineKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100;
};
