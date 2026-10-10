/**
 * calendarReminderDevice.ts — THE ONLY FILE IN THIS APP THAT IMPORTS `expo-calendar`.
 *
 * WHY IT IS A SEAM. The calendar feature has to be checkable before a native
 * dependency exists in the repo, and a fix that "is in the source" but not on the
 * path the user takes has reached the owner twice. So every native call lives
 * here, behind four verbs; the model (services/calendarReminder.ts) stays pure and
 * tier1-gated, and the screen reaches the calendar only through these verbs. The
 * live-source guard suite reads the REAL files and fails if a second importer
 * appears (services/v38CalendarContract.ts, `calendarEventWriters` /
 * `calendarDeviceSeamOnly`).
 *
 * WHAT IT DOES AND DOES NOT DO
 *   • create ONE event (services/calendarReminder.buildCalendarEventInput) and
 *     keep it in place across reminder-time changes — never a second event;
 *   • delete that ONE event (whole series) when the channel is turned off;
 *   • offer the reinstall-hygiene scan, which reads the calendar in exactly ONE
 *     place and only for our own exact title;
 *   • ask for permission on the tap only (the screen calls
 *     `ensureCalendarPermission`); `calendarPermissionState` is the read-only
 *     probe the Settings screen runs on open.
 * It never creates a calendar of its own, never reads anyone else's events for a
 * product purpose, never uploads anything, and has no network call of any kind.
 *
 * SERIES DELETE — VERIFIED, NOT ASSUMED (build-time item §4.1 of the design brief).
 * Read from the pinned `expo-calendar@14.0.6` tarball, not from memory:
 *   • build/Calendar.d.ts:6-20  `RecurringEventOptions = { futureEvents?: boolean;
 *     instanceStartDate?: string | Date }`
 *   • build/Calendar.d.ts:729   `deleteEventAsync(id, recurringEventOptions?)`
 *   • build/Calendar.js:341-342 `const { futureEvents = false, instanceStartDate } =
 *     recurringEventOptions; … deleteEventAsync({ id, instanceStartDate }, { futureEvents })`
 *     → the field name really is `futureEvents`.
 *   • android/…/CalendarModule.kt:547-553 `removeEvent` deletes the row at
 *     `CalendarContract.Events.CONTENT_URI/<id>` outright when `instanceStartDate`
 *     is ABSENT — one row holds the RRULE, so the whole series goes. `futureEvents:
 *     true` is what makes the same call remove the series on iOS, where "this
 *     instance" and "the series" genuinely differ.
 * We therefore never pass `instanceStartDate`, and we always pass
 * `{ futureEvents: true }`: turning the channel off cannot leave tomorrow's
 * reminder firing.
 */
import * as Calendar from 'expo-calendar';
import {
  CALENDAR_REMINDER_TITLE,
  buildCalendarEventInput,
  calendarHygieneWindow,
  findNoteSnapEventsForRemoval,
  type WritableCalendar,
} from './calendarReminder';

/** What the Settings screen may know about the permission. */
export interface CalendarPermissionState {
  /** The device has a calendar provider at all. */
  available: boolean;
  granted: boolean;
  /** False after "don't ask again" — the UI goes to the settings page instead. */
  canAskAgain: boolean;
}

/** The outcome of one create/update, so the row can be honest about a failure. */
export interface ReminderEventWrite {
  ok: boolean;
  /** The event id now on the phone (unchanged on a failed write). */
  eventId: string | null;
  /** True when an existing event was replaced (delete-and-recreate fallback). */
  replaced: boolean;
}

function calendarSourceLabel(calendar: Calendar.Calendar): string {
  const source = calendar.source as { name?: string } | undefined;
  const name = typeof source?.name === 'string' ? source.name : '';
  return name;
}

/**
 * The READ-ONLY permission probe (safe to call on every Settings open): it never
 * shows a dialog, so a revoked permission is surfaced instead of re-prompted.
 */
export async function calendarPermissionState(): Promise<CalendarPermissionState> {
  try {
    const available = await Calendar.isAvailableAsync();
    if (!available) return { available: false, granted: false, canAskAgain: false };
    const response = await Calendar.getCalendarPermissionsAsync();
    return {
      available: true,
      granted: response.status === 'granted',
      canAskAgain: response.canAskAgain !== false,
    };
  } catch {
    return { available: false, granted: false, canAskAgain: false };
  }
}

/**
 * THE ONLY PLACE PERMISSION IS EVER REQUESTED, called from the tap that turns the
 * calendar row ON. It does not fire a dialog the OS cannot show: with "don't ask
 * again" the caller gets `false` and shows the settings guidance instead.
 */
