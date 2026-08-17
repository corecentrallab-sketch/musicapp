import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data-deletion")({
  head: () => ({
    meta: [
      { title: "Data Deletion \u2014 NoteSnap" },
      { name: "description", content: "How to delete your NoteSnap data: no account required, delete recognition history, saved scores, and practice data directly from the app, or request deletion by email." },
    ],
    links: [{ rel: "canonical", href: "https://site-notesnap.vercel.app/data-deletion" }],
  }),
  component: DataDeletion,
});

function DataDeletion() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <a href="/" className="text-sm text-amber-600 hover:text-amber-700">← Back to NoteSnap</a>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          Data Deletion
        </h1>
        <p className="mt-2 text-sm text-stone-500">Last updated: August 2026</p>

        <div className="mt-10 space-y-8 text-stone-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-stone-900">Accounts</h2>
            <p className="mt-2">
              NoteSnap does not require an account, and there is no account to delete. All app
              functionality is available without signing in.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">What Data Exists</h2>
            <p className="mt-2">
              NoteSnap keeps a minimal set of data related to your activity: recognition history,
              saved scores, practice data (streaks, goals, achievements), and preferences. Audio
              recordings you make for recognition are processed transiently to generate anonymous
              audio fingerprints and are not retained as audio files.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">How to Delete Your Data</h2>
            <p className="mt-2">
              You can delete your data at any time, directly from the app, without needing to
              contact us:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong>Recognition history</strong> — open <em>Settings</em> in the app and choose{" "}
                <em>Delete history</em> (or <em>Clear history</em>). This removes your saved
                recognitions immediately.
              </li>
              <li>
                <strong>Saved scores and imported files</strong> — remove items from your library
                in the app; each saved score can be removed at any time.
              </li>
              <li>
                <strong>Everything</strong> — uninstalling the app removes all locally stored data.
              </li>
            </ul>
            <p className="mt-3">
              If you need help deleting data or believe data related to you may be held beyond
              what you can remove in-app, email us at{" "}
              <a href="mailto:notesnap-2b073273@ctomail.io" className="text-amber-600 hover:text-amber-700">
                notesnap-2b073273@ctomail.io
              </a>{" "}
              and we'll respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-stone-900">What Is Kept and Retention</h2>
            <p className="mt-2">
              Anonymous audio fingerprints used for matching are not linked to you and are not
              used to identify you. We do not sell personal data to third parties. Purchases are
              processed by our payment provider (Stripe) under their own privacy policy; NoteSnap
              does not store payment card details.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
