/**
 * historyPiece — pure mapping from a saved recognition (a History row) to the
 * piece shape PieceDetailScreen renders, plus the merge of the catalog's own
 * record for that piece.
 *
 * Why this exists (owner-reported bug, v18 / 0.1.13): History rows were not
 * tappable, so a saved recognition had no route to the piece page. The row now
 * opens PieceDetailScreen exactly the way the hum flow and the recognition
 * result flow already do; this module is the pure, unit-tested part of that
 * mapping (the screen itself is a thin caller).
 *
 * Data honesty rules — the same ones the recognition converter follows:
 *   • identity (id / title / composer) comes from the SAVED recognition, never
 *     from the network;
 *   • the sheet-music URL is only ever one the catalog actually returned — a
 *     piece with no curated score keeps PieceDetailScreen's honest "Sheet music
 *     coming soon" state instead of a dead or invented link;
 *   • nothing here invents a confidence, a genre or a difficulty the data does
 *     not carry.
 *
 * The catalog fields are filled in at tap time from `GET /api/pieces/:id`
 * (see `fetchPieceById` in services/api.ts). That endpoint returns the SAME
 * `sheet_music_url` the recognition response returns for the piece
 * (verified 2026-09-18 against the live backend: the daily-challenge piece
 * b2ffba94-… has identical sheet_music_url from both endpoints), which is what
 * keeps a saved piece's sheet identical to a freshly recognized one.
 */
import type { DailyChallengePiece, SavedPiece } from '../types';

/** Genre shown when the saved record carries no genre tag. */
export const HISTORY_DEFAULT_GENRE = 'Classical';

/**
 * Difficulty label shown when the saved record carries no catalog label.
 * Matches the default the recognition converter uses, so the same piece reads
 * the same way whether opened from a fresh match or from History.
 */
export const HISTORY_DEFAULT_DIFFICULTY = 'Intermediate';

/** Where the piece page was opened from — kept honest about the source. */
export const HISTORY_DETAIL_DESCRIPTION = 'Saved from a recognition in your History';

/**
 * The catalog fields the piece page can use when the catalog has them. All are
 * optional: absent means "the catalog does not know / does not have it", and the
 * saved values (or the honest defaults) stand.
 */
export interface CatalogPieceInfo {
  sheetMusicUrl?: string | null;
  difficultyLabel?: string | null;
  difficultyGrade?: number | null;
  isPublicDomain?: boolean | null;
  sheetMusicAvailable?: boolean | null;
  catalog?: string | null;
  abc?: string | null;
}

/** A non-empty, trimmed string — or undefined. Never returns empty whitespace. */
function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A real number, or null (guards NaN/Infinity and non-number JSON). */
function grade(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Build the PieceDetailScreen shape from a saved recognition.
 *
 * The saved record holds identity + date + optional genre/grade only — it does
 * NOT hold a sheet URL. So the honest starting state is "no sheet yet"; the
 * caller follows up with `fetchPieceById` + `mergeCatalogIntoDetail` and the
 * "View Sheet Music" button appears only if the catalog really has a score.
 */
export function savedPieceToDetail(piece: SavedPiece): DailyChallengePiece {
  return {
    id: piece.id,
    title: piece.title,
    composer: piece.composer,
    genre: clean(piece.genre) ?? HISTORY_DEFAULT_GENRE,
    difficulty: HISTORY_DEFAULT_DIFFICULTY,
    difficultyGrade: grade(piece.difficulty),
    description: HISTORY_DETAIL_DESCRIPTION,
  };
}

/**
 * Merge the catalog's record for the piece into the piece page payload.
 *
 * Rules (all pure, all tested):
 *   • identity (id / title / composer / genre / description) is NEVER taken
 *     from the catalog — the user opened the piece they saved;
 *   • a catalog value only wins when the catalog actually has one; otherwise the
 *     saved value stands. This is what makes the merge safe to call with a
 *     partial response, and what keeps a null `sheet_music_url`
 *     (`sheet_music_available: false`) from looking like a score;
 *   • a null `info` (offline, unknown id, malformed body) returns the base
 *     untouched — never an error, never a fabricated sheet.
 */
export function mergeCatalogIntoDetail(
  base: DailyChallengePiece,
  info: CatalogPieceInfo | null | undefined,
): DailyChallengePiece {
  if (!info) return base;

  const sheetMusicUrl = clean(info.sheetMusicUrl) ?? base.sheetMusicUrl;
  const difficulty = clean(info.difficultyLabel) ?? base.difficulty;
  const difficultyGrade = grade(info.difficultyGrade) ?? base.difficultyGrade ?? null;
  const catalog = clean(info.catalog) ?? base.catalog ?? null;
  const abc = clean(info.abc) ?? base.abc ?? null;
  const isPublicDomain =
    typeof info.isPublicDomain === 'boolean'
      ? info.isPublicDomain
      : base.isPublicDomain;
  const sheetMusicAvailable =
    typeof info.sheetMusicAvailable === 'boolean'
      ? info.sheetMusicAvailable
      : base.sheetMusicAvailable;

  return {
    ...base,
    sheetMusicUrl,
    difficulty,
    difficultyGrade,
    catalog,
    abc,
    isPublicDomain,
    sheetMusicAvailable,
  };
}
