// ---------------------------------------------------------------------------
// Modern-song -> affiliate retailer URL mapping (Backlog #12).
//
// Primary retailer = Sheet Music Direct (owner decision 08-24); Musicnotes stays
// as the backup path (existing template).
//
// HUMAN-READABLE TEXT ONLY — NEVER A CODE (owner on-device bug 09-22, part 2):
// this builder used to prefer an ISRC deep link. SMD's search is
// title/artist/composer facing, so the owner's phone landed on SMD with the box
// filled by a recording code (e.g. `AUAP*600001`) and SMD answered "No Results" —
// the CTA dead-ended on every match that carried an ISRC. The live route evidence
// (robots.txt ASP.NET stack + Wayback CDX: hundreds of HTTP 200 captures of
// `…/Search.aspx?query=…` carrying *title* searches, and none carrying a code) is
// in `affiliate-url-contract.ts`. `modernRetailerUrls()` therefore returns NO link
// at all when all it has is a code — a degraded state beats a retailer page that
// says "No Results".
//
// SMD QUERY IS THE TITLE ALONE — DO NOT RE-ADD THE ARTIST (owner on-device bug
// 09-23). After the ISRC fix the owner STILL got SMD's zero-result page on popular
// modern songs, because the SMD `query` was `"<title> <artist>"`: SMD's matcher
// scores ~0 for extra tokens (a 4-token query returns a handful of hits — 6 for
// `Ed Sheeran & Elton John`), and SMD carries the songs themselves (2024 capture
// `perfect ed sheeran` → "Showing 1 to 25 of 1944 results", 29 arrangements; the
// zero-result page is SMD's own "Sorry, we did not find any results for that
// search phrase…"). Evidence + archived raw HTML:
// `/home/team/shared/SMD-NO-RESULTS-INVESTIGATION-2026-09-23.md`. A title-only
// query is what SMD's index wants, so the primary link uses the title ONLY.
// Adding the artist back "to be more precise" is exactly the regression this
// change removes — the tests below assert the artist string never reaches the SMD
// search box.
//
// AND THE TITLE IS BRACKET-NOISE-STRIPPED (owner on-device bug 09-23, part 2).
// Title-only is necessary but not sufficient: the owner's song came back from the
// provider as `Bang a Gong (Get it on) [2003 Remaster]` (T. Rex), and a
// bracketed edition/remaster suffix is vendor metadata, not part of the title —
// SMD's token matcher scores ~0 for those extra bracketed tokens, and SMD's own
// catalogue titles the song `Get It On (Bang a Gong)`. `cleanSmdQuery()` therefore
// drops every `[ ... ]` section and collapses whitespace before the title reaches
// SMD, while KEEPING parenthesised content (real titles legitimately contain it:
// `(I Can't Get No) Satisfaction`, `Bang a Gong (Get It On)`). Evidence:
// `/home/team/shared/SMD-NO-RESULTS-INVESTIGATION-2026-09-23.md`. The bare-code
// guard runs on the CLEANED string, so `[2003 Remaster]` alone degrades to no link.
//
// AND RELEASE METADATA GOES TOO — PARENS INCLUDED (owner on-device bugs 09-25,
// RC v26 Test 4a finding #2/#3 and Test 5). Bracket stripping was necessary but
// still not sufficient:
//   * `More Than This (2003 Digital Remaster)` (Roxy Music) — a WIDELY SOLD
//     digital sheet-music title — scored SMD's own zero-result page; dropping the
//     parenthetical is the difference between a sale and a dead end.
//   * `Just One More Day - Live at the Whisky a Go Go, 1966` (the exact title on
//     the owner's card) had the same effect via a spaced-dash venue tail.
// `cleanSmdQuery()` now also drops parenthetical sections that carry a metadata
// marker or a 4-digit year, and cuts a spaced-dash tail at the first noisy
// segment — while KEEPING title-bearing parens (`(I Can't Get No)`, `(Get It On)`)
// and keeping the whole string when no later segment matches (a real `A - B`
// duet is never over-stripped). Evidence: `/home/team/shared/RC-V26-RESULTS.md`.
//
// The Musicnotes BACKUP link keeps `"<title> <artist>"` (its own search handles
// both tokens) — but its title half is cleaned the same way and the URL carries
// NO `w` parameter: on the owner's phone Musicnotes read `w=NoteSnap` AS the
// query and searched the literal word "NoteSnap" (owner 09-25, finding #3). The
// tag carried no commission (SMD carries the affiliate ID), so it is deleted;
// `affiliate-url-contract.ts` holds a source scan that fails if it returns.
//
// AFFILIATE ACCOUNT (owner relayed 09-14): Sheet Music Direct approved
// Affiliate ID 67650 — MUST be embedded in every SMD link so each click is
// commission-attributable.
//
// Attribution params: `tid` is the Hal Leonard affiliate click-id param
// (Sheet Music Direct is a Hal Leonard platform and this was the format this
// builder originally used); `affiliateId` is SMD's own documented affiliate
// link param. Both carry the same ID so attribution holds regardless of which
// the programme reads. If the owner's SMD dashboard shows a different param
// name, drop the redundant one here (one line + test update).
//
// ROUTE FIX (owner on-device bug 09-22): this builder used to emit a lowercase
// `/search` path carrying a `searchText` parameter — a route SMD does not serve
// (nginx 500 at the origin; on the owner's phone the CTA landed on SMD's own
// "Page Not Found … you appear to have found something broken on our website"
// page plus a Log In page). The live route + parameter are probe-verified and
// pinned in `affiliate-url-contract.ts`, together with the exact retired strings
// (real archived SMD search URLs, newest 2025-09-17, HTTP 200). That contract
// module is the ONLY file allowed to name the dead route; a source scan in
// `affiliate-url-contract.test.ts` fails the build if it reappears here or
// anywhere else under src/. Never hand-write an SMD URL anywhere else — build it
// here so every surface stays affiliate-attributed.
// ---------------------------------------------------------------------------
import {
  SMD_AFFILIATE_ID,
  SMD_SEARCH_PATH,
  SMD_SEARCH_ORIGIN,
  SMD_SEARCH_QUERY_PARAM,
  looksLikeBareCatalogCode,
} from "./affiliate-url-contract";

