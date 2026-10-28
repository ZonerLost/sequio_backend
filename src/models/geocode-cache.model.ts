import mongoose, { Schema, Document } from "mongoose";

/**
 * Cached geocoding results, keyed on the normalised query.
 *
 * Addresses repeat heavily — most listings in a city share the same "Montreal, QC, Canada" string —
 * so without a cache the same lookup is paid for over and over. It also keeps usage inside the rate
 * limits of a free provider, which is what makes running without an API key viable at all.
 *
 * Failures are cached too, with `found: false`. A city string like "g txyc" (a real value in this
 * database) will never geocode, and retrying it on every save is the same request forever.
 */
export interface IGeocodeCache extends Document {
  /** Lower-cased, collapsed query. The cache key. */
  key: string;
  query: string;
  found: boolean;
  lat?: number;
  lng?: number;
  /** What the provider matched: a street, a city, or something coarser. */
  precision?: string;
  provider: string;
  /** Expiry is handled by a TTL index — a place can be re-geocoded later if a provider improves. */
  expiresAt: Date;
  createdAt: Date;
}

const GeocodeCacheSchema = new Schema<IGeocodeCache>(
  {
    key: { type: String, required: true, unique: true },
    query: { type: String, required: true },
    found: { type: Boolean, required: true },
    lat: { type: Number },
    lng: { type: Number },
    precision: { type: String },
    provider: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

GeocodeCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const GeocodeCacheModel = mongoose.model<IGeocodeCache>(
  "GeocodeCache",
  GeocodeCacheSchema
);
