/**
 * Regression tests for the piece -> reference-melody resolver (SITE WAVE 1b, P2).
 *
 * The site holds nine bundled melodies but a piece page is addressed by a
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

  test("matches the live catalog row for the Air on the G String (seed #9)", () => {
    // The owner-reported gap (build #3): the Air page showed "reference melody
    // coming soon" because only 8 seeds existed. The live row is
    // {"title":"Air on the G String","composer":"Johann Sebastian Bach",
    //  "catalog":"BWV 1068"} — id 0e1e4700-dc96-47f5-8ef9-11c7324150ef, read from
    // https://site-notesnap.vercel.app/api/pieces/0e1e4700-... on 2026-09-25.
    const hit = resolvePieceMelody({
      title: "Air on the G String",
      composer: "Johann Sebastian Bach",
    });
    expect(hit?.seed.pieceId).toBe("air-on-the-g-string");
    expect(hit?.matchedBy).toBe("title");
    expect(hit?.abc).toContain("K:D");
    // Byte-identity guard: this literal is pinned in the app repo's
    // scripts/coachRun.test.ts (AIR_SEED_ABC) too — the two surfaces must keep
    // handing the coach / hum matcher the very same abc string.
    expect(hit?.abc).toBe(
      [
        "X:1",
        "T:Air on the G String (practice phrase)",
        "C:Johann Sebastian Bach",
        "M:4/4",
        "L:1/8",
        "K:D",
        "^f8 | ^f b/2 g/2 e/2 d/2 ^c/2 d/2 ^c2 A2 | a4 a/2 ^f/2 =c/2 B/2 e/2 ^d/2 a/2 g/2 | g4 g/2 e/2 B/2 A/2 d/2 ^c/2 g/2 ^f/2 |]",
      ].join("\n"),
    );
    // The resolver (page widget) and the hum store must hand out the SAME abc.
    expect(melodySeedBySlug("air-on-the-g-string")?.abc).toBe(hit?.abc);
  });

  test("the Air seed never steals another piece's melody", () => {
    // A different Bach piece must not inherit the Air melody...
    expect(
      resolvePieceMelody({ title: "Prelude in C Major", composer: "Johann Sebastian Bach" }),
    ).toBeNull();
    // ...and a loose Air title with the wrong composer must not match either.
    expect(
      resolvePieceMelody({ title: "Air on the G String (BWV 1068)", composer: "Edvard Grieg" }),
    ).toBeNull();
    // ...while the same loose title + Bach does.
    expect(
      resolvePieceMelody({ title: "Air on the G String (BWV 1068)", composer: "Johann Sebastian Bach" })
        ?.seed.pieceId,
    ).toBe("air-on-the-g-string");
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

  test("all nine seeded melodies are carried by exactly nine seeds", () => {
    expect(MELODY_SEED_COUNT).toBe(9);
    expect(new Set(MELODY_SEED_TITLES).size).toBe(9);
    // The Air seed (build #3) must be present with the display title the piece
    // page shows — its words are what the resolver matches on.
    expect(MELODY_SEED_TITLES).toContain("Air on the G String");
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
