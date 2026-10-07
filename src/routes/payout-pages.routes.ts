import { Router, Request, Response } from "express";
import { ENV } from "../config/env";

/**
 * The two browser pages Stripe sends an owner back to after hosted Connect onboarding.
 *
 * Stripe demands a return and a refresh URL, it redirects a *browser* to them, and it only accepts
 * http(s) — an app deep link is refused outright with "Not a valid URL". These pages are therefore the
 * bridge: Stripe lands the owner here, and the page hops to the app's own scheme. Without them,
 * onboarding was unreachable, which is a steep price for a cosmetic gap in where the owner ends up.
 *
 * Mounted outside /api/v1 because they are pages, not API resources.
 */
const router = Router();

// The deep link comes from env, not from a request, but it still lands in an HTML attribute and in a
// script literal — so escape it rather than trusting a value nobody will think to re-check.
const attr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inScript = (value: string): string =>
  // A literal </script> inside the string would close the tag early, so hide the angle bracket.
  JSON.stringify(value).replace(/</g, "\\u003c");

const page = (title: string, message: string, hint: string, deepLink?: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Atussa</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f4f5ed; color: #1b2a1f; padding: 24px;
  }
  main { max-width: 26rem; text-align: center; }
  h1 { font-size: 1.35rem; margin: 0 0 .5rem; color: #1f4d2e; }
  p { margin: 0 0 .75rem; }
  .hint { color: #5b6b5f; font-size: .9rem; }
  .cta {
    display: inline-block; margin: .25rem 0 .75rem; padding: .6rem 1.25rem; border-radius: 999px;
    background: #1f4d2e; color: #fff; text-decoration: none; font-weight: 600;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #14170f; color: #e8ebe1; }
    h1 { color: #9ec7a6; }
    .hint { color: #9aa79d; }
  }
</style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
    ${deepLink ? `<p><a class="cta" href="${attr(deepLink)}">Return to Atussa</a></p>` : ""}
    <p class="hint">${hint}</p>
  </main>
  ${
    deepLink
      ? `<script>
    // Stripe can only redirect to https, so the hop back into the app happens here. If the scheme is
    // not registered — desktop browser, say — nothing happens and the text above still explains it.
    setTimeout(function () { window.location.href = ${inScript(deepLink)}; }, 400);
  </script>`
      : ""
  }
</body>
</html>`;

// Stripe sends the owner here when they finish, or abandon, the hosted flow.
router.get("/return", (_req: Request, res: Response) => {
  res
    .status(200)
    .type("html")
    .send(
      page(
        "Payout setup submitted",
        "Thanks — Stripe has your details. Taking you back to Atussa…",
        "If nothing happens, close this window and reopen the app. Your payout status updates automatically, and Stripe sometimes asks for one more document, in which case the app will prompt you again.",
        ENV.APP_PAYOUT_RETURN_DEEPLINK || undefined
      )
    );
});

// Stripe sends the owner here when the link expired before they finished.
router.get("/refresh", (_req: Request, res: Response) => {
  res
    .status(200)
    .type("html")
    .send(
      page(
        "That link expired",
        "Payout setup links are single-use and expire after a few minutes.",
        "If nothing happens, close this window, reopen Atussa and tap “Set up payouts” again for a fresh link.",
        ENV.APP_PAYOUT_REFRESH_DEEPLINK || undefined
      )
    );
});

export default router;
