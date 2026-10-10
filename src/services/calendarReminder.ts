/**
 * calendarReminder.ts — THE CALENDAR REMINDER MODEL (owner-approved 10-10, backlog
 * b033ab48). Pure by design: no react / react-native / expo / fs imports, so the
 * tier1 gate compiles it with node_modules absent (see tsconfig.tier1.json).
 *
 * WHAT THIS IS. The app already has ONE reminder channel: the streak-aware in-app
 * notification (services/notifications.ts). The owner asked (10-10) that the
 * practice reminder can ALSO appear as a daily recurring event in the user's own
 * phone calendar. The owner approved all four recommendations of the design brief
 * (`/home/team/shared/calendar-reminders-design-brief.md`):
 *   1. OPT-IN, off by default — every existing user keeps exactly today's reminder;
 *   2. CALENDAR-ONLY by default when armed, with an explicit "also keep the in-app
 *      reminder" option, labelled honestly as TWO reminders at the same time;
 *   3. event title exactly `NoteSnap practice`, a 30-minute daily block;
 *   4. ANDROID-first (no iOS EventKit wiring in this batch).
 *
 * THE ONE DECISION POINT. `reminderChannelPlan({ channel, notificationsEnabled,
 * calendarReady })` is the ONLY function in the codebase that decides what gets
 * armed, and it returns every honest line the Settings row must render. Both
 * schedulers (the notification queue and the calendar seam) are called from a
 * screen that reads this plan, so a silent double-arm is unreachable by
 * construction — and the live-source guard suite (services/v38CalendarContract.ts,
 * scripts/v38CalendarWiring.test.ts) proves, on the REAL files, that the screen
 * still renders the two-reminder line whenever `doublePing` is true.
 *
 * The time is not a second time source: every time here comes through
 * `reminderHourMinute` / `formatReminderTime` from services/reminderTime.ts, the
 * same pair services/notifications.ts:78 uses. The two channels therefore cannot
 * drift to different times — the UI cannot even express it.
 *
 * The event is dumb and the notification is not: a calendar event fires every day
 * and cannot know whether the user already practised. That difference is why
 * "both" is a real, labelled choice instead of a silent default, and why
 * CALENDAR_NOT_STREAK_AWARE_LINE is part of the model rather than a screen aside.
 *
 * WHAT NOTE SNAP NEVER DOES (stated here so the guards can assert it): nothing is
 * uploaded — there is no network call anywhere in this feature — and no other
 * event in the user's calendar is read for any product purpose. The only read is
 * the reinstall-hygiene scan, which looks for our own exact title.
 */
import { formatReminderTime, reminderHourMinute } from './reminderTime';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. THE CHANNEL MODEL
// ═══════════════════════════════════════════════════════════════════════════════

/** The three states of the one persisted channel choice. */
export const REMINDER_CHANNELS = ['notification', 'calendar', 'both'] as const;

/** What the persisted `@notesnap/reminderChannel` value can be. */
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/**
 * TODAY'S BEHAVIOUR, and the backward-compatibility rule: an absent key, a
 * reinstall, a corrupt value or a value written by an older app version all read
 * back as the in-app notification — so nothing changes for a user who never
 * asked for a calendar reminder.
 */
export const DEFAULT_REMINDER_CHANNEL: ReminderChannel = 'notification';

/** The persisted channel choice (see services/storage.ts for the accessors). */
export const REMINDER_CHANNEL_STORAGE_KEY = '@notesnap/reminderChannel';
/** The calendar the user picked for the one event. */
export const CALENDAR_REMINDER_CALENDAR_KEY = '@notesnap/calendarReminderCalendarId';
/** The id of the ONE event we created, so it can be updated and deleted. */
export const CALENDAR_REMINDER_EVENT_KEY = '@notesnap/calendarReminderEventId';

/** A raw stored value read back as a channel — never throws, never invents. */
export function normalizeReminderChannel(raw: unknown): ReminderChannel {
  if (typeof raw !== 'string') return DEFAULT_REMINDER_CHANNEL;
  const value = raw.trim();
  return (REMINDER_CHANNELS as readonly string[]).includes(value)
    ? (value as ReminderChannel)
    : DEFAULT_REMINDER_CHANNEL;
}

