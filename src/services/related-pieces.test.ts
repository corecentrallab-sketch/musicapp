/**
 * Regression tests for the related-pieces selection (SITE WAVE 1b, P3).
 *
 * The piece page's "More by <composer>" and "Pieces at the same level" blocks are
 * built from what the live public API can answer (`?composer=`, plus one
 * max-size catalog sample) — there is no similar-pieces endpoint. These tests pin
 * the honesty rules: no current piece, no duplicates across the two blocks, no
 * invented difficulty, and an empty result (no block) rather than padding.
 *
 * Run with: bun test src/services/related-pieces.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  MORE_BY_COMPOSER_LIMIT,
  SAME_LEVEL_LIMIT,
  pickMoreByComposer,
  pickSameLevel,
  type RelatedPieceLike,
} from "./related-pieces";

const piece = (
  id: string,
  title: string,
  composer: string,
  difficulty_label: string | null,
): RelatedPieceLike => ({ id, title, composer, difficulty_label });

const CURRENT = "11111111-1111-1111-1111-111111111111";

describe("pickMoreByComposer", () => {
  const catalog = [
    piece(CURRENT, "Bagatelle in A Minor (Für Elise)", "Ludwig van Beethoven", "Beginner"),
    piece("b2", "Symphony No. 9 — Ode to Joy", "Ludwig van Beethoven", "Intermediate"),
    piece("b3", "Moonlight Sonata", "ludwig van beethoven", "Intermediate"),
    piece("c1", "Clair de Lune", "Claude Debussy", "Intermediate"),
    piece("c2", "Arabesque No. 1", "Claude Debussy", "Advanced"),
  ];

  test("returns only other pieces by the same composer", () => {
    const out = pickMoreByComposer(catalog, {
      currentId: CURRENT,
      composer: "Ludwig van Beethoven",
    });
    expect(out.map((p) => p.id)).toEqual(["b2", "b3"]);
  });

  test("a composer with a single piece yields nothing (no padded block)", () => {
    const alone = pickMoreByComposer(catalog.slice(0, 1), {
      currentId: CURRENT,
      composer: "Ludwig van Beethoven",
    });
    expect(alone).toEqual([]);
    expect(
      pickMoreByComposer(catalog, { currentId: CURRENT, composer: "Claude Debussy" })
        .map((p) => p.id),
    ).toEqual(["c1", "c2"]);
  });

  test("excludes the piece being viewed", () => {
    const out = pickMoreByComposer(catalog, {
      currentId: "b2",
      composer: "Ludwig van Beethoven",
    });
    expect(out.map((p) => p.id)).toEqual([CURRENT, "b3"]);
  });

  test("an empty composer yields nothing", () => {
    expect(pickMoreByComposer(catalog, { currentId: CURRENT, composer: "  " })).toEqual([]);
  });

  test("honours the limit and deduplicates by id", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      piece(`x${i}`, `Piece ${i}`, "Fryderyk Chopin", "Beginner"),
    );
    const out = pickMoreByComposer([...many, many[0]], {
      currentId: CURRENT,
      composer: "Fryderyk Chopin",
    });
    expect(out).toHaveLength(MORE_BY_COMPOSER_LIMIT);
    expect(new Set(out.map((p) => p.id)).size).toBe(MORE_BY_COMPOSER_LIMIT);
  });

  test("drops malformed rows instead of rendering a dead link", () => {
    const out = pickMoreByComposer(
      [
        { id: "", title: "No id", composer: "Ludwig van Beethoven", difficulty_label: null },
        { id: "b9", title: "   ", composer: "Ludwig van Beethoven", difficulty_label: null },
        piece("b2", "Symphony No. 9", "Ludwig van Beethoven", "Intermediate"),
      ],
      { currentId: CURRENT, composer: "Ludwig van Beethoven" },
    );
    expect(out.map((p) => p.id)).toEqual(["b2"]);
  });
});

describe("pickSameLevel", () => {
  const sample = [
    piece(CURRENT, "Bagatelle in A Minor (Für Elise)", "Ludwig van Beethoven", "Beginner"),
    piece("a1", "Minuet in G", "Christian Petzold", "beginner"),
    piece("a2", "Ode to Joy", "Ludwig van Beethoven", "Beginner"),
    piece("a3", "Prelude in C", "Johann Sebastian Bach", "Intermediate"),
    piece("a4", "Étude Op. 10 No. 3", "Fryderyk Chopin", null),
  ];

  test("matches the difficulty label case-insensitively, excluding the current piece", () => {
    const out = pickSameLevel(sample, {
      currentId: CURRENT,
      difficultyLabel: "Beginner",
    });
    expect(out.map((p) => p.id)).toEqual(["a1", "a2"]);
  });

  test("excludes ids already used by another block", () => {
    const out = pickSameLevel(sample, {
      currentId: CURRENT,
      difficultyLabel: "Beginner",
      excludeIds: ["a1"],
    });
    expect(out.map((p) => p.id)).toEqual(["a2"]);
  });

  test("no difficulty label means no block", () => {
    expect(
      pickSameLevel(sample, { currentId: CURRENT, difficultyLabel: null }),
    ).toEqual([]);
    expect(
      pickSameLevel(sample, { currentId: CURRENT, difficultyLabel: "  " }),
    ).toEqual([]);
  });

  test("pieces without a label never fill the block", () => {
    const out = pickSameLevel(sample, {
      currentId: CURRENT,
      difficultyLabel: "Advanced",
    });
    expect(out).toEqual([]);
  });

  test("honours the limit", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      piece(`y${i}`, `Beginner piece ${i}`, "Anon", "Beginner"),
    );
    const out = pickSameLevel(many, { currentId: CURRENT, difficultyLabel: "Beginner" });
    expect(out).toHaveLength(SAME_LEVEL_LIMIT);
  });
});
