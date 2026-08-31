// ---------------------------------------------------------------------------
// dtw.ts — subsequence Dynamic Time Warping for melody-contour matching.
//
// Both the query and each reference are RELATIVE-INTERVAL delta arrays
// (semitone steps between adjacent notes). Because durations are discarded,
// tempo is automatically invariant — a melody hummed twice as slow/fast yields
// the same delta sequence — so the warping here must absorb the things that
// ARE still different after debelivering tempo:
//   1. local pitch error in the extracted interval (±1-2 semitones),
//   2. note-count mismatches (the user hums slurred/skipped notes, or the f0
//      extractor merges re-articulated repeated notes) → insertions/deletions,
//   3. finding the correct sub-window of a (longer) reference within which the
//      short hummed phrase lies (free start / local alignment).
//
// We implement the classic LCS-flavoured subsequence DTW with a free start
// (query can begin anywhere in the reference) and a symmetric gap penalty so a
// query of length m is compared against all m-length sub-alignments of the
// reference. The returned normalized cost is comparable across references.
// ---------------------------------------------------------------------------

export interface SubsequenceDtwResult {
  /** Best-achievable raw cost over any alignment (lower = better). */
  cost: number;
  /** Cost normalized by the alignment length (mean per-delta error + gaps). */
  normalizedCost: number;
  /** Length of the aligned (warped) path. */
  alignmentLength: number;
}

/**
 * Default gap penalty (per inserted/deleted note), in the same units as a
 * one-semitone mismatch. Kept modest so skipping/adding a note costs roughly a
 * single semitone of local error.
 */
export const GAP_PENALTY = 1.0;

/**
 * Saturation cap on a single |query−reference| semitone error. A real whistle
 * occasionally produces one flat-octave / spurious pitch estimate (a gross
 * error of 6–40 semitones). Capping the per-delta cost means one such outlier
 * costs at most `SATURATED_ERROR_COST` instead of flooring the whole match,
 * while a genuinely unrelated melody still accumulates cost across MANY
 * mismatches. `cap` is placed just above the largest legitimate melodic
 * interval (a true octave = 12) so genuine big steps are never clipped.
 */
export const SATURATED_ERROR_COST = 12 as const;

/** Cost of matching one query delta against one reference delta (semitones). */
function matchCost(q: number, r: number): number {
  return Math.min(Math.abs(q - r), SATURATED_ERROR_COST);
}

/**
 * Subsequence DTW: find the best local alignment of `query` (length m) within
 * `reference` (length n), m <= n, with a free start (D[0][j] = 0).
 */
export function dtwSubsequence(query: number[], reference: number[]): SubsequenceDtwResult {
  const m = query.length;
  const n = reference.length;
  if (m === 0) return { cost: 0, normalizedCost: 0, alignmentLength: 0 };
  if (n === 0) return { cost: Infinity, normalizedCost: Infinity, alignmentLength: 0 };

  // D[i][j] : best cost aligning query[0..i-1] to a subsequence ending at ref[j-1].
  // Use two rolling rows; prev[j] holds row i-1, cur[j] row i.
  const prev = new Float64Array(n + 1);
  const cur = new Float64Array(n + 1);
  prev.fill(0); // free start: D[0][j] = 0 for every j

  for (let i = 1; i <= m; i++) {
    cur[0] = Infinity; // cannot end at index 0 for i>=1
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + matchCost(query[i - 1], reference[j - 1]);
      const insRef = prev[j] + GAP_PENALTY; // query consumes a delta, ref stays
      const delRef = cur[j - 1] + GAP_PENALTY; // ref consumes a delta, query stays
      cur[j] = Math.min(sub, insRef, delRef);
    }
    prev.set(cur); // row i becomes the new previous row
    cur.fill(0); // reset for the next row
  }

  // Best alignment is min over all ending positions in the reference.
  let bestCost = Infinity;
  for (let j = 1; j <= n; j++) {
    if (prev[j] < bestCost) bestCost = prev[j];
  }

  const normalizedCost = m > 0 ? bestCost / m : 0;
  return { cost: bestCost, normalizedCost, alignmentLength: m };
}

/** Convert a normalized DTW cost to a similarity score in [0,1] (1 = exact). */
export function dtwCostToSimilarity(normalizedCost: number): number {
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0) return 0;
  return Math.exp(-normalizedCost);
}
