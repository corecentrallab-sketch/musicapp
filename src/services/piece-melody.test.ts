/**
 * Regression tests for the piece -> reference-melody resolver (SITE WAVE 1b, P2).
 *
 * The site holds eight bundled melodies but a piece page is addressed by a
 * catalog UUID, so the widget must resolve by NORMALISED TITLE + COMPOSER. The
 * titles below are the real catalog titles, read from the live
 * `/api/pieces` on 2026-09-18 (see docs/SITE-WAVE1B.md) — including the honest
 * cases where a seed has no piece in the catalog at all and the page must show
 * "coming soon" instead of a wrong melody.
 *
 * Run with: bun test src/services/piece-melody.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  MELODY_SEED_COUNT,
  MELODY_SEED_TITLES,
  melodySeedBySlug,
  normalizePieceKey,
  resolvePieceMelody,
} from "./piece-melody";

describe("normalizePieceKey", () => {
  test("strips diacritics, punctuation and case", () => {
    expect(normalizePieceKey("Für Elise")).toBe("fur elise");
    expect(normalizePieceKey("Für Elise (WoO 59)")).toBe("fur elise woo 59");
    expect(normalizePieceKey("  Twinkle,  Twinkle, Little Star  ")).toBe(
      "twinkle twinkle little star",
    );
  });

  test("returns an empty key for missing values", () => {
    expect(normalizePieceKey(null)).toBe("");
    expect(normalizePieceKey(undefined)).toBe("");
    expect(normalizePieceKey("   ")).toBe("");
  });
});

describe("resolvePieceMelody", () => {
  test("matches a seed title exactly, accent-insensitively", () => {
    const hit = resolvePieceMelody({ title: "Fur Elise", composer: "Ludwig van Beethoven" });
    expect(hit?.seed.pieceId).toBe("fur-elise");
    expect(hit?.matchedBy).toBe("title");
    expect(hit?.abc).toContain("K:Am");
  });

  test("matches the live catalog title for Für Elise (loose title + composer)", () => {
    const hit = resolvePieceMelody({
      title: "Bagatelle in A Minor (Für Elise)",
      composer: "Ludwig van Beethoven",
    });
    expect(hit?.seed.pieceId).toBe("fur-elise");
    expect(hit?.matchedBy).toBe("title-composer");
  });

  test("matches the live catalog title for Ode to Joy", () => {
    const hit = resolvePieceMelody({
      title: "Symphony No. 9 in D Minor (Choral) — Ode to Joy",
      composer: "Ludwig van Beethoven",
    });
    expect(hit?.seed.pieceId).toBe("ode-to-joy");
  });

  test("matches the live catalog title for Canon in D", () => {
    const hit = resolvePieceMelody({
      title: "Canon in D Major (piano arrangement)",
      composer: "Johann Pachelbel",
    });
    expect(hit?.seed.pieceId).toBe("canon-in-d");
  });

  test("every seeded title resolves to itself", () => {
    for (const title of MELODY_SEED_TITLES) {
      const hit = resolvePieceMelody({ title });
      expect(hit?.seed.title).toBe(title);
    }
  });

  test("a related title with a different composer does NOT match", () => {
    expect(
      resolvePieceMelody({ title: "Canon in D Major", composer: "Someone Else" }),
    ).toBeNull();
  });

  test("an unrelated piece does NOT match (no wrong reference melody)", () => {
    expect(
      resolvePieceMelody({ title: "Prelude in C Major", composer: "Johann Sebastian Bach" }),
    ).toBeNull();
    expect(
      resolvePieceMelody({ title: "Clair de Lune", composer: "Claude Debussy" }),
    ).toBeNull();
  });

  test("the Mozart variations on the Twinkle theme stay unmatched (honest gap)", () => {
    // The catalog's only Twinkle-family piece is titled after the variations, not
    // the song; the seed title cannot be matched to it safely, so the page shows
    // "reference melody coming soon" rather than playing the wrong thing.
    expect(
      resolvePieceMelody({
        title: "Twelve Variations on 'Ah vous dirai-je, Maman' (K. 265)",
        composer: "Wolfgang Amadeus Mozart",
      }),
    ).toBeNull();
  });

  test("missing/blank titles resolve to null", () => {
    expect(resolvePieceMelody({ title: "" })).toBeNull();
    expect(resolvePieceMelody({ title: null, composer: "Ludwig van Beethoven" })).toBeNull();
    expect(resolvePieceMelody({})).toBeNull();
  });

  test("all eight seeded melodies are carried by exactly eight seeds", () => {
    expect(MELODY_SEED_COUNT).toBe(8);
    expect(new Set(MELODY_SEED_TITLES).size).toBe(8);
  });
});

describe("melodySeedBySlug", () => {
  test("finds a seed by the slug /api/hum returns", () => {
    expect(melodySeedBySlug("anvil-chorus")?.title).toBe("Anvil Chorus");
  });

  test("returns null for an unknown or missing slug", () => {
    expect(melodySeedBySlug("not-a-seed")).toBeNull();
    expect(melodySeedBySlug(null)).toBeNull();
  });
});
