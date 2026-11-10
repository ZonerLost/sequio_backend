import { registerJob, startScheduler, stopScheduler } from "./scheduler";
import { expirePromotionsJob } from "./jobs/expire-promotions.job";
import { releaseOwnerPayoutsJob } from "./jobs/release-owner-payouts.job";

/**
 * The one place jobs are registered.
 *
 * Add a job here and nowhere else, so the full list of timed work on this platform is readable in a
 * single screen. Read the contract at the top of `scheduler.ts` first — the rules about idempotency
 * are not optional, because these jobs will shortly be releasing deposits and paying owners.
 *
 * Coming, and the reason this exists at all (see IMPLEMENTATION_PLAN.md):
 *   - release a security-deposit hold 24h after return when no claim was opened
 *   - the 12h / 22h / 24h inspection reminders, and the 30-minutes-before-return photo prompt
 *   - expire an accepted booking that was never paid, and free the dates
 *   - auto-complete a rental that neither party closed
 */
export const initScheduler = async (): Promise<void> => {
  registerJob(expirePromotionsJob);
  /**
   * Finds nothing until `STRIPE_CHARGE_MODEL=platform`, by design — it only acts on payments
   * recorded as platform charges, and the default is still `destination`. Read `skipped_*` on its
   * lease row before concluding it works: "released: 0" also means "every owner was refused".
   */
  registerJob(releaseOwnerPayoutsJob);
  await startScheduler();
};

export { stopScheduler };
