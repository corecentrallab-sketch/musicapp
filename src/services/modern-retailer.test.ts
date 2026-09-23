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
 * And they pin the BRACKET-NOISE-STRIPPING rule (owner on-device bug 09-23, part
 * 2): the owner's song arrived as `Bang a Gong (Get it on) [2003 Remaster]`
 * (T. Rex), and the bracketed edition suffix alone drives SMD's token matcher to
 * zero results — it is vendor metadata, not a title. `cleanSmdQuery()` drops every
 * `[ ... ]` section and collapses whitespace for the SMD primary ONLY; real
 * parenthesised title content is kept, and the Musicnotes backup query keeps the
 * raw title+artist.
 *
 * Run with: bun test src/services/modern-retailer.test.ts
 */
import { describe, test, expect } from "bun:test";
import { cleanSmdQuery, modernRetailerUrls } from "./modern-retailer";
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
    expect(new URL(musicnotes!).searchParams.get("q")).toBe(
      "Let It Be The Beatles",
    );
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
      // equality (not substring) — the query can only ever be our title (these
      // titles carry no bracket noise, so the cleaner is the identity here)
      expect(query).toBe(cleanSmdQuery(title));
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
    for (const q of realQueries)
      expect(looksLikeBareCatalogCode(q)).toBe(false);
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
    expect(new URL(musicnotes!).searchParams.get("q")).toBe(
      "Me & You #1 A & B",
    );
  });

  test("REGRESSION: edition-bracket noise never survives into the SMD query (#122)", () => {
    // The exact owner song (09-23): the `[2003 Remaster]` suffix is provider
    // metadata; SMD's matcher scores ~0 for it. Parens are real title content.
    const { primary } = modernRetailerUrls(
      "Bang a Gong (Get it on) [2003 Remaster]",
      "T. Rex",
    );
    expect(primary).toBeDefined();
    expect(new URL(primary!).searchParams.get("query")).toBe(
      "Bang a Gong (Get it on)",
    );
    expect(primary!).not.toContain("Remaster");
    expect(auditSmdAffiliateUrl(primary!).ok).toBe(true);
  });
});

/**
 * Bracket-noise cleanup for the SMD query (owner on-device bug 09-23, part 2).
 * Asserted strings are the exact `query` values the builder must emit.
 */
describe("cleanSmdQuery — edition/bracket noise stripped from the SMD query", () => {
  test("owner's song: '[2003 Remaster]' is dropped, the real parens are kept", () => {
    expect(cleanSmdQuery("Bang a Gong (Get it on) [2003 Remaster]")).toBe(
      "Bang a Gong (Get it on)",
    );
    const { primary, musicnotes } = modernRetailerUrls(
      "Bang a Gong (Get it on) [2003 Remaster]",
      "T. Rex",
    );
    // SMD primary query (exact): bracket gone, parens kept
    expect(new URL(primary!).searchParams.get("query")).toBe(
      "Bang a Gong (Get it on)",
    );
    expect(primary!).not.toContain("Remaster");
    expect(primary!).not.toContain("%5B");
    expect(auditSmdAffiliateUrl(primary!).ok).toBe(true);
    // the Musicnotes backup is NOT cleaned: raw title+artist, as before
    expect(new URL(musicnotes!).searchParams.get("q")).toBe(
      "Bang a Gong (Get it on) [2003 Remaster] T. Rex",
    );
  });

  test("a trailing remaster bracket on a plain title is dropped", () => {
    expect(cleanSmdQuery("Let It Be [2003 Remaster]")).toBe("Let It Be");
    const { primary } = modernRetailerUrls(
      "Let It Be [2003 Remaster]",
      "The Beatles",
    );
    expect(new URL(primary!).searchParams.get("query")).toBe("Let It Be");
    expect(primary!).not.toContain("Beatles");
  });

  test("a real parenthesised title is untouched", () => {
    expect(cleanSmdQuery("(I Can't Get No) Satisfaction")).toBe(
      "(I Can't Get No) Satisfaction",
    );
    const { primary } = modernRetailerUrls(
      "(I Can't Get No) Satisfaction",
      "The Rolling Stones",
    );
    expect(new URL(primary!).searchParams.get("query")).toBe(
      "(I Can't Get No) Satisfaction",
    );
    expect(primary!).not.toContain("Rolling");
  });

  test("interior whitespace collapses and the ends are trimmed", () => {
    expect(cleanSmdQuery("  Yesterday   (Remaster 2023)  ")).toBe(
      "Yesterday (Remaster 2023)",
    );
    expect(cleanSmdQuery("Let   It\tBe\n")).toBe("Let It Be");
    // a title with no brackets and clean spacing is unchanged
    expect(cleanSmdQuery("Me & You #1")).toBe("Me & You #1");
  });

  test("several brackets go, and a fused bracket does not fuse two words", () => {
    expect(cleanSmdQuery("Song [Live][Deluxe Edition]")).toBe("Song");
    expect(cleanSmdQuery("Song[Live]Title")).toBe("Song Title");
  });

  test("a bracketed-only title cleans to empty -> the guard applies -> no link", () => {
    expect(cleanSmdQuery("[2003 Remaster]")).toBe("");
    // existing degraded state: no SMD page that would answer "No Results"
    expect(modernRetailerUrls("[2003 Remaster]", "T. Rex")).toEqual({});
  });

  test("the bare-code guard runs on the CLEANED string", () => {
    // without cleanup this would pass the guard (it has a whitespace) and be
    // searched; cleaned, it is a bare code -> no link.
    expect(cleanSmdQuery("AUAP*600001 [2003 Remaster]")).toBe("AUAP*600001");
    expect(
      modernRetailerUrls("AUAP*600001 [2003 Remaster]", "Some Artist"),
    ).toEqual({});
  });
});
