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

export interface ScannedSource {
  path: string;
  content: string;
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
