import { Router, Request, Response } from "express";

/**
 * The two browser pages Stripe sends an owner back to after hosted Connect onboarding.
 *
 * Stripe demands a return and a refresh URL, and it redirects a *browser* to them — so when the app's
 * deep links are not configured these stand in, instead of refusing to create the link at all. That
 * refusal is what made payout onboarding unreachable: a missing deep link is a cosmetic gap, not a
 * reason to disable getting paid.
 *
 * Mounted outside /api/v1 because they are pages, not API resources.
 */
const router = Router();

const page = (title: string, message: string, hint: string): string => `<!doctype html>
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
    <p class="hint">${hint}</p>
  </main>
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
        "Thanks — Stripe has your details. You can close this window and return to Atussa.",
        "Your payout status updates in the app automatically. Stripe sometimes asks for one more document, in which case the app will prompt you again."
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
        "Close this window, return to Atussa and tap “Set up payouts” again to get a fresh link."
      )
    );
});

export default router;
