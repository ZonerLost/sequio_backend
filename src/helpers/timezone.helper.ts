/**
 * The listing's local clock.
 *
 * Phase 2d measures "more than 48 hours before the rental starts", and that is only a well-defined
 * instant once two things are known: **what time of day the rental begins**, and **in whose clock**.
 * Neither was knowable before this file existed, and the database says why:
 *
 * - **18 of 22 bookings store `startDate` at exactly 00:00 UTC** — they are calendar dates, not
 *   instants. Read literally, a Montreal rental "starting" at midnight UTC begins at 19:00 the
 *   *previous* evening locally. Measuring a 48-hour boundary from that is five hours wrong and, near
 *   midnight, a whole day wrong.
 * - **`pickupTimeFrom` is stored as `"09:00 AM"`** — a 12-hour string. `parseInt` on `"01:00 PM"`
 *   returns 1, not 13, so the obvious parse is quietly twelve hours out for half the day.
 * - **`location.province` cannot be trusted.** The live values are `"Canada"` (15 listings),
 *   `"Quebec"` (8), `"QC"` (3) and `"isb"` (2). Coordinates are the better source and 20 of 28
 *   listings have them.
 *
 * **No npm dependency.** Node's `Intl` carries the full IANA database (418 zones on this runtime),
 * so DST, half-hour offsets and historical changes are the platform's problem, not ours. All this
 * file does is choose a zone name; `Intl` does the arithmetic. That matters because a `package.json`
 * change cannot ship through the crane-append deploy — the same reason `stripe.helper.ts` and
 * `geocoding.helper.ts` use bare `fetch`.
 *
 * **The zone is derived on every read, not stored.** There is deliberately no backfill: a stored
 * zone goes stale the moment an owner edits their address, and a derived one cannot. The single
 * exception is `location.timeZone`, which is an **override** — set it when the derivation is wrong
 * and it wins, which is also the correction path that needs no code change.
 */
import { logger } from "../config/logger";

/**
 * Where a listing with no usable location is assumed to be.
 *
 * Eastern. Every geocoded listing on the platform is in Quebec or Ontario, and the alternative —
 * refusing to quote a refund because a listing has no coordinates — would make the policy
 * unenforceable for the 8 listings that have none. `timeZoneFor` reports `source: "default"` so a
 * caller can tell an assumption from a fact.
 *
 * `America/Montreal` is only a backwards-compatibility alias for `America/Toronto` in the IANA
 * database; using the canonical name keeps the value comparable.
 */
export const DEFAULT_TIME_ZONE = "America/Toronto";

export type TimeZoneSource = "listing" | "coordinates" | "province" | "default";

export interface ResolvedTimeZone {
  timeZone: string;
  source: TimeZoneSource;
}

/**
 * Canadian provinces and territories to IANA zones, by every spelling this database contains.
 *
 * Three entries are deliberately absent — Ontario, Quebec and Newfoundland & Labrador each span two
 * zones, so naming one would be wrong for part of the province. They are resolved by longitude in
 * `splitProvinces` below, and fall back to their majority zone when there are no coordinates.
 */
const PROVINCE_ZONES: Record<string, string> = {
  ns: "America/Halifax",
  "nova scotia": "America/Halifax",
  "nouvelle-ecosse": "America/Halifax",
  nb: "America/Halifax",
  "new brunswick": "America/Halifax",
  "nouveau-brunswick": "America/Halifax",
  pe: "America/Halifax",
  pei: "America/Halifax",
  "prince edward island": "America/Halifax",
  mb: "America/Winnipeg",
  manitoba: "America/Winnipeg",
  // Saskatchewan keeps Central Standard Time all year and does not observe DST. Its own zone,
  // not a Winnipeg alias, which is the whole point.
  sk: "America/Regina",
  saskatchewan: "America/Regina",
  ab: "America/Edmonton",
  alberta: "America/Edmonton",
  bc: "America/Vancouver",
  "british columbia": "America/Vancouver",
  "colombie-britannique": "America/Vancouver",
  yt: "America/Whitehorse",
  yukon: "America/Whitehorse",
  nt: "America/Edmonton",
  "northwest territories": "America/Edmonton",
  nu: "America/Iqaluit",
  nunavut: "America/Iqaluit",
};

