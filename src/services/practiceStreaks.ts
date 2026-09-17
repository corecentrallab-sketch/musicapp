/**
 * practiceStreaks.ts — practice-day streaks (retention build, slice 1: engine).
 *
 * Pure module: no react-native, no AsyncStorage, no clock of its own. Every
 * time-dependent decision takes an injected `now`, so the tier-1 suite is
 * deterministic (same convention as practiceCoach.ts / practiceHistory.ts).
 *
 * WHAT A STREAK IS HERE
 * A streak counts *consecutive local calendar days* on which the user finished
 * at least one practice run. Days come from the practice-coach history
 * (./practiceHistory.ts), which is the per-run record written by the coach; the
 * app's older `@notesnap/streak` counter in storage.ts is a separate, older
 * path and is NOT read here (see the note at the bottom of this header).
 *
 *   • last run today            → alive, not at risk (currentDays counts today)
 *   • last run yesterday, none today → STILL ALIVE, at risk (a nudge may fire)
 *   • last run 2+ days ago      → broken (currentDays = 0)
 *
 * CALENDAR MATH / DST
 * Days are never computed by adding 86_400_000 ms to a timestamp (that breaks
 * across DST transitions and across month/year rollover). Instead each
 * timestamp is converted to a *civil date* (year, month, day) and compared as a
 * day ordinal:
 *
 *   ordinal = Date.UTC(year, month - 1, day) / 86_400_000
 *
 * Date.UTC is UTC-only, so it has no DST rules of its own and handles
 * month/year rollover for free; the local/DST rules are applied exactly once,
 * when the timestamp is converted to civil date parts.
 *
 * `tz` selects which civil calendar is used:
 *   • undefined / null → the device's own local time (what real users have).
 *   • a number         → a fixed UTC offset in MINUTES east of UTC (e.g. 600 =
 *                        AEST +10:00). Deterministic for tests.
 *   • an IANA string   → real named-zone rules through Intl.DateTimeFormat,
 *                        so DST transitions are honoured. If the JS engine has
 *                        no usable Intl (some Hermes builds), this falls back
 *                        to device-local time rather than throwing.
 *
 * RELATIONSHIP TO THE OLD STREAK (do not double-count)
 * storage.ts keeps its own mutable counter (`@notesnap/streak`, recordPractice)
 * and notifications.ts schedules a daily nudge off it. This module derives the
 * same idea from practice history instead. Slice 2 (UI) must pick ONE source of
 * truth per surface — deriving from history is the one that can show "3 days,
 * next badge at 7" honestly. Nothing here writes storage, so the two can
 * coexist until that decision is made.
 */
import type { PracticeSession } from './practiceHistory';

/** Fixed UTC offset (minutes east) or IANA zone name; undefined = device local. */
export type TimeZoneSpec = string | number | null | undefined;

/** Streak tiers worth celebrating. Ordered, ascending, non-resetting. */
export const STREAK_TIERS = [3, 7, 14, 30, 100] as const;
export type StreakTier = (typeof STREAK_TIERS)[number];

export interface StreakSummary {
  /** Consecutive practice days ending today (or yesterday while at risk). */
  currentDays: number;
  /** Longest consecutive run anywhere in the history. */
  longestDays: number;
  /** True when the streak has not been broken (today or yesterday was practised). */
  alive: boolean;
  /** Alive but today has no run yet — the only state that may nudge the user. */
  atRisk: boolean;
  /** Next tier above currentDays, or null once every tier is passed. */
  nextTier: StreakTier | null;
  /** Days still needed for nextTier (0 when nextTier is null). */
  daysToNextTier: number;
  /** Distinct local calendar days with at least one completed run. */
  totalPracticeDays: number;
}

/** A civil date plus its day ordinal (see the header for the ordinal maths). */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
  /** YYYY-MM-DD, the shape storage.ts' getDateStr() uses. */
  key: string;
  /** Whole days since 1970-01-01, UTC-based, DST-free. */
  ordinal: number;
}

// ─── time / calendar helpers ───────────────────────────────────

/** Accepts a Date, an ISO string or epoch ms; NaN-safe. */
export function toEpochMs(now: Date | string | number): number {
  if (typeof now === 'number') return now;
  if (typeof now === 'string') return Date.parse(now);
  return now instanceof Date ? now.getTime() : NaN;
}

/**
 * Minimal shape of Intl.DateTimeFormat that we use. Declared locally so this
 * module never depends on which Intl lib/types a given engine ships.
 */
interface PartsFormatter {
  formatToParts(date: Date): Array<{ type: string; value: string }>;
}
type IntlLike = {
  DateTimeFormat?: new (locale?: string, options?: unknown) => PartsFormatter;
};

const formatterCache = new Map<string, PartsFormatter | null>();

/** Cached IANA-zone formatter, or null when the engine cannot do named zones. */
function namedZoneFormatter(tz: string): PartsFormatter | null {
  const cached = formatterCache.get(tz);
  if (cached !== undefined) return cached;
  let formatter: PartsFormatter | null = null;
  try {
    const intl = (globalThis as { Intl?: IntlLike }).Intl;
    if (intl && typeof intl.DateTimeFormat === 'function') {
      const made = new intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      // A formatter that silently ignores timeZone can't be trusted; prove it
      // works on a probe date before we cache it.
      const probe = made.formatToParts(new Date(0));
      if (probe.some((p) => p.type === 'year')) formatter = made;
    }
  } catch {
    formatter = null;
  }
  formatterCache.set(tz, formatter);
  return formatter;
}

