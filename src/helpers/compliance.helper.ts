/**
 * The 18+ requirement, and an owner's tax registration.
 *
 * Both are Phase 7 compliance items, and both are the kind of rule that is easy to write and easy to
 * get destructively wrong on the first deploy.
 *
 * ## The number that decides the 18+ policy
 *
 * **Zero of 37 accounts have a date of birth, including all 12 that own a listing.** The field has
 * existed since launch, was never required and was never read. So "block accounts that cannot prove
 * they are 18" is not a strict policy — it is a total outage. Everybody loses access, every listing
 * goes unmanageable, and nobody can rent anything, over a field the platform never asked them for.
 *
 * So `AGE_VERIFICATION` has three settings, which are exactly the three answers gap 9 of
 * `CLIENT_DOCS_REVIEW.md` asks the client to choose between — *"blocked, prompted, or
 * grandfathered"*:
 *
 * | | A new account | An existing account with no date of birth |
 * |---|---|---|
 * | `off` (default) | may register without one | prompted, never refused |
 * | `new_accounts` | **must** supply an adult one | prompted, never refused |
 * | `all` | **must** supply an adult one | **refused** renting and listing until they do |
 *
 * **The default is `off`, and that is a deployment constraint rather than a preference.** Making
 * the field required at registration today would 400 every sign-up from the deployed Flutter app,
 * which has no date-of-birth field to send — the same coordinated-release trap as the renter price
 * display. Switch to `new_accounts` the moment the app ships that field, and to `all` only when the
 * client has decided what happens to the 37 accounts that predate the requirement.
 *
 * **One rule is not behind the switch.** A date of birth that is *supplied* and under 18 is refused
 * at every mode, and such an account can never rent or list. Grandfathering is for people the
 * platform never asked, not for people who answered and are too young.
 *
 * ## Tax registration is stored, validated and snapshotted — and changes no price
 *
 * The client's own instruction is that tax allocation "depends on whether the owner is GST/QST
 * registered", and their tax base is **still unconfirmed in writing** (see Pricing in `CLAUDE.md`).
 * Building an allocation rule on an unconfirmed base would mean collecting the right amount and
 * remitting the wrong tax, which is the worse of the two mistakes. So this file validates the
 * numbers and nothing here touches `pricing.helper.ts`.
 */
import { ENV } from "../config/env";

/** Quebec's age of majority, and the Terms requirement. */
export const MINIMUM_AGE_YEARS = 18;

export type AgeVerificationMode = "off" | "new_accounts" | "all";

/** Which accounts the age gate applies to. See the header for why the default is `off`. */
export const ageVerificationMode = (): AgeVerificationMode =>
  ENV.AGE_VERIFICATION === "all"
    ? "all"
    : ENV.AGE_VERIFICATION === "new_accounts"
      ? "new_accounts"
      : "off";

/** Whether a registration must carry a date of birth. False by default — see the header. */
export const dateOfBirthRequiredAtSignup = (): boolean => ageVerificationMode() !== "off";

/**
 * Whole years between two dates, by calendar.
 *
 * Deliberately not `(now - dob) / 365.25 days`. That arithmetic puts somebody born on 29 February
 * over the line a day early some years and late in others, and it is wrong by a day either side of
 * every birthday — which for an 18th birthday is the one day it must not be wrong on. Comparing
 * month and day the way a human does has no such edge.
 */
export const ageInYears = (dateOfBirth: Date | string, on: Date = new Date()): number => {
  const dob = new Date(dateOfBirth);
  const ref = new Date(on);
  let years = ref.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < dob.getUTCDate())) years -= 1;
  return years;
};

/** The latest date of birth that is still an adult today — what a date picker should cap at. */
export const latestAdultBirthDate = (on: Date = new Date()): Date => {
  const d = new Date(on);
  d.setUTCFullYear(d.getUTCFullYear() - MINIMUM_AGE_YEARS);
  return d;
};

/**
 * A plausibility floor on a date of birth.
 *
 * 120 years. Not a real rule, a typo catcher: `1025-06-15` is a slip and should be refused at the
 * boundary rather than stored and puzzled over later.
 */
export const OLDEST_PLAUSIBLE_YEARS = 120;

export const isPlausibleBirthDate = (dateOfBirth: Date | string, on: Date = new Date()): boolean => {
  const age = ageInYears(dateOfBirth, on);
  return new Date(dateOfBirth) <= new Date(on) && age <= OLDEST_PLAUSIBLE_YEARS;
};

export const isAdult = (dateOfBirth: Date | string | null | undefined, on: Date = new Date()): boolean =>
  Boolean(dateOfBirth) && ageInYears(dateOfBirth as Date, on) >= MINIMUM_AGE_YEARS;

