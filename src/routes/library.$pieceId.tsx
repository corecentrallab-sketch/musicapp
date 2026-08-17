/**
 * /library/:pieceId — public-domain piece detail with curated sheet-music
 * sources. The route loader fetches the detail server-side (SSR) so metadata
 * is in the HTML. Honesty rules from the plan: never render a link without a
 * URL, and show a "coming soon" state instead of broken links when no
 * quality-checked score is available yet. No audio previews (the catalog has
 * none).
 */
import { createFileRoute } from "@tanstack/react-router";
import SiteFooter from "~/components/SiteFooter";
import SiteNav from "~/components/SiteNav";
import {
  CATALOG_API_BASE,
  fetchCatalogPiece,
  type SheetSource,
} from "~/lib/catalog-client";

export const Route = createFileRoute("/library/$pieceId")({
  loader: async ({ params }) => {
    const initial = await fetchCatalogPiece(params.pieceId, CATALOG_API_BASE);
    return { initial };
  },
  component: PieceDetailPage,
});

function capitalize(value: string): string {
  if (value === "") return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatScore(value: number | null): string | null {
  if (value == null) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function SourceRow({ source }: { source: SheetSource }) {
  const hasUrl = source.source_url !== "";
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-stone-900">
            {capitalize(source.arrangement_type || "Arrangement")}
          </h3>
          {source.is_primary ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              Primary
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-stone-600">
          Source: {capitalize(source.source_platform || "curated library")}
          {source.format !== "" ? ` · ${source.format.toUpperCase()}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {source.curation_score != null ? (
            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">
              Curation {formatScore(source.curation_score)}
            </span>
          ) : null}
          {source.rating != null ? (
            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">
              ★ {formatScore(source.rating)}
              {source.vote_count != null ? ` (${source.vote_count})` : ""}
            </span>
          ) : null}
        </div>
      </div>
      {hasUrl ? (
        <a
          href={source.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition-colors hover:border-amber-400 hover:text-amber-700"
        >
          View score →
        </a>
      ) : null}
    </li>
  );
}

function PieceDetailPage() {
  const { initial } = Route.useLoaderData();

  if (!initial.success) {
    const error = initial.error;
    return (
      <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased">
        <SiteNav />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <a
            href="/library"
            className="text-sm text-amber-600 transition-colors hover:text-amber-700"
          >
            ← Back to the library
          </a>
          <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
            <span className="text-3xl">🎼</span>
            <h1 className="mt-4 text-xl font-semibold text-stone-900">
              We couldn&rsquo;t find that piece
            </h1>
            <p className="mt-2 text-sm text-stone-500">
              {error === "piece not found"
                ? "It may have been removed, or the link is wrong."
                : error}
            </p>
            <a
              href="/library"
              className="mt-6 inline-block rounded-full bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
            >
              Browse the library
            </a>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const piece = initial.piece;

  const primarySheetUrl =
    piece.sheet_music_available && piece.sheet_music_url
      ? piece.sheet_music_url
      : null;
  const viewableSources = piece.sheet_music_sources.filter(
    (source) => source.source_url !== "",
  );

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased">
      <SiteNav current="library" />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <a
          href="/library"
          className="text-sm text-amber-600 transition-colors hover:text-amber-700"
        >
          ← Back to the library
        </a>

        {/* Metadata */}
        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
          {piece.album_art_url ? (
            <img
              src={piece.album_art_url}
              alt=""
              loading="lazy"
              className="h-24 w-24 shrink-0 rounded-2xl object-cover shadow-sm"
            />
          ) : (
            <span className="inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-4xl">
              🎵
            </span>
          )}
          <div className="min-w-0">
            <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Public domain
            </span>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
              {piece.title}
            </h1>
            {piece.composer ? (
              <p className="mt-1 text-lg text-stone-600">{piece.composer}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
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
            </div>
          </div>
        </div>

        {/* Primary sheet action */}
        <div className="mt-8">
          {primarySheetUrl ? (
            <a
              href={primarySheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center rounded-full bg-amber-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
            >
              View sheet music →
            </a>
          ) : (
            <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
              <span className="font-medium text-stone-800">Score coming soon</span>{" "}
              — this public-domain piece isn&rsquo;t in our quality-checked
              library yet. We&rsquo;re adding typeset, curated scores
              continuously.
            </div>
          )}
        </div>

        {/* Curated sources */}
        <section className="mt-12">
          <h2 className="text-xl font-bold tracking-tight text-stone-900">
            Sheet music sources
          </h2>
          {viewableSources.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-stone-500">
                Quality-checked arrangements for this piece — all public-domain.
              </p>
              <ul className="mt-5 space-y-4">
                {viewableSources.map((source) => (
                  <SourceRow key={source.id} source={source} />
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm text-stone-500">
              No quality-checked score source is available for this piece yet.
              Check back soon.
            </p>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
