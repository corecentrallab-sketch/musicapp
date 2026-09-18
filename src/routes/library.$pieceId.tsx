/**
 * /library/:pieceId — public-domain piece detail with curated sheet-music
 * sources. The route loader fetches the detail server-side (SSR) so metadata
 * is in the HTML. Honesty rules from the plan: never render a link without a
 * URL, show a "coming soon" state instead of broken links when no
 * quality-checked score is available yet, and never use urgency or scarcity
 * copy. No audio previews (the catalog has none).
 *
 * Monetization (owner direction 09-18 — the site must make consistent money,
 * practice engagement -> affiliate purchases): EVERY piece page carries a
 * "Get the official sheet music" CTA to Sheet Music Direct (affiliate ID 67650,
 * primary) — rendered with the same visual weight whether or not we hold a score
 * of our own, because the ~85% of pieces without one are exactly where the
 * official edition is the only thing we can honestly offer. The URL comes from
 * the catalog API's shared `affiliate_url` field when present, else from the same
 * pure builder (`piece-affiliate.ts`) the API uses — one attribution path.
 *
 * WAVE 1b adds the practice/engagement layer around that CTA: the reference-melody
 * player (P2 — interactive for the eight seeded pieces only, honest "coming soon"
 * everywhere else), the related-piece paths (P3 — same composer + same level), and
 * the app CTA loop (P4). All three are server-rendered from data the loader
 * fetches, so they are in the HTML for crawlers and work without client JS.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import AppCta from "~/components/AppCta";
import MelodyPlayer from "~/components/MelodyPlayer";
import PieceOfTheDay, { type DailyPiece } from "~/components/PieceOfTheDay";
import RelatedPieces from "~/components/RelatedPieces";
import SiteFooter from "~/components/SiteFooter";
import SiteNav from "~/components/SiteNav";
import {
  CATALOG_API_BASE,
  fetchCatalogList,
  fetchCatalogPiece,
  type SheetSource,
} from "~/lib/catalog-client";
import { resolvePieceMelody } from "~/services/piece-melody";
import {
  MORE_BY_COMPOSER_LIMIT,
  SAME_LEVEL_SAMPLE_LIMIT,
  pickMoreByComposer,
  pickSameLevel,
  type RelatedPieceLike,
} from "~/services/related-pieces";
import {
  SMD_RETAILER_NAME,
  pieceAffiliateLink,
  pieceAffiliateQuery,
} from "~/services/piece-affiliate";
import { SITE_URL } from "~/services/seo";

const PIECE_URL = (id: string) => `${SITE_URL}/library/${encodeURIComponent(id)}`;

/** Today's piece for the page's daily-practice widget — the same deterministic
 * selection logic and catalog pool as the homepage and the app's Daily Challenge
 * (/api/daily-challenge), called directly server-side so the widget is SSR'd into
 * the HTML (the pattern the homepage already uses). Null when the catalog is
 * unavailable; the widget then shows its honest empty state. */
const getDailyPiece = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { handleDailyChallenge } = await import(
      "~/services/daily-challenge-handler"
    );
    const res = await handleDailyChallenge(
      new Request("https://site-notesnap.vercel.app/api/daily-challenge"),
    );
    if (!res.ok) return null;
    const data = (await res.json()) as DailyPiece;
    if (!data?.piece_id || !data?.title) return null;
    return data;
  } catch (err) {
    console.error("[piece] daily piece fetch failed:", err);
    return null;
  }
});

