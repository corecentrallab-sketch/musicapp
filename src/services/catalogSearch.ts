/**
 * catalogSearch — the pure half of the "Find a piece" screen.
 *
 * The screen is a thin caller over `GET /api/pieces?q=` (live 2026-09-18:
 * `?q=fur` → Für Elise, `?q=beethoven` → 50, `?q=zzzznope` → 0). Everything
 * that could be wrong in a way a test can catch lives here:
 *
 *   • parseCatalogSearchResponse() — the API's JSON → rows, or null for a
 *     malformed body (the caller shows an honest error + retry, never a
 *     fabricated list and never a silent "no results");
 *   • sortPiecesForDisplay()       — sheet-music-ready pieces first, then
 *     alphabetical, so the browsable first page is the most useful one;
 *   • buildSearchPath()/buildSearchUrl() — one place that knows how a query
 *     becomes a URL (encoding included);
 *   • catalogPieceToDetail()       — the PieceDetailScreen payload for a
 *     tapped row.
 *
 * Data-honesty rules (identical to historyPiece.ts, the module this shares its
 * conventions with):
 *   • a sheet link exists ONLY when the catalog says the piece has a curated
 *     score AND gave a non-blank URL — a `sheet_music_available: false` row
 *     (Für Elise today) shows "Coming soon", never a dead or invented link;
 *   • nothing here invents a confidence — a search result was never heard, it
 *     was typed, so there is no match percentage to show;
 *   • identity (id/title/composer) is passed through exactly as the catalog
 *     returned it.
 *
 * Pure + dependency-free on purpose: this module is compiled by
 * tsconfig.tier1.json and exercised by scripts/catalogSearch.test.ts in plain
 * Node (no react-native, no network).
 */
import type { CatalogPiece, DailyChallengePiece } from '../types';
import {
  HISTORY_DEFAULT_DIFFICULTY,
  HISTORY_DEFAULT_GENRE,
} from './historyPiece';

/** Rows requested per search (the API's own default is also 20). */
export const CATALOG_SEARCH_LIMIT = 20;

/** Debounce before a keystroke turns into a request (~300 ms, owner UX brief). */
export const CATALOG_SEARCH_DEBOUNCE_MS = 300;

/** Shown when a query returned nothing. Honest, actionable, no fake "did you mean". */
export const NO_MATCH_MESSAGE = 'No pieces match — try another title or composer';

/** Shown when the catalog could not be reached or answered with junk. */
export const SEARCH_ERROR_MESSAGE =
  "Couldn't load the catalog — check your connection and try again.";

/**
 * Header for the empty-query state. The API returns the catalog's own first
 * page (alphabetical, 525 pieces on 2026-09-18) — so we say exactly that
 * instead of calling it "popular", which the data does not support.
 */
export const BROWSE_FIRST_N_MESSAGE =
  'First 20 pieces in the catalog — search by title or composer';

/** Where the piece page was opened from — kept honest about the source. */
export const SEARCH_DETAIL_DESCRIPTION =
  'Found in the NoteSnap catalog by searching';

/** Badge shown on a row the catalog has a curated score for (owner copy). */
export const SHEET_BADGE_AVAILABLE = '🎼 Sheet music';

/** Badge shown on a row with no curated score yet (honest, never a link). */
export const SHEET_BADGE_COMING_SOON = 'Coming soon';

/** A non-empty, trimmed string — or undefined. Never returns empty whitespace. */
function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A real number, or null (guards NaN/Infinity and non-number JSON). */
function grade(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Trim a user's query; internal whitespace is preserved (the API handles it). */
export function normalizeQuery(query: string | null | undefined): string {
  return typeof query === 'string' ? query.trim() : '';
}

/**
 * Map ONE raw API row to a CatalogPiece, or null when it is not usable.
 *
 * A row without an id or a title is dropped rather than rendered blank — the
 * caller then shows an honest empty state instead of a mystery row. Optional
 * fields degrade to their "catalog does not know" value (null / false), never
 * to a guessed one.
 */
export function parseCatalogPiece(raw: unknown): CatalogPiece | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = clean(typeof r.id === 'string' ? r.id : undefined);
  const title = clean(typeof r.title === 'string' ? r.title : undefined);
  if (!id || !title) return null;

  const composer = clean(typeof r.composer === 'string' ? r.composer : undefined);
  const sheetUrl = clean(
    typeof r.sheet_music_url === 'string' ? r.sheet_music_url : undefined,
  );
  const available = r.sheet_music_available === true;

  return {
    id,
    title,
    composer: composer ?? '',
    catalog: clean(typeof r.catalog === 'string' ? r.catalog : undefined) ?? null,
    difficulty: grade(r.difficulty),
    difficultyLabel:
      clean(typeof r.difficulty_label === 'string' ? r.difficulty_label : undefined) ??
      null,
    isPublicDomain: r.is_public_domain === true,
    sheetMusicAvailable: available,
    // The ONLY way a sheet URL survives parsing: the catalog says this piece has
    // a curated score. A URL on a `sheet_music_available: false` row (or a
    // blank one) is dropped so no caller can render a link the catalog does not
    // stand behind.
    sheetMusicUrl: available ? sheetUrl ?? null : null,
    albumArtUrl:
      clean(typeof r.album_art_url === 'string' ? r.album_art_url : undefined) ??
      null,
  };
}

