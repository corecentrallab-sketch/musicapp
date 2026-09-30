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
import { UNCATEGORISED_GENRE } from './resultGenre';
import { primaryPurchaseUrl } from './purchaseCta';

/**
 * Genre shown when the saved record carries no genre tag. A legacy History row
 * with no genre is "Uncategorised" — we do not know it, so we do not claim it
 * (and specifically do not claim it is classical). Resolved by the module that
 * owns these strings, so this default can never drift from the result card's.
 */
export const HISTORY_DEFAULT_GENRE = UNCATEGORISED_GENRE;

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
 *
 * The ONE thing the saved record may carry beyond identity is `purchaseUrls`
 * (History dead-end sprint, owner 10-01): the licensed retailer links a modern
 * recognition was saved with. They are copied through verbatim — this module
 * never builds, edits or invents one — so the piece page can offer the purchase
 * instead of a dead "coming soon" card.
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
    purchaseUrls: piece.purchaseUrls ?? null,
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
 *     untouched — never an error, never a fabricated sheet;
 *   • the catalog can NEITHER supply NOR clear `purchaseUrls` (History dead-end
 *     sprint, owner 10-01): `CatalogPieceInfo` has no such field at all (the
 *     catalog's purchase map belongs to fresh recognition responses), and the
 *     saved map is carried through unconditionally. A merge with a hostile body
 *     that happens to carry a `purchaseUrls` key cannot overwrite the saved one.
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
    // Straight from the SAVED piece — never from the catalog response.
    purchaseUrls: base.purchaseUrls ?? null,
  };
}

// ─── The sheet-music card (History dead-end sprint, owner 10-01) ──

/**
 * The card a piece page shows when the piece has NO curated score we may host
 * but DOES have a licensed retailer link — i.e. a modern song opened from
 * History. It replaces the old "🎼 Sheet music coming soon" text, which was a
 * dead end exactly where the user wanted to buy (owner: "pressing the
 * sheet-music card must take the user AUTOMATICALLY TO PURCHASE") and, worse,
 * claimed we were still curating a score for a song we will never host.
 *
 * The header is the SONG'S OWN identity — `{title} — official sheet music`, plus
 * the composer/artist line and the genre when the saved row carries one — so the
 * user can see which song's sheet music the card is about (owner: "the song's
 * sheet-music header must be CLEAR in the card").
 *
 * `url` is resolved through `primaryPurchaseUrl()` (Sheet Music Direct primary,
 * Musicnotes backup) — never by naming a retailer key, so the value the card
 * opens is the same one every other CTA in the app opens.
 *
 * Returns null when there is no USABLE purchase URL: the caller then keeps the
 * honest "coming soon" state instead of an empty, unpressable card. Pure — no
 * react / react-native / network, so the tier1 gate can pin every branch.
 */
export function modernSheetCard(
  piece: DailyChallengePiece | null | undefined,
): { title: string; subtitle: string; url: string | null } | null {
  const url = primaryPurchaseUrl(piece?.purchaseUrls ?? null);
  if (!url) return null;

  const title = clean(piece?.title);
  if (!title) return null;

  const composer = clean(piece?.composer);
  const genre = clean(piece?.genre);
  const subtitle = [composer, genre].filter((part) => !!part).join(' · ');

  return {
    title: `${title} — official sheet music`,
    subtitle,
    url,
  };
}

// ─── History search scope (owner 10-01) ────────────────────────

/**
 * Fold a query (or a field of a saved row) for matching: lower-case, diacritics
 * stripped, whitespace collapsed. "Fur Elise" must find "Für Elise" and vice
 * versa — the user's keyboard has no umlaut and the catalog carries one.
 */
export function normalizeHistoryQuery(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    // Combining marks left behind by NFD — the diacritic itself, not the letter.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filter the SAVED recognitions by title/composer, in memory (owner 10-01: in
 * History, looking for a piece must only ever show what the user actually
 * recognized — never a general catalog/internet search).
 *
 *   • an empty/blank query returns the full list, in order (no filtering);
 *   • every other query is matched as a substring of the normalized title OR
 *     composer, so "bach" finds the composer and "elise" finds the title;
 *   • it never touches the network and never invents a row: a non-matching query
 *     yields an empty list and the screen renders its own honest empty state.
 */
export function filterSavedPieces(
  items: readonly SavedPiece[] | null | undefined,
  query: string | null | undefined,
): SavedPiece[] {
  const list = Array.isArray(items) ? items.slice() : [];
  const needle = normalizeHistoryQuery(query);
  if (!needle) return list;
  return list.filter((item) => {
    if (!item) return false;
    return (
      normalizeHistoryQuery(item.title).includes(needle) ||
      normalizeHistoryQuery(item.composer).includes(needle)
    );
  });
}
