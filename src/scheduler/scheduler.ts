import { randomUUID } from "crypto";
import os from "os";
import { JobLeaseModel } from "../models/job-lease.model";
import { logger } from "../config/logger";
import { ENV } from "../config/env";

/**
 * The scheduler: timed work that nothing else in this codebase could do.
 *
 * Until this existed there was no cron, no worker and no timer anywhere, so **nothing could expire**.
 * A seven-day listing boost stayed boosted forever — one in production was 146 days past its expiry,
 * outranking every other listing on every search, because `isBoosted` is the primary sort key and
 * `boostExpiresAt` was written and never read again.
 *
 * ## Why it runs in the API process
 *
 * **No new npm dependency can ship here.** A `package.json` change cannot go through the
 * crane-append deploy, which only replaces `dist/`; it needs a real image build and the dev machine
 * has no Docker. That rules out `node-cron`, `agenda` and `bullmq`. The alternative — EventBridge
 * calling a protected endpoint — is also dependency-free but adds infrastructure to own.
 *
 * So: a plain interval, made safe to run on more than one instance by a database lease. See
 * `job-lease.model.ts` for how the lease works. The important consequence is that **every job must
 * be idempotent**: a lease makes a double-run unlikely, not impossible, and these jobs will
 * eventually move money.
 *
 * ## Rules for anything registered here
 *
 * 1. **Be idempotent.** Filter on the state you are about to change (`isBoosted: true`), never on
 *    time alone, so a re-run finds nothing to do.
 * 2. **Never throw past your own handler.** `server.ts` turns an unhandled rejection into
 *    `process.exit(1)`, so a failing job would take the API down with it. Every run here is wrapped,
 *    but do not rely on that for anything you can handle yourself.
 * 3. **Return a summary.** It is logged and stored on the lease, which is the only visibility into a
 *    job that silently does nothing.
 * 4. **Keep it short.** A job holding its lease for minutes blocks nothing else, but it delays its
 *    own next run and makes a dead instance take longer to detect.
 */

export interface JobResult {
  /** Anything worth seeing in the log. Keep it small — it is stored on the lease row. */
  [key: string]: unknown;
}

export interface ScheduledJob {
  /** Stable identifier. It is the lease's primary key, so renaming a job resets its schedule. */
  name: string;
  /** How often to run, in milliseconds. */
  everyMs: number;
  /**
   * How long this job may hold its lease before another instance may take it. Set it above the
   * realistic worst-case runtime; the lease is renewed while the job runs, so this is the window
   * after a *crash*, not a deadline for the work.
   */
  leaseMs?: number;
  run: () => Promise<JobResult | void>;
}

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/** Identifies this process in the lease row. Only ever read by a human diagnosing a stuck job. */
const INSTANCE_ID = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

const jobs: ScheduledJob[] = [];
let timer: NodeJS.Timeout | null = null;
let running = false;
/** Jobs in flight right now, so shutdown can wait for them instead of killing them mid-write. */
const inFlight = new Set<Promise<void>>();

export const registerJob = (job: ScheduledJob): void => {
  if (jobs.some((j) => j.name === job.name)) {
    throw new Error(`Duplicate scheduled job name: ${job.name}`);
  }
  jobs.push(job);
};

/**
 * Creates the lease row if it is missing.
 *
 * Done once at startup rather than with an upsert on every acquisition: an upsert whose filter does
 * not match an existing row tries to insert, which means every *unsuccessful* acquisition would
 * raise a duplicate-key error against the unique index. Correct, but it turns the normal case into
 * an exception.
 */
const ensureLease = async (name: string): Promise<void> => {
  await JobLeaseModel.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
};

/**
 * Takes the lease if the job is both free and due.
 *
 * One atomic operation does both checks. Two instances cannot both win: the first one's write moves
 * `lockedUntil` into the future, so the second one's filter stops matching.
 */
