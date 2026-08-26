// ---------------------------------------------------------------------------
// match-policy.ts — the application-level "no confident-wrong" gate (shared by
// /api/recognize and the audit tooling so tests exercise the EXACT policy).
//
// The raw landmark matcher returns up to 5 candidates ordered by ID-weighted
// confidence. On real, room-recorded on-device audio the correct piece can be
// weak (~0.33) while a wrong piece can score higher (~0.57) — a plain
// top-confidence threshold cannot separate them. The gate below refuses to
// present ANY title as a confident match unless the top candidate is both
// strong on its own AND unambiguously ahead of the runner-up. An ambiguous or
// weak result degrades to an honest "no confident match" (the owner's launch
// rule: a wrong title is worse than no-title).
// ---------------------------------------------------------------------------

export const MATCH_POLICY = {
  /** Absolute floor on a match's confidence to even be considered. */
  MIN_MATCH_CONFIDENCE: 0.45,
  /** Top must beat the runner-up by at least this absolute margin. */
  MARGIN: 0.15,
  /** Top must also beat the runner-up by at least this ratio. */
  RATIO: 1.5,
  /** When only ONE candidate clears the floor, it must be this strong alone
   *  (no rival to compare against — an isolated just-above-threshold match is
   *  not trustworthy on device audio). */
  SINGLE_MATCH_CONFIDENCE: 0.6,
  /** Human hint surfaced to the user when we decline to name a piece. */
  HINT_AMBIGUOUS: "Couldn't confidently identify this — try playing more or moving closer.",
  HINT_SINGLE_WEAK: "That sounded familiar but wasn't a confident match — try a longer, clearer clip.",
} as const;

export interface ConfidenceMatch {
  confidence: number;
  [k: string]: unknown;
}

export type PolicyResult<T> =
  | { ok: true; top: T & ConfidenceMatch; matches: (T & ConfidenceMatch)[] }
  | { ok: false; reason: "below-threshold" | "ambiguous" | "single-weak"; hint: string };

export function applyMatchPolicy<T extends { confidence: number }>(
  matches: T[],
): PolicyResult<T> {
  const filtered = matches.filter(
    (m) => m.confidence >= MATCH_POLICY.MIN_MATCH_CONFIDENCE,
  );
  if (filtered.length === 0) return { ok: false, reason: "below-threshold", hint: "" };
  const top = filtered[0];
  const second = filtered[1];
  if (second) {
    const margin = top.confidence - second.confidence;
    const ratio = top.confidence / (second.confidence || 1e-9);
    if (margin < MATCH_POLICY.MARGIN || ratio < MATCH_POLICY.RATIO) {
      return { ok: false, reason: "ambiguous", hint: MATCH_POLICY.HINT_AMBIGUOUS };
    }
  } else if (top.confidence < MATCH_POLICY.SINGLE_MATCH_CONFIDENCE) {
    return { ok: false, reason: "single-weak", hint: MATCH_POLICY.HINT_SINGLE_WEAK };
  }
  return { ok: true, top, matches: [top] };
}
