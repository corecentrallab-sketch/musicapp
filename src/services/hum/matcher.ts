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
  HINT_AMBIGUOUS: "That hum sounds like several pieces — try humming a longer, clearer phrase.",
  HINT_SINGLE_WEAK: "That wasn't a confident melody match — try humming a longer, clearer phrase.",
} as const;

export type HumPolicyResult =
  | { ok: true; top: MelodyMatch; matches: MelodyMatch[] }
  | { ok: false; reason: "below-threshold" | "ambiguous" | "single-weak" | "too-short"; hint: string };

/** Score a query delta contour against every skeleton, ranked best-first. */
export function matchMelody(queryDeltas: number[], skeletons: MelodySkeleton[]): MelodyMatch[] {
  const scored: MelodyMatch[] = [];
  for (const sk of skeletons) {
    // Query may be shorter than the skeleton (hum the opening motif of a full
    // tune) — dtwSubsequence requires query.length <= reference.length.
    if (queryDeltas.length > sk.deltas.length) continue;
    if (sk.deltas.length === 0) continue;
    const { normalizedCost } = dtwSubsequence(queryDeltas, sk.deltas);
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
  return { ok: true, top, matches: [top] };
}
