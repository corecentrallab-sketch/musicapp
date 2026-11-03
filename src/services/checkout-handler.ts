import Stripe from "stripe";
import { LIVE_PRICE_IDS } from "~/services/entitlement";

// ---------------------------------------------------------------------------
// Stripe Checkout Session Handler
//
// POST /api/create-checkout-session
// Accepts JSON: { priceId: string, successUrl?: string, cancelUrl?: string }
// Returns JSON: { url: string }
// ---------------------------------------------------------------------------

interface CheckoutRequest {
  priceId: string;
  /** Anonymous app device UUID — stored in session metadata for entitlement. */
  deviceId?: string;
  successUrl?: string;
  cancelUrl?: string;
}

// Price IDs from the OWNER's live Stripe account: the three AUD ONE-TIME prices
// ($4.99 / $39.99 / $9.99). They are read from `LIVE_ONE_TIME_PRICES` in
// entitlement.ts, which is the only place in this repo a live price id appears.
//
// THE DEFECT THIS FIXED (2026-11-03): the allowlist used to hold three
// `price_1U3SE…` ids from an OLDER Stripe account (labelled "USD plans", and
// recurring). The app sends the ids from its own `LIVE_PRICES` — the three
// one-time AUD prices — so every upgrade tap died here with
// `400 Invalid price ID` before Stripe was ever called. The session was also
// created in `mode: "subscription"`, which Stripe refuses for a one_time price.
// Both are fixed: the allowlist is the live set, and the mode is "payment".
const VALID_PRICE_IDS = new Set<string>(LIVE_PRICE_IDS);

/**
 * Handle POST /api/create-checkout-session
 */
export async function handleCreateCheckoutSession(
  req: Request,
): Promise<Response> {
  // --- Only POST ---
  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed. Use POST." },
      { status: 405 },
    );
  }

  // --- Parse body ---
  let body: CheckoutRequest;
  try {
    body = (await req.json()) as CheckoutRequest;
  } catch {
    return Response.json(
      { error: "Invalid JSON body. Expected { priceId, deviceId?, successUrl?, cancelUrl? }" },
      { status: 400 },
    );
  }

  const { priceId, deviceId, successUrl, cancelUrl } = body;

  // --- Validate price ID ---
  if (!priceId || typeof priceId !== "string") {
    return Response.json(
      { error: "Missing or invalid 'priceId' field." },
      { status: 400 },
    );
  }

  if (!VALID_PRICE_IDS.has(priceId)) {
    return Response.json(
      {
        error: `Invalid price ID: "${priceId}". Must be one of: ${[...VALID_PRICE_IDS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  // --- Stripe secret key ---
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error("[checkout] STRIPE_SECRET_KEY is not set");
    return Response.json(
      { error: "Payment processing is not configured. Please contact support." },
      { status: 500 },
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2025-06-30.basil" as any,
  });

  // --- Determine origin for default URLs ---
  // NOTE: the app always passes explicit success/cancel URLs; these defaults are
  // for API clients that omit them. Defaults must resolve 200 on the site —
  // `${origin}/pricing` 404s, so the cancel default is the site root.
  const origin =
    req.headers.get("origin") ||
    req.headers.get("referer") ||
    "https://site-notesnap.vercel.app";
  const defaultSuccessUrl = `${origin}/subscription/success`;
  const defaultCancelUrl = `${origin}/`;

  // --- Create Checkout Session ---
  try {
    const session = await stripe.checkout.sessions.create({
      // ONE-TIME PURCHASE, not a subscription. The three live prices are
      // `type: one_time`, and Stripe rejects `mode: "subscription"` for them.
      // `payment` is what makes the webhook's one-time branch (mode=payment +
      // payment_status=paid → purchases row) fire at all.
      mode: "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // deviceId ties the purchase back to the app install: the webhook reads
      // metadata.device_id (falling back to client_reference_id) to write the
      // purchase row that /api/entitlement serves.
      //
      // metadata.price_id is set here because the webhook receives the session
      // UNEXPANDED — it has no line_items — so without this the tier could only
      // be guessed from amount_total. The webhook still falls back to
      // amount+currency for sessions created outside this endpoint.
      metadata: {
        ...(deviceId ? { device_id: deviceId } : {}),
        price_id: priceId,
      },
      ...(deviceId ? { client_reference_id: deviceId } : {}),
      success_url: successUrl || defaultSuccessUrl,
      cancel_url: cancelUrl || defaultCancelUrl,
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[checkout] Stripe session creation failed:", err);
    if (err instanceof Stripe.errors.StripeError) {
      return Response.json(
        { error: `Stripe error: ${err.message}` },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Failed to create checkout session. Please try again." },
      { status: 500 },
    );
  }
}
