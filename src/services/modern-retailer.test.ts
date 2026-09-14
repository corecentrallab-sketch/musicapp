/**
 * Regression tests for the modern-song affiliate URL builder.
 *
 * The owner's Sheet Music Direct affiliate account (ID 67650) was approved
 * 09-14; every SMD URL returned by /api/recognize-modern must embed the ID so
 * clicks are commission-attributable. These tests pin that invariant.
 *
 * Run with: bun test src/services/modern-retailer.test.ts
 */
import { describe, test, expect } from "bun:test";
import { modernRetailerUrls } from "./modern-retailer";

const SMD_AFFILIATE_ID = "67650";

describe("modernRetailerUrls (Sheet Music Direct affiliate)", () => {
  test("ISRC deep link embeds affiliate ID 67650", () => {
    const { primary } = modernRetailerUrls(
      "Let It Be",
      "The Beatles",
      "TCA123456789",
    );
    expect(primary).toBeDefined();
    expect(primary).toContain("https://www.sheetmusicdirect.com/en-US/search");
    expect(primary).toContain("searchText=TCA123456789");
    expect(primary).toContain(`tid=${SMD_AFFILIATE_ID}`);
    expect(primary).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
  });

  test("title+artist fallback (no ISRC) embeds affiliate ID 67650", () => {
    const { primary } = modernRetailerUrls("Yesterday", "The Beatles");
    expect(primary).toContain("searchText=Yesterday%20The%20Beatles");
    expect(primary).toContain(`tid=${SMD_AFFILIATE_ID}`);
    expect(primary).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
  });

  test("no match metadata -> no retailer URLs", () => {
    const urls = modernRetailerUrls("", "");
    expect(urls.primary).toBeUndefined();
    expect(urls.musicnotes).toBeUndefined();
  });

  test("musicnotes backup remains present", () => {
    const { musicnotes } = modernRetailerUrls("Let It Be", "The Beatles", "TCA1");
    expect(musicnotes).toContain("musicnotes.com");
  });
});