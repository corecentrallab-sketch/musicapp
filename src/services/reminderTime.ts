/**
 * reminderTime.ts — the user's chosen practice-reminder TIME (owner request
 * 09-25: "practice reminders at 6:00 PM" → let the user set the time).
 *
 * The nudge itself is unchanged: ONE one-shot notification a day, scheduled at
 * the user's chosen local time, re-scheduled whenever the app re-evaluates it, and
 * never inside play (see src/services/notifications.ts). Only the fixed 18:00
 * becomes a persisted choice whose default is still 18:00, so existing users see
 * exactly the behaviour they had.
 *
 * This module owns the minutes-of-day value, its formatting and the row copy, so
 * Settings, the scheduler and the tier1 gate all read the same strings. The UI
 * picker is deliberately in-repo (no new native dependency): the settings row
 * carries hour and 5-minute steppers around this module's stepper math.
 *
 * Pure by design (no react / react-native / expo / storage imports), so the tier1
 * gate compiles it with node_modules absent. See scripts/reminderTime.test.ts.
 */

/** Default reminder time: 18:00 local — the pre-existing behaviour, preserved. */
export const DEFAULT_REMINDER_MINUTES = 18 * 60;

/** How far the picker steps a tap (5 minutes — the useful granularity). */
export const REMINDER_MINUTE_STEP = 5;

/** The AsyncStorage key for the chosen time (see services/storage.ts). */
export const REMINDER_MINUTES_STORAGE_KEY = '@notesnap/reminderMinutes';

/** A minutes-of-day value clamped into 00:00–23:55. Never NaN, never out of day. */
export function normalizeReminderMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_REMINDER_MINUTES;
  const rounded = Math.round(n / REMINDER_MINUTE_STEP) * REMINDER_MINUTE_STEP;
  return Math.min(23 * 60 + 55, Math.max(0, rounded));
}

/**
 * Move the chosen time by `deltaMinutes` (a 5-minute tap, or ±60 for the hour
 * stepper), wrapping inside the day so the picker is never a dead end.
 */
export function stepReminderMinutes(current: unknown, deltaMinutes: number): number {
  const base = normalizeReminderMinutes(current);
  const delta = Number.isFinite(deltaMinutes) ? Math.round(deltaMinutes) : 0;
  const day = 24 * 60;
  return ((base + delta) % day + day) % day;
}

/** The hour + minute pair the scheduler needs for a minutes-of-day value. */
export function reminderHourMinute(minutes: unknown): { hour: number; minute: number } {
  const m = normalizeReminderMinutes(minutes);
  return { hour: Math.floor(m / 60), minute: m % 60 };
}

/** "6:00 PM" / "7:30 PM" / "12:05 AM" — 12-hour clock with the meridiem. */
export function formatReminderTime(minutes: unknown): string {
  const m = normalizeReminderMinutes(minutes);
  const hour24 = Math.floor(m / 60);
  const minute = m % 60;
  const meridiem = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

/** The settings row's line: the chosen time, stated plainly. */
export function reminderSettingCopy(minutes: unknown): string {
  return `At ${formatReminderTime(minutes)}, remind me if I have not practiced.`;
}

/** A stored value (string or number) read back as minutes-of-day. */
export function parseStoredReminderMinutes(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_REMINDER_MINUTES;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? normalizeReminderMinutes(n) : DEFAULT_REMINDER_MINUTES;
}

// ─── source contracts (live scan) ───────────────────────────────────────

/**
 * True when the Settings row renders the CHOSEN time (never the literal "6:00
 * PM") and can change it: the row must read reminderSettingCopy(...) from this
 * module and be wired to the stepper + the persist callback.
 */
export function reminderSettingWired(source: string): boolean {
  return (
    source.includes('reminderSettingCopy(') &&
    source.includes('stepReminderMinutes(') &&
    source.includes('onChangeReminderTime(') &&
    !source.includes('At 6:00 PM, remind me if I have not practiced.')
  );
}

/**
 * True when the scheduler uses the PERSISTED time: notifications.ts must read it
 * from storage and hand its hour+minute to the one-shot scheduler (instead of the
 * old fixed hour default).
 */
export function reminderScheduleUsesStoredTime(source: string): boolean {
  return (
    source.includes('getReminderMinutes()') &&
    source.includes('reminderHourMinute(') &&
    /nextNudgeTime\(new Date\(\),\s*hour,\s*minute\)/.test(source)
  );
}
