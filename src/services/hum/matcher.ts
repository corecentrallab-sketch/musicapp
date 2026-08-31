// ---------------------------------------------------------------------------
// matcher.ts — rank melody skeletons against a hummed query contour and apply
// the "no confident-wrong" gate (same philosophy as /api/recognize's
// match-policy): the app only names a piece when the top candidate is strong on
// its own AND clearly ahead of the runner-up. An ambiguous/weak result degrades
// to an honest "no confident match".
// ---------------------------------------------------------------------------
import { dtwSubsequence, dtwCostToSimilarity } from "./dtw";
import type { MelodySkeleton } from "./skeleton";

export interface MelodyMatch {
  piece_id: string;
  title: string;
  composer: string;
  /** Similarity in [0,1]; 1 = exact relative-interval contour match. */
  confidence: number;
  /** Normalized DTW cost (lower = better). */
  cost: number;
  query_deltas: number;
  reference_deltas: number;
}

/** Fewest query deltas (i.e. fewest transitions = fewest notes-1) to accept. */
export const MIN_QUERY_DELTAS = 4;

/** Policy knobs — calibrated by the unit tests (see hum.test.ts). These are
 *  deliberately separate from the landmark MATCH_POLICY because melody
 *  similarity lives on a [0,1] scale dominated by near-perfect contour
 *  alignment, not the sparse landmark-confidence scale. */
export const HUM_MATCH_POLICY = {
  /** Absolute floor on a melody match's confidence to even be considered. */
  MIN_MATCH_CONFIDENCE: 0.55,
  /** Top must beat the runner-up by at least this absolute margin. */
  MARGIN: 0.12,
  /** Top must also beat the runner-up by at least this ratio. */
  RATIO: 1.35,
  /** When only ONE candidate clears the floor, it must be this strong alone. */
  SINGLE_MATCH_CONFIDENCE: 0.7,
  /** Queries with at most this many deltas are "short" — inherently ambiguous. */
  SHORT_QUERY_DELTAS: 12,
  /** Short queries must be much stronger to be named (false positives cluster
   *  in short, scale-like runs — an adversarial short run quantizes to a clean
   *  coincidental contour at ~0.80 even when it is not the piece). The owner's
   *  real whistle is a LONG query (34 deltas) so it uses the normal 0.70 floor;
   *  a short coincidental run is gated harder at 0.85. */
  SINGLE_MATCH_CONFIDENCE_SHORT: 0.85,
  HINT_AMBIGUOUS: "That hum sounds like several pieces — try humming a longer, clearer phrase.",
  HINT_SINGLE_WEAK: "That wasn't a confident melody match — try humming a longer, clearer phrase.",
  HINT_SHORT_WEAK: "That short phrase was too ambiguous to name — try humming or whistling it a little longer.",
} as const;

export type HumPolicyResult =
  | { ok: true; top: MelodyMatch; matches: MelodyMatch[] }
  | { ok: false; reason: "below-threshold" | "ambiguous" | "single-weak" | "too-short"; hint: string };

/** Score a query delta contour against every skeleton, ranked best-first. */
export function matchMelody(queryDeltas: number[], skeletons: MelodySkeleton[]): MelodyMatch[] {
  const scored: MelodyMatch[] = [];
  for (const sk of skeletons) {
    if (sk.deltas.length === 0) continue;
    const { normalizedCost } = subsequenceMatch(queryDeltas, sk.deltas);
    scored.push({
      piece_id: sk.pieceId,
      title: sk.title,
      composer: sk.composer,
      confidence: dtwCostToSimilarity(normalizedCost),
      cost: normalizedCost,
      query_deltas: queryDeltas.length,
      reference_deltas: sk.deltas.length,
    });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored;
}

/**
 * Subsequence match that works in BOTH directions (returns the better of the
 * two). Previously the matcher required queryLength <= referenceLength and
 * SKIPPED the skeleton entirely when the query was longer. A real whistle can
 * easily be LONGER than the (short) seed within which it sits for two reasons:
 *   1. the user whistles the FULL opening phrase, which extends well past the
 *      9-note seed, or
 *   2. vibrato / breath dropout fragments one held note into several small
 *      notes, inflating the extracted query length.
 * In both cases we now align the *shorter* contour as a subsequence of the
 * *longer* one, so Für Elise (and any skeleton) is always scored rather than
 * silently dropped. DTW's free-start + insert/delete already absorb the extra
 * spurious notes. Verified not to increase false positives (gate still rejects
 * unrelated melodies — see tests).
 */
export function subsequenceMatch(queryDeltas: number[], referenceDeltas: number[]): { normalizedCost: number; reverse: boolean } {
  const forward =
    queryDeltas.length <= referenceDeltas.length
      ? dtwSubsequence(queryDeltas, referenceDeltas).normalizedCost
      : Infinity;
  const reversed =
    queryDeltas.length >= referenceDeltas.length
      ? dtwSubsequence(referenceDeltas, queryDeltas).normalizedCost
      : Infinity;
  // Take the better (lower normalized cost) direction; prefer forward on ties
  // so the historical query-inside-reference interpretation is unchanged.
  if (reversed < forward - 1e-9) return { normalizedCost: reversed, reverse: true };
  return { normalizedCost: forward, reverse: false };
}

/** Apply the "no confident-wrong" gate to ranked melody candidates. */
export function applyHumMatchPolicy(matches: MelodyMatch[], queryDeltaCount: number): HumPolicyResult {
  if (queryDeltaCount < MIN_QUERY_DELTAS) {
    return { ok: false, reason: "too-short", hint: "Hum a longer phrase — a few notes isn't enough to identify." };
  }
  const filtered = matches.filter((m) => m.confidence >= HUM_MATCH_POLICY.MIN_MATCH_CONFIDENCE);
  if (filtered.length === 0) return { ok: false, reason: "below-threshold", hint: "" };
  const top = filtered[0];
  const second = filtered[1];
  if (second) {
    const margin = top.confidence - second.confidence;
    const ratio = top.confidence / (second.confidence || 1e-9);
    if (margin < HUM_MATCH_POLICY.MARGIN || ratio < HUM_MATCH_POLICY.RATIO) {
      return { ok: false, reason: "ambiguous", hint: HUM_MATCH_POLICY.HINT_AMBIGUOUS };
    }
  } else if (top.confidence < HUM_MATCH_POLICY.SINGLE_MATCH_CONFIDENCE) {
    return { ok: false, reason: "single-weak", hint: HUM_MATCH_POLICY.HINT_SINGLE_WEAK };
  }
  // Short queries (few deltas) carry too little contour evidence to safely name
  // even when one candidate leads — false positives cluster here (a short
  // scale-like run can quantize to a clean coincidental contour near 0.80).
  // Apply a higher absolute floor independent of single-vs-margin, so a real
  // short melody must be near-exact to be named.
  const requiredFloor = queryDeltaCount <= HUM_MATCH_POLICY.SHORT_QUERY_DELTAS
    ? HUM_MATCH_POLICY.SINGLE_MATCH_CONFIDENCE_SHORT
    : HUM_MATCH_POLICY.SINGLE_MATCH_CONFIDENCE;
  if (top.confidence < requiredFloor) {
    return { ok: false, reason: "single-weak", hint: HUM_MATCH_POLICY.HINT_SHORT_WEAK };
  }
  return { ok: true, top, matches: [top] };
}
