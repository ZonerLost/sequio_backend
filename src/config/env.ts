import dotenv from "dotenv";
dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "3000", 10),
  API_VERSION: process.env.API_VERSION || "v1",
  MONGODB_URI: process.env.MONGODB_URI || "",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || "access_secret",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "refresh_secret",
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT: parseInt(process.env.SMTP_PORT || "587", 10),
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "noreply@zonerlost.com",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
  AWS_REGION: process.env.AWS_REGION || "ca-central-1",
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || "zonerlost-media",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID || "",
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET || "",
  OTP_EXPIRES_IN_MINUTES: parseInt(process.env.OTP_EXPIRES_IN_MINUTES || "10", 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  REVENUECAT_API_KEY: process.env.REVENUECAT_API_KEY || "",
  REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET || "",
  // Stripe Connect: owners onboard with Stripe, so no bank details ever reach this database.
  // With no secret key the payout endpoints answer 503 rather than pretending to work.
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  // Not a secret — it is designed to ship inside client apps. Served by GET /payments/config so a
  // test-to-live switch, or a key rotation, needs no app release.
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || "",
  // Country of the connected accounts we create (ISO-3166-1 alpha-2, lowercase). Owners are in
  // Quebec, so "ca" — but the platform's own Stripe account is US-registered, and whether a US
  // platform may create CA accounts is unresolved, so this is configurable rather than compiled in.
  STRIPE_CONNECT_ACCOUNT_COUNTRY: (process.env.STRIPE_CONNECT_ACCOUNT_COUNTRY || "ca").toLowerCase(),
  // Who absorbs an unrecoverable negative balance on a connected account: "stripe" or "application"
  // (this platform). "stripe" is the default because the alternative obliges Atussa to underwrite,
  // monitor and remediate seller risk, and to answer payment and risk enquiries — a real operations
  // commitment, and one Stripe itself steers new platforms away from.
  STRIPE_CONNECT_LOSSES_COLLECTOR:
    process.env.STRIPE_CONNECT_LOSSES_COLLECTOR === "application" ? "application" : "stripe",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",

  /**
   * Which pricing model applies to NEW bookings. Stored breakdowns are never recomputed.
   *
   * Defaults to the old model deliberately. The November 2026 model cannot ship until the client
   * confirms the GST/QST base in writing — their own document says to confirm it before production,
   * because the instruction came from a phone call with Revenu Quebec. Charging the new price with a
   * guessed tax base would collect the right amount and remit the wrong tax, which is the worse of
   * the two mistakes.
   */
  PRICING_MODEL: process.env.PRICING_MODEL === "2026-11" ? "2026-11" : "2026-09",
  /**
   * What GST/QST applies to under the 2026-11 model.
   *
   * "renter_total" is our reading of "the applicable total taxable transaction amount"; "fees_only"
   * keeps the old behaviour of taxing only the platform's cut. Both are implemented and neither has
   * been confirmed.
   */
  PRICING_TAX_BASE: process.env.PRICING_TAX_BASE === "renter_total" ? "renter_total" : "fees_only",

  /**
   * Timed work: boosts expiring, deposits releasing, owners being paid.
   *
   * Defaults to ON in production and OFF everywhere else, deliberately. A developer machine points
   * at the same Atlas cluster as production, so a default of "on" would have every `npm run dev`
   * quietly running production jobs; a default of "off" would mean one forgotten environment
   * variable and nothing ever expires, silently, which is the bug this feature exists to fix.
   * Keying it to NODE_ENV is safe in both directions. Set it explicitly to override either way.
   */
  SCHEDULER_ENABLED:
    process.env.SCHEDULER_ENABLED !== undefined
      ? process.env.SCHEDULER_ENABLED === "true"
      : process.env.NODE_ENV === "production",
  /** How often to look for due jobs. Jobs declare their own interval; this is the resolution. */
  SCHEDULER_TICK_MS: Number(process.env.SCHEDULER_TICK_MS) || 60_000,

  /**
   * How the renter's card is charged, and therefore when the owner is paid.
   *
   * - `destination` (the default, and what is live): a destination charge. The owner's share
   *   transfers the instant the renter pays, because that is when a destination charge settles.
   * - `platform`: separate charges and transfers. The money lands in Atussa's balance and the
   *   `release-owner-payouts` job transfers the owner's share when the rental is over.
   *
   * `platform` is what the client's requirement needs — the owner paid at the end of the rental —
   * and it is what makes every refund path clean, because until the transfer runs nothing has left
   * Atussa and there is nothing to claw back from an owner who may have withdrawn it.
   *
   * **It defaults to `destination` so that deploying this changed nothing.** Do not switch it until
   * one owner has reached `active` on Stripe onboarding and a real transfer has been verified
   * end to end: no owner has completed onboarding yet, so the `transfers` capability is unproven.
   * Switching is safe to do per-environment and does not rewrite anything already charged — a
   * payment records which model charged it, and the payout job only ever acts on `platform` rows.
   */
  STRIPE_CHARGE_MODEL: process.env.STRIPE_CHARGE_MODEL === "platform" ? "platform" : "destination",

  /**
   * How long after a rental ends before the owner's share is transferred.
   *
   * 24 hours, to match the claim window the client specified: the owner has 24 hours from the actual
   * return to open a claim, and paying them out before that window closes would mean reversing a
   * transfer to fund a deposit capture. Phase 4 has not been built, so nothing opens a claim yet —
   * but the hold is what makes this job correct when it is, rather than something to remember to
   * add later.
   */
  OWNER_PAYOUT_HOLD_HOURS: Number(process.env.OWNER_PAYOUT_HOLD_HOURS) || 24,

  /**
   * Which accounts the 18+ requirement applies to: `off`, `new_accounts` or `all`.
   *
   * **`off` is the only safe default today.** No account on the platform has a date of birth, and
   * the deployed app has no field to send one, so requiring it would refuse every new sign-up and
   * `all` would lock out all 37 existing accounts. See `compliance.helper.ts`.
   */
  AGE_VERIFICATION: ["off", "new_accounts", "all"].includes(String(process.env.AGE_VERIFICATION))
    ? String(process.env.AGE_VERIFICATION)
    : "off",

  /**
   * Geocoding: turning an address into coordinates.
   *
   * Default provider is OpenStreetMap Nominatim, which needs no key and is the same data the
   * Flutter app already renders its map tiles from. Its usage policy requires an identifying
   * User-Agent and at most one request a second; both are honoured, and results are cached.
   * Switch to mapbox or google (with GEOCODER_API_KEY) when volume justifies paying for it.
   */
  GEOCODER: (process.env.GEOCODER || "nominatim").toLowerCase(),
  GEOCODER_API_KEY: process.env.GEOCODER_API_KEY || "",
  // Nominatim blocks generic agents, correctly. Name the app and give a contact.
  GEOCODER_USER_AGENT:
    process.env.GEOCODER_USER_AGENT || "Atussa/1.0 (support@atussa.ca)",

  // Where Stripe sends the owner back after hosted onboarding. **Must be http(s)** — Stripe rejects
  // a custom scheme with "Not a valid URL", so an app deep link cannot go here. Leave unset to use
  // this server's own /payouts pages, or set a universal/app link once one exists.
  STRIPE_CONNECT_RETURN_URL: process.env.STRIPE_CONNECT_RETURN_URL || "",
  STRIPE_CONNECT_REFRESH_URL: process.env.STRIPE_CONNECT_REFRESH_URL || "",
  /**
   * The business profile Stripe attaches to every connected account.
   *
   * These are facts about Atussa, not about the owner, so they are prefilled rather than asked.
   * Leaving them unasked removes four fields from an onboarding flow that already asks fifteen —
   * measured against the live account on 2026-10-07.
   *
   * CONNECT_BUSINESS_URL must be a real domain: Stripe rejects example.com and its subdomains with
   * "Not a valid URL". The MCC is a card-network merchant category; 5734 is computer/equipment
   * retail, which is the closest fit for tool rental.
   */
  CONNECT_BUSINESS_URL: process.env.CONNECT_BUSINESS_URL || "https://atussa.ca",
  CONNECT_BUSINESS_MCC: process.env.CONNECT_BUSINESS_MCC || "5734",
  CONNECT_BUSINESS_DESCRIPTION:
    process.env.CONNECT_BUSINESS_DESCRIPTION || "Peer-to-peer tool and equipment rental",
  // Empty on purpose: setting it removes one more question from owner onboarding, but an invented
  // number would be published to real customers as the way to reach support. Set it to a line
  // somebody answers.
  CONNECT_SUPPORT_PHONE: process.env.CONNECT_SUPPORT_PHONE || "",

  // The app's own deep links. Not sent to Stripe: the hosted /payouts pages bounce to these, which is
  // how an owner gets back into the app from a flow that can only redirect to https.
  APP_PAYOUT_RETURN_DEEPLINK: process.env.APP_PAYOUT_RETURN_DEEPLINK || "atussa://payouts/done",
  APP_PAYOUT_REFRESH_DEEPLINK: process.env.APP_PAYOUT_REFRESH_DEEPLINK || "atussa://payouts/retry",
};