/** Provinces spanning two zones: the majority zone, used when there is no coordinate to refine it. */
const SPLIT_PROVINCE_ZONES: Record<string, string> = {
  on: "America/Toronto",
  ontario: "America/Toronto",
  qc: "America/Toronto",
  quebec: "America/Toronto",
  québec: "America/Toronto",
  nl: "America/St_Johns",
  newfoundland: "America/St_Johns",
  "newfoundland and labrador": "America/St_Johns",
  "terre-neuve-et-labrador": "America/St_Johns",
};

const normalise = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\.$/, "");

/**
 * The zone for a point in Canada, by longitude band.
 *
 * **Approximate, and knowingly so.** A correct answer needs the IANA shapefile, which is megabytes
 * of polygons and a dependency. These bands follow the real boundaries to roughly a degree, which
 * for a listing within ~70 km of a zone edge can be one hour out — and one hour of error in a
 * 48-hour window is bounded, visible (`source` is reported) and correctable (`location.timeZone`).
 * A missing time zone, by contrast, silently puts every window five hours out.
 *
 * Returns `null` outside Canada rather than guessing: this is the only country the platform
 * operates in, and a confident wrong answer for somewhere else is worse than falling through to the
 * province map.
 */
const zoneFromCoordinates = (lat: number, lng: number): string | null => {
  // Canada's rough bounding box. Anything outside it is not somewhere these bands describe.
  if (lat < 41 || lat > 84 || lng < -141.5 || lng > -52) return null;

  if (lat >= 60) {
    // The territories. Of near-zero consequence to a Quebec rental platform, included so the
    // function has no silent hole.
    if (lng >= -85) return "America/Iqaluit"; // eastern Nunavut, incl. Baffin Island
    if (lng >= -102) return "America/Rankin_Inlet"; // central Nunavut
    if (lng >= -120) return "America/Cambridge_Bay"; // western Nunavut
    if (lng >= -131) return "America/Edmonton"; // Northwest Territories
    return "America/Whitehorse"; // Yukon
  }

  // Newfoundland island only — its own half-hour offset. Labrador, immediately north, is Atlantic,
  // so latitude is what separates them.
  if (lng >= -59.5 && lat < 51.6) return "America/St_Johns";
  // Labrador, Cape Breton, and the sliver of Quebec east of 63°W.
  if (lng >= -63) return "America/Halifax";
  /**
   * The rest of the Maritimes.
   *
   * **The Atlantic/Eastern line is not a meridian.** Nova Scotia, PEI and New Brunswick all reach
   * well west of 63°W — Halifax itself is at 63.58°W — while Quebec's Gaspé peninsula sits at the
   * same longitudes and is Eastern. Latitude separates them: the New Brunswick/Quebec border runs
   * at about 48°N. A band on longitude alone put Halifax an hour out, which is exactly the class of
   * error this whole file exists to prevent.
   */
  if (lng >= -69 && lat < 48.1) return "America/Halifax";
  // Quebec west of the Gaspé, and eastern/central Ontario.
  if (lng >= -90) return "America/Toronto";
  // Western Ontario and Manitoba.
  if (lng >= -102) return "America/Winnipeg";
  if (lng >= -110) return "America/Regina";
  if (lng >= -120) return "America/Edmonton";
  return "America/Vancouver";
};

/** Whether `Intl` recognises a zone name. A bad override must not poison the arithmetic. */
export const isKnownTimeZone = (timeZone: unknown): boolean => {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
};

export interface TimeZoneLocation {
  province?: string | null;
  country?: string | null;
  timeZone?: string | null;
  coordinates?: { lat?: number | null; lng?: number | null } | null;
}

/**
 * The listing's time zone, and where the answer came from.
 *
 * Order of authority: an explicit override, then the coordinates, then the province, then the
 * platform default. Coordinates beat the province because the province field in this database is
 * frequently the country or junk, while the coordinates — when present — came from the geocoder and
 * are real.
 */
