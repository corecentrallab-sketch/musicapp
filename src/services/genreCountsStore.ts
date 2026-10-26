/**
 * genreCountsStore — the REAL numbers behind the Discover style surface
 * (v45 slice 3b).
 *
 * The tiles and the era chips may print a count ONLY when that count was
 * derived from the catalog's own rows (owner rule: never hardcoded, never
 * faked). This module is the one place that asks for them:
 *
 *   • `/api/pieces` caps a page at 50 and reports the true `total`, so a count
 *     of the whole library needs the pages walked — a single page of 50 would
 *     describe 50 rows as if they were 536;
 *   • the walk stops the moment it is complete, fails, or hits the page cap;
 *   • an incomplete walk yields `eras: null`, so every number is OMITTED rather
 *     than guessed (this is also what a backend that does not yet serve `genre`
 *     produces: rows without the field → `eraCountsFromPieces` returns null);
 *   • the result is cached for the session and the request is de-duplicated, so
 *     Home mounting twice costs one walk, not two.
 *
 * Deliberately NOT in the tier1 include list: it talks to the network through
 * api.ts (which pulls AsyncStorage for the device id). The derivation itself
 * lives in the pure, tier1-tested `genreFamilies.eraCountsFromPieces()`.
 */
import { searchPiecePage } from './api';
import { eraCountsFromPieces, type EraCounts } from './genreFamilies';

/** The backend's per-page cap is 50; asking for more is clamped server-side. */
const PAGE_LIMIT = 50;
/** A hard stop so a pathological `total` can never loop forever. */
const MAX_PAGES = 24;

export interface GenreCounts {
  /** The catalog's own total for the (unfiltered) browse — the real library size. */
  total: number;
  /** Per-era counts, or null when they could not be derived honestly. */
  eras: EraCounts | null;
}

let cache: GenreCounts | null = null;
let inflight: Promise<GenreCounts | null> | null = null;

/** Test/theme-switch hook: forget the cached walk. */
export function resetGenreCountsCache(): void {
  cache = null;
  inflight = null;
}

/**
 * The library size and (when derivable) the per-era counts. Resolves to null
 * when the catalog could not be read at all — callers then render no numbers.
 */
export async function loadGenreCounts(): Promise<GenreCounts | null> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async (): Promise<GenreCounts | null> => {
    try {
      const first = await searchPiecePage('', PAGE_LIMIT, 0);
      const total = first.total;
      if (!Number.isFinite(total) || total <= 0) return null;
      const rows = [...first.pieces];
      let offset = rows.length;
      let pages = 1;
      while (rows.length < total && pages < MAX_PAGES && offset > 0) {
        const next = await searchPiecePage('', PAGE_LIMIT, offset);
        if (next.pieces.length === 0) break;
        rows.push(...next.pieces);
        offset += next.pieces.length;
        pages += 1;
      }
      const eras = eraCountsFromPieces(rows, total);
      const counts: GenreCounts = { total, eras };
      cache = counts;
      return counts;
    } catch {
      // Offline / server error / malformed body: no numbers, no invention.
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