export async function ensureCalendarPermission(): Promise<boolean> {
  const current = await calendarPermissionState();
  if (current.granted) return true;
  if (!current.available || !current.canAskAgain) return false;
  try {
    const response = await Calendar.requestCalendarPermissionsAsync();
    return response.status === 'granted';
  } catch {
    return false;
  }
}

/**
 * The calendars the user can actually add to (a read-only "Holidays" calendar is
 * omitted rather than offered and then failing on write).
 */
export async function listWritableCalendars(): Promise<WritableCalendar[]> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const seen: Record<string, true> = {};
    const writable: WritableCalendar[] = [];
    for (const calendar of calendars ?? []) {
      if (calendar?.allowsModifications !== true) continue;
      if (typeof calendar.id !== 'string' || calendar.id.length === 0) continue;
      if (seen[calendar.id]) continue;
      seen[calendar.id] = true;
      writable.push({
        id: calendar.id,
        title: typeof calendar.title === 'string' ? calendar.title : '',
        source: calendarSourceLabel(calendar),
      });
    }
    return writable;
  } catch {
    return [];
  }
}

/** The device's own default calendar, pre-selected where it is writable. */
export async function defaultCalendarId(): Promise<string | null> {
  try {
    const calendar = await Calendar.getDefaultCalendarAsync();
    return typeof calendar?.id === 'string' && calendar.id.length > 0 ? calendar.id : null;
  } catch {
    return null;
  }
}

/**
 * The device's own time zone, so the recurring event is pinned to the user's local
 * wall clock. `null` when it cannot be resolved — the payload then omits the field
 * and the calendar applies its own zone (never a guessed one).
 */
export async function localTimeZone(): Promise<string | null> {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Create the event, or move the ONE existing event, from the SAME persisted
 * minutes the in-app nudge uses. A failed update falls back to
 * delete-and-recreate, so a calendar that went read-only can never leave a stale
 * time or a duplicate behind; if that fails too the caller gets `ok: false` and
 * shows the honest retry line.
 */
export async function upsertReminderEvent(args: {
  eventId: string | null;
  calendarId: string;
  minutes: number;
}): Promise<ReminderEventWrite> {
  if (typeof args?.calendarId !== 'string' || args.calendarId.length === 0) {
    return { ok: false, eventId: args?.eventId ?? null, replaced: false };
  }
  const available = await Calendar.isAvailableAsync().catch(() => false);
  if (!available) return { ok: false, eventId: args.eventId ?? null, replaced: false };

  const input = buildCalendarEventInput({
    minutes: args.minutes,
    now: new Date(),
    timeZone: await localTimeZone(),
  });

  if (args.eventId) {
    try {
      await Calendar.updateEventAsync(args.eventId, {
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        allDay: false,
        alarms: input.alarms,
        notes: input.notes,
      });
      return { ok: true, eventId: args.eventId, replaced: false };
    } catch {
      // The event is gone, or the calendar refused the change: never leave a
      // half-updated pair — remove ours, then write one fresh event below.
      await removeReminderEvent(args.eventId);
    }
  }

  try {
    const created = await Calendar.createEventAsync(args.calendarId, input);
    return { ok: true, eventId: created, replaced: Boolean(args.eventId) };
  } catch {
    return { ok: false, eventId: null, replaced: false };
  }
}

/**
 * Remove the ONE event we own — the WHOLE recurring series (see the verification
 * block at the top of this file): the id, and `{ futureEvents: true }`, and never
 * an `instanceStartDate` (which is what would delete a single day instead).
 */
export async function removeReminderEvent(eventId: string | null): Promise<boolean> {
  if (typeof eventId !== 'string' || eventId.length === 0) return false;
  try {
    await Calendar.deleteEventAsync(eventId, { futureEvents: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE REINSTALL PATH. Storage is app-local, so a reinstall forgets which event is
 * ours; this finds it by EXACT title inside a 90-day window in the calendars we
 * can write to, and deletes each match as a series. It is the only read of the
 * user's calendar in the whole feature, and it looks for nothing but our title.
 */
export async function removeNoteSnapReminders(
  calendars: WritableCalendar[],
): Promise<{ ok: boolean; removed: number }> {
  const ids = (Array.isArray(calendars) ? calendars : [])
    .map((calendar) => calendar?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return { ok: false, removed: 0 };

  const { start, end } = calendarHygieneWindow(new Date());
  try {
    const events = await Calendar.getEventsAsync(ids, start, end);
    const matches = findNoteSnapEventsForRemoval(events, CALENDAR_REMINDER_TITLE);
    let removed = 0;
    for (const id of matches) {
      if (await removeReminderEvent(id)) removed += 1;
    }
    return { ok: true, removed };
  } catch {
    return { ok: false, removed: 0 };
  }
}
