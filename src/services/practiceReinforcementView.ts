/**
 * practiceReinforcementView.ts — the presentation layer of practice
 * reinforcement (retention build, slice 2: the UI wiring).
 *
 * The engine (./practiceReinforcement.ts) decides WHAT happened: streak tiers,
 * minute milestones, personal bests, and a gentle at-risk nudge. This module
 * decides only WHAT THE UI IS ALLOWED TO SHOW, so that rule lives in one pure,
 * tested place instead of scattered across components:
 *
 *   • celebrations are shown in the engine's order, capped (never a wall of
 *     cards after one run)
 *   • the quiet streak line ("3-day streak — 4 more days to hit 7") is built
 *     from the streak fields the engine already computed — the UI never invents
 *     its own streak arithmetic
 *   • when nothing was crossed AND the streak is below the first tier, the
 *     moment collapses to the streak line, and when there is neither a crossing
 *     nor a streak there is NO moment at all. There is deliberately no
 *     "consolation celebration" path: no fabricated scores, no fake moments.
 *   • the at-risk nudge is gated to OUTSIDE-PLAY surfaces (the engine's
 *     `playSafeOnly` / `surface: 'outside-play-only'` contract) and to at most
 *     once per local calendar day.
 *
 * Pure: no react-native, no storage, no clock — callers inject `now`-derived day
 * keys — so all of it is covered by the tier-1 suite
 * (scripts/practiceReinforcementView.test.ts).
 */
import {
  computeStreak,
  type StreakSummary,
} from './practiceStreaks';
import type {
  Celebration,
  Reinforcement,
  ReinforcementNudge,
} from './practiceReinforcement';

/** Where a nudge may be considered for display. */
export type ReinforcementSurface = 'home' | 'piece-detail' | 'play' | 'score';

/**
 * Surfaces that are, by definition, inside a practice run or its result — the
 * engine's contract forbids a nudge there, so they can never pass the gate.
 */
export const PLAY_SURFACES: readonly ReinforcementSurface[] = ['play', 'score'];

/** Most celebrations to stack in one moment — one run can cross several. */
export const MAX_CELEBRATIONS = 3;

/** Zeroed streak summary (no history), derived from the engine so it cannot drift. */
export const EMPTY_STREAK_SUMMARY: StreakSummary = computeStreak([], 0);

/** The fields the streak line needs — a StreakSummary satisfies this. */
export interface StreakLineInput {
  currentDays: number;
  nextTier: number | null;
  daysToNextTier: number;
}

export interface StreakLine {
  /** e.g. "3-day streak — 4 more days to hit 7". Positive framing only. */
  text: string;
  currentDays: number;
  nextTier: number | null;
  daysToNextTier: number;
}

/**
 * The quiet streak line shown once after a scored run.
 *
 * Returns null when there is no streak to speak of (0 days, or an unusable
 * summary) — silence is the honest answer there, never a "0-day streak".
 */
export function streakLine(
  streaks: StreakLineInput | null | undefined,
): StreakLine | null {
  if (!streaks) return null;
  const currentDays = streaks.currentDays;
  if (!Number.isFinite(currentDays) || currentDays < 1) return null;

  const nextTier = streaks.nextTier ?? null;
  const daysToNextTier =
    typeof streaks.daysToNextTier === 'number' && Number.isFinite(streaks.daysToNextTier)
      ? streaks.daysToNextTier
      : 0;

  if (nextTier === null) {
    return {
      text: `${currentDays}-day streak — you have reached every practice milestone`,
      currentDays,
      nextTier: null,
      daysToNextTier: 0,
    };
  }

  const dayWord = daysToNextTier === 1 ? 'day' : 'days';
  return {
    text: `${currentDays}-day streak — ${daysToNextTier} more ${dayWord} to hit ${nextTier}`,
    currentDays,
    nextTier,
    daysToNextTier,
  };
}

