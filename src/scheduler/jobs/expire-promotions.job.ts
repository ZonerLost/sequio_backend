import { ItemModel } from "../../models/item.model";
import { ScheduledJob, JobResult } from "../scheduler";

/**
 * Turns off listing boosts and admin "featured" flags once their time is up.
 *
 * Nothing did this before, because there was no scheduler. `boostExpiresAt` and `featuredUntil` were
 * both written at purchase and never read again, so **a boost never ended**. In production one
 * listing was 146 days into a seven-day boost.
 *
 * That is not a cosmetic bug. `isBoosted: -1` is the primary sort key on every browse, search and
 * feed, ahead of whatever the renter actually sorted by — so a single expired boost permanently
 * outranks every other listing on the platform, and the owner who paid $9.99 for seven days got the
 * rest for free while everyone else was pushed down.
 *
 * Idempotent, as every job here must be: it filters on the flag it is about to clear, so a second
 * run finds nothing. It does not touch `boostExpiresAt` or `featuredUntil` — those stay as the
 * record of when the promotion was bought and when it ended.
 *
 * A listing that is boosted with **no** expiry set is deliberately left alone. There is no honest
 * way to guess when it should have ended, and silently un-boosting something someone paid for is
 * worse than leaving it; those are visible in the result as `boostedWithoutExpiry`.
 */
const run = async (): Promise<JobResult> => {
  const now = new Date();

  const [boosts, featured, boostedWithoutExpiry] = await Promise.all([
    ItemModel.updateMany(
      { isBoosted: true, boostExpiresAt: { $ne: null, $lte: now } },
      { $set: { isBoosted: false } }
    ),
    ItemModel.updateMany(
      { isFeatured: true, featuredUntil: { $ne: null, $lte: now } },
      { $set: { isFeatured: false } }
    ),
    ItemModel.countDocuments({ isBoosted: true, boostExpiresAt: null }),
  ]);

  return {
    boostsExpired: boosts.modifiedCount,
    featuredExpired: featured.modifiedCount,
    boostedWithoutExpiry,
  };
};

export const expirePromotionsJob: ScheduledJob = {
  name: "expire-promotions",
  // Five minutes. A boost running five minutes long costs nobody anything; the bug was that it ran
  // five months long.
  everyMs: 5 * 60 * 1000,
  run,
};
