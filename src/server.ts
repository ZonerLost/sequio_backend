import http from "http";
import app from "./app";
import { connectDatabase } from "./config/database";
import { ENV } from "./config/env";
import { logger } from "./config/logger";
import { initSocket, setIO } from "./socket";

/**
 * Payouts are configured through four env vars, and a *partial* configuration is the dangerous case:
 * the status endpoint answers happily while onboarding returns 503, with nothing anywhere saying why.
 * All four missing is simply "the feature is off" and stays quiet.
 */
const reportPayoutConfig = (): void => {
  const missing = (
    [
      ["STRIPE_SECRET_KEY", ENV.STRIPE_SECRET_KEY],
      ["STRIPE_WEBHOOK_SECRET", ENV.STRIPE_WEBHOOK_SECRET],
      ["STRIPE_CONNECT_RETURN_URL", ENV.STRIPE_CONNECT_RETURN_URL],
      ["STRIPE_CONNECT_REFRESH_URL", ENV.STRIPE_CONNECT_REFRESH_URL],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length === 4) {
    logger.info("💸 Payouts: not configured (Stripe Connect endpoints will answer 503)");
    return;
  }
  if (missing.length > 0) {
    logger.warn(
      `💸 Payouts: PARTIALLY configured — missing ${missing.join(", ")}. ` +
        "Onboarding will answer 503 until every one is set."
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