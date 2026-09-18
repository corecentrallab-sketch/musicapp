/**
 * piece-melody.ts — which reference melody belongs to a catalog piece
 * (SITE WAVE 1b, P2: the "play the melody" widget).
 *
 * The site holds exactly eight public-domain reference melodies, bundled as ABC
 * in `hum/melody-seeds.ts` (MELODY_SEEDS) — the same byte-identical seed list the
 * hum-to-search recogniser searches and the app's practice coach practices
 * against. Those seeds carry **slug** ids (`fur-elise`), while a piece page is
 * addressed by a catalog **UUID**, and the same title can be written several ways
 * ("Für Elise" / "Fur Elise" / "Bagatelle in A Minor (Für Elise)").
 *
 * So a piece page can never join on id. This module is the resolver: it matches
 * a catalog piece to a seed by NORMALISED TITLE + COMPOSER, ported from the app's
 * `src/services/pieceAbc.ts` (`resolvePieceAbc` / `normalizePieceKey`) so the two
 * surfaces agree about what a piece's reference melody is.
 *
 * Matching is deliberately conservative — a wrong reference melody is worse than
 * no melody at all, so an unmatched piece returns null and the page shows the
 * honest "coming soon" state. Only these eight titles can ever match:
 *   Für Elise · Ode to Joy · Twinkle, Twinkle, Little Star · Greensleeves ·
 *   Jingle Bells · Canon in D · Happy Birthday · Anvil Chorus
 *
 * Pure: no network, no database, no environment. Testable under plain bun test.
 */
import { MELODY_SEEDS, type AbcSeed } from "./hum/melody-seeds";

/** The eight bundled melodies — exported so tests/UI can state the honest scope. */
export const MELODY_SEED_COUNT = MELODY_SEEDS.length;
export const MELODY_SEED_TITLES: string[] = MELODY_SEEDS.map((seed) => seed.title);

/**
 * Fold a title to a comparable key: lower-case, diacritics stripped (Für =
 * fur), punctuation dropped, whitespace collapsed. Handles the ways our own data
 * writes these titles ("Für Elise" vs "Fur Elise" vs "…(Für Elise)").
 */
export function normalizePieceKey(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    // Combining marks (the umlaut in Für) are dropped by the strip below.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Composer surname, for the title+composer agreement check. */
function composerKey(composer: string | null | undefined): string {
  const key = normalizePieceKey(composer);
  if (!key) return "";
  const parts = key.split(" ");
  return parts[parts.length - 1] ?? "";
}

/** First two words of a title key — "fur elise (excerpt)" vs "fur elise woO 59". */
function leadingWords(key: string): string {
  return key.split(" ").slice(0, 2).join(" ");
}

export type MelodyMatchKind = "title" | "title-composer";

export interface ResolvedPieceMelody {
  /** The bundled seed whose ABC is the reference melody for this piece. */
  seed: AbcSeed;
  /** The ABC text to synthesise (embedded in the page — no fetch, works offline). */
  abc: string;
  /** How the match was made, for diagnostics and honest copy. */
  matchedBy: MelodyMatchKind;
}

/**
 * Resolve a catalog piece to one of the bundled reference melodies.
 *
 * Order (matches the app's resolver): exact normalised title, then a related
 * title — one key containing the other, or the same leading two words — but only
 * when the composer's surname agrees. Returns null when nothing is safe to match.
 */
export function resolvePieceMelody(input: {
  title?: string | null;
  composer?: string | null;
}): ResolvedPieceMelody | null {
  const titleKey = normalizePieceKey(input?.title);
  if (titleKey === "") return null;

  const exact = MELODY_SEEDS.find(
    (seed) => normalizePieceKey(seed.title) === titleKey,
  );
  if (exact) return { seed: exact, abc: exact.abc, matchedBy: "title" };

  const wantedComposer = composerKey(input?.composer);
  const related = MELODY_SEEDS.find((seed) => {
    const seedTitle = normalizePieceKey(seed.title);
    const isRelated =
      seedTitle.includes(titleKey) ||
      titleKey.includes(seedTitle) ||
      leadingWords(seedTitle) === leadingWords(titleKey);
    if (!isRelated) return false;
    // Without a composer to compare we accept the title relation alone; with one,
    // it has to agree — otherwise we would hand a Beethoven piece the wrong tune.
    if (wantedComposer === "") return true;
    return composerKey(seed.composer) === wantedComposer;
  });

  return related
    ? { seed: related, abc: related.abc, matchedBy: "title-composer" }
    : null;
}

/**
 * Look a seed up by the slug `/api/hum` returns — unused by the piece page
 * (which has no slug) but keeps the site's seed identity in one place.
 */
export function melodySeedBySlug(slug: string | null | undefined): AbcSeed | null {
  if (typeof slug !== "string" || slug === "") return null;
  return MELODY_SEEDS.find((seed) => seed.pieceId === slug) ?? null;
}
