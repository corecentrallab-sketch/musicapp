// ---------------------------------------------------------------------------
// landmark-matching.ts — match query landmarks against the DB landmark table
// using hash lookup + time-offset alignment voting (Shazam-style).
//
// For each query landmark we look up DB rows sharing its hash, then compute the
// anchor-time delta (query_tc - db_tc). A genuine match concentrates a large
// number of these deltas around a single offset; a false match spreads its few
// agreeing hashes across many offsets. We find the densest delta cluster per
// piece and score it against the query size.
// ---------------------------------------------------------------------------

import { sql } from "~/db";
import type { Landmark } from "~/services/landmark";

export interface LandmarkMatch {
  piece_id: string;
  title: string;
  composer: string;
  catalog: string | null;
  genre: string | null;
  difficulty: number | null;
  album_art_url: string | null;
  sheet_music_url: string | null;
  tab_url: string | null;
  is_public_domain: boolean | null;
  segment_start_s: number;
  segment_end_s: number;
  overlap_count: number;
  total_overlap: number;
  confidence: number;
}

// Tunables
const DELTA_BIN_CS = 40; // ~0.4s — absorbs jitter and mild tempo drift
const MERGE_NEIGHBORS = 1; // also count adjacent bins (tempo tolerance)
// Hard floor on aligning votes before a piece is even considered (kills the
// long tail of accidental 1-2 hash collisions from unrelated audio).
const MIN_ALIGN_VOTES = 20;
// Fraction of the query's landmarks that must agree at one offset.
const MIN_CONFIDENCE = 0.02;
/** Cap on how many query hashes we push into a single SQL IN (bounded wire). */
const MAX_HASHES_PER_QUERY = 4000;
/** Bounded landmark rows per Neon response page (keeps each page small). */
const PAGE_ROWS = 20000;

interface DbRow {
  piece_id: string;
  hash: number;
  tc: number;
  title: string;
  composer: string;
  catalog: string | null;
  genre: string | null;
  difficulty: number | null;
  album_art_url: string | null;
  sheet_music_url: string | null;
  tab_url: string | null;
  is_public_domain: boolean | null;
  segment_start_s: number;
  segment_end_s: number;
}

/**
 * Fetch ALL piece_landmarks rows whose hash is in `hashes`, in bounded pages so
 * no single Neon response exceeds Neon's 64 MB cap (fixes HTTP 507 on large or
 * common pieces where the single `WHERE l.hash = ANY(<all>)` response ballooned).
 * Mirrors the old single-query WHERE/SELECT exactly — identical row set — so the
 * matcher semantics below are unchanged; only the DB read is paginated
 * (LIMIT + keyset cursor over (hash, piece_id, tc), hashes in bounded IN-list
 * batches).
 */
async function fetchLandmarks(hashes: number[]): Promise<DbRow[]> {
  const out: DbRow[] = [];
  for (let i = 0; i < hashes.length; i += MAX_HASHES_PER_QUERY) {
    const batch = hashes.slice(i, i + MAX_HASHES_PER_QUERY);
    // Keyset cursor over (hash, piece_id, tc); loop until a short page.
    let cursor: [number, string, number] | null = null;
    for (;;) {
      const rows = (await sql()`
        SELECT
          l.piece_id, l.hash, l.tc,
          p.title, p.composer, p.catalog, p.genre, p.difficulty,
          p.album_art_url, p.sheet_music_url, p.tab_url, p.is_public_domain,
          0 AS segment_start_s, 0 AS segment_end_s
        FROM piece_landmarks l
        JOIN pieces p ON p.id = l.piece_id
        WHERE l.hash = ANY(${batch}::int[])
          ${
            cursor
              ? sql()`AND (l.hash, l.piece_id, l.tc) > (${cursor[0]}::int, ${cursor[1]}::uuid, ${cursor[2]}::int)`
              : sql()``
          }
        ORDER BY l.hash, l.piece_id, l.tc
        LIMIT ${PAGE_ROWS}
      `) as unknown as DbRow[];
      for (const r of rows) out.push(r);
      if (rows.length < PAGE_ROWS) break;
      const last = rows[rows.length - 1];
      cursor = [last.hash, last.piece_id, last.tc];
    }
  }
  return out;
}

