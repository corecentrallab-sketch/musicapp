// ---------------------------------------------------------------------------
// Modern-song -> affiliate retailer URL mapping (Backlog #12).
//
// Primary retailer = Sheet Music Direct (owner decision 08-24).
// Prefer ISRC-based deep link (most precise) when we have one; else fall back
// to title+artist search. Musicnotes stays as a backup path (existing template).
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
} from "./affiliate-url-contract";

/**
 * SMD deep link. The `query` parameter carries title/artist/ISRC/catalog text on
 * SMD's live search page. The affiliate params (`tid` / `affiliateId`) are
 * appended so attribution survives the in-app WebView session.
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
  isrc?: string,
): { primary?: string; musicnotes?: string } {
  if (!title || !artist) return {};
  const byIsrc = isrc ? smdUrl(isrc) : undefined;
  const byQuery = smdUrl(`${title} ${artist}`.trim());
  return {
    primary: byIsrc || byQuery,
    musicnotes: musicnotesSearchUrl(`${title} ${artist}`),
  };
}