import crypto from "crypto";
import { ENV } from "../config/env";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";

/**
 * Stripe over plain HTTPS, deliberately without the `stripe` SDK.
 *
 * Adding a dependency would force a full Docker image rebuild, and this deploy path ships by appending
 * the compiled `dist/` onto the live image (see CLAUDE.md → Deploying). The runtime is Node 24, so
 * `fetch` and `crypto` cover everything Connect onboarding needs.
 */

const API = "https://api.stripe.com/v1";
// Pinned: an account's default API version can change under us, which would silently alter payloads.
const STRIPE_VERSION = "2024-06-20";
const TIMEOUT_MS = 20_000;
/** Stripe's own recommendation: reject signatures older than five minutes (replay protection). */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export const stripeConfigured = (): boolean => Boolean(ENV.STRIPE_SECRET_KEY);

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
    // 4xx from Stripe is our request's fault, so keep it a 4xx rather than reporting a server error.
    const status = response.status >= 400 && response.status < 500 ? HTTP_STATUS.BAD_REQUEST : 502;
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
