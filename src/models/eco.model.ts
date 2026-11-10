import mongoose, { Schema, Document } from "mongoose";

// CO2 footprint in kg per item category (production cost avoided by renting)
export const CO2_BY_CATEGORY: Record<string, number> = {
  tools: 27,
  power_tools: 45,
  outdoor: 35,
  sports: 30,
  electronics: 80,
  cameras: 60,
  audio: 40,
  kitchen: 20,
  furniture: 50,
  garden: 25,
  cleaning: 15,
  baby: 30,
  party: 20,
  vehicles: 120,
  camping: 35,
  cycling: 40,
  winter_sports: 50,
  water_sports: 55,
  music: 35,
  other: 20,

  /**
   * The November 2026 taxonomy, keyed alongside the 20 legacy slugs rather than replacing them.
   *
   * `item.category` keeps whatever the client sent, in either vocabulary, so the lookup has to
   * answer for both — otherwise every listing created by a catalogue-aware client would fall
   * through to `other` and silently report 20 kg. These are averages over each category's
   * subcategories, derived from the legacy figures above; like those, they are estimates, not
   * measurements, and no source was ever supplied for either set.
   */
  tools_home_improvement: 40,
  garden_outdoors: 25,
  camping_outdoor_recreation: 35,
  sports_fitness: 35,
  parties_events: 20,
  electronics_technology: 70,
  home_kitchen: 25,
  family_pets: 30,
  travel_transportation: 60,
  fashion_beauty: 20,
  games_hobbies: 20,
  professional_equipment: 50,
};

// KM equivalent per kg of CO2 (driving a car emits ~0.21 kg CO2/km)
export const KG_TO_KM_CAR = 4.76; // 1 kg CO2 = 4.76 km by car

export function calculateCO2Saved(category: string): number {
  const normalized = category.toLowerCase().replace(/ /g, "_");
  return CO2_BY_CATEGORY[normalized] ?? CO2_BY_CATEGORY["other"];
}

export function co2ToKmEquivalent(co2Kg: number): number {
  return parseFloat((co2Kg * KG_TO_KM_CAR).toFixed(1));
}

export interface IEcoImpact extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  item: mongoose.Types.ObjectId;
  category: string;
  co2SavedKg: number;
  kmEquivalent: number;
  city: string;
  province: string;
  createdAt: Date;
}

const EcoImpactSchema = new Schema<IEcoImpact>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
    item: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    category: { type: String, required: true },
    co2SavedKg: { type: Number, required: true },
    kmEquivalent: { type: Number, required: true },
    city: { type: String, required: true },
    province: { type: String, required: true },
  },
  { timestamps: true }
);

EcoImpactSchema.index({ user: 1, createdAt: -1 });
EcoImpactSchema.index({ city: 1 });
EcoImpactSchema.index({ co2SavedKg: -1 });

export const EcoImpactModel = mongoose.model<IEcoImpact>("EcoImpact", EcoImpactSchema);