/** Parsed payload of `GET /api/pieces?q=`: the page of rows plus the match total. */
export interface CatalogSearchResponse {
  pieces: CatalogPiece[];
  /** Total matches on the server (not just this page). */
  total: number;
}

/**
 * Parse the whole `/api/pieces` body, or null when it is not a usable
 * response. Null means "surface an error with Retry" — it is intentionally
 * DIFFERENT from `{ pieces: [], total: 0 }`, which means the search genuinely
 * found nothing.
 */
export function parseCatalogSearchResponse(
  json: unknown,
): CatalogSearchResponse | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as Record<string, unknown>;
  if (body.success === false) return null;
  if (!Array.isArray(body.pieces)) return null;

  const pieces: CatalogPiece[] = [];
  for (const raw of body.pieces) {
    const piece = parseCatalogPiece(raw);
    if (piece) pieces.push(piece);
  }

  const rawTotal = grade(body.total);
  return {
    pieces,
    // The server's total when it sent a sane one; otherwise the page we hold.
    total: rawTotal !== null && rawTotal >= pieces.length ? rawTotal : pieces.length,
  };
}

/**
 * Sheet-music-ready rows first, then alphabetical by title, then by composer.
 * Returns a NEW array (the caller's state is never re-ordered in place) and
 * never mutates the input.
 *
 * Why sheet-first: the first page is what a browsing user actually sees, and a
 * piece they can open and play right now beats one whose score is "coming soon".
 */
export function sortPiecesForDisplay(pieces: CatalogPiece[]): CatalogPiece[] {
  return [...pieces].sort((a, b) => {
    if (a.sheetMusicAvailable !== b.sheetMusicAvailable) {
      return a.sheetMusicAvailable ? -1 : 1;
    }
    const byTitle = a.title.localeCompare(b.title, undefined, {
      sensitivity: 'base',
    });
    if (byTitle !== 0) return byTitle;
    return a.composer.localeCompare(b.composer, undefined, { sensitivity: 'base' });
  });
}

/** Query string for one search page, e.g. `/api/pieces?limit=20&q=fur`. */
export function buildSearchPath(
  query: string,
  limit: number = CATALOG_SEARCH_LIMIT,
): string {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : CATALOG_SEARCH_LIMIT;
  const q = normalizeQuery(query);
  return q.length > 0
    ? `/api/pieces?limit=${safeLimit}&q=${encodeURIComponent(q)}`
    : `/api/pieces?limit=${safeLimit}`;
}

/** Absolute URL for one search page (base URL may carry a trailing slash). */
export function buildSearchUrl(
  baseUrl: string,
  query: string,
  limit: number = CATALOG_SEARCH_LIMIT,
): string {
  return `${baseUrl.replace(/\/+$/, '')}${buildSearchPath(query, limit)}`;
}

/** The badge copy for a row: a real score, or the honest coming-soon state. */
export function sheetBadgeLabel(sheetMusicAvailable: boolean): string {
  return sheetMusicAvailable ? SHEET_BADGE_AVAILABLE : SHEET_BADGE_COMING_SOON;
}

/**
 * Header line above the results. An empty query is the browse state (honest
 * "first N in the catalog"); a query reports how many matched, and says so when
 * only the first page of them is on screen.
 */
export function resultsHeaderText(
  total: number,
  query: string,
  shown: number = total,
): string {
  const q = normalizeQuery(query);
  if (q.length === 0) return BROWSE_FIRST_N_MESSAGE;
  if (total <= 0) return '';
  const noun = total === 1 ? 'piece' : 'pieces';
  const pages =
    shown > 0 && shown < total ? ` · showing ${shown}` : '';
  return `${total} ${noun} match “${q}”${pages}`;
}

/** The user-facing message for a finished search that found nothing. */
export function noMatchMessage(_query: string): string {
  return NO_MATCH_MESSAGE;
}

/**
 * The PieceDetailScreen payload for a tapped search row.
 *
 * Everything rendered comes from what the catalog returned for this piece —
 * there is no confidence here (a search result was typed, not heard) and no
 * sheet link unless the catalog really has a curated score.
 */
export function catalogPieceToDetail(piece: CatalogPiece): DailyChallengePiece {
  return {
    id: piece.id,
    title: piece.title,
    composer: piece.composer,
    genre: HISTORY_DEFAULT_GENRE,
    difficulty: piece.difficultyLabel ?? HISTORY_DEFAULT_DIFFICULTY,
    difficultyGrade: piece.difficulty,
    description: SEARCH_DETAIL_DESCRIPTION,
    sheetMusicUrl: piece.sheetMusicUrl ?? undefined,
    isPublicDomain: piece.isPublicDomain,
    sheetMusicAvailable: piece.sheetMusicAvailable,
    catalog: piece.catalog,
    // ABC (coach reference melody) is not part of the search row; the screen
    // fills it in from /api/pieces/:id after the tap, exactly like History does.
    abc: null,
  };
}