/**
 * Metadata markers that never belong in a retailer search box. A trailing
 * `- Live at the Whisky a Go Go, 1966` or `(2003 Digital Remaster)` is release
 * metadata, not the song title, and SMD's token matcher scores it to zero.
 *
 * Deliberately CONSERVATIVE (owner-proven cases only + unambiguous equivalents):
 * a marker only ever removes a *parenthetical section* or a *spaced-dash tail*,
 * never a bare word inside the title, and a missed marker merely leaves the
 * query slightly noisy (the old behaviour) while a false positive would delete a
 * real title. Markers whose word appears in real titles ("take", "session") are
 * excluded for that reason.
 */
const RETAILER_METADATA_MARKER =
  /\b(?:live|remaster(?:ed)?|deluxe|feat|featuring|edition|demo|acoustic|anniversary|reissue|remix|mix|mono|stereo|instrumental|karaoke|version|bonus|expanded)\b/i;
/** A 4-digit release year (19xx / 20xx) — `(1966)`, `- Live …, 1966`. */
const RETAILER_METADATA_YEAR = /\b(?:19|20)\d{2}\b/;

/** True when a title section/tail is release metadata rather than title text. */
export function isRetailerMetadataNoise(section: string): boolean {
  return (
    RETAILER_METADATA_MARKER.test(section) || RETAILER_METADATA_YEAR.test(section)
  );
}

/** Split a title on a spaced dash (` - `, ` – `, ` — `) — the venue-tail form. */
const SPACED_DASH = /\s+[-\u2013\u2014]\s+/;

