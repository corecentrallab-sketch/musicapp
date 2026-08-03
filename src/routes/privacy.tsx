import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Privacy() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <a href="/" className="text-sm text-amber-600 hover:text-amber-700">← Back to NoteSnap</a>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-stone-500">Last updated: August 2026</p>

        <div className="mt-10 space-y-8 text-stone-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-stone-900">1. Information We Collect</h2>
            <p className="mt-2">
              NoteSnap collects audio recordings solely for the purpose of music recognition. Recordings are processed to generate anonymous audio fingerprints and are not stored as audio files. We also collect app usage data (recognitions, practice sessions, streaks) to personalise your experience and improve our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">2. How We Use Your Data</h2>
            <p className="mt-2">
              Audio fingerprints are used exclusively to identify music and match it to our catalog. Usage data powers features like practice streaks, recommendations, and achievement badges. We do not sell personal data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">3. Data Storage</h2>
            <p className="mt-2">
              Recognition history, practice data, and preferences are stored securely in our database. You can delete your history at any time from the app's Settings screen. Audio recordings are processed transiently and not retained.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">4. Third-Party Links</h2>
            <p className="mt-2">
              When you choose to purchase sheet music for copyrighted songs, you'll be directed to third-party retailers (such as Musicnotes or Sheet Music Plus). Those retailers have their own privacy policies. NoteSnap may earn a commission on qualifying purchases.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">5. Contact</h2>
            <p className="mt-2">
              Questions about this policy? Email us at{" "}
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
