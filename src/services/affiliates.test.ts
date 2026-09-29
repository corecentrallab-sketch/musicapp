/**
 * Regression tests for the backup retailer registry.
 *
 * Owner decision 08-24: Sheet Music Plus was dropped as a primary retailer (its
 * flow loops the user on sign-in) — it must stop shipping. This test pins the
 * retirement so the template cannot creep back in, and pins that the Musicnotes
 * backup path still resolves.
 *
 * Run with: bun test src/services/affiliates.test.ts
 */
import { describe, test, expect } from "bun:test";
import { AFFILIATE_RETAILERS } from "./affiliates";
import { generatePurchaseUrls } from "./generate-purchase-urls";
import {
  MUSICNOTES_RETIRED_QUERY_PARAM,
  MUSICNOTES_RETIRED_SEARCH_PATH,
  MUSICNOTES_SEARCH_ORIGIN,
  MUSICNOTES_SEARCH_PATH,
  MUSICNOTES_SEARCH_QUERY_PARAM,
  auditMusicnotesSearchUrl,
} from "./affiliate-url-contract";

describe("AFFILIATE_RETAILERS (Sheet Music Plus retired)", () => {
  test("no sheetmusicplus entry remains", () => {
    expect(AFFILIATE_RETAILERS.sheetmusicplus).toBeUndefined();
  });

  test("generated purchase URLs never include sheetmusicplus", () => {
    const urls = generatePurchaseUrls("Let It Be", "The Beatles");
    expect(Object.keys(urls)).not.toContain("sheetmusicplus");
    expect(JSON.stringify(urls)).not.toContain("sheetmusicplus.com");
  });

  test("musicnotes backup still builds a search URL — on the LIVE route/parameter", () => {
    const urls = generatePurchaseUrls("Let It Be", "The Beatles");
    // Owner 09-28 (RC v28 Test 12 / fc19fe16): the backup must use Musicnotes'
    // live shape (`/search` with the query in `w`). The retired sub-route plus the
    // `q` parameter (which Musicnotes does not read) made the retailer answer with
    // its EMPTY-QUERY "Popular" grid — Für Elise on top, not the shopper's song.
    expect(urls.musicnotes).toContain(
      `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}?${MUSICNOTES_SEARCH_QUERY_PARAM}=`,
    );
    expect(urls.musicnotes).toContain(
      encodeURIComponent("Let It Be The Beatles"),
    );
    expect(urls.musicnotes).not.toContain(MUSICNOTES_RETIRED_SEARCH_PATH);
    expect(
      new URL(urls.musicnotes!).searchParams.has(MUSICNOTES_RETIRED_QUERY_PARAM),
    ).toBe(false);
    expect(auditMusicnotesSearchUrl(urls.musicnotes!).problems).toEqual([]);
  });

  test("jwpepper is retired from the registry, not merely unwired", () => {
    // LINK AUDIT 2026-09-22: the entry had no affiliate ID ("check availability")
    // and was not approved, yet `generatePurchaseUrls` iterated the whole
    // registry and emitted an unattributed jwpepper.com link on every
    // copyrighted-song match. The registry now holds approved retailers only.
    expect(AFFILIATE_RETAILERS.jwpepper).toBeUndefined();
  });

  test("generated purchase URLs never include jwpepper", () => {
    const urls = generatePurchaseUrls("Let It Be", "The Beatles");
    expect(Object.keys(urls)).not.toContain("jwpepper");
    expect(JSON.stringify(urls)).not.toContain("jwpepper.com");
    // ...even when a caller explicitly asks for it (see the contract test file)
    expect(JSON.stringify(generatePurchaseUrls("Let It Be", "The Beatles", ["jwpepper"]))).not.toContain(
      "jwpepper.com",
    );
  });
});
