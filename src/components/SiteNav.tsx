/**
 * Shared top navigation for subpages (library, piece detail). Mirrors the
 * landing page nav in src/routes/index.tsx; anchors point at the home sections
 * so the same links work from any page.
 */
export default function SiteNav({ current }: { current?: "library" }) {
  const navLink =
    "transition-colors hover:text-amber-700";
  return (
    <nav className="sticky top-0 z-50 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <a href="/" className="text-xl font-bold tracking-tight text-amber-700">
          NoteSnap
        </a>
        <div className="flex items-center gap-4 text-sm font-medium text-stone-600 sm:gap-6">
          <a href="/#how-it-works" className={navLink}>
            How it works
          </a>
          <a href="/#features" className={navLink}>
            Features
          </a>
          <a href="/#pricing" className={navLink}>
            Pricing
          </a>
          <a
            href="/library"
            className={`transition-colors ${
              current === "library"
                ? "text-amber-700 font-semibold"
                : "hover:text-amber-700"
            }`}
          >
            Library
          </a>
          <a
            href="/#beta"
            className="rounded-full bg-amber-600 px-4 py-1.5 text-white transition-colors hover:bg-amber-700"
          >
            Beta
          </a>
        </div>
      </div>
    </nav>
  );
}
