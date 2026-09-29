/**
 * Sheet Music Direct affiliate-URL contract.
 *
 * ONE place that knows what a shippable SMD search link looks like, so a dead
 * route can never come back silently. The builder in `modern-retailer.ts` must
 * construct its URL from these constants; every emitted link is checked against
 * `auditSmdAffiliateUrl()` in the test suite.
 *
 * ---------------------------------------------------------------------------
 * OWNER ON-DEVICE BUG 2026-09-22 (the reason this file exists)
 * ---------------------------------------------------------------------------
 * The builder shipped `https://www.sheetmusicdirect.com/en-US/search?searchText=…`.
 * That route does not exist on SMD's ASP.NET stack: on the owner's device the
 * in-app "Get the official sheet music" button landed on SMD's own
 * "Page Not Found — sorry, you appear to have found something broken on our
 * website" page plus a Log In page. Route probed live 2026-09-22: SMD's origin
 * answers with a bare nginx 500 for `/en-US/search`.
 *
 * The REAL search route (probe-verified 2026-09-22) is the ASP.NET page
 *
 *     https://www.sheetmusicdirect.com/en-US/Search.aspx?query=<encoded query>
 *
 * Evidence: the Wayback CDX index returns hundreds of SMD search URLs of that
 * exact shape with HTTP **200** — the newest captured 2025-09-17, i.e. the live
 * site today (`/en-US/Search.aspx?query=…`, plus its locale-less twin
 * `/Search.aspx?query=…`). The old shape `/en-US/search?searchText=…` has no
 * 200 in the index at all. SMD's own robots.txt still advertises the `.aspx`
 * stack (/Browse.aspx, /AddToBasket.aspx, /Account/*).
 *
 * The query parameter is `query` — NOT `searchText` (the retired builder's own
 * invention; the 2024 archived form posted to `./Search.aspx` with the WebForms
 * field `ctl00$txtSearchTerms`, which is a POST field, not a GET parameter).
 * ---------------------------------------------------------------------------
 */

/** Owner's approved Sheet Music Direct affiliate ID (relayed 09-14). */
export const SMD_AFFILIATE_ID = "67650";

/** SMD origin used for every outbound purchase link. */
export const SMD_SEARCH_ORIGIN = "https://www.sheetmusicdirect.com";

/** Live, probe-verified search page (ASP.NET). */
export const SMD_SEARCH_PATH = "/en-US/Search.aspx";

/** Live, probe-verified search query parameter. */
export const SMD_SEARCH_QUERY_PARAM = "query";

/**
 * Routes that LOOK like an SMD search page but are dead (404 / nginx 500).
 * Lower-cased; compared against a URL's pathname. Kept as data so the guard test
 * can assert the retired shape is actually rejected.
 */
export const SMD_DEAD_SEARCH_PATHS = ["/en-us/search", "/search"] as const;

/** Parameters the RETIRED builder invented; their presence means a stale shape. */
export const SMD_RETIRED_QUERY_PARAMS = ["searchText"] as const;

/**
 * Source-text tripwire for the scanner: `en-US/search` unless it is the real
 * `en-US/search.aspx` page.
 */
export const SMD_DEAD_ROUTE_SOURCE_PATTERN = /en-US\/search(?!\.aspx)/i;

export interface SmdUrlAudit {
  ok: boolean;
  problems: string[];
}

export function isDeadSmdSearchPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "").toLowerCase();
  return (SMD_DEAD_SEARCH_PATHS as readonly string[]).includes(p);
}

/**
 * True when the URL resolves to one of the retired search routes. Compares the
 * PATHNAME (never the raw string): the live `/en-US/Search.aspx` obviously
 * contains the substring `/en-us/search`, which is exactly the trap a naive
 * `not.toContain("/en-us/search")` assertion falls into.
 */
