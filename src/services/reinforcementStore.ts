/**
 * reinforcementStore.ts — the device adapter for the practice-reinforcement
 * layer (retention build, slice 2).
 *
 * This is the ONLY module in the layer that touches react-native/AsyncStorage.
 * The decisions live in ./practiceStreaks.ts, ./practiceMilestones.ts,
 * ./practiceReinforcement.ts (the engine) and ./practiceReinforcementView.ts
 * (what the UI may show); this file just reads the device's practice history,
 * hands it to the engine, and remembers that the user dismissed a nudge today.
 *
 * STREAK SOURCE OF TRUTH (slice 2 unification): the streak shown anywhere in the
 * app comes from the engine over the practice history — never from the legacy
 * mutable `@notesnap/streak` counter in storage.ts. getDisplayStreakLocal() is
 * the one read the screens use, so no two surfaces can disagree.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPracticeHistoryLocal } from './practiceHistoryStore';
import { computeStreak, localDayKey, type StreakSummary } from './practiceStreaks';
import {
  EMPTY_STREAK_SUMMARY,
  type StreakLineInput,
} from './practiceReinforcementView';
import { evaluateNudge, type ReinforcementNudge } from './practiceReinforcement';

/** YYYY-MM-DD of the last day the at-risk nudge card was dismissed. */
export const NUDGE_DISMISSED_KEY = 'notesnap:practice:nudge-dismissed:v1';

/** The engine's streak for this device, as of `now` (device-local calendar). */
export async function getEngineStreakLocal(now: number = Date.now()): Promise<StreakSummary> {
  try {
    const history = await getPracticeHistoryLocal();
    return computeStreak(history, now);
  } catch {
    // Storage unavailable → report no streak rather than a made-up one.
    return EMPTY_STREAK_SUMMARY;
  }
}

/** What the app's streak surfaces render (current streak + best ever). */
export interface DisplayStreak extends StreakLineInput {
  currentDays: number;
  nextTier: number | null;
  daysToNextTier: number;
  longestDays: number;
}

/** Single source for every on-screen streak number (see the header note). */
export async function getDisplayStreakLocal(now: number = Date.now()): Promise<DisplayStreak> {
  const streaks = await getEngineStreakLocal(now);
  return {
    currentDays: streaks.currentDays,
    nextTier: streaks.nextTier,
    daysToNextTier: streaks.daysToNextTier,
    longestDays: streaks.longestDays,
  };
}

/** The gentle at-risk nudge for this device, or null (see evaluateNudge). */
export async function getReinforcementNudgeLocal(
  now: number = Date.now(),
): Promise<ReinforcementNudge | null> {
  try {
    const history = await getPracticeHistoryLocal();
    return evaluateNudge({ history, now });
  } catch {
    return null;
  }
}

/** Today's YYYY-MM-DD key in the device's own calendar. */
export function todayKeyLocal(now: number = Date.now()): string | null {
  return localDayKey(now);
}

/** YYYY-MM-DD the nudge was last dismissed, or null when it never was. */
export async function getNudgeDismissedDay(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(NUDGE_DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** Remember that the nudge was dismissed today (one gentle card per day). */
export async function setNudgeDismissedDay(dayKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(NUDGE_DISMISSED_KEY, dayKey);
  } catch {
    // Dismissal is a nicety — a failed write must never break the screen.
  }
}
