import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import "express-async-errors";
import { ENV } from "./config/env";
import { logger } from "./config/logger";
import { swaggerSpec } from "./config/swagger";
import routes from "./routes/index";
import payoutPages from "./routes/payout-pages.routes";
import { errorHandler, notFound } from "./middleware/error.middleware";

const app = express();

// Trust proxy for App Runner / load balancer
app.set('trust proxy', 1);
// ─── Core Middleware ───────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(
  express.json({
    limit: "10mb",
    // Stripe signs the exact bytes it sent, so the parsed body cannot be used to verify a signature.
    // Kept for webhook paths only, to avoid holding a second copy of every request body in memory.
    verify: (req, _res, buf) => {
      if (req.url?.includes("/webhooks/")) {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.info(msg.trim()) },
  })
);

// ─── Rate Limiting ─────────────────────────────────────────
const limiter = rateLimit({
  windowMs: ENV.RATE_LIMIT_WINDOW_MS,
  max: ENV.RATE_LIMIT_MAX,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});
app.use("/api", limiter);

// ─── Swagger Docs ──────────────────────────────────────────
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "Larissa API Docs",
    customCss: `.swagger-ui .topbar { background-color: #00b4a6; }`,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  })
);

app.get("/api-docs.json", (_, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ─── API Routes ────────────────────────────────────────────
app.use(`/api/${ENV.API_VERSION}`, routes);

// Browser pages Stripe returns owners to after Connect onboarding — not API resources, so no prefix.
app.use("/payouts", payoutPages);

// ─── Error Handling ────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;