export interface AgeStatus {
  /** True only when a date of birth is on file *and* it clears the minimum. */
  ageVerified: boolean;
  /** True when the account has no date of birth at all — the state all 37 accounts are in today. */
  needsDateOfBirth: boolean;
  /**
   * True when the account cannot rent or list right now.
   *
   * An account with **no** date of birth is blocked only under `all`. An account whose date of
   * birth is under 18 is blocked at every mode, including `off`.
   */
  blocked: boolean;
  minimumAge: number;
  mode: AgeVerificationMode;
}

/**
 * Where one account stands against the age requirement.
 *
 * Note the asymmetry, which is deliberate: an account with a date of birth **under** 18 is blocked
 * in either mode. Grandfathering applies to people the platform never asked, not to people who
 * answered and are too young.
 */
export const ageStatusOf = (
  user: { dateOfBirth?: Date | string | null } | null | undefined,
  on: Date = new Date()
): AgeStatus => {
  const mode = ageVerificationMode();
  const dob = user?.dateOfBirth ?? null;
  const verified = isAdult(dob, on);

  return {
    ageVerified: verified,
    needsDateOfBirth: !dob,
    blocked: dob ? !verified : mode === "all",
    minimumAge: MINIMUM_AGE_YEARS,
    mode,
  };
};

/** The message a refusal carries. One wording, so three clients cannot paraphrase it differently. */
export const AGE_REFUSAL_MESSAGE = `You must be at least ${MINIMUM_AGE_YEARS} to rent or list an item. Add your date of birth to your profile to continue.`;
export const UNDERAGE_REFUSAL_MESSAGE = `You must be at least ${MINIMUM_AGE_YEARS} to use Atussa.`;

// ── tax registration ────────────────────────────────────────────────────────────────────────────

/**
 * A GST/HST registration number: the nine-digit Business Number, then `RT`, then a four-digit
 * account suffix — `123456789RT0001`.
 *
 * Accepted with or without spaces and in either case; stored normalised. Format only: this proves
 * the number is *shaped* like a registration number, not that it exists. Only the Canada Revenue
 * Agency can tell you that, and it has no public API — which is why `verifiedAt` is set by an
 * administrator and not by code.
 */
const GST_PATTERN = /^(\d{9})RT(\d{4})$/;

/** A Quebec QST number: ten digits, `TQ`, then four — `1234567890TQ0001`. */
const QST_PATTERN = /^(\d{10})TQ(\d{4})$/;

const squash = (value: string): string => value.replace(/[\s-]/g, "").toUpperCase();

export const normaliseGstNumber = (value: string): string | null => {
  const text = squash(String(value));
  return GST_PATTERN.test(text) ? text : null;
};

export const normaliseQstNumber = (value: string): string | null => {
  const text = squash(String(value));
  return QST_PATTERN.test(text) ? text : null;
};

export const isValidGstNumber = (value: unknown): boolean =>
  typeof value === "string" && normaliseGstNumber(value) !== null;

export const isValidQstNumber = (value: unknown): boolean =>
  typeof value === "string" && normaliseQstNumber(value) !== null;

export interface TaxRegistrationSnapshot {
  isRegistered: boolean;
  gstNumber?: string;
  qstNumber?: string;
  /** When this was copied off the user. The booking keeps it; the user record moves on. */
  snapshotAt: Date;
}

/**
 * The owner's registration status, frozen onto a booking.
 *
 * **This is the answer to "what happens when the status changes mid-rental".** It changes nothing
 * about a booking already made. An owner who registers for QST on day three of a ten-day rental did
 * not retroactively make the first two days a registered transaction, and an owner who deregisters
 * does not undo the allocation that applied when the rental was agreed. The same rule as
 * `booking.pricing`: store what was true at the time, never recompute it.
 *
 * Returns `null` when there is nothing to record, so the field stays absent rather than storing a
 * confident `isRegistered: false` for an owner who was never asked. Absent means unknown; `false`
 * means they said no (DO-NOT #13).
 */
export const taxRegistrationSnapshot = (
  user: {
    taxRegistration?: {
      isRegistered?: boolean;
      gstNumber?: string;
      qstNumber?: string;
    } | null;
  } | null | undefined,
  at: Date = new Date()
): TaxRegistrationSnapshot | null => {
  const reg = user?.taxRegistration;
  if (!reg || typeof reg.isRegistered !== "boolean") return null;
  return {
    isRegistered: reg.isRegistered,
    ...(reg.gstNumber ? { gstNumber: reg.gstNumber } : {}),
    ...(reg.qstNumber ? { qstNumber: reg.qstNumber } : {}),
    snapshotAt: at,
  };
};
