/**
 * Regression tests for the modern-song affiliate URL builder.
 *
 * The owner's Sheet Music Direct affiliate account (ID 67650) was approved
 * 09-14; every SMD URL returned by /api/recognize-modern must embed the ID so
 * clicks are commission-attributable. These tests pin that invariant.
 *
 * They also pin the ROUTE (owner on-device bug 09-22): the builder used to emit
 * a lowercase `/search` path with a `searchText` parameter — a route SMD does not
 * serve, so the CTA 404'd on the owner's phone. The live, probe-verified shape is
 * `/en-US/Search.aspx?query=…`; the exact retired strings + evidence live in
 * `affiliate-url-contract.ts` (and a source scan there blocks their return).
 *
 * Run with: bun test src/services/modern-retailer.test.ts
 */
import { describe, test, expect } from "bun:test";
import { modernRetailerUrls } from "./modern-retailer";
import {
  SMD_AFFILIATE_ID,
  SMD_SEARCH_PATH,
  auditSmdAffiliateUrl,
  isDeadSmdSearchUrl,
} from "./affiliate-url-contract";

const SMD_LIVE_PATH_MARKER = `https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}`;

describe("modernRetailerUrls (Sheet Music Direct affiliate)", () => {
  test("ISRC deep link embeds affiliate ID 67650", () => {
    const { primary } = modernRetailerUrls(
      "Let It Be",
      "The Beatles",
      "TCA123456789",
    );
    expect(primary).toBeDefined();
    expect(primary).toContain(SMD_LIVE_PATH_MARKER);
    expect(primary).toContain("query=TCA123456789");
    expect(primary).toContain(`tid=${SMD_AFFILIATE_ID}`);
    expect(primary).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
  });

  test("title+artist fallback (no ISRC) embeds affiliate ID 67650", () => {
    const { primary } = modernRetailerUrls("Yesterday", "The Beatles");
    expect(primary).toContain("query=Yesterday%20The%20Beatles");
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

  test("REGRESSION: never emits the retired dead search route", () => {
    const queries: [string, string, string?][] = [
      ["Let It Be", "The Beatles", "TCA123456789"],
      ["Yesterday", "The Beatles"],
      ["Für Elise", "Ludwig van Beethoven"],
      ["Rock & Roll", "Led Zeppelin"],
      ["Title #2 (Live)", "Band?"],
    ];
    for (const [title, artist, isrc] of queries) {
      const { primary } = modernRetailerUrls(title, artist, isrc);
      expect(primary).toBeDefined();
      expect(isDeadSmdSearchUrl(primary!)).toBe(false);
      expect(new URL(primary!).pathname).toBe(SMD_SEARCH_PATH);
      const audit = auditSmdAffiliateUrl(primary!);
      expect(audit.problems).toEqual([]);
      expect(audit.ok).toBe(true);
    }
  });

  test("REGRESSION: a query containing & or # cannot break attribution", () => {
    const { primary } = modernRetailerUrls("Me & You #1", "A & B");
    const params = new URL(primary!).searchParams;
    expect(params.get("tid")).toBe(SMD_AFFILIATE_ID);
    expect(params.get("affiliateId")).toBe(SMD_AFFILIATE_ID);
    expect(params.get("query")).toBe("Me & You #1 A & B");
  });
});