/**
 * Live probe for the Musicnotes BACKUP link — "does the page actually run OUR
 * query?" (owner on-device bug 2026-09-28, RC v28 Test 12; retired-route bug
 * fc19fe16).
 *
 * WHY THIS EXISTS: the wrong-page bug was invisible to every URL-shape assertion
 * we had. A URL can be well-formed, https, on the right host, carry a query
 * parameter — and still make the retailer render its EMPTY-QUERY "Popular" browse
 * grid, whose all-time top seller is Für Elise. The owner tapped the CTA and got
 * Für Elise's sheet music while his song was "Play that Funky Music". Only the
 * RENDERED page can tell you that: Musicnotes echoes the query it actually ran in
 * the document `<title>` (`Search: <query> | Musicnotes`) and in the search box,
 * and puts a bare `Search:  | Musicnotes` (empty) on the browse page.
 *
 * Probe evidence, 2026-09-28, JS-executing browser (headless Chromium → real DOM,
 * HTTP 200 in every case, query `Let It Be The Beatles`):
 *   retired path + `q` → `<title>Search:  | Musicnotes</title>`  (0 hits, "Popular")
 *   live path    + `q` → `<title>Search:  | Musicnotes</title>`  (0 hits, "Popular")
 *   live path    + `w` → `<title>Search: Let It Be The Beatles | Musicnotes</title>`
 *                        (56 hits; the search box carries the query)
 * The `?q=` column is the one that matters: repointing the ROUTE alone is NOT the
 * fix — Musicnotes reads `w`. Both halves are pinned in `affiliate-url-contract.ts`.
 *
 * HOW IT IS USED: `probeMusicnotesSearch()` is called by the live-probe regression
 * in `affiliate-url-contract.test.ts`, so the built URL is checked against the
 * real retailer at gate time, not just against a regex. CAVEAT (measured on this
 * build box): Musicnotes sits behind Cloudflare, and a plain `fetch()` from a
 * datacenter IP gets HTTP 403 `<title>Just a moment...</title>` — a bot check,
 * NOT a broken link and NOT a product defect. The probe reports that as
 * `cloudflare-challenge` (the caller logs it and falls back to the URL-shape +
 * source-scan assertions); it never fails the gate for a challenge. A
 * JS-executing browser from the same box DOES get the real page (that is how the
 * table above was produced — recipe in `docs/RUNBOOK.md`).
 *
 * This module is deliberately fetch-injectable so its classifier is unit-tested
 * against canned documents, including the exact empty-query title.
 */

/** Where the probe's evidence came from — the caller decides what to do with it. */
export type MusicnotesProbeVerdict =
  | "query-executed"
  | "empty-query-page"
  | "cloudflare-challenge"
  | "http-error"
  | "unrecognized-page";

export interface MusicnotesSearchPage {
  /** `<title>` of the rendered document ("" when there is none). */
  title: string;
  /** The value the page's own search box carries, when one is present. */
  searchBoxValue: string;
  /** True when the rendered document reflects OUR query (title or search box). */
  queryExecuted: boolean;
  verdict: MusicnotesProbeVerdict;
}

export interface MusicnotesSearchProbe extends MusicnotesSearchPage {
  requestedUrl: string;
  status: number;
  /** One-line human summary for logs/gate output. */
  detail: string;
}

/** `<title>` text of an HTML document, whitespace-collapsed ("" when absent). */
export function extractHtmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

/**
 * The value Musicnotes' search input carries, when the document has one. The live
 * form is `GET /search` with a single text field named `w`; the header search box
 * is `id="sli_search_1"`.
 */
export function extractMusicnotesSearchBoxValue(html: string): string {
  const input =
    /<input[^>]*\bname="w"[^>]*>/i.exec(html)?.[0] ??
    /<input[^>]*\bid="sli_search_1"[^>]*>/i.exec(html)?.[0];
  if (!input) return "";
  const value = /\bvalue="([^"]*)"/i.exec(input);
  return value ? decodeHtmlEntities(value[1]).replace(/\s+/g, " ").trim() : "";
}

/** Minimal entity decoding for the handful of characters a query can carry. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** Case/whitespace-insensitive "does this text carry that query" check. */
function carriesQuery(text: string, query: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const hay = normalize(text);
  const needle = normalize(query);
  return needle !== "" && hay.includes(needle);
}

/**
 * Classify a fetched Musicnotes search document. PURE — canned HTML in, verdict
 * out (the gate's live probe supplies the real fetch).
 */
export function classifyMusicnotesSearchPage(
  html: string,
  query: string,
  status = 200,
): MusicnotesSearchPage {
  const title = extractHtmlTitle(html);
  const searchBoxValue = extractMusicnotesSearchBoxValue(html);
  const queryExecuted =
    carriesQuery(title, query) || carriesQuery(searchBoxValue, query);

  // Cloudflare's interstitial ("Just a moment...") is an environment fact, never
  // a product defect: report it as such so the caller can say so honestly.
  const challenged =
    /just a moment/i.test(title) || /cf-(?:chl|mitigated)|__cf_chl/i.test(html);

  let verdict: MusicnotesProbeVerdict;
  if (challenged || status === 403 || status === 503) {
    verdict = "cloudflare-challenge";
  } else if (status !== 200) {
    verdict = "http-error";
  } else if (queryExecuted) {
    verdict = "query-executed";
  } else if (/^Search:\s*\|/i.test(title)) {
    // THE BUG, exactly as the owner saw it: a Search page with an EMPTY query —
    // Musicnotes answers it with its "Popular" browse grid, Für Elise on top.
    verdict = "empty-query-page";
  } else {
    verdict = "unrecognized-page";
  }

  return { title, searchBoxValue, queryExecuted, verdict };
}

export interface ProbeOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Realistic UA — a bare fetch() looks even more like a bot to Cloudflare. */
  userAgent?: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/**
 * Fetch the built Musicnotes URL and report whether the page executed the query
 * that URL carries. Never throws for a network/HTTP failure — a blocked fetch is
 * a *finding* (`verdict`), because the caller has to distinguish "the retailer
 * blocked us" from "the URL is wrong".
 */
export async function probeMusicnotesSearch(
  url: string,
  options: ProbeOptions = {},
): Promise<MusicnotesSearchProbe> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const requested = new URL(url);
  const query = requested.searchParams.get("w") ?? "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": options.userAgent ?? DEFAULT_UA },
    });
    const html = await response.text();
    const page = classifyMusicnotesSearchPage(html, query, response.status);
    return {
      ...page,
      requestedUrl: url,
      status: response.status,
      detail: `HTTP ${response.status} title=${JSON.stringify(page.title)} verdict=${page.verdict}`,
    };
  } catch (error) {
    return {
      title: "",
      searchBoxValue: "",
      queryExecuted: false,
      verdict: "http-error",
      requestedUrl: url,
      status: 0,
      detail: `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
