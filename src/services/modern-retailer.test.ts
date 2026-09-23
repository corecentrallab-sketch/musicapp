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
 * And they pin the QUERY (owner on-device bug 09-22, part 2): the builder used to
 * prefer an ISRC deep link, so the owner's phone opened SMD with a recording code
 * in the search box (`AUAP*600001`) and got "No Results" — SMD indexes titles,
 * artists and composers, not codes. The query must now always be human-readable,
 * and a bare code must never be emitted at all.
 *
 * And they pin the TITLE-ONLY rule (owner on-device bug 09-23): the human-readable
 * query is the TITLE ALONE. `"<title> <artist>"` still dead-ended on SMD's own
 * zero-result page for many popular songs, because SMD's matcher scores ~0 for the
 * extra tokens (a 4-token query returns 6 hits). The artist string must never
 * reach the SMD search box — the Musicnotes backup keeps title+artist, which its
 * search handles well. Evidence:
 * `/home/team/shared/SMD-NO-RESULTS-INVESTIGATION-2026-09-23.md`.
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
  looksLikeBareCatalogCode,
} from "./affiliate-url-contract";

const SMD_LIVE_PATH_MARKER = `https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}`;

describe("modernRetailerUrls (Sheet Music Direct affiliate)", () => {
  test("a match that HAS an ISRC still searches the title (never the code)", () => {
    const { primary } = modernRetailerUrls(
      "Let It Be",
      "The Beatles",
      "TCA123456789",
    );
    expect(primary).toBeDefined();
    expect(primary).toContain(SMD_LIVE_PATH_MARKER);
    expect(primary).toContain("query=Let%20It%20Be");
    // the code must not survive anywhere in the link, encoded or not
    expect(primary).not.toContain("TCA123456789");
    expect(new URL(primary!).searchParams.get("query")).toBe("Let It Be");
    expect(primary).toContain(`tid=${SMD_AFFILIATE_ID}`);
    expect(primary).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
  });

  test("title-only search (no ISRC) embeds affiliate ID 67650 and drops the artist", () => {
    const { primary } = modernRetailerUrls("Yesterday", "The Beatles");
    expect(primary).toContain("query=Yesterday");
    expect(new URL(primary!).searchParams.get("query")).toBe("Yesterday");
    // the artist must NOT be part of the SMD query (09-23: extra tokens -> no results)
    expect(primary).not.toContain("Beatles");
    expect(primary).toContain(`tid=${SMD_AFFILIATE_ID}`);
    expect(primary).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
  });

  test("no match metadata -> no retailer URLs", () => {
    const urls = modernRetailerUrls("", "");
    expect(urls.primary).toBeUndefined();
    expect(urls.musicnotes).toBeUndefined();
  });

  test("the Musicnotes backup searches title+artist and carries no SMD params", () => {
    const { primary, musicnotes } = modernRetailerUrls(
      "Let It Be",
      "The Beatles",
      "TCA123456789",
    );
    expect(musicnotes).toBeDefined();
    expect(musicnotes!).toContain("musicnotes.com");
    // The backup keeps BOTH tokens (its own search handles them) while the SMD
    // primary is title-only — the two queries deliberately differ.
    expect(new URL(musicnotes!).searchParams.get("q")).toBe("Let It Be The Beatles");
    expect(new URL(primary!).searchParams.get("query")).toBe("Let It Be");
    // attribution belongs to our SMD link only
    expect(musicnotes!).not.toContain("sheetmusicdirect.com");
    expect(musicnotes!).not.toContain(SMD_AFFILIATE_ID);
    expect(musicnotes!).not.toBe(primary);
  });

  test("REGRESSION: the emitted query IS the title — neither artist nor code can slip in", () => {
    const cases: [string, string, string?][] = [
      ["Elise's Serenade", "Trito Music", "QZTEST0000001"],
      ["Let It Be", "The Beatles", "AUAP*600001"],
      ["Für Elise", "Ludwig van Beethoven", undefined],
      ["Symphony No. 5 in C Minor, Op. 67", "Beethoven", "GBAYC0102393"],
    ];
    for (const [title, artist, isrc] of cases) {
      const { primary } = modernRetailerUrls(title, artist, isrc);
      expect(primary).toBeDefined();
      const query = new URL(primary!).searchParams.get("query")!;
      // equality (not substring) — the query can only ever be our title
      expect(query).toBe(title);
      // ... and the artist is not in the URL at all (09-23: title-only search)
      expect(new URL(primary!).searchParams.get("query")).not.toContain(artist);
      expect(looksLikeBareCatalogCode(query)).toBe(false);
      if (isrc) expect(query).not.toContain(isrc);
    }
  });

  test("a bare recording code is never searched (no 'No Results' dead end)", () => {
    // Junk vendor metadata: the code arrives in the title field, so the title
    // query IS a bare code. Emit nothing rather than an SMD page whose
    // answer is "No Results" (the owner's on-device bug).
    const junk = modernRetailerUrls("AUAP*600001", " ");
    expect(junk.primary).toBeUndefined();
    expect(junk.musicnotes).toBeUndefined();
    expect(modernRetailerUrls("QZTEST0000001", "")).toEqual({});
  });

  test("looksLikeBareCatalogCode flags the codes the owner saw and no real title", () => {
    const codes = [
      "AUAP*600001",
      "QZTEST0000001",
      "TCA123456789",
      "GBAYE0601498",
      "12345678",
    ];
    for (const code of codes) expect(looksLikeBareCatalogCode(code)).toBe(true);

    const realQueries = [
      "Let It Be The Beatles",
      "Für Elise Ludwig van Beethoven",
      "Symphony No. 5 in C Minor, Op. 67",
      "Rock & Roll Led Zeppelin",
      "1812",
      "Beethoven",
      "",
      "   ",
    ];
    for (const q of realQueries) expect(looksLikeBareCatalogCode(q)).toBe(false);
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
    const { primary, musicnotes } = modernRetailerUrls("Me & You #1", "A & B");
    const params = new URL(primary!).searchParams;
    expect(params.get("tid")).toBe(SMD_AFFILIATE_ID);
    expect(params.get("affiliateId")).toBe(SMD_AFFILIATE_ID);
    // title only — the raw `&`/`#` in the artist must not even be part of it
    expect(params.get("query")).toBe("Me & You #1");
    expect(new URL(musicnotes!).searchParams.get("q")).toBe("Me & You #1 A & B");
  });
});
