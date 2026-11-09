import mongoose, { Schema, Document } from "mongoose";

/**
 * One row per scheduled job: when it last ran, and who is running it right now.
 *
 * This is what makes it safe to run the scheduler inside the API process. Every instance ticks on
 * its own timer, but a job only runs if that instance wins the lease — a single atomic
 * `findOneAndUpdate` that both checks the job is due and takes the lock. Two instances ticking at
 * the same millisecond cannot both win, because the second one's filter no longer matches.
 *
 * `lockedUntil` is a lease, not a lock: it expires. A process that dies mid-job does not wedge that
 * job forever — the lease lapses and the next tick picks it up. The running instance renews it while
 * it works, so a slow job is not stolen out from under itself.
 *
 * It also makes the schedule survive a restart, because `lastRunAt` lives in the database rather than
 * in a timer. A deploy in the middle of the hour does not reset every job's clock.
 */
export interface IJobLease extends Document {
  name: string;
  /** Lease expiry. Null or in the past means nobody holds it. */
  lockedUntil: Date | null;
  /** Which instance holds it, for diagnosing a job that keeps timing out. */
  owner: string | null;
  /** When the job last *started*. The schedule is measured from this. */
  lastRunAt: Date | null;
  lastFinishedAt: Date | null;
  lastDurationMs: number | null;
  /** The last thing that went wrong, kept so a repeatedly failing job is visible without log diving. */
  lastError: string | null;
  lastResult: string | null;
  runCount: number;
  failureCount: number;
}

const JobLeaseSchema = new Schema<IJobLease>(
  {
    name: { type: String, required: true, unique: true },
    lockedUntil: { type: Date, default: null },
    owner: { type: String, default: null },
    lastRunAt: { type: Date, default: null },
    lastFinishedAt: { type: Date, default: null },
    lastDurationMs: { type: Number, default: null },
    lastError: { type: String, default: null },
    lastResult: { type: String, default: null },
    runCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const JobLeaseModel = mongoose.model<IJobLease>("JobLease", JobLeaseSchema);
