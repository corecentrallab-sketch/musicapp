/**
 * practiceMilestones.ts — minutes ladder + personal-best detection
 * (retention build, slice 1: engine).
 *
 * Pure module (no react-native / AsyncStorage / own clock), unit-tested by the
 * tier-1 suite. It turns the practice history into the two "positive
 * reinforcement" numbers the UI will show:
 *
 *   1. MINUTES — an "Iron Fingers" ladder at 100 / 1 000 / 5 000 minutes.
 *      The ladder is COMPOUND and NON-RESETTING: total minutes only grow, so a
 *      threshold fires exactly once, and one long session may cross several
 *      thresholds at once (e.g. a first-ever 1 200-minute marathon crosses both
 *      100 and 1 000 — the UI may celebrate both).
 *   2. PERSONAL BEST — how the run that just finished compares with the best
 *      run on the same piece BEFORE it.
 *
 * SCHEMA NOTE (slice-1 decision, no migration was needed)
 * `PracticeSession` in ./practiceHistory.ts already carries the two fields this
 * module needs — `durationSec: number` and `accuracyPct: number` — so this
 * slice did NOT change the stored record shape and did NOT bump the storage key
 * (`notesnap:practice:history:v1`). Two consequences worth knowing:
 *   • Field name is `durationSec` (already canonical in the repo), not
 *     `durationSeconds`; the engine reads what is actually persisted.
 *   • `durationSec` is a REQUIRED number in the stored schema and
 *     practiceHistory.parseHistory() drops any record whose durationSec is not
 *     a number. So a `null` duration can never come off the device, and we must
 *     NOT write one (it would silently delete the whole session on next read).
 *     `sessionsMinutes()` below still accepts and EXCLUDES null/undefined/NaN/
 *     negative durations, which keeps hand-built/legacy/future records safe: an
 *     excluded session contributes 0 minutes and never corrupts the total.
 */
import { bestAccuracy, type PracticeSession } from './practiceHistory';

/** Minute thresholds of the Iron Fingers ladder. Ascending, compound, never reset. */
export const MILESTONES = [100, 1000, 5000] as const;
export type MinuteMilestone = (typeof MILESTONES)[number];

/** Human label per threshold, for celebration titles / share cards. */
export const MILESTONE_LABELS: Record<number, string> = {
  100: 'Iron Fingers I',
  1000: 'Iron Fingers II',
  5000: 'Iron Fingers III',
};

/** Only the fields this module needs — keeps call sites free of full records. */
export interface DurableSessionLike {
  durationSec?: number | null;
  accuracyPct?: number | null;
  pieceId?: string | null;
}

export interface PersonalBestResult {
  /** Piece the comparison is scoped to (personal bests are per piece). */
  pieceId: string;
  /** Accuracy of the run that just finished, 0–100. */
  accuracyPct: number;
  /** Best accuracy on this piece BEFORE the finished run, or null. */
  priorBest: number | null;
  /** True only when a prior best existed and was beaten. */
  isNewBest: boolean;
  /** accuracyPct − priorBest (may be ≤ 0), null when there was no prior best. */
  deltaPct: number | null;
  /** True when this is the first completed run for this piece (no prior best). */
  firstEver: boolean;
}

// ─── rounding / minutes ────────────────────────────────────────

/** One decimal place — 6 seconds of precision, plenty for a minutes total. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Minutes for one session, or null when it must be excluded from totals.
 * Excluded: missing duration, non-finite, or negative. Zero is a valid value
 * (a session with durationSec 0 simply adds nothing).
 */
export function sessionMinutes(session: DurableSessionLike | null | undefined): number | null {
  if (!session) return null;
  const raw = session.durationSec;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return raw / 60;
}

/**
 * Total practice minutes across a history — the ONE number used for display and
 * for milestone crossing, rounded to one decimal so what the user is shown and
 * what fired the celebration can never disagree. Sessions excluded by
 * `sessionMinutes` contribute nothing.
 */
export function computeMinutesTotal(history: readonly DurableSessionLike[]): number {
  let seconds = 0;
  for (const session of history) {
    const minutes = sessionMinutes(session);
    if (minutes !== null) seconds += minutes * 60;
  }
  return round1(seconds / 60);
}

/** How many sessions in the history were excluded for a missing duration. */
export function excludedDurationCount(history: readonly DurableSessionLike[]): number {
  let count = 0;
  for (const session of history) {
    if (sessionMinutes(session) === null) count++;
  }
  return count;
}

/**
 * Thresholds newly crossed when the total moves `before` → `after`.
 * Compound and non-resetting: a threshold that was already passed does not
 * reappear, and a big jump can cross several at once.
 */
export function milestonesCrossed(before: number, after: number): number[] {
  return MILESTONES.filter((threshold) => before < threshold && after >= threshold);
}

/** Smallest threshold above `total`, with the minutes still needed for it. */
export function nextMilestone(total: number): { tier: MinuteMilestone | null; minutesToNext: number } {
  for (const threshold of MILESTONES) {
    if (threshold > total) return { tier: threshold, minutesToNext: round1(threshold - total) };
  }
  return { tier: null, minutesToNext: 0 };
}

// ─── personal best ─────────────────────────────────────────────

/**
 * Compare the run that just finished against the best earlier run on the SAME
 * piece. Per-piece on purpose: an accuracy on one piece says nothing about
 * another, so a cross-piece "best" would be a meaningless number.
 */
export function computePersonalBest(
  history: readonly PracticeSession[],
  completedSession: DurableSessionLike | null | undefined,
  pieceId: string,
): PersonalBestResult {
  const accuracy = readAccuracy(completedSession);
  const priorBest = bestAccuracy([...history], pieceId);
  const firstEver = priorBest === null;
  const isNewBest = !firstEver && accuracy > (priorBest as number);
  return {
    pieceId,
    accuracyPct: accuracy,
    priorBest,
    isNewBest,
    deltaPct: firstEver ? null : round1(accuracy - (priorBest as number)),
    firstEver,
  };
}

/** Accuracy of a session, clamped to 0–100; 0 when absent/unusable. */
function readAccuracy(session: DurableSessionLike | null | undefined): number {
  const raw = session?.accuracyPct;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.round(Math.max(0, Math.min(100, raw)));
}
