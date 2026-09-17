/**
 * practiceReinforcement.ts — the single pure entry point of the practice
 * reinforcement layer (retention build; slice 1 shipped the engine, slice 2
 * added evaluateNudge() + the UI wiring — see ./practiceReinforcementView.ts for
 * the rules about what the UI may show and where).
 *
 * One call answers everything the UI needs after a finished practice run:
 *
 *   evaluateReinforcement({ history, completedSession, now, tz })
 *     → streaks        (current / longest / alive / at risk / next tier)
 *     → minutes        (total, thresholds just crossed, next threshold)
 *     → personalBest   (beat-last-time framing, per piece)
 *     → celebrations[] (structured payloads for the share cards)
 *     → nudge          (gentle at-risk-streak prompt, or null)
 *
 *   evaluateNudge({ history, now, tz })
 *     → the SAME nudge payload with no finished run — the "quiet card outside
 *       practice" path.
 *
 * Design rules baked in here (all testable, all in the tier-1 suite):
 *   • Pure: no storage, no clock, no react-native. `now` and `tz` are injected,
 *     so the same inputs always produce the same output.
 *   • `history` is the history BEFORE the finished run — matching
 *     getBestAccuracy() semantics in practiceHistory.ts. The engine appends
 *     completedSession itself (capped at PRACTICE_HISTORY_CAP). To be safe for
 *     callers that pass the already-updated history instead, an identical
 *     session already present is NOT added twice (see sameSession()).
 *   • CAP CONSEQUENCE (documented, tested): history keeps the newest 200 runs,
 *     so once a user has 200 stored runs the oldest is dropped on each save —
 *     and a dropped run's minutes stop being counted. That is a property of the
 *     storage cap, not of this engine; the streak/longest-day maths and the
 *     "already crossed" bookkeeping are unaffected because they are derived
 *     from the days still present.
 *   • Celebrations fire on CROSSINGS, never on state: a threshold that was
 *     already passed is not re-announced, and a second run on the same day does
 *     not re-announce the same streak tier. Minutes and tiers are compound and
 *     non-resetting.
 *   • Copy is positive-framing only — no guilt, no "don't break your streak"
 *     pressure, no manufactured urgency, and no raw percentages (they are not
 *     shown to users anywhere; accuracy moves are phrased as points).
 *   • The nudge is DATA, not a notification. This layer schedules nothing and
 *     touches no push API. `playSafeOnly: true` is a contract flag: the UI must
 *     only ever surface a nudge OUTSIDE a practice run / score screen.
 */
import {
  appendSession,
  normalizeSession,
  type PracticeSession,
} from './practiceHistory';
import {
  STREAK_TIERS,
  computeStreak,
  hasDay,
  toEpochMs,
  type StreakSummary,
  type StreakTier,
  type TimeZoneSpec,
} from './practiceStreaks';
import {
  MILESTONE_LABELS,
  computeMinutesTotal,
  computePersonalBest,
  milestonesCrossed,
  nextMilestone,
  type PersonalBestResult,
} from './practiceMilestones';

export type CelebrationKind =
  | 'streak-tier'
  | 'minutes-milestone'
  | 'personal-best'
  | 'first-session';

/** Structured celebration payload — the future share-card layer renders this. */
export interface Celebration {
  kind: CelebrationKind;
  /** Headline, e.g. "7-day streak!". */
  title: string;
  emoji: string;
  /** One supportive line. Never carries a raw accuracy percentage. */
  copy: string;
  /** Ready-to-share sentence for the share card / share sheet. */
  shareText: string;
  /** Numeric anchor: streak days, milestone minutes, accuracy points, or 1. */
  value: number;
  /** Threshold that fired it (streak tier / minute milestone), else null. */
  threshold: number | null;
}

/** The finished run, in the shape practiceHistory.normalizeSession accepts. */
export interface CompletedSessionInput {
  pieceId: string;
  accuracyPct: number;
  durationSec: number;
  /** Omit to use `now` — never the device clock, so tests stay deterministic. */
  playedAt?: string;
}

export interface ReinforcementInput {
  /** Runs BEFORE the finished one (see the header note on double-counting). */
  history?: readonly PracticeSession[];
  completedSession: CompletedSessionInput;
  /** Injected "now" — Date, ISO string or epoch ms. */
  now: Date | string | number;
  /** Calendar to use; undefined = device local. */
  tz?: TimeZoneSpec;
}

