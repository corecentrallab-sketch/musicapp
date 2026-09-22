/**
 * Regression tests for the piece-page affiliate link builder (SITE WAVE 1a).
 *
 * Owner direction 09-18: every piece page carries an affiliate CTA, and the
 * catalog API exposes the same URL as `affiliate_url`, so app and site share one
 * attribution path. Sheet Music Direct (affiliate ID 67650) is primary; the
 * Musicnotes fallback must never be the normal path.
 *
 * Run with: bun test src/services/piece-affiliate.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  MUSICNOTES_RETAILER_NAME,
  SMD_RETAILER_NAME,
  pieceAffiliateLink,
  pieceAffiliateQuery,
  pieceAffiliateUrl,
} from "./piece-affiliate";
import { sheetMusicDirectSearchUrl } from "./modern-retailer";
import {
  SMD_AFFILIATE_ID,
  SMD_SEARCH_PATH,
  auditSmdAffiliateUrl,
  isDeadSmdSearchUrl,
} from "./affiliate-url-contract";

describe("pieceAffiliateQuery", () => {
  test("joins title and composer", () => {
    expect(
      pieceAffiliateQuery("Bagatelle in A Minor (Fur Elise)", "Ludwig van Beethoven"),
    ).toBe("Bagatelle in A Minor (Fur Elise) Ludwig van Beethoven");
  });

  test("skips a missing composer instead of leaving a trailing space", () => {
    expect(pieceAffiliateQuery("Greensleeves", "")).toBe("Greensleeves");
    expect(pieceAffiliateQuery("Greensleeves", "   ")).toBe("Greensleeves");
  });

  test("collapses whitespace and trims both parts", () => {
    expect(pieceAffiliateQuery("  Clair   de  Lune ", " Claude  Debussy ")).toBe(
      "Clair de Lune Claude Debussy",
    );
  });

  test("empty title and composer -> empty query", () => {
    expect(pieceAffiliateQuery("", "")).toBe("");
    expect(pieceAffiliateQuery("   ", "")).toBe("");
  });
});

describe("pieceAffiliateLink (Sheet Music Direct primary)", () => {
  test("classical piece -> SMD deep link carrying affiliate ID 67650", () => {
    const link = pieceAffiliateLink("Für Elise", "Ludwig van Beethoven");
    expect(link).not.toBeNull();
    expect(link!.retailer).toBe(SMD_RETAILER_NAME);
    expect(link!.usedFallback).toBe(false);
    expect(link!.url).toContain(
      `https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}`,
    );
    expect(link!.url).toContain(
      `query=${encodeURIComponent("Für Elise Ludwig van Beethoven")}`,
    );
    expect(link!.url).toContain(`tid=${SMD_AFFILIATE_ID}`);
    expect(link!.url).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
    expect(auditSmdAffiliateUrl(link!.url).ok).toBe(true);
  });

  test("title-only piece (no composer) still builds an SMD link", () => {
    const link = pieceAffiliateLink("Greensleeves", "");
    expect(link!.usedFallback).toBe(false);
    expect(link!.query).toBe("Greensleeves");
    expect(link!.url).toBe(sheetMusicDirectSearchUrl("Greensleeves")!);
  });

  test("no title -> null (no CTA, never a dead link)", () => {
    expect(pieceAffiliateLink("", "Anonymous")).toBeNull();
    expect(pieceAffiliateUrl("", "Anonymous")).toBeNull();
  });

  test("musicnotes fallback is used only when the SMD builder fails", () => {
    const link = pieceAffiliateLink("Any Piece", "Any Composer", {
      sheetMusicDirect: () => undefined,
      musicnotes: () => "https://www.musicnotes.com/search/go?q=Any&w=NoteSnap",
    });
    expect(link).not.toBeNull();
    expect(link!.usedFallback).toBe(true);
    expect(link!.retailer).toBe(MUSICNOTES_RETAILER_NAME);
    expect(link!.url).toContain("musicnotes.com");
  });

  test("both builders failing -> null", () => {
    const link = pieceAffiliateLink("Any Piece", "Any Composer", {
      sheetMusicDirect: () => undefined,
      musicnotes: () => undefined,
    });
    expect(link).toBeNull();
  });

  test("every default-path URL is affiliate-attributed and on the live route", () => {
    const titles = [
      ["Für Elise", "Ludwig van Beethoven"],
      ["Air on the G String", "Johann Sebastian Bach"],
      ["Greensleeves", ""],
    ] as const;
    for (const [title, composer] of titles) {
      const url = pieceAffiliateUrl(title, composer);
      expect(url).toContain(`tid=${SMD_AFFILIATE_ID}`);
      expect(url).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
      expect(isDeadSmdSearchUrl(url!)).toBe(false);
      expect(auditSmdAffiliateUrl(url!).ok).toBe(true);
    }
  });
});