/** Whole days since 1970-01-01 for a civil date (UTC maths only — no DST). */
export function dayOrdinal(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Two-digit zero pad. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function civilDay(year: number, month: number, day: number): CalendarDay {
  return {
    year,
    month,
    day,
    key: `${year}-${pad2(month)}-${pad2(day)}`,
    ordinal: dayOrdinal(year, month, day),
  };
}

/** Civil date for an instant under the requested calendar. null when unusable. */
export function calendarDayOf(ms: number, tz?: TimeZoneSpec): CalendarDay | null {
  if (!Number.isFinite(ms)) return null;

  if (typeof tz === 'number' && Number.isFinite(tz)) {
    // Fixed offset: shift the instant, then read it back in UTC parts.
    const shifted = new Date(ms + tz * 60_000);
    return civilDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }

  if (typeof tz === 'string' && tz.length > 0) {
    const formatter = namedZoneFormatter(tz);
    if (formatter) {
      try {
        const parts = formatter.formatToParts(new Date(ms));
        let year = NaN;
        let month = NaN;
        let day = NaN;
        for (const part of parts) {
          if (part.type === 'year') year = Number(part.value);
          else if (part.type === 'month') month = Number(part.value);
          else if (part.type === 'day') day = Number(part.value);
        }
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
          return civilDay(year, month, day);
        }
      } catch {
        /* fall through to device-local below */
      }
    }
  }

  // Device-local calendar — the runtime applies the actual local/DST rules.
  const d = new Date(ms);
  return civilDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** YYYY-MM-DD for an instant under the requested calendar (null when unusable). */
export function localDayKey(ms: number, tz?: TimeZoneSpec): string | null {
  const day = calendarDayOf(ms, tz);
  return day ? day.key : null;
}

/**
 * Distinct practice-day ordinals in a history, ascending. Sessions with a
 * missing/unparseable `playedAt` are skipped (they cannot be placed on a day).
 */
export function practiceDayOrdinals(
  history: readonly PracticeSession[],
  tz?: TimeZoneSpec,
): number[] {
  const seen = new Set<number>();
  for (const session of history) {
    const ms = toEpochMs(session?.playedAt ?? '');
    const day = calendarDayOf(ms, tz);
    if (day) seen.add(day.ordinal);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Length of the consecutive run ending at `endOrdinal` (0 when absent). */
function runEndingAt(days: ReadonlySet<number>, endOrdinal: number): number {
  if (!days.has(endOrdinal)) return 0;
  let length = 1;
  let cursor = endOrdinal - 1;
  while (days.has(cursor)) {
    length++;
    cursor--;
  }
  return length;
}

/** Longest consecutive run in an ascending ordinal list. */
function longestRun(ascending: readonly number[]): number {
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of ascending) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/** Smallest tier strictly above `days`, or null when all tiers are passed. */
export function nextTierAbove(days: number): StreakTier | null {
  for (const tier of STREAK_TIERS) {
    if (tier > days) return tier;
  }
  return null;
}

// ─── the entry point ───────────────────────────────────────────

/**
 * Streak summary for a history, evaluated as of `now`.
 *
 * @param history completed practice sessions (any order; duplicates on the
 *                same day collapse into that one day).
 * @param now     the instant to evaluate at — injected so tests are stable.
 * @param tz      calendar to use (see TimeZoneSpec); default = device local.
 */
export function computeStreak(
  history: readonly PracticeSession[],
  now: Date | string | number,
  tz?: TimeZoneSpec,
): StreakSummary {
  const days = practiceDayOrdinals(history, tz);
  const daySet = new Set(days);
  const longestDays = longestRun(days);
  const totalPracticeDays = days.length;

  const nowDay = calendarDayOf(toEpochMs(now), tz);
  // With no usable `now` we cannot judge today; treat the streak as not alive
  // rather than inventing a number the UI would show as fact.
  if (!nowDay) {
    return {
      currentDays: 0,
      longestDays,
      alive: false,
      atRisk: false,
      nextTier: nextTierAbove(0),
      daysToNextTier: nextTierAbove(0) ?? 0,
      totalPracticeDays,
    };
  }

  const today = nowDay.ordinal;
  const last = days.length > 0 ? days[days.length - 1] : null;

  let currentDays = 0;
  let alive = false;
  let atRisk = false;

  if (last !== null && last >= today) {
    // Practised today (a future-dated run also lands here: clock skew must not
    // make an active player look lapsed).
    currentDays = runEndingAt(daySet, last);
    alive = true;
  } else if (last !== null && last === today - 1) {
    // Yesterday, nothing today yet: alive and at risk, not broken.
    currentDays = runEndingAt(daySet, last);
    alive = true;
    atRisk = true;
  }
  // else: last run 2+ days ago → broken (0).

  const nextTier = nextTierAbove(currentDays);
  return {
    currentDays,
    longestDays,
    alive,
    atRisk,
    nextTier,
    daysToNextTier: nextTier === null ? 0 : nextTier - currentDays,
    totalPracticeDays,
  };
}

/** True when the local calendar day of `ms` already appears in the history. */
export function hasDay(
  history: readonly PracticeSession[],
  ms: number,
  tz?: TimeZoneSpec,
): boolean {
  const day = calendarDayOf(ms, tz);
  if (!day) return false;
  return practiceDayOrdinals(history, tz).includes(day.ordinal);
}