export const timeZoneFor = (location?: TimeZoneLocation | null): ResolvedTimeZone => {
  if (location?.timeZone) {
    if (isKnownTimeZone(location.timeZone)) {
      return { timeZone: location.timeZone, source: "listing" };
    }
    // Loud, because someone set it deliberately and it is not doing what they think.
    logger.warn(`[timezone] ignoring unknown listing time zone ${String(location.timeZone)}`);
  }

  const lat = location?.coordinates?.lat;
  const lng = location?.coordinates?.lng;
  if (typeof lat === "number" && typeof lng === "number" && !(lat === 0 && lng === 0)) {
    const zone = zoneFromCoordinates(lat, lng);
    if (zone) return { timeZone: zone, source: "coordinates" };
  }

  const province = location?.province ? normalise(String(location.province)) : "";
  if (province) {
    const exact = PROVINCE_ZONES[province];
    if (exact) return { timeZone: exact, source: "province" };
    const split = SPLIT_PROVINCE_ZONES[province];
    if (split) return { timeZone: split, source: "province" };
  }

  return { timeZone: DEFAULT_TIME_ZONE, source: "default" };
};

// ── the arithmetic, all of it delegated to Intl ──────────────────────────────────────────────────

const OFFSET_PATTERN = /GMT([+-])(\d{1,2})(?::(\d{2}))?/;

/**
 * A zone's offset from UTC at a given instant, in minutes, DST included.
 *
 * Read out of `Intl` rather than computed, which is what makes "America/St_Johns is -02:30 in
 * summer and -03:30 in winter" something this file never has to know.
 */
export const zoneOffsetMinutes = (instant: Date, timeZone: string): number => {
  const name = new Intl.DateTimeFormat("en-CA", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;

  if (!name) return 0;
  // Plain "GMT" is UTC itself — the pattern below needs a sign and would miss it.
  const match = OFFSET_PATTERN.exec(name);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
};

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** What the wall clock in `timeZone` read at that instant. */
export const partsInZone = (instant: Date, timeZone: string): ZonedParts => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // hour12:false still yields "24" for midnight in some ICU versions; normalise it.
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
  };
};

/**
 * The instant at which a wall clock in `timeZone` reads those parts.
 *
 * Two passes, because the offset depends on the instant and the instant depends on the offset. The
 * first guess uses the offset at the naive-UTC time; if that guess lands on the other side of a DST
 * change the offset differs and the second pass corrects it. Two passes always suffice, since a
 * transition moves the clock by at most an hour or two.
 *
 * Ambiguous and non-existent local times — the hour that repeats in autumn and the one skipped in
 * spring — resolve to a real instant rather than throwing. For a 48-hour cancellation boundary an
 * hour of ambiguity once a year is not worth an error path.
 */
export const instantFromParts = (parts: ZonedParts, timeZone: string): Date => {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const firstOffset = zoneOffsetMinutes(new Date(naive), timeZone);
  const candidate = new Date(naive - firstOffset * 60_000);
  const secondOffset = zoneOffsetMinutes(candidate, timeZone);
  return secondOffset === firstOffset ? candidate : new Date(naive - secondOffset * 60_000);
};

/**
 * The calendar date a stored booking date denotes, read in **UTC**.
 *
 * Deliberately not read in the listing's zone. `2026-11-15T00:00:00Z` is how this database records
 * "15 November" — the date the renter picked in a date picker — and reading that same instant in
 * Montreal gives 14 November, which is the wrong day. UTC is where the intent was recorded, so UTC
 * is where the date is read.
 */
export const calendarDateOf = (date: Date): { year: number; month: number; day: number } => {
  const d = new Date(date);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

/**
 * Parses the clock strings this database actually holds.
 *
 * `"09:00 AM"` is the stored format on all 12 bookings that carry a pickup time; `"09:00"` and
 * `"9:00"` are what a different client build might send. Returns `null` for anything else rather
 * than a plausible-looking zero, so the caller falls back to a documented default instead of
 * silently starting the rental at midnight.
 */
export const parseClockTime = (text?: string | null): { hour: number; minute: number } | null => {
  if (typeof text !== "string") return null;
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(text);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute };
};

/** A human-readable local time, for a notification body or an admin screen. */
export const formatInZone = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(instant);
