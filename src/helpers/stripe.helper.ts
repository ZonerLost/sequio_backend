import crypto from "crypto";
import { ENV } from "../config/env";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { logger } from "../config/logger";

/**
 * Stripe over plain HTTPS, deliberately without the `stripe` SDK.
 *
 * Adding a dependency would force a full Docker image rebuild, and this deploy path ships by appending
 * the compiled `dist/` onto the live image (see CLAUDE.md → Deploying). The runtime is Node 24, so
 * `fetch` and `crypto` cover everything Connect onboarding needs.
 */

const API = "https://api.stripe.com/v1";
const API_V2 = "https://api.stripe.com/v2";
// Pinned: an account's default API version can change under us, which would silently alter payloads.
const STRIPE_VERSION = "2024-06-20";
/**
 * Accounts v2 lives behind a dated release, and which one depends on the liability model:
 *
 * - Stripe-carried losses with an Express dashboard is in public preview, so it needs ".preview".
 *   ".endive" rejects that combination with "This account configuration is not supported".
 * - Platform-carried losses works on the stable ".endive", but only once the Connect platform
 *   profile declares that liability.
 *
 * Both verified against the live account on 2026-10-07.
 */
const STRIPE_VERSION_V2 =
  ENV.STRIPE_CONNECT_LOSSES_COLLECTOR === "stripe" ? "2026-09-30.preview" : "2026-09-30.endive";
const TIMEOUT_MS = 20_000;
/** Stripe's own recommendation: reject signatures older than five minutes (replay protection). */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export const stripeConfigured = (): boolean => Boolean(ENV.STRIPE_SECRET_KEY);

/**
 * Stripe errors that describe this platform's own configuration rather than the current request.
 * They are written for developers — the Connect one tells the reader to run the Stripe CLI — so they
 * must never reach an app user. Narrow on purpose: a declined card or a bad id still passes through
 * with Stripe's own wording, which is genuinely useful to a client.
 */
const PLATFORM_CONFIG_ERRORS = [
  /signed up for Connect/i, // Connect was never enabled on the account
  /responsibilities of managing losses/i, // Connect platform profile not completed
  /This account configuration is not supported/i,
  /no longer recommends Accounts v1/i, // we are calling the wrong API version
  /Invalid API Key/i,
  /(test|live)mode key.*(live|test)mode/i, // keys crossed between modes
  /You did not provide an API key/i,
];

