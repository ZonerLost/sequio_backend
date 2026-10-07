import { UserRepository } from "../repository/user.repository";
import { UserModel } from "../models/user.model";
import { AppError } from "../middleware/error.middleware";
import { HTTP_STATUS } from "../config/constants";
import { ENV } from "../config/env";
import { logger } from "../config/logger";
import { StripeConnectAccount, stripeRequest, stripeRequestV2 } from "../helpers/stripe.helper";

const userRepo = new UserRepository();

/** What the app shows on the Payout Information screen. */
export type PayoutState = "not_connected" | "pending" | "restricted" | "active";

export interface PayoutStatus {
  state: PayoutState;
  connected: boolean;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  /** Stripe's own list of what is still missing, e.g. ["individual.verification.document"]. */
  requirementsDue: string[];
  disabledReason?: string;
  bank?: { last4?: string; name?: string };
  country?: string;
  currency?: string;
  /** True while Stripe still needs something: the app should offer the onboarding link again. */
  actionRequired: boolean;
}

/**
 * Owners are paid through Stripe Connect (Express), so this service never sees an account number:
 * it creates the connected account, hands back a Stripe-hosted onboarding link, and mirrors the
 * resulting status. The platform's commission is taken at charge time as an application fee, which is
 * the separate charging work — nothing here moves money on its own.
 */
export class PayoutService {
  /** Maps a Stripe account onto the four states a UI can render. */
  private static toStatus(account?: {
    id?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    requirementsDue?: string[];
    disabledReason?: string;
    country?: string;
    defaultCurrency?: string;
    bankLast4?: string;
    bankName?: string;
  }): PayoutStatus {
    if (!account?.id) {
      return {
        state: "not_connected",
        connected: false,
        payoutsEnabled: false,
        chargesEnabled: false,
        detailsSubmitted: false,
        requirementsDue: [],
        actionRequired: true,
      };
    }

    const requirementsDue = account.requirementsDue ?? [];
    const state: PayoutState = account.payoutsEnabled
      ? "active"
      : account.disabledReason || requirementsDue.length > 0
        ? account.detailsSubmitted
          ? "restricted"
          : "pending"
        : "pending";

    return {
      state,
      connected: true,
      payoutsEnabled: !!account.payoutsEnabled,
      chargesEnabled: !!account.chargesEnabled,
      detailsSubmitted: !!account.detailsSubmitted,
      requirementsDue,
      disabledReason: account.disabledReason,
      bank: account.bankLast4 || account.bankName ? { last4: account.bankLast4, name: account.bankName } : undefined,
      country: account.country,
      currency: account.defaultCurrency,
      actionRequired: !account.payoutsEnabled,
    };
  }

  /** Flattens a Stripe account into the fields stored on the user. */
  private static fromStripe(account: StripeConnectAccount) {
    const bank = account.external_accounts?.data?.[0];
    return {
      id: account.id,
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
      requirementsDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? undefined,
      country: account.country,
      defaultCurrency: account.default_currency,
      bankLast4: bank?.last4,
      bankName: bank?.bank_name,
      syncedAt: new Date(),
    };
  }

  /**
   * Current status, refreshed from Stripe when an account exists — a stale "action required" is worse
   * than one extra call, and onboarding state changes outside our control.
   */
  async getStatus(userId: string): Promise<PayoutStatus> {
    const user = await userRepo.findById(userId);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);

    const accountId = user.stripeAccount?.id;
    if (!accountId) return PayoutService.toStatus(undefined);

