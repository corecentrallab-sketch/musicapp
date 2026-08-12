import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/create-checkout-session — API info
 * POST /api/create-checkout-session — handled by serve.ts (see checkout-handler.ts)
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
        Creates a Stripe Checkout Session for subscription signups.
      </p>
      <h3>Request body (JSON)</h3>
      <pre>{`{
  "priceId": "price_1U3SEFBbnDObsY4ujb2zxBSs",
  "successUrl": "https://site-notesnap.vercel.app/subscription/success",
  "cancelUrl": "https://site-notesnap.vercel.app/subscription/cancel"
}`}</pre>
      <h3>Valid price IDs</h3>
      <ul>
        <li><code>price_1U3SEFBbnDObsY4ujb2zxBSs</code> — Pro Monthly ($4.99/mo)</li>
        <li><code>price_1U3SEKBbnDObsY4usDGDFNPQ</code> — Pro Yearly ($39.99/yr)</li>
        <li><code>price_1U3SEKBbnDObsY4uVrnJDIyg</code> — Family/Teacher ($9.99/mo)</li>
      </ul>
      <h3>Response</h3>
      <pre>{`{
  "url": "https://checkout.stripe.com/c/pay/..."
}`}</pre>
      <p>
        <code>successUrl</code> and <code>cancelUrl</code> are optional — sensible
        defaults are used if omitted.
      </p>
    </div>
  );
}
