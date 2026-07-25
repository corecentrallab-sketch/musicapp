/**
 * AsyncStorage helpers for all retention features.
 * Keys are namespaced under @notesnap/.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  OnboardingAnswers,
  StreakData,
  Badge,
  WeeklyGoal,
} from '../types';

const KEYS = {
  ONBOARDING: '@notesnap/onboarding',
  STREAK: '@notesnap/streak',
  BADGES: '@notesnap/badges',
  WEEKLY_GOAL: '@notesnap/weeklyGoal',
  PRACTICE_DAYS: '@notesnap/practiceDays',
} as const;

// ─── Onboarding ───────────────────────────────────────────────

export async function getOnboardingAnswers(): Promise<OnboardingAnswers | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.ONBOARDING);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveOnboardingAnswers(answers: OnboardingAnswers): Promise<void> {
  await AsyncStorage.setItem(KEYS.ONBOARDING, JSON.stringify(answers));
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  const answers = await getOnboardingAnswers();
  return answers !== null;
}

// ─── Streaks ──────────────────────────────────────────────────

const DEFAULT_STREAK: StreakData = {
  currentStreak: 0,
  lastPracticeDate: null,
  bestStreak: 0,
};

export async function getStreakData(): Promise<StreakData> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.STREAK);
    return raw ? { ...DEFAULT_STREAK, ...JSON.parse(raw) } : DEFAULT_STREAK;
  } catch {
    return DEFAULT_STREAK;
  }
}

export async function saveStreakData(data: StreakData): Promise<void> {
  await AsyncStorage.setItem(KEYS.STREAK, JSON.stringify(data));
}

/**
 * Records a practice session for today.
 * Should be called when user opens sheet music or uses practice tools.
 * Returns the updated streak data.
 */
export async function recordPractice(): Promise<StreakData> {
  const today = getTodayStr();
  const streak = await getStreakData();

  if (streak.lastPracticeDate === today) {
    // Already practiced today — no change
    return streak;
  }

  const yesterday = getDateStr(new Date(Date.now() - 86400000));

  if (streak.lastPracticeDate === yesterday) {
    // Consecutive day — increment streak
    streak.currentStreak += 1;
  } else if (streak.lastPracticeDate !== today) {
    // Missed a day — reset streak
    streak.currentStreak = 1;
  }

  streak.lastPracticeDate = today;
  if (streak.currentStreak > streak.bestStreak) {
    streak.bestStreak = streak.currentStreak;
  }

  await saveStreakData(streak);

  // Also track today in practice days set (for weekly goals)
  await addPracticeDay(today);

  return streak;
}

// ─── Practice Days (for weekly goals) ─────────────────────────

async function getPracticeDays(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PRACTICE_DAYS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function addPracticeDay(dateStr: string): Promise<void> {
  const days = await getPracticeDays();
  if (!days.includes(dateStr)) {
    days.push(dateStr);
    await AsyncStorage.setItem(KEYS.PRACTICE_DAYS, JSON.stringify(days));
  }
}

// ─── Weekly Goals ─────────────────────────────────────────────

export async function getWeeklyGoal(): Promise<WeeklyGoal> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.WEEKLY_GOAL);
    const thisMonday = getMondayStr(new Date());
    if (raw) {
      const goal: WeeklyGoal = JSON.parse(raw);
      // If it's a new week, reset
      if (goal.weekStart !== thisMonday) {
        const newGoal = autoSetWeeklyGoal();
        await AsyncStorage.setItem(KEYS.WEEKLY_GOAL, JSON.stringify(newGoal));
        return newGoal;
      }
      // Recalculate current from practice days
      const practiceDays = await getPracticeDays();
      const weekDays = practiceDays.filter((d) => d >= thisMonday);
      return { ...goal, current: weekDays.length };
    }
  } catch {
    // fall through to default
  }
  const goal = autoSetWeeklyGoal();
  await AsyncStorage.setItem(KEYS.WEEKLY_GOAL, JSON.stringify(goal));
  return goal;
}

export async function saveWeeklyGoal(goal: WeeklyGoal): Promise<void> {
  await AsyncStorage.setItem(KEYS.WEEKLY_GOAL, JSON.stringify(goal));
}

/** Auto-set target based on previous week's activity (min 3, max 7). */
function autoSetWeeklyGoal(): WeeklyGoal {
  const thisMonday = getMondayStr(new Date());
  return {
    target: 5, // default: 5 days per week
    current: 0,
    weekStart: thisMonday,
  };
}

// ─── Badges ────────────────────────────────────────────────────

export async function getBadges(): Promise<Badge[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.BADGES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveBadges(badges: Badge[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.BADGES, JSON.stringify(badges));
}

// ─── Helpers ──────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD. */
export function getTodayStr(): string {
  return getDateStr(new Date());
}

function getDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns the Monday of the current week as YYYY-MM-DD. */
function getMondayStr(d: Date): string {
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(monday.getDate() + diff);
  return getDateStr(monday);
}
