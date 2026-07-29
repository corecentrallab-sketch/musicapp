import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/subscription/success")({
  component: SubscriptionSuccess,
});

function SubscriptionSuccess() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased flex items-center justify-center">
      <div className="text-center px-4 max-w-lg">
        <span className="text-6xl">🎉</span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          Welcome to NoteSnap Pro!
        </h1>
        <p className="mt-4 text-lg text-stone-600 leading-relaxed">
          You're all set. Your subscription is now active — enjoy unlimited
          recognitions, advanced recommendations, custom skins, cloud sync,
          and everything else Pro has to offer.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <a
            href="/"
            className="rounded-full bg-amber-600 px-6 py-3 text-base font-semibold text-white hover:bg-amber-700 transition-colors shadow-sm"
          >
            Go to your library
          </a>
          <a
            href="/#features"
            className="rounded-full border border-stone-300 px-6 py-3 text-base font-semibold text-stone-700 hover:border-amber-400 hover:text-amber-700 transition-colors"
          >
            Explore features
          </a>
        </div>
      </div>
    </div>
  );
}
