/**
 * searchExternal.ts — the EXTERNAL half of the "Find a piece" search box.
 *
 * OWNER DIRECTION (10-01, verbatim intent): "the search box below (search by
 * title or composer) only shows internal library songs. The front page search box
 * should show results for everything in both internal results of search and
 * external affiliate results for search from notesnap if searching for a
 * song/sheet music piece." The ratified scope behind it (plan, 09-28):
 * "any search in NoteSnap should not be a dead end — it should lead to a money
 * path." So the box now searches TWO places at once:
 *
 *   1. our own public-domain / classical catalog (`GET /api/pieces?q=`), which is
 *      unchanged and still listed FIRST — it is the free, in-app offer; and
 *   2. the licensed retailers, via an affiliate deep link built from the user's
 *      own words — the money path for a song we do not (and may never) hold.
 *
 * The no-dead-end rule, stated as code: `externalSearchSection()` returns a
 * VISIBLE section for any non-empty query, whether the catalog answered with 50
 * pieces, with one, or with none. "Fields of Gold" finds nothing in our PD
 * library — that is exactly the query this section exists for. An empty query
 * renders nothing (there is nothing to search for).
 *
 * WHERE THE URLS COME FROM (source of truth, verified 10-01):
 * the ONE SMD deep-link builder in the codebase is the backend's
 * `sheetMusicDirectSearchUrl()` in the site repo
 * (`src/services/modern-retailer.ts`), which is what every app-side purchase URL
 * is built from — the app has never hand-written a retailer URL (`types/index.ts`:
 * `sheetmusicdirect` / `musicnotes` are "built by the backend, never by the app").
 * The backend has NO free-text search endpoint (only `/api/recognize-modern`,
 * which needs audio), so the search box cannot ask the backend for this URL. This
 * module therefore MIRRORS the backend builder byte for byte — route, parameter
 * and affiliate id — and `searchExternalContract.ts` pins exactly that shape on
 * the real source, so the mirror cannot drift silently:
 *
 *   • SMD (PRIMARY, affiliate id 67650, PR #118 shape / PR #122 title-only query):
 *     `https://www.sheetmusicdirect.com/en-US/Search.aspx?query=<q>&tid=67650&affiliateId=67650`
 *   • Musicnotes (secondary, UX-only — no affiliate program; retired
 *     `/search/go?q=` route + `w=NoteSnap` tag are NEVER used again, see
 *     fc19fe16): `https://www.musicnotes.com/search?w=<q>`
 *
 * The query is the shopper's own words — a title, a composer, or both, never a
 * catalogue/recording code (the owner's 09-22 "No Results" bug), and we never add
 * an artist token the user did not type (the 09-23 SMD zero-result bug: SMD's
 * matcher scores ~0 for extra tokens).
 *
 * WE HOST NOTHING. Both links open the retailer's owned page (which carries its
 * own previews and its own checkout) inside our in-app shell, on an explicit tap
 * only — never an auto-redirect, per the owner's 08-24 rule and the same
 * no-auto-redirect contract the modern-song interstitial follows.
 *
 * Pure by design — no react / react-native / expo / fs imports — so the tier1
 * gate compiles and runs it under plain Node (tsconfig.tier1.json).
 */

/** Sheet Music Direct origin (the URL builder's only host — PR #118). */
export const SMD_SEARCH_ORIGIN = 'https://www.sheetmusicdirect.com';
/** The live SMD search route (retailer-copy contract, re-probed 09-24/09-28). */
export const SMD_SEARCH_PATH = '/en-US/Search.aspx';
/** SMD's search parameter — the user's own words, never a code. */
export const SMD_SEARCH_QUERY_PARAM = 'query';
/** Our approved SMD affiliate id (owner 09-14: PRIMARY paying retailer, 10%). */
export const SMD_AFFILIATE_ID = '67650';

/** Musicnotes origin — the secondary CTA's host. */
export const MUSICNOTES_SEARCH_ORIGIN = 'https://www.musicnotes.com';
/** Musicnotes' live search path (`/search/go` is retired — fc19fe16). */
export const MUSICNOTES_SEARCH_PATH = '/search';
/** Musicnotes' own search field name (NOT a referrer tag: `w=NoteSnap` was the bug). */
export const MUSICNOTES_SEARCH_QUERY_PARAM = 'w';

/** Above this the query is not a search, it is a paste — trim it down. */
export const MAX_EXTERNAL_QUERY_LENGTH = 120;

/** Section heading — the offer, in the owner's words. */
export const EXTERNAL_SECTION_TITLE = 'Official sheet music';
/** Honest one-liner under the heading. */
export const EXTERNAL_SECTION_NOTE =
  'From licensed retailers — we open their store inside NoteSnap and never host these scores.';