/** Stripe takes form-encoded bodies with bracketed paths: metadata[userId], capabilities[transfers][requested]. */
const encode = (params: Record<string, unknown>, prefix = ""): string[] => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const path = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((entry, i) => {
        if (entry !== null && typeof entry === "object") {
          parts.push(...encode(entry as Record<string, unknown>, `${path}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${path}[${i}]`)}=${encodeURIComponent(String(entry))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(...encode(value as Record<string, unknown>, path));
    } else {
      parts.push(`${encodeURIComponent(path)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
};

interface StripeErrorBody {
  error?: { message?: string; type?: string; code?: string };
}

/**
 * One Stripe call. Throws AppError so a Stripe failure surfaces as a real status code and the actual
 * Stripe message, instead of a generic 500 nobody can act on.
 *
 * `idempotencyKey` matters on every POST that creates something: without it a retried request (or an
 * impatient double tap) creates a second Connect account for the same owner.
 */
export const stripeRequest = async <T>(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> => {
  if (!stripeConfigured()) {
    throw new AppError(
      "Payouts are not configured on this server yet",
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }

  const body = params ? encode(params).join("&") : undefined;
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${ENV.STRIPE_SECRET_KEY}`,
    "Stripe-Version": STRIPE_VERSION,
  };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? (body ?? "") : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError(
      `Could not reach Stripe (${(err as Error).name})`,
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & StripeErrorBody) : ({} as T & StripeErrorBody);

  if (!response.ok) {
    const message = json.error?.message ?? `Stripe returned ${response.status}`;

    // Some Stripe 4xx messages describe *our* setup, not anything the user did, and they are written
    // for developers: the Connect one literally tells the reader to run the Stripe CLI. Passing that
    // through meant an owner tapping "Set up payouts" saw internal tooling instructions. These become
    // a plain 503, with the real message kept in the logs where it is useful.
    if (PLATFORM_CONFIG_ERRORS.some((pattern) => pattern.test(message))) {
      logger.error("Stripe platform configuration error", { path, status: response.status, message });
      throw new AppError(
        "Payments are not fully set up on this server yet. Please try again later.",
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }

    // Anything else is about this request — a declined card, a bad id — so Stripe's wording helps.
    // 4xx from Stripe is our request's fault, so keep it a 4xx rather than reporting a server error.
    const status = response.status >= 400 && response.status < 500 ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.BAD_GATEWAY;
    throw new AppError(`Stripe: ${message}`, status);
  }

  return json as T;
};

/**
 * Verifies a `Stripe-Signature` header against the exact bytes Stripe signed.
 *
 * Returns the parsed event, or throws. Never parse the body before this passes: a forged event could
 * otherwise flip an account to "payouts enabled".
 */
export const verifyStripeWebhook = <T>(rawBody: Buffer | string, signatureHeader?: string): T => {
  const secret = ENV.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed. The RevenueCat webhook skips its check when unset; that mistake is not repeated here.
    throw new AppError("Stripe webhook secret is not configured", HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  if (!signatureHeader) {
    throw new AppError("Missing Stripe-Signature header", HTTP_STATUS.BAD_REQUEST);
  }

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, pair) => {
    const [k, v] = pair.split("=");
    if (k && v) (acc[k.trim()] ??= []).push(v.trim());
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) {
    throw new AppError("Malformed Stripe-Signature header", HTTP_STATUS.BAD_REQUEST);
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
    throw new AppError("Stripe signature timestamp is outside the tolerance", HTTP_STATUS.BAD_REQUEST);
  }

  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const matches = signatures.some((candidate) => {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(candidate, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!matches) throw new AppError("Stripe signature does not match", HTTP_STATUS.UNAUTHORIZED);

  return JSON.parse(payload) as T;
};

/**
 * One Accounts v2 call. Separate from stripeRequest because v2 differs in three ways that matter:
 * a /v2 base path, a JSON body rather than form encoding, and its own dated API version.
 *
 * Only account *creation* needs this. Stripe documents that a v2 account id can be passed to v1
 * endpoints, so account links, status reads and PaymentIntents all stay on v1 and keep working.
 */
export const stripeRequestV2 = async <T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> => {
  if (!stripeConfigured()) {
    throw new AppError(
      "Payments are not configured on this server yet",
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${ENV.STRIPE_SECRET_KEY}`,
    "Stripe-Version": STRIPE_VERSION_V2,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${API_V2}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError(
      `Could not reach Stripe (${(err as Error).name})`,
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & StripeErrorBody) : ({} as T & StripeErrorBody);

  if (!response.ok) {
    const message = json.error?.message ?? `Stripe returned ${response.status}`;
    // Same rule as v1: a message about our own setup is for the logs, not for an app user. The
    // platform-profile one lands here until the loss responsibilities are declared in the dashboard.
    if (PLATFORM_CONFIG_ERRORS.some((pattern) => pattern.test(message))) {
      logger.error("Stripe platform configuration error", { path, status: response.status, message });
      throw new AppError(
        "Payments are not fully set up on this server yet. Please try again later.",
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }
    const status = response.status >= 400 && response.status < 500 ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.BAD_GATEWAY;
    throw new AppError(`Stripe: ${message}`, status);
  }

  return json as T;
};

/** The subset of a Connect account this app reads. Bank details deliberately never leave Stripe. */
export interface StripeConnectAccount {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  country?: string;
  default_currency?: string;
  requirements?: { currently_due?: string[]; disabled_reason?: string | null };
  external_accounts?: { data?: Array<{ last4?: string; bank_name?: string }> };
  metadata?: Record<string, string>;
}

export interface StripePaymentIntent {
  id: string;
  object: "payment_intent";
  amount: number;
  currency: string;
  status: string;
  client_secret: string;
  latest_charge?: string;
  transfer_data?: { destination?: string };
  application_fee_amount?: number;
  metadata?: Record<string, string>;
}

export interface StripeRefund {
  id: string;
  object: "refund";
  amount: number;
  currency: string;
  status: string;
  payment_intent?: string;
  charge?: string;
}

export const createPaymentIntent = async (params: {
  amount: number;
  currency: string;
  destinationAccountId?: string;
  applicationFeeAmount?: number;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<StripePaymentIntent> => {
  const payload: Record<string, unknown> = {
    amount: params.amount,
    currency: params.currency.toLowerCase(),
    payment_method_types: ["card"],
  };

  if (params.destinationAccountId) {
    payload.transfer_data = { destination: params.destinationAccountId };
    if (params.applicationFeeAmount !== undefined && params.applicationFeeAmount > 0) {
      payload.application_fee_amount = params.applicationFeeAmount;
    }
  }

  if (params.metadata) {
    payload.metadata = params.metadata;
  }

  return stripeRequest<StripePaymentIntent>("POST", "/payment_intents", payload, params.idempotencyKey);
};

export const getPaymentIntent = async (
  paymentIntentId: string
): Promise<StripePaymentIntent> => {
  return stripeRequest<StripePaymentIntent>("GET", `/payment_intents/${paymentIntentId}`);
};

export const createRefund = async (params: {
  paymentIntentId: string;
  amount?: number;
  reverseTransfer?: boolean;
  refundApplicationFee?: boolean;
  reason?: string;
  idempotencyKey?: string;
}): Promise<StripeRefund> => {
  const payload: Record<string, unknown> = {
    payment_intent: params.paymentIntentId,
  };

  if (params.amount) payload.amount = params.amount;
  if (params.reverseTransfer !== undefined) payload.reverse_transfer = params.reverseTransfer;
  if (params.refundApplicationFee !== undefined) payload.refund_application_fee = params.refundApplicationFee;
  if (params.reason) payload.reason = params.reason;

  return stripeRequest<StripeRefund>("POST", "/refunds", payload, params.idempotencyKey);
};
