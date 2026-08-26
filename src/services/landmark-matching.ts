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
// Rejection floor on the total ID-weighted "match surface" of the query (the
// sum of weights over ALL distinct query hashes found anywhere in the DB).
// A query whose landmark hashes barely exist in the catalog at all is not a
// confident signal — no matter how nicely a handful happen to align — so we
// refuse to emit any confident match for it. Prevents tiny-denominator
// confidence inflation on alien/low-signal audio (e.g. noise whose few stray
// hashes collide into one offset).
const MIN_MATCH_WEIGHT = 15;
// Fraction of the query's matched surface that must agree at one offset.
const MIN_CONFIDENCE = 0.02;
// IDF damping: common hashes (present in many pieces — the "hub" problem that
// makes e.g. Träumerei beat Für Elise on degraded audio) are down-weighted as
// 1/sqrt(df). A hash unique to one piece contributes 1.0; one shared by 20
// pieces contributes ~0.22. This collapses cross-piece collisions while
// preserving the piece's own distinctive evidence.
const IDF_POWER = 0.5;
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

  // Pull candidate DB rows in bounded pages (hash IN-list batches + keyset
  // cursor over (hash, piece_id, tc)) so no single Neon response is large
  // enough to trip the 64MB cap (fixes HTTP 507 on large/common pieces).
  const piecesById = new Map<string, { d: number; w: number }[]>(); // piece -> aligned (delta, weight)
  const pieceMeta: Record<string, Omit<DbRow, "piece_id" | "hash" | "tc">> = {};

  const rows = await fetchLandmarks(queryHashSet);

  // ---- Inverse-document-frequency (IDF) weighting ---------------------------
  // df[hash] = number of DISTINCT pieces whose DB rows contain that hash.
  // Computed directly from the rows we already fetched (no extra query). A hash
  // that appears in many pieces is common/weak evidence for any one of them; we
  // weight it 1/sqrt(df) so hub pieces stop winning low-signal races on shared
  // hashes alone (the Träumerei > Für Elise confident-wrong on device audio).
  const dfByHash = new Map<number, number>();
  {
    const pieceCount = new Map<number, Set<string>>();
    for (const r of rows) {
      let s = pieceCount.get(r.hash);
      if (!s) { s = new Set(); pieceCount.set(r.hash, s); }
      s.add(r.piece_id);
    }
    for (const [h, ids] of pieceCount) dfByHash.set(h, ids.size);
  }
  const weightOf = (h: number): number => 1 / Math.pow(Math.max(1, dfByHash.get(h) ?? 1), IDF_POWER);

  // Total ID-weighted "match surface" of the query: sum of weights over ALL
  // distinct query hashes that exist in the DB (each counted once). This is the
  // denominator for confidence. It is the matched SURFACE, not every emitted
  // landmark, so a noisy/reverby clip with lots of spurious peaks no longer
  // tanks the confidence of a genuine match — and a wrong piece's shared-hash
  // evidence is simultaneously down-weighted by IDF.
  let matchWeightTotal = 0;
  for (const h of queryHashSet) {
    const d = dfByHash.get(h);
    if (d) matchWeightTotal += weightOf(h);
  }

  // Align DB rows to query by (hash -> time delta), grouped per piece.
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
    const w = weightOf(row.hash);
    for (const qt of qTimes) {
      deltas.push({ d: qt - row.tc, w });
    }
  }

  if (piecesById.size === 0 || matchWeightTotal <= 0) return [];

  // Alignment scoring per piece.
  const results: LandmarkMatch[] = [];
  for (const [pieceId, deltas] of piecesById) {
    const best = bestClusterWeighted(deltas);
    if (best.votes < MIN_ALIGN_VOTES) continue;
    // Confidence = fraction of the query's ID-weighted matched surface that
    // concentrates at this piece's best single offset. The denominator is
    // floored at MIN_MATCH_WEIGHT so an alien query whose few stray hashes
    // happen to collide into one offset cannot inflate confidence on a tiny
    // match surface.
    const denom = Math.max(matchWeightTotal, MIN_MATCH_WEIGHT);
    const confidence = Math.min(1, best.weighted / denom);
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
      overlap_count: best.votes,
      total_overlap: best.votes,
      confidence,
    });
  }

  results.sort((a, b) => b.confidence - a.confidence || b.overlap_count - a.overlap_count);
  return results.slice(0, 5);
}

/**
 * Find the densest cluster of (delta -> weight) pairs around a single time
 * offset using a coarse histogram with neighbour-merge. Returns both the raw
 * vote count (used as the MIN_ALIGN_VOTES floor) and the ID-weighted sum
 * (used for confidence and ranking). Fast and memory-light.
 */
function bestClusterWeighted(items: { d: number; w: number }[]): { votes: number; weighted: number } {
  if (items.length === 0) return { votes: 0, weighted: 0 };
  let min = Infinity, max = -Infinity;
  for (const it of items) {
    if (it.d < min) min = it.d;
    if (it.d > max) max = it.d;
  }
  const span = max - min;
  if (!isFinite(span) || span > 2_000_000) return { votes: 1, weighted: (items[0]?.w ?? 1) };
  const numBins = Math.ceil(span / DELTA_BIN_CS) + 2;
  const votesHist = new Int32Array(Math.max(1, numBins));
  const weightHist = new Float64Array(Math.max(1, numBins));
  const idx = (d: number) => Math.floor((d - min) / DELTA_BIN_CS);
  for (const it of items) {
    const b = idx(it.d);
    votesHist[b]++; weightHist[b] += it.w;
  }
  let bestVotes = 0, bestWeighted = 0;
  for (let b = 0; b < votesHist.length; b++) {
    let v = votesHist[b]; let wt = weightHist[b];
    for (let m = 1; m <= MERGE_NEIGHBORS; m++) {
      if (b - m >= 0) { v += votesHist[b - m]; wt += weightHist[b - m]; }
      if (b + m < votesHist.length) { v += votesHist[b + m]; wt += weightHist[b + m]; }
    }
    if (wt > bestWeighted) { bestWeighted = wt; bestVotes = v; }
  }
  return { votes: bestVotes, weighted: bestWeighted };
}