/**
 * Clean a song title for a retailer search box: strip release metadata, then
 * normalise whitespace.
 *
 * History (each rule exists because the owner hit it on device):
 *  - 09-23 part 2: `Bang a Gong (Get it on) [2003 Remaster]` arrived with a
 *    bracketed edition suffix, which alone pushes SMD's token matcher to zero
 *    results → every `[ ... ]` section is removed.
 *  - 09-25: `More Than This (2003 Digital Remaster)` (Roxy Music) — a SALABLE
 *    song — scored zero results for the same reason, and
 *    `Just One More Day - Live at the Whisky a Go Go, 1966` (the owner's card
 *    text, dash form) did too. See `/home/team/shared/RC-V26-RESULTS.md`
 *    (Test 4a / Test 5).
 *
 * Rules, in order:
 *  1. every `[ ... ]` section is removed outright (edition/bracket metadata);
 *  2. a `( ... )` section is removed when it contains a metadata marker or a
 *   4-digit year (`(2003 Digital Remaster)`, `(Live at the Whisky a Go Go, 1966)`,
 *   `(1966)`) while title-bearing parens are KEPT (`(I Can't Get No)`,
 *   `(Get It On)`, `(Sittin' On)`);
 *  3. a spaced-dash tail is cut at the FIRST later segment that carries a
 *   metadata marker or a year (`Just One More Day - Live at the Whisky a Go Go,
 *   1966` → `Just One More Day`); when no later segment matches, the whole
 *   string is kept, so a real `A - B` duet title is never over-stripped;
 *  4. whitespace runs collapse to one space and the ends are trimmed.
 *
 * Safe to hand any string: no metadata in, no change out. Used for the SMD
 * primary query AND for the title half of the Musicnotes backup query (owner
 * 09-25: the backup must never carry a venue tail either — its own engine reads
 * `-` tokens as operators and returned an unrelated result).
 */
export function cleanSmdQuery(title: string): string {
  // 1 + 2: bracket sections always go; parenthesised metadata goes.
  let cleaned = title
    // Replaced by a SPACE (not "") so a title that runs straight into a bracket
    // does not fuse two words together.
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(([^)]*)\)/g, (whole, inner: string) =>
      isRetailerMetadataNoise(inner) ? " " : whole,
    );

  // 3: cut a metadata tail at the first noisy later segment.
  const segments = cleaned.split(SPACED_DASH);
  if (segments.length > 1) {
    const cutAt = segments.findIndex(
      (segment, index) => index > 0 && isRetailerMetadataNoise(segment),
    );
    if (cutAt > 0) cleaned = segments.slice(0, cutAt).join(" - ");
  }

  // 4: normalise.
  return cleaned.replace(/\s+/g, " ").replace(/^[\s-]+|[\s-]+$/g, "").trim();
}

/**
 * SMD deep link. The `query` parameter carries the shopper's own words — a title,
 * artist and/or composer, never a catalogue/recording code (see the file header).
 * The affiliate params (`tid` / `affiliateId`) are appended so attribution
 * survives the in-app WebView session.
 */
function smdUrl(query: string): string {
  const q = encodeURIComponent(query);
  return (
    `${SMD_SEARCH_ORIGIN}${SMD_SEARCH_PATH}?${SMD_SEARCH_QUERY_PARAM}=${q}` +
    `&tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}`
  );
}

/**
 * SMD deep link for a free-text query (title / composer / "title composer"),
 * or undefined when there is nothing to search for. Exported so every surface
 * that links to a retailer — the modern-song route and the catalog/piece pages —
 * builds the URL through this one function and therefore always carries the
 * affiliate ID (one attribution path, WAVE 1a).
 */
export function sheetMusicDirectSearchUrl(query: string): string | undefined {
  const q = query.trim();
  return q === "" ? undefined : smdUrl(q);
}

