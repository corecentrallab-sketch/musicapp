/**
 * Regression tests for the Musicnotes live probe (owner on-device bug 09-28,
 * RC v28 Test 12; retired-route bug fc19fe16).
 *
 * The wrong-page bug was invisible to URL-shape assertions: the backup link was
 * well-formed, https, on the right host, carried a query parameter — and the
 * retailer still rendered its EMPTY-QUERY "Popular" browse grid (Für Elise on
 * top, i.e. the wrong sheet the owner reported). Only the RENDERED document tells
 * you which query the page actually ran, and Musicnotes echoes it in its
 * `<title>`: `Search: <query> | Musicnotes` when it searched, `Search:  |
 * Musicnotes` (empty query) when it did not.
 *
 * This suite therefore pins the CLASSIFIER against canned documents (the three
 * shapes the owner's bug covers, including the exact empty-query title), and pins
 * the fetch wrapper's behaviour on a network failure. The live call against the
 * real retailer lives in `affiliate-url-contract.test.ts` (it needs the network,
 * so it degrades honestly when Cloudflare blocks this box).
 *
 * Run with: bun test src/services/musicnotes-search-probe.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  MUSICNOTES_RETIRED_QUERY_PARAM,
  MUSICNOTES_RETIRED_SEARCH_PATH,
  MUSICNOTES_SEARCH_PATH,
  MUSICNOTES_SEARCH_QUERY_PARAM,
  MUSICNOTES_SEARCH_ORIGIN,
} from "./affiliate-url-contract";
import {
  classifyMusicnotesSearchPage,
  extractHtmlTitle,
  extractMusicnotesSearchBoxValue,
  probeMusicnotesSearch,
} from "./musicnotes-search-probe";

const QUERY = "Let It Be The Beatles";

/** The LIVE shape: the page echoes the query it ran (this is a WIN). */
const LIVE_HTML = `<!doctype html><html><head><title>Search: ${QUERY} | Musicnotes</title></head>
<body><input id="sli_search_1" name="w" value="${QUERY}">
<p>Showing 1 to 25 of 56 results</p></body></html>`;

/** The BUG: a Search page with an empty query -> the "Popular" browse grid. */
const EMPTY_QUERY_HTML = `<!doctype html><html><head><title>Search:  | Musicnotes</title></head>
<body><div class="popular">Popular Sheet Music</div>
<a href="/sheetmusic/1234">Fur Elise</a></body></html>`;

/** Cloudflare's interstitial — an environment fact, never a product defect. */
const CHALLENGE_HTML = `<!doctype html><html><head><title>Just a moment...</title></head>
<body><div id="cf-chl-widget"></div></body></html>`;