/** The primary card (SMD, the paying affiliate). */
export const EXTERNAL_SMD_CTA_LABEL = 'Search Sheet Music Direct';
/** The secondary card (Musicnotes, UX-only — same pattern as the modern card). */
export const EXTERNAL_MUSICNOTES_CTA_LABEL = 'Try Musicnotes';
/** Shown under the internal "No match" state — the no-dead-end promise. */
export const EXTERNAL_NO_MATCH_HINT =
  'Not in our free library? Search the licensed retailers below for the official sheet music.';
/** Line under the cards (we host nothing, we claim nothing). */
export const EXTERNAL_HOSTING_NOTE =
  'NoteSnap never hosts or distributes copyrighted sheet music — these open the retailer’s own pages.';

/** Subtitle when the catalog matched nothing for this query. */
export const EXTERNAL_SUBTITLE_NO_INTERNAL =
  'Not in our free library — search the retailers for the official edition.';
/** Subtitle when the catalog DID match (the retailers sit alongside our own scores). */
export const EXTERNAL_SUBTITLE_WITH_INTERNAL =
  'Also available as official sheet music from licensed retailers.';

/**
 * Normalise what the user typed into what we hand a retailer.
 *
 * Deliberately MINIMAL: the user typed these words and sees them again on the
 * card, so we do not rewrite their title (the backend's `cleanSmdQuery()` strips
 * release metadata from a *provider* title — the user's own typed query has no
 * vendor suffix to strip, and stripping parentheses here would mangle a real
 * title like `(I Can't Get No) Satisfaction`). Only the two things that are
 * certainly wrong: surrounding whitespace (the search box posts on settle) and a
 * whitespace run from a paste.
 */
export function normalizeSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_EXTERNAL_QUERY_LENGTH).trim();
}

/**
 * The SMD deep link for a free-text query, or undefined when there is nothing to
 * search for. Mirrors the backend's `sheetMusicDirectSearchUrl()` exactly
 * (`?query=<encoded>&tid=67650&affiliateId=67650`).
 */
export function sheetMusicDirectSearchUrl(raw: unknown): string | undefined {
  const q = normalizeSearchQuery(raw);
  if (q === '') return undefined;
  return (
    `${SMD_SEARCH_ORIGIN}${SMD_SEARCH_PATH}?${SMD_SEARCH_QUERY_PARAM}=${encodeURIComponent(q)}` +
    `&tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}`
  );
}

/**
 * The Musicnotes search URL for a free-text query (UX-only CTA — Musicnotes has
 * no affiliate program), or undefined when there is nothing to search for.
 * Live shape only: `/search?w=<q>`.
 */
export function musicnotesSearchUrl(raw: unknown): string | undefined {
  const q = normalizeSearchQuery(raw);
  if (q === '') return undefined;
  return `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}?${MUSICNOTES_SEARCH_QUERY_PARAM}=${encodeURIComponent(q)}`;
}

/** Everything the external section needs to render (or not) — pure data. */
export interface ExternalSearchSection {
  /** True when the query is non-empty, i.e. when the section must render. */
  visible: boolean;
  /** The normalised query the links were built from (echoed back on the card). */
  query: string;
  /** How many internal catalog matches this query had (0 = the no-dead-end case). */
  internalMatchCount: number;
  /** The PRIMARY licensed retailer link (Sheet Music Direct, affiliate 67650). */
  smdUrl?: string;
  /** The secondary Musicnotes search link (UX-only). */
  musicnotesUrl?: string;
  /** True when the secondary CTA is rendered (it must differ from the primary). */
  showMusicnotes: boolean;
  /** Honest subtitle for this query/result combination. */
  subtitle: string;
}

/**
 * THE decision the search screen renders from — and the no-dead-end guarantee in
 * one place: visibility depends on the QUERY alone, never on whether our own
 * catalog matched. A zero-match query ("Fields of Gold") still resolves to the
 * money path; an empty query renders nothing at all.
 *
 * `internalMatchCount` is used for candour, not for gating: with matches the
 * section says "also available", with none it says "not in our free library".
 */
export function externalSearchSection(
  rawQuery: unknown,
  internalMatchCount = 0,
): ExternalSearchSection {
  const query = normalizeSearchQuery(rawQuery);
  const smdUrl = sheetMusicDirectSearchUrl(query);
  const musicnotesUrl = musicnotesSearchUrl(query);
  const visible = query !== '' && !!smdUrl;
  const matches =
    typeof internalMatchCount === 'number' && internalMatchCount > 0
      ? Math.floor(internalMatchCount)
      : 0;
  return {
    visible,
    query,
    internalMatchCount: matches,
    smdUrl,
    musicnotesUrl,
    // "when it differs from the primary": the two retailers are different
    // destinations by construction, so the CTA renders whenever both links
    // exist. The comparison is kept so a future alias (same origin/route) drops
    // the redundant button instead of offering the same page twice.
    showMusicnotes: visible && !!musicnotesUrl && musicnotesUrl !== smdUrl,
    subtitle:
      matches > 0
        ? EXTERNAL_SUBTITLE_WITH_INTERNAL
        : EXTERNAL_SUBTITLE_NO_INTERNAL,
  };
}