/**
 * ---------------------------------------------------------------------------
 * Musicnotes backup link — the ONE shape, and never a `w` parameter
 * ---------------------------------------------------------------------------
 * Owner on-device bug 2026-09-25 (RC v26 Test 4a finding #3 + Test 5): the
 * backup URL used to end with the tag `w=NoteSnap` (a "referrer tag" nobody ever
 * passed to Musicnotes' engine). Musicnotes' search page reads `w` as ITS query — on the
 * owner's phone the search box literally showed "NoteSnap" and the engine
 * searched the word "NoteSnap", returning one irrelevant fuzzy result
 * ("Sockerfens dans") instead of Otis Redding. The song query never reached the
 * engine. The same template would have broken the Musicnotes links on all 528
 * piece pages at publish.
 *
 * There is NO affiliate attribution on this link (Sheet Music Direct carries the
 * affiliate ID 67650), so the tag bought nothing — the parameter is deleted
 * outright, and `scanSourcesForNoteSnapReferrerTag()` (in
 * `affiliate-url-contract.ts`) fails the gate if `w=NoteSnap` or a second
 * hand-written Musicnotes URL builder ever reappears under `src/`.
 */
export const MUSICNOTES_SEARCH_ORIGIN = "https://www.musicnotes.com";
export const MUSICNOTES_SEARCH_PATH = "/search/go";
export const MUSICNOTES_SEARCH_QUERY_PARAM = "q";

/** The single Musicnotes search template, for the affiliate registry. */
export function musicnotesSearchUrlTemplate(): string {
  return `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}?${MUSICNOTES_SEARCH_QUERY_PARAM}={{query}}`;
}

/** Musicnotes search link for a free-text query — the backup retailer path. */
export function musicnotesSearchUrl(query: string): string | undefined {
  const q = query.trim();
  return q === ""
    ? undefined
    : `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}?${MUSICNOTES_SEARCH_QUERY_PARAM}=${encodeURIComponent(q)}`;
}

export function modernRetailerUrls(
  title: string,
  artist: string,
  // Accepted and DELIBERATELY IGNORED — a recording code must never become a
  // retailer search query (`_`-prefixed so the unused parameter is explicit; the
  // call site keeps passing it so the decision is visible in review). The code
  // still travels to the app inside the match for display/diagnostics.
  _isrc?: string,
): { primary?: string; musicnotes?: string } {
  if (!title || !artist) return {};
  // The SMD search box gets the TITLE ALONE (09-23, see the file header): extra
  // tokens narrow SMD's result set to nothing on many popular songs. The artist
  // is still required above (unchanged contract: no match metadata at all -> no
  // link), but it is NOT part of the primary query — the tests assert it never
  // appears in the SMD URL.
  // ... and the title is bracket-noise-stripped first (09-23, part 2): the
  // provider hands back edition metadata such as `[2003 Remaster]`, which SMD's
  // matcher scores to zero. Parenthesised title content is kept.
  const titleQuery = cleanSmdQuery(title);
  // A code can reach here only through junk vendor metadata (a code in the title
  // field) — it is not something a retailer can search. Emit nothing and let the
  // caller show its honest degraded state instead of an SMD page whose answer is
  // "No Results" (the owner's on-device bug). The guard runs on the CLEANED
  // string, so a bracket-only title (`[2003 Remaster]`) cleans to "" and a
  // bracket-wrapped code still stops here.
  if (titleQuery === "" || looksLikeBareCatalogCode(titleQuery)) return {};
  return {
    // ALWAYS the human-readable TITLE, built by the shared builder so the
    // affiliate ID travels with it. There is no by-code branch any more.
    primary: sheetMusicDirectSearchUrl(titleQuery),
    // Backup retailer for the app's secondary CTA (owner-approved: Musicnotes).
    // Query = the CLEANED title + the artist (owner on-device bug 09-25, finding
    // #2): the raw title carried the venue tail
    // (`Just One More Day - Live at the Whisky a Go Go, 1966`) and Musicnotes'
    // engine reads `-` tokens as operators, returning an unrelated result. Both
    // tokens are kept — Musicnotes' multi-token search handles them — but the
    // title half is metadata-stripped exactly like the SMD primary.
    // Carries NO SMD params and no affiliate ID — it is not our SMD link.
    musicnotes: musicnotesSearchUrl(`${cleanSmdQuery(title)} ${artist}`.trim()),
  };
}
