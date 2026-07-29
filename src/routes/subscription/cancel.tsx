import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/subscription/cancel")({
  component: SubscriptionCancel,
});

function SubscriptionCancel() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased flex items-center justify-center">
      <div className="text-center px-4 max-w-lg">
        <span className="text-6xl">💭</span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          No worries
        </h1>
        <p className="mt-4 text-lg text-stone-600 leading-relaxed">
          You can try again anytime. NoteSnap Free is still available — no
          pressure, no obligation. If you change your mind, we'll be here.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <a
            href="/#pricing"
            className="rounded-full bg-amber-600 px-6 py-3 text-base font-semibold text-white hover:bg-amber-700 transition-colors shadow-sm"
          >
            See plans again
          </a>
          <a
            href="/"
            className="rounded-full border border-stone-300 px-6 py-3 text-base font-semibold text-stone-700 hover:border-amber-400 hover:text-amber-700 transition-colors"
          >
            Continue with Free
          </a>
        </div>
      </div>
    </div>
  );
}
