import http from "http";
import app from "./app";
import { connectDatabase } from "./config/database";
import { ENV } from "./config/env";
import { logger } from "./config/logger";
import { initSocket, setIO } from "./socket";
import { initScheduler, stopScheduler } from "./scheduler";

/**
 * Three keys are required (secret, publishable, webhook secret) and the two app deep links are
 * optional — without them Stripe returns owners to this server's own pages. A *partial* configuration
 * is the dangerous case: some endpoints answer happily while others 503, with nothing saying why. All
 * three missing is simply "the feature is off" and stays quiet.
 */
const reportPayoutConfig = (): void => {
  const missing = (
    [
      ["STRIPE_SECRET_KEY", ENV.STRIPE_SECRET_KEY],
      ["STRIPE_PUBLISHABLE_KEY", ENV.STRIPE_PUBLISHABLE_KEY],
      ["STRIPE_WEBHOOK_SECRET", ENV.STRIPE_WEBHOOK_SECRET],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  // Optional: without them Stripe returns owners to this server's hosted pages instead of the app.
  if (!ENV.STRIPE_CONNECT_RETURN_URL || !ENV.STRIPE_CONNECT_REFRESH_URL) {
    logger.info("💸 Payouts: no app deep links set — owners will return to the web pages at /payouts");
  }

  if (missing.length === 3) {
    logger.info("💸 Payouts: not configured (Stripe Connect endpoints will answer 503)");
    return;
  }
  if (missing.length > 0) {
    logger.warn(
      `💸 Payments/payouts: PARTIALLY configured — missing ${missing.join(", ")}. ` +
        "Charging and onboarding answer 503 until each one is set."
    );
    return;
  }
  const mode = ENV.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test";
  logger.info(`💸 Payouts: Stripe Connect ready (${mode} mode)`);
};

const startServer = async () => {
  await connectDatabase();
  reportPayoutConfig();

  const httpServer = http.createServer(app);
  const io = initSocket(httpServer);
  setIO(io);

  httpServer.listen(ENV.PORT, () => {
    logger.info(`🚀 Zonerlost API running on port ${ENV.PORT}`);
    logger.info(`📍 Environment: ${ENV.NODE_ENV}`);
    logger.info(`🔗 Health: http://localhost:${ENV.PORT}/api/${ENV.API_VERSION}/health`);
    logger.info(`🔌 Socket.io ready`);
  });

  /**
   * Started after the server is listening, and deliberately not awaited into the boot path: a
   * scheduler that cannot reach its lease collection must not stop the API from serving traffic.
   * It logs and the jobs simply do not run.
   */
  initScheduler().catch((err) =>
    logger.error("Scheduler failed to start", { message: (err as Error).message })
  );

  /**
   * Give in-flight jobs a chance to finish before the process goes. App Runner sends SIGTERM on a
   * deploy, and a job cut in half is a job that has to be safe to re-run — which they are, but
   * finishing cleanly is better than relying on it.
   */
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    stopScheduler()
      .catch(() => undefined)
      .finally(() => httpServer.close(() => process.exit(0)));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandledrejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  process.exit(1);
});

startServer();