/**
 * Match query landmarks against the landmark reference table.
 * Returns top matches ordered by confidence, above thresholds.
 */
export async function matchLandmarks(
  queryLandmarks: Landmark[],
): Promise<LandmarkMatch[]> {
  if (queryLandmarks.length === 0) return [];

  // Group query landmark times by hash.
  const queryByHash = new Map<number, number[]>();
  for (const lm of queryLandmarks) {
    let arr = queryByHash.get(lm.hash);
    if (!arr) { arr = []; queryByHash.set(lm.hash, arr); }
    if (arr.length < 64) arr.push(lm.timeCs); // bound per-hash times
  }
  const queryHashSet = Array.from(queryByHash.keys());
  const queryLandmarkCount = queryLandmarks.length;

  // Pull candidate DB rows in bounded pages (hash IN-list batches + keyset
  // cursor over (hash, piece_id, tc)) so no single Neon response is large
  // enough to trip the 64MB cap (fixes HTTP 507 on large/common pieces).
  const piecesById = new Map<string, number[]>(); // piece -> deltas (cs)
  const pieceMeta: Record<string, Omit<DbRow, "piece_id" | "hash" | "tc">> = {};

  const rows = await fetchLandmarks(queryHashSet);

  for (const row of rows) {
    pieceMeta[row.piece_id] = {
      title: row.title, composer: row.composer, catalog: row.catalog,
      genre: row.genre, difficulty: row.difficulty,
      album_art_url: row.album_art_url, sheet_music_url: row.sheet_music_url,
      tab_url: row.tab_url, is_public_domain: row.is_public_domain,
      segment_start_s: row.segment_start_s, segment_end_s: row.segment_end_s,
    };
    const qTimes = queryByHash.get(row.hash);
    if (!qTimes) continue;
    let deltas = piecesById.get(row.piece_id);
    if (!deltas) { deltas = []; piecesById.set(row.piece_id, deltas); }
    for (const qt of qTimes) {
      deltas.push(qt - row.tc);
    }
  }

  if (piecesById.size === 0) return [];

  // Alignment scoring per piece.
  const results: LandmarkMatch[] = [];
  for (const [pieceId, deltas] of piecesById) {
    const best = bestCluster(deltas);
    if (best < MIN_ALIGN_VOTES) continue;
    const confidence = Math.min(1, best / queryLandmarkCount);
    if (confidence < MIN_CONFIDENCE) continue;
    const meta = pieceMeta[pieceId];
    results.push({
      piece_id: pieceId,
      title: meta.title,
      composer: meta.composer,
      catalog: meta.catalog,
      genre: meta.genre,
      difficulty: meta.difficulty,
      album_art_url: meta.album_art_url,
      sheet_music_url: meta.sheet_music_url,
      tab_url: meta.tab_url,
      is_public_domain: meta.is_public_domain,
      segment_start_s: 0,
      segment_end_s: 0,
      overlap_count: best,
      total_overlap: best,
      confidence,
    });
  }

  results.sort((a, b) => b.confidence - a.confidence || b.overlap_count - a.overlap_count);
  return results.slice(0, 5);
}

/**
 * Find the number of deltas that cluster around a single time offset using a
 * coarse histogram with neighbour-merge. Fast and memory-light (imsort not
 * needed — we histogram into a bounded integer range).
 */
function bestCluster(deltas: number[]): number {
  let min = Infinity, max = -Infinity;
  for (const d of deltas) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  if (deltas.length === 0) return 0;
  const span = max - min;
  if (!isFinite(span) || span > 2_000_000) return 1; // degenerate
  const numBins = Math.ceil(span / DELTA_BIN_CS) + 2;
  const hist = new Int32Array(Math.max(1, numBins));
  const idx = (d: number) => Math.floor((d - min) / DELTA_BIN_CS);
  for (const d of deltas) hist[idx(d)]++;

  let best = 0;
  for (let b = 0; b < hist.length; b++) {
    let sum = hist[b];
    for (let m = 1; m <= MERGE_NEIGHBORS; m++) {
      if (b - m >= 0) sum += hist[b - m];
      if (b + m < hist.length) sum += hist[b + m];
    }
    if (sum > best) best = sum;
  }
  return best;
}
