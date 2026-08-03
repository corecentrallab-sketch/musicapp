import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: Terms,
});

function Terms() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <a href="/" className="text-sm text-amber-600 hover:text-amber-700">← Back to NoteSnap</a>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-stone-500">Last updated: August 2026</p>

        <div className="mt-10 space-y-8 text-stone-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-stone-900">1. Acceptance of Terms</h2>
            <p className="mt-2">
              By using NoteSnap, you agree to these terms. If you do not agree, please do not use the app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">2. Service Description</h2>
            <p className="mt-2">
              NoteSnap identifies music playing around you and provides sheet music for recognized pieces. For public-domain works, sheet music is provided free. For copyrighted works, NoteSnap links to licensed retailers where you can purchase official sheet music. NoteSnap does not host, distribute, or sell copyrighted sheet music.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">3. Subscriptions</h2>
            <p className="mt-2">
              The free tier includes 5 music recognitions per month with full access to the notation editor, practice tools, and exports. Pro and Family plans offer unlimited recognitions and additional features. Subscriptions auto-renew unless cancelled. You can cancel anytime with one tap — no commitments, no penalties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">4. Affiliate Disclosure</h2>
            <p className="mt-2">
              When you purchase sheet music through links in NoteSnap, we may earn a commission from the retailer. This does not affect the price you pay. We only link to licensed, legitimate sheet music retailers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">5. Intellectual Property</h2>
            <p className="mt-2">
              The NoteSnap app, branding, and recognition technology are proprietary. Sheet music for public-domain works is sourced from freely-licensed arrangements. Copyrighted music recognition results link to licensed retailers — no copyrighted content is hosted or distributed by NoteSnap.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">6. Limitation of Liability</h2>
            <p className="mt-2">
              NoteSnap is provided "as is." We strive for accuracy in music recognition but cannot guarantee perfect results. NoteSnap is not liable for damages arising from use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">7. Contact</h2>
            <p className="mt-2">
              Questions about these terms? Email us at{" "}
              <a href="mailto:notesnap-2b073273@ctomail.io" className="text-amber-600 hover:text-amber-700">
                notesnap-2b073273@ctomail.io
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
