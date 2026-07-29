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
  successUrl?: string;
  cancelUrl?: string;
}

const VALID_PRICE_IDS = new Set([
  "price_1TyU6EBbnDObsY4u0FbZ2fui", // Pro Monthly $4.99/mo
  "price_1TyUC6BbnDObsY4uOHfB8glf", // Pro Yearly $39.99/yr
  "price_1TyUFsBbnDObsY4uXFnCubR4", // Family $9.99/mo
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
      { error: "Invalid JSON body. Expected { priceId, successUrl?, cancelUrl? }" },
      { status: 400 },
    );
  }

  const { priceId, successUrl, cancelUrl } = body;

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
  const origin = req.headers.get("origin") || req.headers.get("referer") || "https://notesnap.app";
  const defaultSuccessUrl = `${origin}/subscription/success`;
  const defaultCancelUrl = `${origin}/pricing`;

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
