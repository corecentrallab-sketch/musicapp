/**
 * Newsletter — "Daily practice note" opt-in endpoints (marketing site).
 *
 *   POST /api/newsletter/subscribe    body: { email, instrument? }
 *   GET  /api/newsletter/unsubscribe  query: ?email=...
 *
 * Storage + confirmation only. No emails are sent from this module — the team
 * lead's send pipeline consumes the newsletter_subscribers table later.
 *
 * Honest opt-in rules (from the business plan): the form shows a clear
 * statement of what the subscriber gets, there are no pre-checked boxes, no
 * dark patterns, and unsubscribe is one click, idempotent, and permanent for
 * the row (re-subscribing re-activates it).
 */
import { sql } from "~/db";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_INSTRUMENT_LEN = 60;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function validEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

/**
 * POST /api/newsletter/subscribe
 * Validates the email, upserts the row (re-activating previously unsubscribed
 * addresses), and returns a confirmation JSON payload. Never sends email.
 */
export async function handleNewsletterSubscribe(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const record = (body ?? {}) as { email?: unknown; instrument?: unknown };
  const email = normalizeEmail(record.email);
  if (!validEmail(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  const rawInstrument = record.instrument;
  const instrument =
    typeof rawInstrument === "string" && rawInstrument.trim() !== ""
      ? rawInstrument.trim().slice(0, MAX_INSTRUMENT_LEN)
      : null;

  try {
    await sql()`
      INSERT INTO newsletter_subscribers (email, instrument, source, subscribed_at, unsubscribed_at)
      VALUES (${email}, ${instrument}, 'site', now(), NULL)
      ON CONFLICT (email) DO UPDATE SET
        instrument = CASE
          WHEN EXCLUDED.instrument IS NOT NULL
            THEN EXCLUDED.instrument
          ELSE newsletter_subscribers.instrument
        END,
        source = 'site',
        subscribed_at = now(),
        unsubscribed_at = NULL
    `;
  } catch (err) {
    console.error("[newsletter] subscribe failed:", err);
    return json({ error: "Something went wrong — please try again." }, 500);
  }

  return json({ ok: true, status: "subscribed", email }, 200);
}

/**
 * GET /api/newsletter/unsubscribe?email=...
 * Flags the row as unsubscribed (idempotent — works whether or not the address
 * is known) and returns a short human-readable confirmation page, since this
 * URL is what a link inside a future email will point to.
 */
export async function handleNewsletterUnsubscribe(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const email = normalizeEmail(url.searchParams.get("email"));
  if (!validEmail(email)) {
    return json({ error: "A valid email address is required (?email=...)." }, 400);
  }

  try {
    await sql()`
      UPDATE newsletter_subscribers
      SET unsubscribed_at = now()
      WHERE email = ${email} AND unsubscribed_at IS NULL
    `;
  } catch (err) {
    console.error("[newsletter] unsubscribe failed:", err);
    return json({ error: "Something went wrong — please try again." }, 500);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribed — NoteSnap</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#fafaf9;color:#292524;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:1rem;padding:2.5rem;
        max-width:26rem;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.05)}
  h1{font-size:1.35rem;margin:0 0 .5rem;color:#1c1917}
  p{color:#57534e;line-height:1.6;margin:.4rem 0}
  a{color:#b45309;font-weight:600;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
  <h1>You're unsubscribed</h1>
  <p>You won't receive any more daily practice notes from NoteSnap at
     <strong>${escapeHtml(email)}</strong>.</p>
  <p>Changed your mind? <a href="https://site-notesnap.vercel.app/#daily-practice">Re-subscribe anytime</a>.</p>
</div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