export const Route = createFileRoute("/library/$pieceId")({
  loader: async ({ params }) => {
    const [initial, daily] = await Promise.all([
      fetchCatalogPiece(params.pieceId, CATALOG_API_BASE),
      getDailyPiece(),
    ]);
    // The API carries `affiliate_url` for every piece (one attribution path,
    // shared with the app); this local build is the fallback for an API that
    // predates the field and uses the same pure builder, so the URL is identical.
    const piece = initial.success ? initial.piece : null;
    const affiliate = piece
      ? pieceAffiliateLink(piece.title, piece.composer)
      : null;

    // Related-piece paths (P3). The public API answers two questions — "pieces by
    // this composer" and "a page of the catalog" (no difficulty filter, no
    // similarity ranking) — so both questions are asked in parallel, once, and the
    // filtering happens below in pure, tested helpers. A failure returns [] and
    // the block simply does not render: the page never waits on a nicety.
    let moreByComposer: RelatedPieceLike[] = [];
    let sameLevel: RelatedPieceLike[] = [];
    if (piece) {
      const [byComposer, levelSample] = await Promise.all([
        piece.composer.trim() === ""
          ? null
          : fetchCatalogList({
              composer: piece.composer,
              limit: MORE_BY_COMPOSER_LIMIT + 1,
              base: CATALOG_API_BASE,
            }),
        piece.difficulty_label
          ? fetchCatalogList({
              limit: SAME_LEVEL_SAMPLE_LIMIT,
              base: CATALOG_API_BASE,
            })
          : null,
      ]);
      moreByComposer =
        byComposer && byComposer.success
          ? pickMoreByComposer(byComposer.pieces, {
              currentId: piece.id,
              composer: piece.composer,
            })
          : [];
      sameLevel =
        levelSample && levelSample.success
          ? pickSameLevel(levelSample.pieces, {
              currentId: piece.id,
              difficultyLabel: piece.difficulty_label,
              excludeIds: moreByComposer.map((related) => related.id),
            })
          : [];
    }

    // Reference melody (P2): resolved by normalised title + composer — the seeds
    // carry slugs, the page carries a UUID, so an id join is impossible. Null
    // means this piece is not one of the eight seeded melodies.
    const melody = piece
      ? resolvePieceMelody({ title: piece.title, composer: piece.composer })
      : null;

    return {
      initial,
      daily,
      affiliate,
      moreByComposer,
      sameLevel,
      melodyTitle: melody?.seed.title ?? null,
      melodyAbc: melody?.abc ?? null,
    };
  },
  head: ({ loaderData }) => {
    // Dynamic per-piece SEO: title + description are built from the piece data
    // the loader fetched server-side, so they render in the initial HTML.
    const initial = loaderData?.initial;
    const piece = initial?.success ? initial.piece : null;
    const pieceId = piece?.id ?? "";
    const composer = piece?.composer?.trim() ?? "";
    const title = piece
      ? `${piece.title} Sheet Music — Free PDF${composer ? ` | ${composer}` : ""} | NoteSnap`
      : "Sheet Music | NoteSnap";
    const description = piece
      ? `Free ${piece.title} sheet music${composer ? ` by ${composer}` : ""} — download the score as a PDF, check the difficulty rating, and practice with NoteSnap's built-in tools.`
      : "Browse this piece's sheet music on NoteSnap — free public-domain scores with practice tools.";
    const ogImage =
      piece?.album_art_url && /^https?:\/\//.test(piece.album_art_url)
        ? piece.album_art_url
        : `${SITE_URL}/og-image.png`;
    const canonical = pieceId ? PIECE_URL(pieceId) : `${SITE_URL}/library`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        { property: "og:image", content: ogImage },
        {
          "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "MusicComposition",
            name: piece?.title ?? "Sheet Music",
            ...(composer
              ? { composer: { "@type": "Person", name: composer } }
              : {}),
            url: canonical,
            ...(piece?.is_public_domain === true
              ? { isAccessibleForFree: true, genre: "Classical" }
              : {}),
            ...(piece?.difficulty != null
              ? {
                  additionalProperty: {
                    "@type": "PropertyValue",
                    name: "difficulty",
                    value: String(piece.difficulty),
                  },
                }
              : {}),
          },
        },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
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

/**
 * Affiliate purchase CTA — the site's direct money path. Sheet Music Direct
 * (affiliate ID 67650) is the primary retailer; the link opens in a new tab so
 * the visitor keeps their place on the piece page. Copy states the commission
 * plainly (no urgency, no scarcity) and the label is descriptive for screen
 * readers.
 */
function AffiliateCta({
  url,
  retailer,
  query,
  hasOwnScore,
}: {
  url: string;
  retailer: string;
  query: string;
  hasOwnScore: boolean;
}) {
  return (
    <section
      aria-labelledby="official-sheet-music-heading"
      className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6"
    >
      <h2
        id="official-sheet-music-heading"
        className="text-lg font-semibold text-stone-900"
      >
        Get the official sheet music
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-stone-700">
        {hasOwnScore
          ? "Prefer a published edition to practise from? Search the licensed catalogue for this piece — printed and digital editions from the publishers."
          : "Our quality-checked score for this piece isn't ready yet, but the official published edition is available to buy — search the licensed catalogue by title and composer."}
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        aria-label={`Search ${retailer} for ${query} — official sheet music (opens in a new tab)`}
        className="mt-4 inline-flex min-h-12 items-center rounded-full bg-amber-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
      >
        Get the official sheet music →
      </a>
      <p className="mt-3 text-xs text-stone-500">
        Opens {retailer} in a new tab, searching for &ldquo;{query}&rdquo;.
        NoteSnap earns a commission on purchases — it never changes the price you
        pay, and never affects which pieces we show you.
      </p>
    </section>
  );
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
  const {
    initial,
    daily,
    affiliate,
    moreByComposer,
    sameLevel,
    melodyTitle,
    melodyAbc,
  } = Route.useLoaderData();

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

  // Shared attribution path: the API's affiliate_url wins when present; otherwise
  // the identical link is rebuilt locally by the same pure builder.
  const affiliateUrl = piece.affiliate_url ?? affiliate?.url ?? null;
  const affiliateRetailer = piece.affiliate_url
    ? SMD_RETAILER_NAME
    : (affiliate?.retailer ?? SMD_RETAILER_NAME);
  const affiliateQuery =
    affiliate?.query ?? pieceAffiliateQuery(piece.title, piece.composer);

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

        {/* Affiliate purchase CTA — every piece page, same weight with or
            without a score of our own (the money lever). */}
        {affiliateUrl ? (
          <AffiliateCta
            url={affiliateUrl}
            retailer={affiliateRetailer}
            query={affiliateQuery}
            hasOwnScore={primarySheetUrl !== null}
          />
        ) : null}

        {/* Play the melody (P2) — the engagement step: hear it, then play it.
            Interactive for the eight seeded melodies; the honest "coming soon"
            state for every other piece (no player, no placeholder tune). */}
        <MelodyPlayer
          abc={melodyAbc}
          pieceTitle={piece.title}
          seedTitle={melodyTitle ?? undefined}
        />

        {/* Related-piece paths (P3) — same composer, same level. Renders nothing
            when there is nothing honest to show. */}
        <RelatedPieces
          composer={piece.composer}
          moreByComposer={moreByComposer}
          difficultyLabel={piece.difficulty_label}
          sameLevel={sameLevel}
        />

        {/* App CTA loop (P4) — the site's practice engagement hands off to the
            app, where recognition, the coach and offline sheets live. */}
        <div className="mt-12">
          <AppCta />
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

        {/* Daily practice: the same piece in the app, one step from here. */}
        <div className="mt-12">
          <PieceOfTheDay
            daily={daily}
            currentPieceId={piece.id}
            variant="compact"
          />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
