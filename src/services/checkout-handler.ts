import Stripe from "stripe";

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

// Price IDs from the OWNER's Stripe account (STRIPE_SECRET_KEY in Vercel env).
// Currency is USD per the owner's product definitions (2026-08-12).
const VALID_PRICE_IDS = new Set([
  "price_1U3SEFBbnDObsY4ujb2zxBSs", // NoteSnap Pro — Monthly $4.99 USD / month
  "price_1U3SEKBbnDObsY4usDGDFNPQ", // NoteSnap Pro — Yearly $39.99 USD / year
  "price_1U3SEKBbnDObsY4uVrnJDIyg", // NoteSnap Family/Teacher $9.99 USD / month
]);

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
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // deviceId ties the purchase back to the app install: the webhook reads
      // metadata.device_id to write the subscription row that /api/entitlement
      // serves. client_reference_id is kept as a Stripe-visible fallback.
      ...(deviceId
        ? { metadata: { device_id: deviceId }, client_reference_id: deviceId }
        : {}),
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
