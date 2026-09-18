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

describe("AFFILIATE_RETAILERS (Sheet Music Plus retired)", () => {
  test("no sheetmusicplus entry remains", () => {
    expect(AFFILIATE_RETAILERS.sheetmusicplus).toBeUndefined();
  });

  test("generated purchase URLs never include sheetmusicplus", () => {
    const urls = generatePurchaseUrls("Let It Be", "The Beatles");
    expect(Object.keys(urls)).not.toContain("sheetmusicplus");
    expect(JSON.stringify(urls)).not.toContain("sheetmusicplus.com");
  });

  test("musicnotes backup still builds a search URL", () => {
    const urls = generatePurchaseUrls("Let It Be", "The Beatles");
    expect(urls.musicnotes).toContain("https://www.musicnotes.com/search/go?q=");
    expect(urls.musicnotes).toContain(
      encodeURIComponent("Let It Be The Beatles"),
    );
  });

  test("jwpepper template is untouched", () => {
    expect(AFFILIATE_RETAILERS.jwpepper?.urlTemplate).toContain(
      "https://www.jwpepper.com/sheet-music/search.jsp?keywords={{query}}",
    );
  });
});