/** The storage-shaped read: absent / empty / garbage → the default channel. */
export function parseStoredReminderChannel(raw: unknown): ReminderChannel {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_REMINDER_CHANNEL;
  return normalizeReminderChannel(raw);
}

/** The channel-choice control, verbatim (so the screen re-types nothing). */
export const CALENDAR_CHOICE_TITLE = 'Reminders for this time';
export const CHANNEL_CHOICE_CALENDAR_ONLY_LABEL = 'Use the calendar only';
export const CHANNEL_CHOICE_BOTH_LABEL = "Also keep NoteSnap's in-app reminder";
export const CHANNEL_CHOICE_CALENDAR_ONLY_HINT = 'Stops the NoteSnap notification at this time.';
/** The honest hint for "both" — it names the second reminder, not just the option. */
export function channelChoiceBothHint(minutes: unknown): string {
  return `You'll get TWO reminders at ${formatReminderTime(minutes)} — the calendar cannot stay quiet on a day you already practised.`;
}

/**
 * The honesty-line keys the Settings row must render. The plan carries KEYS and
 * the copy plane below carries the text, so a screen can only render the shared
 * copy: a re-typed literal in a screen is caught by the wiring suite.
 */
export const CALENDAR_HONESTY_LINES = [
  'calendar-on',
  'two-reminders',
  'not-streak-aware',
  'permission-denied',
] as const;

/** One honesty line, by contract key. */
export type CalendarHonestyLine = (typeof CALENDAR_HONESTY_LINES)[number];

/** The key of the two-reminders line — the one that must follow `doublePing`. */
export const CALENDAR_TWO_REMINDERS_LINE_KEY: CalendarHonestyLine = 'two-reminders';

/** The slot the chosen time is filled into (one placeholder, one renderer). */
export const CALENDAR_TIME_SLOT = '{time}';

// ─── the honest copy plane (one source for the screen and the gate) ────────────

export const CALENDAR_HONESTY =
  'NoteSnap adds one daily event to the calendar you pick. It cannot read or change anything else in your calendar, and nothing leaves your phone.';

export const CALENDAR_SURVIVES_UNINSTALL_LINE =
  'This event is saved in your calendar, not in NoteSnap — so it stays there even if you uninstall the app. Remove it here first, or delete it in your calendar app.';

export const CALENDAR_TWO_REMINDERS_LINE = `You'll get two reminders at ${CALENDAR_TIME_SLOT} — one from NoteSnap, one from your calendar.`;

export const CALENDAR_NOT_STREAK_AWARE_LINE =
  "A calendar event reminds you every day. It can't know whether you already practised — only the NoteSnap notification can.";

export const CALENDAR_PERMISSION_DENIED_LINE =
  "Calendar reminders are off because NoteSnap isn't allowed to use your calendar. Your in-app reminder still works.";

export const CALENDAR_STALE_CALENDAR_LINE = 'That calendar is no longer on this phone.';

/** The body of the event itself, so the user can recognise ours a year later. */
export const CALENDAR_NOTES =
  "Set by NoteSnap. Practice reminders live in your calendar — NoteSnap can't see or change what else is in here.";

/** The copy for each honesty key, in the order the row shows them. */
export const CALENDAR_HONESTY_COPY: Record<CalendarHonestyLine, string> = {
  'calendar-on': CALENDAR_HONESTY,
  'two-reminders': CALENDAR_TWO_REMINDERS_LINE,
  'not-streak-aware': CALENDAR_NOT_STREAK_AWARE_LINE,
  'permission-denied': CALENDAR_PERMISSION_DENIED_LINE,
};

/** Fill the chosen time into an honesty line (only the two-reminders one has it). */
export function calendarHonestyText(line: CalendarHonestyLine, minutes: unknown): string {
  const text = CALENDAR_HONESTY_COPY[line] ?? '';
  return text.split(CALENDAR_TIME_SLOT).join(formatReminderTime(minutes));
}

// ─── the plan: the ONE decision point ─────────────────────────────────────────

export interface ReminderChannelPlanInput {
  /** The persisted (or about-to-be-persisted) channel choice. */
  channel: unknown;
  /**
   * The in-app notification row's own switch. Optional because a caller can hand
   * this an unknown value (a corrupt read, a half-loaded screen): anything that is
   * not `true` counts as "not on", which is the safe direction — nothing armed.
   */
  notificationsEnabled?: boolean;
  /**
   * True only when the calendar channel can genuinely fire: permission granted,
   * a writable calendar chosen and the event written. A revoked permission must
   * never leave the user with no reminder at all (§5.4 of the design brief).
   */
  calendarReady?: boolean;
}

