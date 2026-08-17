import { createFileRoute } from "@tanstack/react-router";
/**
 * /api/newsletter/subscribe — opt-in "Daily practice note" signup.
 * POST (JSON { email, instrument? }) — handled by serve.ts / vercel-entry.ts
 *   (see newsletter-handler.ts). Storage + confirmation only; no email is sent
 *   from the site.
 */
export const Route = createFileRoute("/api/newsletter/subscribe")({
  component: ApiNewsletterInfo,
});
function ApiNewsletterInfo() {
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>NoteSnap Newsletter API</h1>
      <h2>POST /api/newsletter/subscribe</h2>
      <p>Opts an email into the "Daily practice note". No emails are sent from here.</p>
      <h3>Request body (JSON)</h3>
      <pre>{`{
  "email": "you@example.com",
  "instrument": "Piano"        // optional
}`}</pre>
      <h3>Response</h3>
      <pre>{`{
  "ok": true,
  "status": "subscribed",
  "email": "you@example.com"
}`}</pre>
      <h3>Unsubscribe</h3>
      <p>
        <code>GET /api/newsletter/unsubscribe?email=you@example.com</code> flags
        the address as unsubscribed (idempotent).
      </p>
    </div>
  );
}