describe("classifyMusicnotesSearchPage — the rendered page is the verdict", () => {
  test("the LIVE query is reported as executed (title echoes it)", () => {
    const page = classifyMusicnotesSearchPage(LIVE_HTML, QUERY);
    expect(page.title).toBe(`Search: ${QUERY} | Musicnotes`);
    expect(page.queryExecuted).toBe(true);
    expect(page.verdict).toBe("query-executed");
  });

  test("the search box alone is enough evidence when the title does not echo", () => {
    const html = `<title>Musicnotes</title><input name="w" value="Fur Elise Lang Lang">`;
    const page = classifyMusicnotesSearchPage(html, "Fur Elise Lang Lang");
    expect(page.searchBoxValue).toBe("Fur Elise Lang Lang");
    expect(page.queryExecuted).toBe(true);
    expect(page.verdict).toBe("query-executed");
  });

  test("the empty-query 'Popular' page is the BUG, reported as such", () => {
    const page = classifyMusicnotesSearchPage(EMPTY_QUERY_HTML, QUERY);
    expect(page.title).toBe("Search: | Musicnotes");
    expect(page.queryExecuted).toBe(false);
    expect(page.verdict).toBe("empty-query-page");
  });

  test("a query the page did NOT run is not 'executed' — even on a 200", () => {
    // A different (wrong) parameter would render exactly this: the browse grid.
    const page = classifyMusicnotesSearchPage(EMPTY_QUERY_HTML, "Play that Funky Music Wild Cherry");
    expect(page.queryExecuted).toBe(false);
    expect(page.verdict).toBe("empty-query-page");
  });

  test("Cloudflare's interstitial is reported as a challenge, not as a defect", () => {
    expect(classifyMusicnotesSearchPage(CHALLENGE_HTML, QUERY).verdict).toBe(
      "cloudflare-challenge",
    );
    // ...also when it arrives as a 403 with a normal-looking body
    expect(classifyMusicnotesSearchPage("<html></html>", QUERY, 403).verdict).toBe(
      "cloudflare-challenge",
    );
    expect(classifyMusicnotesSearchPage(CHALLENGE_HTML, QUERY, 403).verdict).toBe(
      "cloudflare-challenge",
    );
  });

  test("HTTP failures and unknown documents get their own verdicts", () => {
    expect(classifyMusicnotesSearchPage("nope", QUERY, 404).verdict).toBe(
      "http-error",
    );
    expect(classifyMusicnotesSearchPage("<html><body>x</body></html>", QUERY).verdict).toBe(
      "unrecognized-page",
    );
  });

  test("extractors: title is whitespace-collapsed, entities are decoded", () => {
    expect(extractHtmlTitle("<title>\n  A\n  B </title>")).toBe("A B");
    expect(extractHtmlTitle("<html></html>")).toBe("");
    expect(
      extractMusicnotesSearchBoxValue(`<input name="w" value="Elise&#39;s Serenade">`),
    ).toBe("Elise's Serenade");
    expect(extractMusicnotesSearchBoxValue("<input name='other' value='x'>")).toBe("");
  });
});

describe("probeMusicnotesSearch — the fetch wrapper (network is a FINDING)", () => {
  /** The live URL, built from the contract constants (never hand-written). */
  const liveUrl = `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}?${MUSICNOTES_SEARCH_QUERY_PARAM}=${encodeURIComponent(QUERY)}`;
  /** The retired shape that shipped and produced the wrong page. */
  const retiredUrl = `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_RETIRED_SEARCH_PATH}?${MUSICNOTES_RETIRED_QUERY_PARAM}=${encodeURIComponent(QUERY)}`;

  test("reports the live URL as executing the query", async () => {
    const probe = await probeMusicnotesSearch(liveUrl, {
      fetchImpl: (async () => new Response(LIVE_HTML, { status: 200 })) as typeof fetch,
    });
    expect(probe.verdict).toBe("query-executed");
    expect(probe.queryExecuted).toBe(true);
    expect(probe.status).toBe(200);
    expect(probe.detail).toContain("query-executed");
  });

  test("flags the RETIRED URL as the empty-query page (the bug, reproduced offline)", async () => {
    // This is the assertion that would have caught the owner's bug: the retired
    // route + parameter make the retailer render a Search page with NO query.
    const probe = await probeMusicnotesSearch(retiredUrl, {
      fetchImpl: (async () =>
        new Response(EMPTY_QUERY_HTML, { status: 200 })) as typeof fetch,
    });
    expect(probe.verdict).toBe("empty-query-page");
    expect(probe.title).toBe("Search: | Musicnotes");
  });

  test("a thrown fetch is reported, never thrown (offline box cannot break the gate)", async () => {
    const probe = await probeMusicnotesSearch(liveUrl, {
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND");
      }) as typeof fetch,
    });
    expect(probe.verdict).toBe("http-error");
    expect(probe.status).toBe(0);
    expect(probe.detail).toContain("ENOTFOUND");
  });

  test("the query is read from the URL's own parameter, not from the caller", async () => {
    // If the builder ever moved the query out of `w`, the probe must go blind in
    // the honest direction: no query in the URL -> nothing can be "executed", so
    // the retired shape can never be mistaken for a working search.
    const probe = await probeMusicnotesSearch(retiredUrl, {
      fetchImpl: (async () => new Response(LIVE_HTML, { status: 200 })) as typeof fetch,
    });
    expect(probe.queryExecuted).toBe(false);
    expect(probe.verdict).not.toBe("query-executed");
  });
});
