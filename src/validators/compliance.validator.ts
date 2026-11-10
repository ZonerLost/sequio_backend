import Joi from "joi";
import {
  MINIMUM_AGE_YEARS,
  OLDEST_PLAUSIBLE_YEARS,
  ageInYears,
  dateOfBirthRequiredAtSignup,
  isValidGstNumber,
  isValidQstNumber,
  normaliseGstNumber,
  normaliseQstNumber,
} from "../helpers/compliance.helper";

/**
 * The Joi half of the compliance rules, in its own file because two validators share it.
 *
 * `auth.validator.ts` uses the date-of-birth schema at registration and `profile.validator.ts` uses
 * it on update — and a second copy of an age rule is a second place for it to be wrong.
 */

export { dateOfBirthRequiredAtSignup };

/**
 * A date of birth, checked three ways.
 *
 * The age check is **computed per request**, not frozen at module load. A bound built from
 * `Date.now()` at startup drifts further out of date every day the process stays up — the same trap
 * the seven-day backdating limit in `booking.validator.ts` avoids, and one that matters more here:
 * a long-running process would start refusing people who had their eighteenth birthday since the
 * last deploy.
 *
 * It is also calendar arithmetic rather than a day count, because `365.25` days is wrong by a day on
 * either side of every birthday, and an eighteenth birthday is the one day it must be right on.
 */
export const dateOfBirthSchema = Joi.date()
  .iso()
  .custom((value, helpers) => {
    const age = ageInYears(value);
    if (new Date(value) > new Date()) return helpers.error("date.future");
    if (age > OLDEST_PLAUSIBLE_YEARS) return helpers.error("date.implausible");
    if (age < MINIMUM_AGE_YEARS) return helpers.error("date.underage");
    return value;
  })
  .messages({
    "date.future": "A date of birth cannot be in the future",
    "date.implausible": "That date of birth does not look right — check the year",
    "date.underage": `You must be at least ${MINIMUM_AGE_YEARS} to use Atussa`,
    "date.base": "Give the date of birth as a date, for example 1995-06-15",
  });

/**
 * An owner declaring their GST/HST and QST registration.
 *
 * Two rules worth keeping:
 *
 * - **The numbers are normalised, not just accepted.** `123 456 789 rt0001` and `123456789RT0001`
 *   are the same registration, and storing both spellings would make the field impossible to match
 *   on later.
 * - **Claiming to be registered without giving a number is refused.** `isRegistered: true` with no
 *   number is the state most likely to be read by a future tax report as "allocate to the owner",
 *   with nothing to put on the paperwork. Either answer is fine; a half answer is not.
 *
 * `verifiedAt`, `verifiedBy` and `verificationNote` are deliberately **absent** from this schema, so
 * `stripUnknown` discards them: an owner cannot mark their own registration verified. That is the
 * administrator's route.
 */
export const taxRegistrationSchema = Joi.object({
  isRegistered: Joi.boolean().required().messages({
    "any.required": "Say whether you are registered for GST/QST",
  }),
  gstNumber: Joi.string()
    .custom((value, helpers) =>
      isValidGstNumber(value) ? normaliseGstNumber(value) : helpers.error("string.gst")
    )
    .allow(null, "")
    .optional()
    .messages({
      "string.gst": "A GST/HST number looks like 123456789RT0001 — nine digits, RT, then four",
    }),
  qstNumber: Joi.string()
    .custom((value, helpers) =>
      isValidQstNumber(value) ? normaliseQstNumber(value) : helpers.error("string.qst")
    )
    .allow(null, "")
    .optional()
    .messages({
      "string.qst": "A QST number looks like 1234567890TQ0001 — ten digits, TQ, then four",
    }),
})
  .custom((value, helpers) => {
    const registered = value.isRegistered === true;
    const hasNumber = Boolean(value.gstNumber) || Boolean(value.qstNumber);
    if (registered && !hasNumber) return helpers.error("object.missingNumber");
    return value;
  })
  .messages({
    "object.missingNumber":
      "Give your GST/HST or QST number, or set isRegistered to false — a registration with no number cannot be used",
  });

/**
 * An administrator recording, or withdrawing, verification of an owner's tax registration.
 *
 * The note is required both ways. An administrator who un-verifies a registration months later has
 * a reason, and a bare `verified: false` is not something the next person can act on — the same
 * argument as the required explanation on an owner cancellation.
 */
export const taxRegistrationReviewSchema = Joi.object({
  verified: Joi.boolean().required(),
  note: Joi.string().min(3).max(500).required().messages({
    "any.required": "Say what you checked, or why you are withdrawing the verification",
  }),
});
