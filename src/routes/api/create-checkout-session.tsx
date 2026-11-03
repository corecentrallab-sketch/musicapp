import { createFileRoute } from "@tanstack/react-router";
import { LIVE_ONE_TIME_PRICES } from "~/services/live-prices";

/**
 * GET /api/create-checkout-session — API info
 * POST /api/create-checkout-session — handled by serve.ts (see checkout-handler.ts)
 *
 * The price list is RENDERED from `LIVE_ONE_TIME_PRICES` rather than typed here,
 * so this page cannot drift from the prices the endpoint actually accepts. It
 * used to hardcode three `price_1U3SE…` subscription ids from an older Stripe
 * account — the same stale set that made every upgrade tap fail.
 */
export const Route = createFileRoute("/api/create-checkout-session")({
  component: ApiCheckoutInfo,
});

function ApiCheckoutInfo() {
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>NoteSnap Checkout API</h1>
      <h2>POST /api/create-checkout-session</h2>
      <p>
        Creates a Stripe Checkout Session for a one-time purchase (AUD). The
        session is created in <code>mode: "payment"</code>; the webhook records
        the purchase once Stripe confirms the payment.
      </p>
      <h3>Request body (JSON)</h3>
      <pre>{`{
  "priceId": "${LIVE_ONE_TIME_PRICES[0].priceId}",
  "deviceId": "<app device uuid>",
  "successUrl": "https://notesnap.app/subscription/success",
  "cancelUrl": "https://notesnap.app/"
}`}</pre>
      <h3>Valid price IDs (live, one-time, AUD)</h3>
      <ul>
        {LIVE_ONE_TIME_PRICES.map((price) => (
          <li key={price.priceId}>
            <code>{price.priceId}</code> — {price.plan} ($
            {(price.amountTotal / 100).toFixed(2)} {price.currency.toUpperCase()},
            one-time)
          </li>
        ))}
      </ul>
      <h3>Response</h3>
      <pre>{`{
  "url": "https://checkout.stripe.com/c/pay/..."
}`}</pre>
      <p>
        <code>successUrl</code> and <code>cancelUrl</code> are optional — sensible
        defaults are used if omitted. <code>deviceId</code> is optional but a
        purchase without it cannot be tied to an install, so nothing is
        unlocked.
      </p>
    </div>
  );
}