export interface ReminderChannelPlan {
  /** The normalized channel this plan was built from. */
  channel: ReminderChannel;
  /** Arm the streak-aware in-app notification? */
  armNotification: boolean;
  /** Arm (create/keep) the calendar event? */
  armCalendarEvent: boolean;
  /** True IFF both are armed — the row must say so. */
  doublePing: boolean;
  /** Which honesty lines the Settings row must render (keys, not literals). */
  honestLines: CalendarHonestyLine[];
}

/**
 * THE ONLY FUNCTION THAT DECIDES WHAT GETS ARMED.
 *
 * Pinned properties (see scripts/v38Calendar.test.ts, the truth table):
 *   • `'notification'`  ⇒ the calendar event is NOT armed (an existing user's
 *     behaviour is untouched, and turning the calendar row off deletes the event);
 *   • `'calendar'`      ⇒ the in-app notification is NOT armed (one reminder, from
 *     the calendar, which is the recommended default and the owner's ask);
 *   • `doublePing`      ⇒ exactly `armNotification && armCalendarEvent`;
 *   • `calendarReady === false` ⇒ the calendar event is NOT armed AND, when
 *     notifications are on, the in-app channel IS armed instead — a revoked
 *     permission can never leave the user with no reminder;
 *   • the two-reminders honesty line is present exactly when `doublePing`.
 */
export function reminderChannelPlan(
  input?: ReminderChannelPlanInput | null,
): ReminderChannelPlan {
  const channel = normalizeReminderChannel(input?.channel);
  const enabled = input?.notificationsEnabled === true;
  const ready = input?.calendarReady === true;

  const armCalendarEvent = ready && (channel === 'calendar' || channel === 'both');
  // 'notification' → the in-app channel, exactly today's behaviour.
  // 'calendar'     → silent while the calendar can fire; if it CANNOT, the in-app
  //                  channel takes over so the user is never left with nothing.
  // 'both'         → both, and the row says so.
  const armNotification =
    channel === 'notification' ? enabled : channel === 'calendar' ? enabled && !ready : enabled;

  const doublePing = armNotification && armCalendarEvent;

  // The lines about WHAT IS ARMED. The denied state ('permission-denied') is not
  // here on purpose: it is a permission state the screen holds and renders once,
  // from CALENDAR_PERMISSION_DENIED_LINE, so the user never reads it twice.
  const honestLines: CalendarHonestyLine[] = [];
  if (armCalendarEvent) honestLines.push('calendar-on');
  if (doublePing) honestLines.push(CALENDAR_TWO_REMINDERS_LINE_KEY);
  if (armCalendarEvent && !armNotification) honestLines.push('not-streak-aware');

  return { channel, armNotification, armCalendarEvent, doublePing, honestLines };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. THE EVENT MODEL (owner decision 3: exact title, 30-minute daily block)
// ═══════════════════════════════════════════════════════════════════════════════

/** The event title, verbatim — fixed, recognisable and searchable by the user. */
export const CALENDAR_REMINDER_TITLE = 'NoteSnap practice';

/** A 30-minute block — a slot to practise in, not a claim about practice length. */
export const CALENDAR_EVENT_DURATION_MINUTES = 30;

/** The alarm fires at the event's own start (offset 0), with the OS alert UI. */
export const CALENDAR_EVENT_ALARM = { relativeOffset: 0, method: 'alert' } as const;

/** The daily rule: every day, forever — no endDate, no occurrence count. */
export const CALENDAR_EVENT_RECURRENCE = { frequency: 'daily' } as const;

/**
 * The one alarm method this feature uses, as a LITERAL. expo-calendar types the
 * native field as its `AlarmMethod` enum, which a widened `string` cannot satisfy;
 * the seam (`calendarReminderDevice.ts`) maps this literal onto the enum member,
 * because this module is pure and may not import the native package.
 */
export type CalendarAlarmMethod = 'alert';

/** The payload `createEventAsync(calendarId, input)` / `updateEventAsync` takes. */
export interface CalendarEventInput {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: false;
  recurrenceRule: { frequency: 'daily' };
  alarms: { relativeOffset: number; method: CalendarAlarmMethod }[];
  notes: string;
  /** The device's own zone when the caller knows it; omitted when it does not. */
  timeZone?: string;
}

/**
 * The NEXT occurrence of the chosen local time — today while that time is still
 * ahead, otherwise tomorrow — plus the 30-minute end. Built on
 * `reminderHourMinute` (the one time source), and the end is computed on the
 * local wall clock so a DST boundary cannot silently make the block 30 real
 * minutes that read as 90 (or 0) in the user's calendar.
 */
export function calendarEventStartsAt(
  minutes: unknown,
  now: Date,
): { startDate: Date; endDate: Date } {
  const { hour, minute } = reminderHourMinute(minutes);
  const base = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const startDate = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hour,
    minute,
    0,
    0,
  );
  if (startDate.getTime() <= base.getTime()) {
    startDate.setDate(startDate.getDate() + 1);
  }
  const endDate = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
    startDate.getHours(),
    startDate.getMinutes() + CALENDAR_EVENT_DURATION_MINUTES,
    0,
    0,
  );
  return { startDate, endDate };
}