export function isDeadSmdSearchUrl(url: string): boolean {
  try {
    return isDeadSmdSearchPath(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * The contract every outbound SMD link must satisfy: live route, non-empty
 * `query`, and BOTH affiliate parameters carrying the owner's ID (attribution
 * is the whole point of the link).
 */
export function auditSmdAffiliateUrl(url: string): SmdUrlAudit {
  const problems: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problems: ["not a parseable absolute URL"] };
  }

  if (parsed.protocol !== "https:") problems.push("not https");
  if (parsed.hostname !== "www.sheetmusicdirect.com") {
    problems.push(`unexpected host: ${parsed.hostname}`);
  }
  if (isDeadSmdSearchPath(parsed.pathname)) {
    problems.push(`dead SMD search route: ${parsed.pathname}`);
  }
  if (parsed.pathname.toLowerCase() !== SMD_SEARCH_PATH.toLowerCase()) {
    problems.push(`path is not the live search page (${SMD_SEARCH_PATH}): ${parsed.pathname}`);
  }
  const query = parsed.searchParams.get(SMD_SEARCH_QUERY_PARAM);
  if (query === null || query.trim() === "") {
    problems.push(`missing/empty ${SMD_SEARCH_QUERY_PARAM} parameter`);
  }
  for (const retired of SMD_RETIRED_QUERY_PARAMS) {
    if (parsed.searchParams.has(retired)) {
      problems.push(`retired parameter present: ${retired}`);
    }
  }
  if (parsed.searchParams.get("tid") !== SMD_AFFILIATE_ID) {
    problems.push(`tid must be ${SMD_AFFILIATE_ID}`);
  }
  if (parsed.searchParams.get("affiliateId") !== SMD_AFFILIATE_ID) {
    problems.push(`affiliateId must be ${SMD_AFFILIATE_ID}`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * ---------------------------------------------------------------------------
 * OWNER ON-DEVICE BUG 2026-09-22, PART 2 — a catalogue code is not a search term
 * ---------------------------------------------------------------------------
 * The modern-song path used to search SMD with the recording's ISRC (the owner's
 * phone showed SMD's search box filled with `AUAP*600001`) and SMD answered
 * **"No Results"**: SMD's search indexes titles / artists / composers, not
 * recording codes. Evidence: the Wayback CDX index has hundreds of HTTP 200
 * captures of `/en-US/Search.aspx?query=…` carrying *title* text, and none
 * carrying a code; SMD's robots.txt shows the same ASP.NET title-search stack.
 *
 * `looksLikeBareCatalogCode()` is the tripwire for that bug class: a query that
 * has no whitespace and carries a code's fingerprint (an ISRC-shaped string, a
 * long bare number, or a separator-style code such as `AUAP*600001`) is a code,
 * not something a shopper typed into a retailer search box.
 *
 * Deliberately NARROW, so real titles are never mistaken for codes: a title may
 * legitimately contain digits (`Symphony No. 5 in C Minor, Op. 67`), so any query
 * with a whitespace is never a code, and short numerals (`1812`) are never one.
 */
export function looksLikeBareCatalogCode(query: string): boolean {
  const q = query.trim();
  if (q === "" || /\s/.test(q)) return false;
  const digits = (q.match(/\d/g) ?? []).length;
  // ISRC / Apple-code shape: a long alphanumeric run with mostly digits.
  if (q.length >= 10 && digits >= 6) return true;
  // A bare long number carries no title information whatsoever.
  if (/^\d{8,}$/.test(q)) return true;
  // Separator-style recording code, e.g. "AUAP*600001" / "TCA1/23" (from the bug).
  if (digits >= 3 && /^[A-Za-z0-9]{2,}[*/][A-Za-z0-9]{2,}$/.test(q)) return true;
  return false;
}

/**
 * ---------------------------------------------------------------------------
 * OWNER ON-DEVICE BUG 2026-09-25 — the Musicnotes backup's `w=NoteSnap` tag
 * ---------------------------------------------------------------------------
 * The backup link (Musicnotes, zero commission — SMD carries affiliate ID 67650)
 * used to end in `&w=NoteSnap`, a "referrer tag". Musicnotes' search page reads
 * `w` as ITS OWN query parameter, so on the owner's phone the search box showed
 * "NoteSnap" and the engine searched the literal word "NoteSnap", returning one
 * irrelevant fuzzy result ("Sockerfens dans — Notknapparsviten") — the song query
 * never reached the engine. Reproduced twice (RC v26 Test 4a finding #3 + Test 5).
 * The same hand-written template sat in TWO files (`modern-retailer.ts` and
 * `affiliates.ts`), which is how a fix in one place would have left the other
 * broken — the two copies shared nothing.
 *
 * Both the tag and the duplicated builder are now contract violations:
 * `scanSourcesForNoteSnapReferrerTag()` flags the `w` tag anywhere, and flags a
 * hand-written Musicnotes search URL outside `modern-retailer.ts` (the single
 * builder that also builds the registry's template).
 */
export const MUSICNOTES_RETAILER_HOST = "www.musicnotes.com";
/** Musicnotes origin — the site every backup link points at. */
export const MUSICNOTES_SEARCH_ORIGIN = "https://www.musicnotes.com";
/**
 * The `w` parameter is NOT a referrer tag: it is Musicnotes' QUERY parameter
 * (probe-verified 2026-09-28 — its own search form is `GET /search` with the
 * single text field `w`, and the page title echoes it). `w=NoteSnap` therefore
 * made Musicnotes search for the literal word "NoteSnap"; the parameter stays in
 * the live URL, and only that VALUE is banned.
 */
export const MUSICNOTES_RETIRED_TAG = "w=NoteSnap";

/** A `?w=`/`&w=` parameter carrying the retired NoteSnap tag. */
export const MUSICNOTES_RETIRED_TAG_PATTERN = /[?&]w=NoteSnap\b/i;
/**
 * A Musicnotes search URL written out by hand — either the live shape
 * (`musicnotes.com/search?w=`) or the retired one (`musicnotes.com/search/go?q=`).
 * Only ONE module may hold it (`modern-retailer.ts`, which re-exports the shape
 * from this module); everywhere else must call `musicnotesSearchUrl()` /
 * `musicnotesSearchUrlTemplate()`.
 */
export const MUSICNOTES_HARDCODED_URL_PATTERN =
  /musicnotes\.com\/search(?:\/(?:go|search))?\?[^\s"'`]*\b(?:q|w)=/i;

/** Paths allowed to spell out a Musicnotes search URL (the one builder). */
export const MUSICNOTES_URL_BUILDER_ALLOWLIST: readonly string[] = [
  "services/modern-retailer.ts",
];

export interface ScannedSource {
  path: string;
  content: string;
}

export interface NoteSnapTagOffender extends DeadRouteOffender {
  /** Which contract rule the line broke. */
  rule: "w=NoteSnap tag" | "hand-written Musicnotes URL";
}

/**
 * Pure source scanner (the team's source-contract pattern): returns every place
 * a source file still carries the retired `w=NoteSnap` tag, or hand-writes a
 * Musicnotes search URL outside the one builder. `allow` takes repo-relative
 * paths — the test that pins the new shape plants both offenders on purpose, so
 * it allowlists itself.
 */
export function scanSourcesForNoteSnapReferrerTag(
  files: readonly ScannedSource[],
  allow: readonly string[] = [],
): NoteSnapTagOffender[] {
  // The TAG rule scans every file the caller did not exempt (this module and the
  // test that documents the retired shape are the only exemptions) — a real URL is
  // the only way to match it, because a doc that merely *names* the tag writes
  // `w=NoteSnap` with no `?`/`&` in front of it.
  const tagExempt = new Set(allow);
  // The URL rule additionally exempts the ONE builder module, and `.test.ts`
  // files: a test cannot ship a link, and several legitimately assert the URL's
  // prefix as a literal (`toContain("https://www.musicnotes.com/search/go?q=")`).
  // Shipped code — routes, components, every other service — is always scanned.
  const urlExempt = new Set([...allow, ...MUSICNOTES_URL_BUILDER_ALLOWLIST]);
  const offenders: NoteSnapTagOffender[] = [];
  for (const file of files) {
    const isTestFile = /\.test\.tsx?$/.test(file.path);
    file.content.split("\n").forEach((text, index) => {
      const tag = !tagExempt.has(file.path) && MUSICNOTES_RETIRED_TAG_PATTERN.test(text);
      const url =
        !isTestFile &&
        !urlExempt.has(file.path) &&
        MUSICNOTES_HARDCODED_URL_PATTERN.test(text);
      if (!tag && !url) return;
      offenders.push({
        path: file.path,
        line: index + 1,
        text: text.trim().slice(0, 200),
        rule: tag ? "w=NoteSnap tag" : "hand-written Musicnotes URL",
      });
    });
  }
  return offenders;
}

export interface DeadRouteOffender {
  path: string;
  line: number;
  text: string;
}

/**
 * Pure source scanner (the team's source-contract pattern): returns every place
 * a source file still mentions the retired `/en-US/search` route, so a future
 * template or copy-paste cannot quietly resurrect the dead link. Files listed in
 * `allow` (the contract module itself, which documents the dead route on
 * purpose) are skipped.
 */
export function scanSourcesForDeadSmdRoute(
  files: readonly ScannedSource[],
  allow: readonly string[] = [],
): DeadRouteOffender[] {
  const allowed = new Set(allow);
  const offenders: DeadRouteOffender[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    const lines = file.content.split("\n");
    lines.forEach((text, index) => {
      if (SMD_DEAD_ROUTE_SOURCE_PATTERN.test(text) || /[?&]searchText=/.test(text)) {
        offenders.push({ path: file.path, line: index + 1, text: text.trim() });
      }
    });
  }
  return offenders;
}

/**
 * ---------------------------------------------------------------------------
 * Musicnotes live shape + the RETIRED Musicnotes route (owner on-device bug
 * 2026-09-28, RC v28 Test 12 — "the Musicnotes CTA shows the wrong page")
 * ---------------------------------------------------------------------------
 * The owner tapped the Musicnotes CTA and got Für Elise's page instead of his
 * song. Root cause: the builder emitted a RETIRED Musicnotes path, and the live
 * retailer answered it with its EMPTY-QUERY "Popular" browse grid (HTTP 200, not
 * an error) — whose all-time top seller is Für Elise. App + backend wiring were
 * correct; the URL was wrong.
 *
 * The retired parameter was wrong too, and in the same way: `q` is not
 * Musicnotes' search parameter. Probed 2026-09-28 with a JS-executing browser
 * (headless Chromium → real DOM, HTTP 200 in every case, query
 * `Let It Be The Beatles`); the page's own `<title>` is the verdict:
 *
 *   retired path + `q` → `<title>Search:  | Musicnotes</title>`  (0 hits, "Popular")
 *   live path    + `q` → `<title>Search:  | Musicnotes</title>`  (0 hits, "Popular")
 *   live path    + `w` → `<title>Search: Let It Be The Beatles | Musicnotes</title>`
 *                        (56 hits; the search box carries the query)
 *
 * The live shape is therefore the path `/search` with the parameter `w` — which
 * is also why the earlier `w=NoteSnap` tag was searched as a song title. Both the
 * retired path and the retired parameter are pinned here: the source scan below
 * fails the gate if the retired route is spelled anywhere but the contract module
 * (and its test), and `auditMusicnotesSearchUrl()` fails if an emitted URL does
 * not carry the query in `w`.
 */
export const MUSICNOTES_SEARCH_PATH = "/search";
export const MUSICNOTES_SEARCH_QUERY_PARAM = "w";
/** The retired route, exactly as it shipped (empty-query "Popular" page). */
export const MUSICNOTES_RETIRED_SEARCH_PATH = "/search/go";
/** The retired query parameter (never read by Musicnotes' search page). */
export const MUSICNOTES_RETIRED_QUERY_PARAM = "q";
/**
 * Source-text tripwire for the scanner: the retired Musicnotes sub-route,
 * wherever it is spelled (a path literal, a template, a hand-written URL).
 */
export const MUSICNOTES_RETIRED_ROUTE_SOURCE_PATTERN = /\/search\/go\b/i;

/**
 * The contract every emitted Musicnotes backup link must satisfy: live path,
 * the shopper's query carried in `w`, and NO trace of the retired route or
 * parameter. `expectedQuery` is optional so a caller can also assert the exact
 * query the link should search.
 */
export function auditMusicnotesSearchUrl(
  url: string,
  expectedQuery?: string,
): SmdUrlAudit {
  const problems: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problems: ["not a parseable absolute URL"] };
  }
  if (parsed.protocol !== "https:") problems.push("not https");
  if (parsed.hostname !== MUSICNOTES_RETAILER_HOST) {
    problems.push(`unexpected host: ${parsed.hostname}`);
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (MUSICNOTES_RETIRED_ROUTE_SOURCE_PATTERN.test(path)) {
    problems.push(`retired Musicnotes route: ${parsed.pathname}`);
  }
  if (path !== MUSICNOTES_SEARCH_PATH) {
    problems.push(
      `path is not the live search page (${MUSICNOTES_SEARCH_PATH}): ${parsed.pathname}`,
    );
  }
  if (parsed.searchParams.has(MUSICNOTES_RETIRED_QUERY_PARAM)) {
    // `q` is not read by Musicnotes — its presence means the empty-query page,
    // i.e. the wrong-sheet bug, not a search.
    problems.push(`retired parameter present: ${MUSICNOTES_RETIRED_QUERY_PARAM}`);
  }
  const query = parsed.searchParams.get(MUSICNOTES_SEARCH_QUERY_PARAM);
  if (query === null || query.trim() === "") {
    problems.push(`missing/empty ${MUSICNOTES_SEARCH_QUERY_PARAM} parameter`);
  } else if (expectedQuery !== undefined && query !== expectedQuery) {
    problems.push(
      `${MUSICNOTES_SEARCH_QUERY_PARAM} is not the expected query: ${query}`,
    );
  }
  if (MUSICNOTES_RETIRED_TAG_PATTERN.test(url)) {
    problems.push(`retired ${MUSICNOTES_RETIRED_TAG} tag present`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Pure source scanner (the team's source-contract pattern): returns every place
 * a source file still spells the RETIRED Musicnotes route, so a re-pointed
 * constant or a copy-pasted template cannot quietly bring the wrong-page bug
 * back. Files in `allow` (the contract module itself and its test, which document
 * the retired route on purpose) are skipped.
 */
export function scanSourcesForRetiredMusicnotesRoute(
  files: readonly ScannedSource[],
  allow: readonly string[] = [],
): DeadRouteOffender[] {
  const allowed = new Set(allow);
  const offenders: DeadRouteOffender[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    const lines = file.content.split("\n");
    lines.forEach((text, index) => {
      if (MUSICNOTES_RETIRED_ROUTE_SOURCE_PATTERN.test(text)) {
        offenders.push({ path: file.path, line: index + 1, text: text.trim() });
      }
    });
  }
  return offenders;
}
