/**
 * /library — browse and search the public-domain catalog.
 *
 * The route loader fetches the first page server-side (SSR) so the initial
 * results are in the HTML; search and "load more" run client-side against the
 * same public API (same-origin /api/pieces in the browser).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState, type FormEvent } from "react";
import SiteFooter from "~/components/SiteFooter";
import SiteNav from "~/components/SiteNav";
import {
  CATALOG_API_BASE,
  fetchCatalogList,
  type CatalogPiece,
} from "~/lib/catalog-client";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/library")({
  loader: async () => {
    const initial = await fetchCatalogList({
      limit: PAGE_SIZE,
      offset: 0,
      base: CATALOG_API_BASE,
    });
    return { initial };
  },
  head: () => ({
    meta: [
      {
        title:
          "Sheet Music Library — 500+ Free Public-Domain Classical Scores | NoteSnap",
      },
      {
        name: "description",
        content:
          "Browse NoteSnap's free sheet music library: 500+ public-domain classical scores for piano and guitar, ready to play with difficulty ratings. Download free PDFs of works by Bach, Beethoven, Mozart, Debussy, Chopin and more.",
      },
      {
        property: "og:title",
        content: "Sheet Music Library — Free Public-Domain Classical Scores | NoteSnap",
      },
      {
        property: "og:description",
        content:
          "500+ free public-domain classical scores for piano and guitar. Browse by composer, see difficulty ratings, and open any score instantly.",
      },
      { property: "og:url", content: "https://site-notesnap.vercel.app/library" },
    ],
    links: [{ rel: "canonical", href: "https://site-notesnap.vercel.app/library" }],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const { initial } = Route.useLoaderData();
  const [pieces, setPieces] = useState<CatalogPiece[]>(
    initial.success ? initial.pieces : [],
  );
  const [total, setTotal] = useState<number>(
    initial.success ? initial.total : 0,
  );
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(
    initial.success ? null : initial.error,
  );
  const requestRef = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    const result = await fetchCatalogList({ q, limit: PAGE_SIZE, offset: 0 });
    if (requestId !== requestRef.current) return; // superseded by a newer request
    setLoading(false);
    if (result.success) {
      setPieces(result.pieces);
      setTotal(result.total);
      setAppliedQuery(q);
    } else {
      setError(result.error);
    }
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void runSearch(query.trim());
    },
    [query, runSearch],
  );

  const handleRetry = useCallback(() => {
    void runSearch(appliedQuery);
  }, [appliedQuery, runSearch]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const requestId = requestRef.current;
    setLoadingMore(true);
    const result = await fetchCatalogList({
      q: appliedQuery,
      limit: PAGE_SIZE,
      offset: pieces.length,
    });
    setLoadingMore(false);
    if (requestId !== requestRef.current) return;
    if (result.success) {
      setPieces((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const fresh = result.pieces.filter((p) => !seen.has(p.id));
        return [...prev, ...fresh];
      });
      setTotal(result.total);
    } else {
      setError(result.error);
    }
  }, [appliedQuery, loadingMore, pieces.length]);

  const hasMore = pieces.length < total;
  const summary =
    appliedQuery !== ""
      ? `${pieces.length} of ${total} match${total === 1 ? "" : "es"} for "${appliedQuery}"`
      : `${total} public-domain piece${total === 1 ? "" : "s"}`;

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased">
      <SiteNav current="library" />

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
          Free sheet music library
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          Browse the library
        </h1>
        <p className="mt-3 max-w-2xl text-stone-600 leading-relaxed">
          Public-domain classical works with typeset, quality-checked scores.
          Search by title or composer — every score is hosted by NoteSnap and
          free to view.
        </p>

        {/* Search */}
        <form
          onSubmit={handleSubmit}
          role="search"
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or composer…"
            aria-label="Search the library by title or composer"
            className="min-h-12 flex-1 rounded-full border border-stone-300 bg-white px-5 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-amber-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Search
          </button>
        </form>

        {error ? (
          <div
            className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 text-center"
            role="alert"
          >
            <p className="text-stone-700">{error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-4 rounded-full border border-stone-300 px-5 py-2 text-sm font-semibold text-stone-700 transition-colors hover:border-amber-400 hover:text-amber-700"
            >
              Try again
            </button>
          </div>
        ) : null}

        {!error && !loading ? (
          <p className="mt-6 text-sm text-stone-500" aria-live="polite">
            {summary}
          </p>
        ) : null}

        {/* Loading (first search) */}
        {loading ? (
          <p
            className="mt-10 flex items-center gap-2 text-sm text-stone-600"
            aria-live="polite"
          >
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-amber-600" />
            Loading…
          </p>
        ) : null}

        {/* Results */}
        {!loading && !error ? (
          pieces.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
              <span className="text-3xl">🎼</span>
              <h2 className="mt-4 text-lg font-semibold text-stone-900">
                No matches — try another composer
              </h2>
              <p className="mt-2 text-sm text-stone-500">
                The library currently covers public-domain classical works. Try
                &ldquo;Bach&rdquo;, &ldquo;Mozart&rdquo;, or &ldquo;Clair de
                Lune&rdquo;.
              </p>
            </div>
          ) : (
            <ul className="mt-6 space-y-4">
              {pieces.map((piece) => (
                <li key={piece.id}>
                  <article className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      {piece.album_art_url ? (
                        <img
                          src={piece.album_art_url}
                          alt=""
                          loading="lazy"
                          className="h-14 w-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-xl">
                          🎵
                        </span>
                      )}
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-stone-900">
                          <a
                            href={`/library/${piece.id}`}
                            className="transition-colors hover:text-amber-700"
                          >
                            {piece.title}
                          </a>
                        </h3>
                        {piece.composer ? (
                          <p className="truncate text-sm text-stone-600">
                            {piece.composer}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          {piece.difficulty_label ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-700">
                              {piece.difficulty_label}
                            </span>
                          ) : null}
                          {piece.catalog ? (
                            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">
                              {piece.catalog}
                            </span>
                          ) : null}
                          <span className="text-stone-400">Public domain</span>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {piece.sheet_music_available && piece.sheet_music_url ? (
                        <a
                          href={piece.sheet_music_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-10 items-center rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
                        >
                          View sheet →
                        </a>
                      ) : (
                        <span className="text-sm text-stone-400">
                          Score coming soon
                        </span>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {/* Load more */}
        {!loading && !error && hasMore ? (
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="inline-flex min-h-11 items-center rounded-full border border-stone-300 px-6 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:border-amber-400 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </main>

      <SiteFooter />
    </div>
  );
}