/** What a component renders after a scored run — celebrations plus one line. */
export interface ReinforcementMoment {
  /** Engine payloads, in engine order, capped at MAX_CELEBRATIONS. */
  celebrations: Celebration[];
  /** Quiet line under the celebrations; null when there is no streak yet. */
  streakLine: StreakLine | null;
  /** True when at least one crossing happened — the only "big moment" case. */
  hasMoment: boolean;
  /** Streak days as of this run (for the share card). */
  streakDays: number;
  /** Total logged practice minutes including this run (for the share card). */
  totalMinutes: number;
  /** This run's length in whole minutes (0 when unknown). */
  runMinutes: number;
}

/**
 * Turn an engine result into the moment the coach card renders.
 *
 * Returns null when there is nothing honest to show: no crossing, and no streak
 * to report either. A run that crossed nothing still gets the streak line (when
 * a streak exists) — it never gets a manufactured celebration.
 */
export function buildReinforcementMoment(
  reinforcement: Reinforcement | null | undefined,
  run: { durationSec?: number } = {},
): ReinforcementMoment | null {
  if (!reinforcement) return null;

  const celebrations = [...reinforcement.celebrations].slice(0, MAX_CELEBRATIONS);
  const line = streakLine(reinforcement.streaks);
  if (celebrations.length === 0 && line === null) return null;

  const durationSec =
    typeof run.durationSec === 'number' && Number.isFinite(run.durationSec) && run.durationSec > 0
      ? run.durationSec
      : 0;

  return {
    celebrations,
    streakLine: line,
    hasMoment: celebrations.length > 0,
    streakDays: Math.max(0, reinforcement.streaks.currentDays),
    totalMinutes: reinforcement.minutes.total,
    runMinutes: Math.round(durationSec / 60),
  };
}

/** Local hour the once-a-day streak nudge may land (outside any practice run). */
export const NUDGE_HOUR = 18;

/**
 * The next nudge moment — today at `hour:minute`, or null when that moment has
 * already passed. Pure and injected-`now`, so it is covered by the tier-1 suite.
 *
 * Returning null rather than "tomorrow at 18:00" is deliberate: a nudge whose
 * copy says "today" must never be delivered tomorrow, and we do not nag late at
 * night about a day that is nearly over.
 *
 * `hour`/`minute` default to the historical 18:00. The user's chosen reminder
 * time (owner 09-25, see services/reminderTime.ts) is passed in by the nudge
 * scheduler; nothing else changed about the one-shot semantics.
 */
export function nextNudgeTime(
  now: Date,
  hour: number = NUDGE_HOUR,
  minute: number = 0,
): Date | null {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const at = new Date(now.getTime());
  at.setHours(hour, minute, 0, 0);
  return at.getTime() > now.getTime() ? at : null;
}

export interface NudgeGateInput {
  nudge: ReinforcementNudge | null | undefined;
  /** Where the card would be shown. */
  surface: ReinforcementSurface;
  /** YYYY-MM-DD this nudge was last dismissed, or null when never dismissed. */
  dismissedDayKey?: string | null;
  /** Today's YYYY-MM-DD in the user's calendar (see localDayKey). */
  todayKey?: string | null;
}

/**
 * The nudge to show on this surface, or null.
 *
 * Rejects a payload that does not carry the engine's outside-play contract, any
 * play/score surface, a nudge with no streak to protect, and a nudge already
 * dismissed today (one gentle card per day, never a nag).
 */
export function nudgeForSurface(input: NudgeGateInput): ReinforcementNudge | null {
  const { nudge, surface } = input;
  if (!nudge) return null;
  if (nudge.playSafeOnly !== true || nudge.surface !== 'outside-play-only') return null;
  if (PLAY_SURFACES.includes(surface)) return null;
  if (!(nudge.streakDays >= 1)) return null;
  if (input.todayKey && input.dismissedDayKey === input.todayKey) return null;
  return nudge;
}