/**
 * The exact event we write. ONE event, ONE recurrence rule, ONE alarm we
 * specified ourselves: we cannot control the user's own calendar-app default
 * reminders, which is why the copy says "one NoteSnap reminder" and never
 * "one reminder".
 */
export function buildCalendarEventInput(args: {
  minutes: unknown;
  now: Date;
  timeZone?: string | null;
}): CalendarEventInput {
  const { startDate, endDate } = calendarEventStartsAt(args.minutes, args.now);
  const input: CalendarEventInput = {
    title: CALENDAR_REMINDER_TITLE,
    startDate,
    endDate,
    allDay: false,
    recurrenceRule: { frequency: CALENDAR_EVENT_RECURRENCE.frequency },
    alarms: [{ relativeOffset: CALENDAR_EVENT_ALARM.relativeOffset, method: CALENDAR_EVENT_ALARM.method }],
    notes: CALENDAR_NOTES,
  };
  if (typeof args.timeZone === 'string' && args.timeZone.length > 0) {
    input.timeZone = args.timeZone;
  }
  return input;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. NO ORPHANS: THE REMEMBERED CALENDAR, AND THE HYGIENE SCAN
// ═══════════════════════════════════════════════════════════════════════════════

/** One writable calendar, in the shape the picker lists. */
export interface WritableCalendar {
  id: string;
  title: string;
  /** Where it comes from ("Google", "you@gmail.com", "Phone") — the picker's subtitle. */
  source: string;
}

/** How the picker labels one calendar (title + source, never a raw id). */
export function calendarChoiceLabel(calendar: WritableCalendar | null | undefined): string {
  if (!calendar) return '';
  const title = typeof calendar.title === 'string' ? calendar.title.trim() : '';
  const source = typeof calendar.source === 'string' ? calendar.source.trim() : '';
  if (title.length === 0) return source;
  return source.length === 0 ? title : `${title} — ${source}`;
}

/**
 * The remembered calendar is GONE (account removed, signed out, new phone).
 * Detected on every Settings open and surfaced honestly — never a crash, never a
 * silent re-create in a different calendar.
 */
export function isCalendarReminderStale(args: {
  storedCalendarId: string | null | undefined;
  calendars: WritableCalendar[] | null | undefined;
}): boolean {
  const stored = typeof args?.storedCalendarId === 'string' ? args.storedCalendarId : '';
  if (stored.length === 0) return false;
  const list = Array.isArray(args?.calendars) ? args.calendars : [];
  return !list.some((calendar) => calendar?.id === stored);
}

/** The hygiene scan looks this far ahead (stated in the confirm dialog). */
export const CALENDAR_HYGIENE_WINDOW_DAYS = 90;

/** The window the reinstall-hygiene scan searches. */
export function calendarHygieneWindow(now: Date): { start: Date; end: Date } {
  const base = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + CALENDAR_HYGIENE_WINDOW_DAYS);
  return { start, end };
}

/** One event row as the hygiene scan sees it. */
export interface RemovableEvent {
  id?: string;
  title?: string | null;
}

