/**
 * related-pieces.ts — the pure selection behind the piece page's
 * "More by <composer>" / "Pieces at the same level" blocks (SITE WAVE 1b, P3).
 *
 * The live public API (`/api/pieces`) supports `?q`, `?composer`, `?limit`
 * (≤50) and `?offset` and nothing else — there is no "similar pieces" endpoint
 * and no difficulty filter. So the page asks the API for the two lists it CAN
 * ask for (a composer query, and one maximum-size sample of the catalog) and the
 * filtering/trimming happens here, as pure functions.
 *
 * Honesty rules: never show the piece you are already on, never repeat a piece
 * across the two blocks, never invent a difficulty, and render NOTHING rather
 * than a padded or wrong list (a composer with one piece gets no block; a level
 * with no other piece in the sample gets no block).
 */
import { normalizePieceKey } from "./piece-melody";

/** The fields both blocks need — a `CatalogPiece` satisfies this structurally. */
export interface RelatedPieceLike {
  id: string;
  title: string;
  composer: string;
  difficulty_label: string | null;
}

/** "More by <composer>": 3–5 links (we ask the API for a few more than we show). */
export const MORE_BY_COMPOSER_LIMIT = 5;
/** "Pieces at the same level": a small row of alternatives. */
export const SAME_LEVEL_LIMIT = 4;
/**
 * How much of the catalog we sample for the same-level block. The live API caps
 * `limit` at 50, and there is no difficulty filter on the endpoint, so this is a
 * SAMPLE of the catalog (ordered by title), not the whole of it: the block can
 * therefore show fewer alternatives than the catalog holds at that level. We show
 * what the API can honestly answer and nothing when that is nothing.
 */
export const SAME_LEVEL_SAMPLE_LIMIT = 50;

function isUsable(piece: RelatedPieceLike): boolean {
  return (
    typeof piece?.id === "string" &&
    piece.id !== "" &&
    typeof piece.title === "string" &&
    piece.title.trim() !== ""
  );
}

/** Deduplicate by id, keeping the first occurrence (API order is stable). */
function uniqueById(pieces: readonly RelatedPieceLike[]): RelatedPieceLike[] {
  const seen = new Set<string>();
  const out: RelatedPieceLike[] = [];
  for (const piece of pieces) {
    if (!isUsable(piece) || seen.has(piece.id)) continue;
    seen.add(piece.id);
    out.push(piece);
  }
  return out;
}

/**
 * Other pieces by the same composer. Matching is diacritic/case-insensitive on
 * the whole composer string (`Fauré` = `Faure`), so a piece credited
 * "Ludwig van Beethoven" is never offered next to "L. v. Beethoven" by accident
 * — but the same spelling in a different case or accent still counts.
 */
export function pickMoreByComposer(
  pieces: readonly RelatedPieceLike[],
  opts: { currentId: string; composer: string; limit?: number },
): RelatedPieceLike[] {
  const wanted = normalizePieceKey(opts.composer);
  if (wanted === "") return [];
  const limit = opts.limit ?? MORE_BY_COMPOSER_LIMIT;
  return uniqueById(pieces)
    .filter((piece) => piece.id !== opts.currentId)
    .filter((piece) => normalizePieceKey(piece.composer) === wanted)
    .slice(0, Math.max(0, limit));
}

/**
 * Other pieces at the same difficulty level, from the catalog sample the caller
 * fetched. `excludeIds` keeps a piece from appearing in both blocks; a null or
 * empty label yields nothing (we never guess a level for a piece that has none).
 */
export function pickSameLevel(
  pieces: readonly RelatedPieceLike[],
  opts: {
    currentId: string;
    difficultyLabel: string | null | undefined;
    excludeIds?: readonly string[];
    limit?: number;
  },
): RelatedPieceLike[] {
  const wanted = normalizePieceKey(opts.difficultyLabel ?? "");
  if (wanted === "") return [];
  const limit = opts.limit ?? SAME_LEVEL_LIMIT;
  const excluded = new Set<string>([opts.currentId, ...(opts.excludeIds ?? [])]);
  return uniqueById(pieces)
    .filter((piece) => !excluded.has(piece.id))
    .filter((piece) => normalizePieceKey(piece.difficulty_label ?? "") === wanted)
    .slice(0, Math.max(0, limit));
}
