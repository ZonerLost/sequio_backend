import { OwnerPayoutService } from "../../services/owner-payout.service";
import { ScheduledJob, JobResult } from "../scheduler";

const payouts = new OwnerPayoutService();

/**
 * Pays owners their share once the rental is over.
 *
 * This is the job the scheduler was built for. Under the destination charge that is still live, the
 * owner's share leaves Atussa the moment the renter's card is charged, which is why owner
 * cancellation currently has to reverse a transfer the owner may already have withdrawn. Under
 * separate charges and transfers the money waits in Atussa's balance and this moves it.
 *
 * **It does nothing until `STRIPE_CHARGE_MODEL=platform`.** It only ever acts on payments recorded
 * as `platform` charges, and nothing writes those while the default is `destination` — so the job is
 * registered, leased and ticking from the day it ships, and finds nothing, which is the intended
 * state until an owner has reached `active` on Stripe onboarding.
 *
 * Idempotent in two independent ways, because this one moves money: the query filters on
 * `payoutAt: null`, so a completed payout is never a candidate, and `release()` claims each row with
 * an atomic update before it calls Stripe. The Stripe idempotency key (`transfer-<paymentId>`) is
 * the third line of defence.
 *
 * ## Read `skipped` before concluding it works
 *
 * A quiet log here means one of two very different things: nothing was due, or everything due was
 * refused. `skipped` names which — `owner_payouts_not_enabled` is the live state of every owner on
 * this platform today, because none has completed Stripe onboarding. A job that reported only
 * "released: 0" would look healthy while paying nobody.
 */
const run = async (): Promise<JobResult> => {
  const result = await payouts.releaseDue();

  return {
    released: result.released,
    releasedCents: result.releasedCents,
    failed: result.failed,
    // Flattened into the result so a lease row read six weeks from now still says why.
    ...Object.fromEntries(Object.entries(result.skipped).map(([k, v]) => [`skipped_${k}`, v])),
  };
};

export const releaseOwnerPayoutsJob: ScheduledJob = {
  name: "release-owner-payouts",
  /**
   * Fifteen minutes. The payout is already deliberately held for
   * `OWNER_PAYOUT_HOLD_HOURS` (24 by default), so the tick resolution is irrelevant to when an owner
   * is paid — and a slower tick means fewer Stripe calls on a job that mostly finds nothing.
   */
  everyMs: 15 * 60 * 1000,
  run,
};
