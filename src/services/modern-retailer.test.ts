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
 * `[ ... ]` section and collapses whitespace; real parenthesised title content is
 * kept.
 *
 * And they pin the RELEASE-METADATA rule + the Musicnotes backup shape (owner
 * on-device bugs 09-25, RC v26 Test 4a findings #2/#3 and Test 5). Two real
 * strings the owner saw on his phone:
 *   `More Than This (2003 Digital Remaster)` (Roxy Music) — a widely sold digital
 *   title — scored SMD's zero-result page because of the parenthetical;
 *   `Just One More Day - Live at the Whisky a Go Go, 1966` (the exact card text)
 *   did the same via its spaced-dash venue tail.
 * `cleanSmdQuery()` now also drops parenthetical sections carrying a metadata
 * marker or a 4-digit year and cuts a spaced-dash tail at the first noisy
 * segment, while KEEPING title-bearing parens. The Musicnotes backup uses the
 * SAME cleaned title (its engine reads `-` tokens as operators) and carries NO
 * `w` parameter — Musicnotes read `w=NoteSnap` AS THE QUERY on the owner's phone
 * and searched the literal word "NoteSnap".
 *
 * And they pin the VERSION-DESCRIPTOR rule (owner on-device bug 09-25, RC v26
 * re-test #2): the owner's modern card read `Fur Elise (Piano Version)` and its
 * SMD CTA answered "No Results" — a version/edition descriptor in a parenthetical
 * is metadata, not part of the title. `version` is a marker, so that card cleans
 * to `Fur Elise`; the rest of the family (`Re-recorded`, `Remixed`, `Radio Edit`)
 * is pinned too, together with the over-strip guards: title-bearing parens
 * (`(I Can't Get No) Satisfaction`) and descriptor words INSIDE a title stay.
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

  test("OWNER 09-25 (#3): the Musicnotes backup carries NO w parameter — Musicnotes reads w AS the query", () => {
    // On the owner's phone the search box showed "NoteSnap" and the engine searched
    // that literal word, returning one unrelated fuzzy result; the song title never
    // reached the engine. RC v26 Test 4a finding #3 + Test 5 (two reproductions).
    for (const [title, artist] of [
      ["Just One More Day - Live at the Whisky a Go Go, 1966", "Otis Redding"],
      ["More Than This (2003 Digital Remaster)", "Roxy Music"],
      ["Let It Be", "The Beatles"],
    ] as const) {
      const { musicnotes } = modernRetailerUrls(title, artist);
      expect(musicnotes).toBeDefined();
      const url = new URL(musicnotes!);
      expect(url.hostname).toBe("www.musicnotes.com");
      expect(url.pathname).toBe("/search/go");
      expect(url.searchParams.has("w")).toBe(false);
      expect(musicnotes!).not.toContain("w=NoteSnap");
      expect(musicnotes!).not.toContain("NoteSnap");
      // the query is the ONLY parameter — the engine's `q` is our cleaned title
      expect([...url.searchParams.keys()]).toEqual(["q"]);
    }
  });

  test("OWNER 09-25 (#2): the Musicnotes backup query is the CLEANED title + artist", () => {
    // The backup used to receive the RAW title, so the venue tail
    // (`Just One More Day - Live at the Whisky a Go Go, 1966`) reached Musicnotes'
    // engine, which reads `-` tokens as operators and answered with an unrelated
    // result (the owner's "Sockerfens dans" fuzzy hit, RC v26 Test 4a finding #2).
    const dash = modernRetailerUrls(
      "Just One More Day - Live at the Whisky a Go Go, 1966",
      "Otis Redding",
    );
    expect(new URL(dash.musicnotes!).searchParams.get("q")).toBe(
      "Just One More Day Otis Redding",
    );
    const paren = modernRetailerUrls(
      "More Than This (2003 Digital Remaster)",
      "Roxy Music",
    );
    expect(new URL(paren.musicnotes!).searchParams.get("q")).toBe(
      "More Than This Roxy Music",
    );
    // the artist is still present (the backup keeps both tokens, unlike SMD)
    expect(paren.musicnotes!).toContain("Roxy%20Music");
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
    // the Musicnotes backup gets the SAME cleaned title + the artist (owner 09-25):
    // the bracket noise is gone there too — only the SMD query drops the artist.
    expect(new URL(musicnotes!).searchParams.get("q")).toBe(
      "Bang a Gong (Get it on) T. Rex",
    );
    expect(musicnotes!).not.toContain("Remaster");
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
    // a title-bearing paren survives, spacing is normalised around it
    expect(cleanSmdQuery("  Yesterday   (Get It On)  ")).toBe(
      "Yesterday (Get It On)",
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

  test("OWNER 09-25 (Test 5): 'More Than This (2003 Digital Remaster)' -> 'More Than This'", () => {
    // Roxy Music's More Than This is widely sold as digital sheet music; the
    // parenthetical alone put SMD on its zero-result page on the owner's phone
    // (RC v26 Test 5). A 4-digit year inside a parenthetical is metadata.
    expect(cleanSmdQuery("More Than This (2003 Digital Remaster)")).toBe(
      "More Than This",
    );
    const { primary, musicnotes } = modernRetailerUrls(
      "More Than This (2003 Digital Remaster)",
      "Roxy Music",
    );
    expect(new URL(primary!).searchParams.get("query")).toBe("More Than This");
    expect(primary!).not.toContain("Remaster");
    expect(primary!).not.toContain("2003");
    expect(auditSmdAffiliateUrl(primary!).ok).toBe(true);
    expect(new URL(musicnotes!).searchParams.get("q")).toBe(
      "More Than This Roxy Music",
    );
  });

  test("OWNER 09-25 (Test 4a): the spaced-dash venue tail is dropped, dash AND paren form", () => {
    // The exact title on the owner's card, plus the paren spelling the same
    // metadata takes in other provider payloads.
    expect(
      cleanSmdQuery("Just One More Day - Live at the Whisky a Go Go, 1966"),
    ).toBe("Just One More Day");
    expect(
      cleanSmdQuery("Just One More Day (Live at the Whisky a Go Go, 1966)"),
    ).toBe("Just One More Day");
    expect(cleanSmdQuery("Just One More Day (1966)")).toBe("Just One More Day");

    const { primary, musicnotes } = modernRetailerUrls(
      "Just One More Day - Live at the Whisky a Go Go, 1966",
      "Otis Redding",
    );
    expect(new URL(primary!).searchParams.get("query")).toBe("Just One More Day");
    expect(primary!).not.toContain("Whisky");
    expect(primary!).not.toContain("1966");
    expect(new URL(musicnotes!).searchParams.get("q")).toBe(
      "Just One More Day Otis Redding",
    );
  });

  test("REGRESSION: title-bearing parens are never stripped, and a real ' - ' duet survives", () => {
    // The two "keep" cases the owner's data needs, plus the over-strip guard:
    // only a segment carrying a marker/year is cut, so an ordinary dashed title
    // is left alone.
    expect(cleanSmdQuery("(I Can't Get No) Satisfaction")).toBe(
      "(I Can't Get No) Satisfaction",
    );
    expect(cleanSmdQuery("Bang a Gong (Get It On)")).toBe("Bang a Gong (Get It On)");
    expect(cleanSmdQuery("(Sittin' On) The Dock of the Bay")).toBe(
      "(Sittin' On) The Dock of the Bay",
    );
    expect(cleanSmdQuery("Me and My Friend - Part 1")).toBe(
      "Me and My Friend - Part 1",
    );
    expect(cleanSmdQuery("Islands - A Duet")).toBe("Islands - A Duet");
    // a real paren title by an artist whose song ALSO has a live version: only the
    // noisy paren goes when it is the noisy one.
    expect(cleanSmdQuery("Get It On (Live at the Fillmore, 1971)")).toBe(
      "Get It On",
    );
    expect(cleanSmdQuery("Get It On (Bang a Gong)")).toBe(
      "Get It On (Bang a Gong)",
    );
  });

  test("the bare-code guard runs on the CLEANED string", () => {
    // without cleanup this would pass the guard (it has a whitespace) and be
    // searched; cleaned, it is a bare code -> no link.
    expect(cleanSmdQuery("AUAP*600001 [2003 Remaster]")).toBe("AUAP*600001");
    expect(
      modernRetailerUrls("AUAP*600001 [2003 Remaster]", "Some Artist"),
    ).toEqual({});
  });

  test("OWNER 09-25 RC v26 (#2): 'Fur Elise (Piano Version)' -> 'Fur Elise'", () => {
    // The owner's exact modern card (RC v26 on-device re-test #2): the SMD CTA
    // for this title answered "No Results" because the version descriptor was not
    // treated as metadata. `version` is a marker, so the paren goes; the card is
    // pinned because it is the one that dead-ended on his phone.
    expect(cleanSmdQuery("Fur Elise (Piano Version)")).toBe("Fur Elise");
    // umlaut spelling: the accent is preserved, never transliterated
    expect(cleanSmdQuery("Für Elise (Piano Version)")).toBe("Für Elise");
    expect(cleanSmdQuery("Fur Elise (Guitar Version)")).toBe("Fur Elise");
    expect(cleanSmdQuery("Fur Elise (Instrumental)")).toBe("Fur Elise");
    expect(cleanSmdQuery("Fur Elise (Remastered)")).toBe("Fur Elise");
    // `Piano` alone is NOT a version descriptor — the paren stays (conservative)
    expect(cleanSmdQuery("Fur Elise (Piano)")).toBe("Fur Elise (Piano)");

    const { primary, musicnotes } = modernRetailerUrls(
      "Fur Elise (Piano Version)",
      "Lang Lang",
    );
    // SMD primary: the searchable title only, descriptor gone, artist never added
    expect(new URL(primary!).searchParams.get("query")).toBe("Fur Elise");
    expect(primary!).not.toContain("Version");
    expect(primary!).not.toContain("Lang");
    expect(auditSmdAffiliateUrl(primary!).ok).toBe(true);
    // Musicnotes backup: cleaned title + artist, and NO `w` parameter (the old
    // live bug made Musicnotes search the literal word "NoteSnap")
    expect(new URL(musicnotes!).searchParams.get("q")).toBe("Fur Elise Lang Lang");
    expect(musicnotes!).not.toContain("w=");
    expect(musicnotes!).not.toContain("NoteSnap");

    // REGRESSION: title-bearing parens are never stripped by the version rule
    expect(cleanSmdQuery("(I Can't Get No) Satisfaction")).toBe(
      "(I Can't Get No) Satisfaction",
    );
  });

  test("the re-record / remix / radio-edit variants are metadata too", () => {
    // Same family as `(Piano Version)`: provider-side audio variants that SMD's
    // token matcher scores to zero. `remaster` never covered `Re-recorded`, and
    // `\bremix\b` never matched `Remixed`.
    expect(cleanSmdQuery("Fur Elise (Re-recorded)")).toBe("Fur Elise");
    expect(cleanSmdQuery("Fur Elise (rerecorded)")).toBe("Fur Elise");
    expect(cleanSmdQuery("Fur Elise (re-recording)")).toBe("Fur Elise");
    expect(cleanSmdQuery("Song (Remixed)")).toBe("Song");
    expect(cleanSmdQuery("Song (Remixes)")).toBe("Song");
    expect(cleanSmdQuery("Song (Radio Edit)")).toBe("Song");
    expect(cleanSmdQuery("Song (Single Edit)")).toBe("Song");
    // the spaced-dash spelling of the same metadata is cut like any other tail
    expect(cleanSmdQuery("Song - Re-recorded")).toBe("Song");
  });

  test("a descriptor word INSIDE the title is never touched", () => {
    // The over-strip guard for this pass: markers only ever remove a
    // parenthetical section or a spaced-dash tail, never a title's own words.
    expect(cleanSmdQuery("Live and Let Die")).toBe("Live and Let Die");
    expect(cleanSmdQuery("Version of Me")).toBe("Version of Me");
    expect(cleanSmdQuery("Mixed Messages")).toBe("Mixed Messages");
    // a hyphen inside a word is not a spaced-dash tail
    expect(cleanSmdQuery("Re-Recorded Love")).toBe("Re-Recorded Love");
  });
});