/**
 * EXACT-TITLE MATCH ONLY — nothing fuzzy, nothing partial, no case folding. A
 * title scan is a blunt instrument, so it is kept blunt on purpose: the confirm
 * dialog names the title and the window instead of hiding the mechanism.
 */
export function findNoteSnapEventsForRemoval(
  events: RemovableEvent[] | null | undefined,
  title: string = CALENDAR_REMINDER_TITLE,
): string[] {
  const list = Array.isArray(events) ? events : [];
  const wanted = typeof title === 'string' ? title : CALENDAR_REMINDER_TITLE;
  const ids: string[] = [];
  for (const event of list) {
    if (!event) continue;
    if (typeof event.id !== 'string' || event.id.length === 0) continue;
    if (event.title === wanted) ids.push(event.id);
  }
  return ids;
}

// ─── the hygiene action's copy + outcomes ─────────────────────────────────────

export const CALENDAR_HYGIENE_CTA = 'Remove NoteSnap reminders';
export const CHOOSE_CALENDAR_CTA = 'Choose a calendar';
export const CHANGE_CALENDAR_CTA = 'Change';
export const CALENDAR_OPEN_SETTINGS_CTA = 'Open settings';
export const CALENDAR_ROW_TITLE = 'Add it to my calendar';
export const CALENDAR_PICKER_TITLE = 'Which calendar?';
export const CALENDAR_PICKER_CTA = 'Use this calendar';
export const CALENDAR_PICKER_HINT =
  'Only calendars you can add to are listed. NoteSnap will add one daily event. It cannot read or change anything else in your calendar.';

/** The hygiene confirm: names the mechanism, the title and the window. */
export function calendarHygieneConfirm(minutes: unknown): string {
  return `This removes the daily "${CALENDAR_REMINDER_TITLE}" event at ${formatReminderTime(
    minutes,
  )} from your calendar. We look for events titled "${CALENDAR_REMINDER_TITLE}" in your calendar for the next ${CALENDAR_HYGIENE_WINDOW_DAYS} days. It will not touch anything else.`;
}

export const CALENDAR_HYGIENE_NOTHING_LINE = 'Nothing to remove.';
export const CALENDAR_HYGIENE_FAILED_LINE = "Couldn't reach your calendar.";
export const CALENDAR_UPDATE_FAILED_LINE = "Couldn't update your calendar.";