/** Gentle, positive nudge — OUTSIDE play only. Not a notification. */
export interface ReinforcementNudge {
  kind: 'at-risk-streak';
  streakDays: number;
  daysToNextTier: number;
  /**
   * Contract flag: this may only be shown somewhere a practice run is not in
   * progress (home / library / coach idle). Never over a score or during play.
   */
  playSafeOnly: true;
  /** Explicit surface name so the UI cannot mistake the intent. */
  surface: 'outside-play-only';
  title: string;
  emoji: string;
  copy: string;
}

export interface Reinforcement {
  streaks: StreakSummary;
  minutes: {
    /** Total minutes including the finished run (1 decimal place). */
    total: number;
    /** Milestone thresholds newly crossed by the finished run. */
    crossed: number[];
    next_tier: number | null;
    minutesToNext: number;
  };
  personalBest: PersonalBestResult & {
    /** True when this was the very first practice run on the device. */
    firstSessionEver: boolean;
  };
  /** Fixed order: first-session, personal-best, streak-tier, minutes-milestone. */
  celebrations: Celebration[];
  nudge: ReinforcementNudge | null;
}

/** Accuracy moves are phrased in points (0–100 scale), never as a percentage. */
function formatPoints(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Copy per streak tier — steady, encouraging, no pressure. */
const STREAK_TIER_COPY: Record<number, string> = {
  3: 'Three days in a row — the habit is starting.',
  7: 'A full week of practising. That is a streak worth keeping.',
  14: 'Two weeks running — this is your routine now.',
  30: 'Thirty days. Practice has become part of your day.',
  100: 'One hundred days in a row. Outstanding consistency.',
};

function streakTierCelebration(days: number, tier: number): Celebration {
  return {
    kind: 'streak-tier',
    title: `${days}-day streak!`,
    emoji: '🔥',
    copy: STREAK_TIER_COPY[tier] ?? `${days} days in a row — keep the music going.`,
    shareText: `I am on a ${days}-day practice streak on NoteSnap 🎵`,
    value: days,
    threshold: tier,
  };
}

function minutesCelebration(threshold: number): Celebration {
  const label = MILESTONE_LABELS[threshold] ?? `${threshold} minutes`;
  return {
    kind: 'minutes-milestone',
    title: `${label}: ${threshold} minutes`,
    emoji: '🏅',
    copy: `${threshold} minutes of practice logged — your fingers are getting stronger.`,
    shareText: `I just crossed ${threshold} practice minutes on NoteSnap — ${label} unlocked 🏅`,
    value: threshold,
    threshold,
  };
}

function personalBestCelebration(deltaPct: number): Celebration {
  return {
    kind: 'personal-best',
    title: 'New personal best!',
    emoji: '🏆',
    copy: `You beat your last best on this piece by ${formatPoints(deltaPct)} points.`,
    shareText: 'I just set a new personal best in NoteSnap practice 🏆',
    value: deltaPct,
    threshold: null,
  };
}

function firstSessionCelebration(): Celebration {
  return {
    kind: 'first-session',
    title: 'First practice logged!',
    emoji: '🎉',
    copy: 'Welcome — every run from here builds your streak.',
    shareText: 'Just logged my first practice run on NoteSnap 🎉',
    value: 1,
    threshold: null,
  };
}

/** The nudge a streak summary implies, or null (alive-but-not-today only). */
function nudgeFromStreaks(streaks: StreakSummary): ReinforcementNudge | null {
  return streaks.atRisk && streaks.currentDays >= 1 ? atRiskNudge(streaks) : null;
}

function atRiskNudge(streaks: StreakSummary): ReinforcementNudge {
  return {
    kind: 'at-risk-streak',
    streakDays: streaks.currentDays,
    daysToNextTier: streaks.daysToNextTier,
    playSafeOnly: true,
    surface: 'outside-play-only',
    title: 'Your streak is still warm',
    emoji: '🎹',
    copy: `You have practised ${streaks.currentDays} days in a row. Today is still open whenever you are ready.`,
  };
}

/** true when both records describe the same stored run. */
function sameSession(a: PracticeSession, b: PracticeSession): boolean {
  return (
    a.playedAt === b.playedAt &&
    a.pieceId === b.pieceId &&
    a.accuracyPct === b.accuracyPct &&
    a.durationSec === b.durationSec
  );
}

/**
 * Normalize the finished run, defaulting playedAt to the injected `now`.
 * Returns null when there is no usable pieceId, or when `now` is unusable and
 * no playedAt was supplied.
 */
export function normalizeCompletedSession(
  input: CompletedSessionInput,
  now: Date | string | number,
): PracticeSession | null {
  const nowMs = toEpochMs(now);
  const fallbackIso = Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null;
  // No playedAt AND no usable `now` → we cannot place the run on a calendar day.
  // Returning null is deliberate: falling back to the device clock here would
  // make the result depend on a hidden input.
  const playedAt = input?.playedAt ?? fallbackIso;
  if (!playedAt) return null;
  return normalizeSession({
    pieceId: input?.pieceId,
    accuracyPct: input?.accuracyPct,
    durationSec: input?.durationSec,
    playedAt,
  });
}

/** Everything the reinforcement UI needs, for one finished practice run. */
export function evaluateReinforcement(input: ReinforcementInput): Reinforcement | null {
  const completed = normalizeCompletedSession(input.completedSession, input.now);
  if (!completed) return null; // no usable pieceId, or no way to place the run in time

  const prior = [...(input.history ?? [])];
  const alreadyStored = prior.some((session) => sameSession(session, completed));
  const withCompleted = alreadyStored ? prior : appendSession(prior, completed);

  const streaks = computeStreak(withCompleted, input.now, input.tz);
  const starterStreak = computeStreak(prior, input.now, input.tz);

  const minutesBefore = computeMinutesTotal(prior);
  const total = computeMinutesTotal(withCompleted);
  const crossed = milestonesCrossed(minutesBefore, total);
  const next = nextMilestone(total);

  const personalBest = computePersonalBest(prior, completed, completed.pieceId);
  const firstSessionEver = prior.length === 0;

  const celebrations: Celebration[] = [];
  if (firstSessionEver) {
    // The first run gets its own welcome moment; there is no "last best" to
    // beat yet, so no personal-best celebration is stacked on top of it.
    celebrations.push(firstSessionCelebration());
  } else if (personalBest.isNewBest && personalBest.deltaPct !== null) {
    celebrations.push(personalBestCelebration(personalBest.deltaPct));
  }

  // Streak tier: only when this run actually ADDED a practice day, so a second
  // run on the same day can never re-announce a tier.
  const addedNewDay = !hasDay(prior, toEpochMs(completed.playedAt), input.tz);
  if (addedNewDay && streaks.alive) {
    const tier = STREAK_TIERS.find(
      (candidate) => candidate <= streaks.currentDays && candidate > starterStreak.currentDays,
    );
    if (tier) celebrations.push(streakTierCelebration(streaks.currentDays, tier));
  }

  for (const threshold of crossed) celebrations.push(minutesCelebration(threshold));

  const nudge = nudgeFromStreaks(streaks);

  return {
    streaks,
    minutes: {
      total,
      crossed,
      next_tier: next.tier,
      minutesToNext: next.minutesToNext,
    },
    personalBest: { ...personalBest, firstSessionEver },
    celebrations,
    nudge,
  };
}

/**
 * The at-risk nudge for a history, with no finished run to evaluate — the
 * "quiet card on the home screen" path (slice 2). Same copy and same contract as
 * the nudge returned by evaluateReinforcement, so the UI has ONE source for it.
 */
export function evaluateNudge(input: {
  /** Completed practice runs (any order). */
  history?: readonly PracticeSession[];
  /** Injected "now" — Date, ISO string or epoch ms. */
  now: Date | string | number;
  /** Calendar to use; undefined = device local. */
  tz?: TimeZoneSpec;
}): ReinforcementNudge | null {
  return nudgeFromStreaks(computeStreak(input.history ?? [], input.now, input.tz));
}

// ─── re-exports so the UI slice imports from one place ─────────

export {
  STREAK_TIERS,
  computeStreak,
  localDayKey,
  type StreakSummary,
  type StreakTier,
  type TimeZoneSpec,
} from './practiceStreaks';
export {
  MILESTONES,
  MILESTONE_LABELS,
  computeMinutesTotal,
  computePersonalBest,
  milestonesCrossed,
  nextMilestone,
  sessionMinutes,
  excludedDurationCount,
  type PersonalBestResult,
} from './practiceMilestones';