    try {
      const account = await stripeRequest<StripeConnectAccount>("GET", `/accounts/${accountId}`);
      const fields = PayoutService.fromStripe(account);
      await UserModel.updateOne({ _id: userId }, { $set: { stripeAccount: fields } });
      return PayoutService.toStatus(fields);
    } catch (err) {
      // Stripe being unreachable must not blank out the screen: serve the last known state instead.
      logger.error("Stripe account refresh failed, serving stored status", {
        message: (err as Error).message,
        userId,
      });
      return PayoutService.toStatus(user.stripeAccount);
    }
  }

  /**
   * Returns a fresh Stripe-hosted onboarding URL, creating the connected account on first use.
   *
   * The link is single-use and expires in minutes, so the app must fetch one each time the owner taps
   * "set up payouts" rather than caching it.
   */
  async createOnboardingLink(
    userId: string,
    /** This server's public origin, used only when the app's deep links are not configured. */
    publicOrigin?: string
  ): Promise<{ url: string; expiresAt: Date; accountId: string; returnsTo: "app" | "web" }> {
    // Stripe insists on a return and a refresh URL, and it redirects a browser to them. Refusing to
    // create the link when the app's deep links are unset made getting paid impossible over a
    // cosmetic gap, so fall back to this server's own hosted pages.
    const fallback = publicOrigin?.replace(/\/$/, "");
    // Stripe only accepts http(s) here. Anything else — an app scheme, a typo — is ignored with a
    // warning rather than sent, because Stripe answers "Not a valid URL" and the owner simply cannot
    // start onboarding at all.
    const httpsOnly = (value: string, name: string): string | undefined => {
      if (!value) return undefined;
      if (/^https?:\/\//i.test(value)) return value;
      logger.warn(`${name} is not an http(s) URL, so Stripe cannot use it — falling back to the hosted page`, { value });
      return undefined;
    };

    const returnUrl =
      httpsOnly(ENV.STRIPE_CONNECT_RETURN_URL, "STRIPE_CONNECT_RETURN_URL") ||
      (fallback && `${fallback}/payouts/return`);
    const refreshUrl =
      httpsOnly(ENV.STRIPE_CONNECT_REFRESH_URL, "STRIPE_CONNECT_REFRESH_URL") ||
      (fallback && `${fallback}/payouts/refresh`);
    if (!returnUrl || !refreshUrl) {
      throw new AppError(
        "Payout onboarding cannot determine where to send the owner back to",
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }
    // "web" whenever Stripe lands on our page first — even though that page then bounces into the
    // app, the client should still re-check on foreground in case the bounce is blocked.
    const returnsTo: "app" | "web" = returnUrl === ENV.STRIPE_CONNECT_RETURN_URL ? "app" : "web";

    const user = await userRepo.findById(userId);
    if (!user) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);

    let accountId = user.stripeAccount?.id;
    if (!accountId) {
      // v2 requires a contact email, and a phone-only signup has a placeholder address rather than a
      // real one. Say so plainly instead of letting Stripe reject it with its own wording.
      const contactEmail = user.email?.endsWith("@placeholder.local") ? undefined : user.email;
      if (!contactEmail) {
        throw new AppError(
          "Add an email address to your profile before setting up payouts",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      // Accounts v2: Stripe refuses POST /v1/accounts for new Connect integrations. The resulting
      // acct_ id still works on every v1 endpoint, so links, status and charges are unchanged.
      const account = await stripeRequestV2<{ id: string }>(
        "POST",
        "/core/accounts",
        {
          contact_email: contactEmail,
          display_name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
          dashboard: "express",
          identity: { country: ENV.STRIPE_CONNECT_ACCOUNT_COUNTRY, entity_type: "individual" },
          configuration: {
            // merchant = can be charged on behalf of; recipient = can receive transfers, which is
            // what a destination charge needs.
            merchant: { capabilities: { card_payments: { requested: true } } },
            recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
          },
          defaults: {
            currency: ENV.STRIPE_CONNECT_ACCOUNT_COUNTRY === "ca" ? "cad" : "usd",
            // The platform always collects the application fee — that is the commission. Who carries
            // an unrecoverable negative balance is configurable, and defaults to Stripe: making the
            // platform liable obliges Atussa to underwrite and monitor seller risk, and requires an
            // acknowledgement in the Connect platform profile before accounts can be created at all.
            //
            // Stripe-carried losses was verified end to end on 2026-10-07 — creation, the hosted
            // onboarding link the app already uses, and v1 status reads all work. The embedded-
            // components requirement in Stripe's docs applies to accounts with no Stripe-hosted
            // dashboard; Express is Stripe-hosted, so it does not apply here.
            responsibilities: {
              fees_collector: "application",
              losses_collector: ENV.STRIPE_CONNECT_LOSSES_COLLECTOR,
            },
          },
          metadata: { userId },
          // Note: business_profile is not part of the v2 create shape, so it is set immediately
          // below through v1 — which is also the only write the platform is permitted to make on
          // these accounts while Stripe carries the losses.
        },
        // Keyed on the user, so a retry or a double tap cannot create a second connected account.
        `connect-account-${userId}`
      );
      accountId = account.id;

      /**
       * Answer the questions that are Atussa's to answer, before the owner is ever shown them.
       *
       * Stripe asks a new account for its business category, website, product description and
       * support phone. Those describe the platform, not the owner — they are identical for everyone
       * — so asking each owner was extra questions in a flow that already runs long and that
       * people abandon. Measured on 2026-10-07: 19 requirements before, 16 after, and 15 once
       * CONNECT_SUPPORT_PHONE holds a real number — left empty rather than invented, because
       * Stripe shows it to customers as the way to reach support.
       *
       * Not fatal if it fails. The owner can still complete onboarding by answering them, which is
       * exactly what happened before this existed, so a transient Stripe error must not block
       * getting paid.
       */
      await stripeRequest("POST", `/accounts/${accountId}`, {
        business_profile: {
          mcc: ENV.CONNECT_BUSINESS_MCC,
          url: ENV.CONNECT_BUSINESS_URL,
          product_description: ENV.CONNECT_BUSINESS_DESCRIPTION,
          ...(ENV.CONNECT_SUPPORT_PHONE ? { support_phone: ENV.CONNECT_SUPPORT_PHONE } : {}),
        },
      }).catch((err: Error) => {
        logger.warn("Could not prefill the business profile; the owner will be asked instead", {
          accountId,
          message: err.message,
        });
      });

      // Read it back through v1 so the stored shape stays exactly what the rest of this file expects.
      const v1 = await stripeRequest<StripeConnectAccount>("GET", `/accounts/${accountId}`);
      await UserModel.updateOne(
        { _id: userId },
        { $set: { stripeAccount: PayoutService.fromStripe(v1) } }
      );
    }

    const link = await stripeRequest<{ url: string; expires_at: number }>("POST", "/account_links", {
      account: accountId,
      type: "account_onboarding",
      refresh_url: refreshUrl,
      return_url: returnUrl,
      collect: "currently_due",
    });

    // returnsTo tells a client whether Stripe will deep-link back into the app ("app") or land on
    // this server's page ("web"), so it knows whether to expect a resume or to poll on next foreground.
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000), accountId, returnsTo };
  }

  /**
   * Applies an `account.updated` event. Matched on the stored account id, falling back to the userId
   * recorded in metadata at creation time.
   */
  async applyAccountUpdate(account: StripeConnectAccount): Promise<boolean> {
    const fields = PayoutService.fromStripe(account);
    const byAccount = await UserModel.updateOne(
      { "stripeAccount.id": account.id },
      { $set: { stripeAccount: fields } }
    );
    if (byAccount.matchedCount > 0) return true;

    const userId = account.metadata?.userId;
    if (!userId) {
      logger.warn("Stripe account.updated for an unknown account", { accountId: account.id });
      return false;
    }
    const byMetadata = await UserModel.updateOne({ _id: userId }, { $set: { stripeAccount: fields } });
    return byMetadata.matchedCount > 0;
  }
}

export const payoutService = new PayoutService();
