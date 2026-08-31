/**
 * Shared footer for subpages. Mirrors the landing page footer in
 * src/routes/index.tsx with the Library link added.
 */
export default function SiteFooter() {
  return (
    <footer className="border-t border-stone-200 bg-white py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="text-lg font-bold tracking-tight text-amber-700">
            NoteSnap
          </span>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-stone-500">
            <a href="/#how-it-works" className="transition-colors hover:text-amber-700">
              How it works
            </a>
            <a href="/#features" className="transition-colors hover:text-amber-700">
              Features
            </a>
            <a href="/#pricing" className="transition-colors hover:text-amber-700">
              Pricing
            </a>
            <a href="/library" className="transition-colors hover:text-amber-700">
              Library
            </a>
            <a href="/privacy" className="transition-colors hover:text-amber-700">
              Privacy
            </a>
            <a href="/terms" className="transition-colors hover:text-amber-700">
              Terms
            </a>
            <a
              href="/cost"
              className="transition-colors hover:text-amber-700"
              download="notesnap-services-cost.csv"
            >
              Cost breakdown (CSV)
            </a>
          </div>
          <p className="text-xs text-stone-400">
            &copy; {new Date().getFullYear()} NoteSnap. Sheet music for musicians.
          </p>
        </div>
      </div>
    </footer>
  );
}
