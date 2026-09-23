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
// The Musicnotes BACKUP link is deliberately unchanged: Musicnotes' search handles
// `"<title> <artist>"` well, and it is the fallback for songs SMD scores badly.
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
 * Clean a song title for the SMD search box: strip edition/bracket noise, then
 * normalise whitespace (owner on-device bug 09-23, part 2 — the owner's match came
 * back as `Bang a Gong (Get it on) [2003 Remaster]` and the bracketed edition
 * suffix alone is enough to push SMD's token matcher to zero results; see the file
 * header and `/home/team/shared/SMD-NO-RESULTS-INVESTIGATION-2026-09-23.md`).
 *
 * Rules, deliberately narrow:
 *  - every `[ ... ]` section is removed outright (remaster / live / deluxe edition
 *    / `[feat. X]` style metadata — never part of the title SMD indexes);
 *  - parenthesised content is KEPT: real titles legitimately contain it
 *    (`(I Can't Get No) Satisfaction`, `Bang a Gong (Get It On)`);
 *  - internal whitespace runs collapse to one space, and the ends are trimmed.
 *
 * Safe to hand any string: no brackets in, no change out. Exported so the query
 * contract is testable directly (and only ever used for the SMD primary query —
 * the Musicnotes backup keeps the untouched title+artist).
 */
export function cleanSmdQuery(title: string): string {
  return (
    title
      // Bracket sections go entirely. Replaced by a SPACE (not "") so a title that
      // runs straight into a bracket does not fuse two words together.
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
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

/** Musicnotes search link for a free-text query — the backup retailer path. */
export function musicnotesSearchUrl(query: string): string | undefined {
  const q = query.trim();
  return q === ""
    ? undefined
    : `https://www.musicnotes.com/search/go?q=${encodeURIComponent(q)}&w=NoteSnap`;
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
    // Unchanged: the RAW title+artist — Musicnotes' search handles both tokens,
    // and its query is deliberately NOT passed through the SMD cleaner.
    // Carries NO SMD params and no affiliate ID — it is not our SMD link.
    musicnotes: musicnotesSearchUrl(`${title} ${artist}`.trim()),
  };
}