/** The outcome of the hygiene action, stated plainly (never a silent no-op). */
export function calendarHygieneOutcomeLine(count: number): string {
  const removed = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (removed === 0) return CALENDAR_HYGIENE_NOTHING_LINE;
  return `Removed ${removed} reminder${removed === 1 ? '' : 's'}.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. THE ROW (one source for the screen and for the gate)
// ═══════════════════════════════════════════════════════════════════════════════

export interface CalendarReminderRow {
  title: string;
  /** The STATE lines under the title, in display order. */
  lines: string[];
  /**
   * The honesty keys the row must render, straight from the plan. The screen maps
   * these through `calendarHonestyText`, so the two-reminder warning cannot be
   * dropped without dropping it from the plan that armed the second reminder.
   */
  honesty: CalendarHonestyLine[];
  /** The channel-choice hints, so the choice is never a bare radio pair. */
  choiceHints: { calendarOnly: string; both: string };
}

/** The OFF-state line: what turning this on will do, with the real time. */
export function calendarRowOffHint(minutes: unknown): string {
  return `Puts a daily "${CALENDAR_REMINDER_TITLE}" event at ${formatReminderTime(
    minutes,
  )} in the calendar you choose. NoteSnap only ever touches that one event — your calendar stays yours.`;
}

/**
 * The row's lines, rendered FROM the plan — so the copy the user reads and the
 * copy the gate asserts are the same strings, and `doublePing` can never be true
 * with a silent row.
 */
export function formatCalendarReminderRow(
  plan: ReminderChannelPlan,
  context: { calendarName?: string | null; minutes: unknown; blocked?: boolean },
): CalendarReminderRow {
  const minutes = context?.minutes;
  const calendarName = typeof context?.calendarName === 'string' ? context.calendarName.trim() : '';
  const lines: string[] = [];

  if (plan.armCalendarEvent) {
    lines.push(`Daily "${CALENDAR_REMINDER_TITLE}" at ${formatReminderTime(minutes)}`);
    if (calendarName.length > 0) lines.push(`in ${calendarName}`);
    else lines.push(CALENDAR_STALE_CALENDAR_LINE);
  } else if (context?.blocked) {
    // The user asked for the calendar channel and the permission is not there:
    // the screen renders CALENDAR_PERMISSION_DENIED_LINE and the settings action
    // itself, so the row adds no second line here.
  } else {
    lines.push(calendarRowOffHint(minutes));
  }

  return {
    title: CALENDAR_ROW_TITLE,
    lines,
    // The plan's honesty keys, passed through untouched — the ROW does not get to
    // decide which honest lines the user sees.
    honesty: plan.honestLines.slice(),
    choiceHints: {
      calendarOnly: CHANNEL_CHOICE_CALENDAR_ONLY_HINT,
      both: channelChoiceBothHint(minutes),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. LIVE-SOURCE CONTRACTS (pure predicates over REAL file text)
//
// The precedent is `reminderSettingWired` in services/reminderTime.ts: a pure
// predicate that scans a real screen's source and returns false when the wiring
// is not there. The DISK WALK and the mutation probes live in
// scripts/v38CalendarWiring.test.ts; the rest of the guard bodies live in
// services/v38CalendarContract.ts.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * True when the Settings calendar row is really wired: it renders the row model
 * (`formatCalendarReminderRow(`), carries the honesty copy from this module, is
 * wired to the enable/disable handlers, and re-types NEITHER the title NOR a
 * time literal (a hard-coded "NoteSnap practice" or "6:00 PM" would drift the
 * moment the user changes the reminder time).
 */
export function calendarSettingWired(source: string): boolean {
  if (typeof source !== 'string' || source.length < 4000) return false;
  if (source.indexOf('formatCalendarReminderRow(') < 0) return false;
  if (source.indexOf('CALENDAR_HONESTY') < 0) return false;
  if (source.indexOf('enableCalendarReminders') < 0) return false;
  if (source.indexOf('disableCalendarReminders') < 0) return false;
  // Every honest line is RENDERED from this module's copy plane.
  if (source.indexOf('calendarHonestyText(') < 0) return false;
  if (source.indexOf('calendarChoiceLabel(') < 0) return false;
  // No re-typed copy, and no second time literal on the calendar surface.
  if (source.indexOf(`'NoteSnap practice'`) >= 0) return false;
  if (source.indexOf('"NoteSnap practice"') >= 0) return false;
  return !/6:00 ?PM|18\s*\*\s*60|'18:00'/.test(source);
}

/**
 * True when the calendar channel is armed THROUGH the plan and nowhere else: the
 * screen computes `reminderChannelPlan(`, the calendar write is gated on
 * `plan.armCalendarEvent` (or the row's own enable handler derived from it), and
 * no native event call appears in the screen at all.
 */
export function calendarPlanHonored(source: string): boolean {
  if (typeof source !== 'string' || source.length < 4000) return false;
  if (source.indexOf('reminderChannelPlan(') < 0) return false;
  if (source.indexOf('armCalendarEvent') < 0) return false;
  if (source.indexOf('plan.doublePing') < 0 && source.indexOf('doublePing') < 0) return false;
  if (source.indexOf('createEventAsync(') >= 0) return false;
  if (source.indexOf('updateEventAsync(') >= 0) return false;
  return source.indexOf('deleteEventAsync(') < 0;
}

/**
 * The ONE seam allowed to touch the native calendar module.
 */
export const CALENDAR_DEVICE_SEAM_PATH = 'src/services/calendarReminderDevice.ts';

/**
 * True when this source's relationship to `expo-calendar` is the ALLOWED one: the
 * seam (services/calendarReminderDevice.ts) imports it, and every other file does
 * not. `isSeam` is required so the predicate is non-vacuous in both directions —
 * passing it for the wrong file fails, which is exactly the mistake (a second
 * importer, or a seam that stopped importing) this guard exists to catch.
 */
export function calendarDeviceSeamOnly(source: string, isSeam: boolean): boolean {
  if (typeof source !== 'string' || source.length === 0) return false;
  const importsNative =
    /from\s+['"]expo-calendar['"]/.test(source) ||
    /require\(\s*['"]expo-calendar['"]\s*\)/.test(source);
  return isSeam ? importsNative : !importsNative;
}