const acquire = async (job: ScheduledJob): Promise<boolean> => {
  const now = new Date();
  const leaseMs = job.leaseMs ?? DEFAULT_LEASE_MS;
  const dueBefore = new Date(now.getTime() - job.everyMs);

  // Two separate $or clauses, so they have to be combined under $and — a second `$or` key would
  // simply overwrite the first and the job would run on every tick.
  const claimed = await JobLeaseModel.findOneAndUpdate(
    {
      name: job.name,
      $and: [
        { $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
        { $or: [{ lastRunAt: null }, { lastRunAt: { $lte: dueBefore } }] },
      ],
    },
    {
      $set: {
        lockedUntil: new Date(now.getTime() + leaseMs),
        owner: INSTANCE_ID,
        lastRunAt: now,
      },
      $inc: { runCount: 1 },
    },
    { returnDocument: "after" }
  );

  return Boolean(claimed);
};

/** Extends the lease of a job that is still working, so a slow run is not taken for a dead one. */
const renew = async (job: ScheduledJob): Promise<void> => {
  const leaseMs = job.leaseMs ?? DEFAULT_LEASE_MS;
  await JobLeaseModel.updateOne(
    { name: job.name, owner: INSTANCE_ID },
    { $set: { lockedUntil: new Date(Date.now() + leaseMs) } }
  );
};

/** Releases the lease and records what happened. Never throws. */
const release = async (
  job: ScheduledJob,
  startedAt: number,
  result: JobResult | void,
  error?: unknown
): Promise<void> => {
  try {
    await JobLeaseModel.updateOne(
      { name: job.name, owner: INSTANCE_ID },
      {
        $set: {
          lockedUntil: null,
          owner: null,
          lastFinishedAt: new Date(),
          lastDurationMs: Date.now() - startedAt,
          lastError: error ? String((error as Error)?.message ?? error).slice(0, 500) : null,
          lastResult: result ? JSON.stringify(result).slice(0, 500) : null,
        },
        ...(error ? { $inc: { failureCount: 1 } } : {}),
      }
    );
  } catch (err) {
    // A failure to release is survivable: the lease expires on its own. Losing the API is not.
    logger.error("Scheduler could not release a lease", {
      job: job.name,
      message: (err as Error).message,
    });
  }
};

const runJob = async (job: ScheduledJob): Promise<void> => {
  const startedAt = Date.now();
  const leaseMs = job.leaseMs ?? DEFAULT_LEASE_MS;
  // Renew at a third of the lease, so two renewals can be missed before anyone else may take over.
  const renewal = setInterval(() => {
    renew(job).catch((err) =>
      logger.warn("Scheduler could not renew a lease", {
        job: job.name,
        message: (err as Error).message,
      })
    );
  }, Math.max(1000, Math.floor(leaseMs / 3)));

  try {
    const result = await job.run();
    await release(job, startedAt, result);
    // Only worth a line when the job actually did something; a quiet job every minute is noise.
    if (result && Object.values(result).some((v) => typeof v === "number" && v > 0)) {
      logger.info(`Scheduler: ${job.name}`, { ...result, ms: Date.now() - startedAt });
    }
  } catch (err) {
    await release(job, startedAt, undefined, err);
    logger.error(`Scheduler job failed: ${job.name}`, { message: (err as Error).message });
  } finally {
    clearInterval(renewal);
  }
};

/** One pass over every registered job. Never throws, never runs two passes at once. */
const tick = async (): Promise<void> => {
  if (running) return;
  running = true;
  try {
    for (const job of jobs) {
      let claimed = false;
      try {
        claimed = await acquire(job);
      } catch (err) {
        // A database blip must not stop the other jobs, or stop the next tick.
        logger.warn("Scheduler could not read a lease", {
          job: job.name,
          message: (err as Error).message,
        });
        continue;
      }
      if (!claimed) continue;

      const promise = runJob(job).finally(() => inFlight.delete(promise));
      inFlight.add(promise);
      await promise;
    }
  } finally {
    running = false;
  }
};

export const startScheduler = async (): Promise<void> => {
  if (!ENV.SCHEDULER_ENABLED) {
    logger.info("⏰ Scheduler: disabled (SCHEDULER_ENABLED)");
    return;
  }
  if (!jobs.length) {
    logger.warn("⏰ Scheduler: enabled but no jobs are registered");
    return;
  }

  for (const job of jobs) {
    try {
      await ensureLease(job.name);
    } catch (err) {
      logger.error("Scheduler could not create a lease row", {
        job: job.name,
        message: (err as Error).message,
      });
    }
  }

  timer = setInterval(() => {
    tick().catch((err) => logger.error("Scheduler tick failed", { message: (err as Error).message }));
  }, ENV.SCHEDULER_TICK_MS);

  logger.info(
    `⏰ Scheduler: ${jobs.length} job(s), ticking every ${Math.round(ENV.SCHEDULER_TICK_MS / 1000)}s`,
    { jobs: jobs.map((j) => `${j.name}@${Math.round(j.everyMs / 1000)}s`) }
  );

  // Run once at startup rather than waiting a full tick, so a deploy settles anything overdue now.
  tick().catch((err) => logger.error("Scheduler tick failed", { message: (err as Error).message }));
};

/** Stops ticking and waits for anything in flight, so a deploy does not cut a job in half. */
export const stopScheduler = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (inFlight.size) {
    logger.info(`⏰ Scheduler: waiting for ${inFlight.size} job(s) to finish`);
    await Promise.allSettled([...inFlight]);
  }
};

/** Exposed for the test script, which drives these directly rather than waiting on the interval. */
export const __runTickForTests = tick;
export const __acquireForTests = acquire;
export const __ensureLeaseForTests = ensureLease;
export const __instanceId = INSTANCE_ID;
export const __jobs = jobs;
