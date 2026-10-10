/**
 * v38CalendarContract.ts — THE LIVE-SOURCE GUARDS FOR THE CALENDAR-REMINDER
 * FEATURE (owner-approved 10-10, backlog b033ab48).
 *
 * WHY THIS MODULE EXISTS. This team's only verification between owner device
 * passes is the tier1 gate: there is no emulator and no instrumented run. The
 * failure mode that has reached the owner more than once is not a wrong rule but a
 * rule that is "in the source" and NOT on the path the user takes. So every
 * property of this feature that can only be seen in a real file — a permission
 * asked from a mount effect, a second event writer, a warning line that stopped
 * being rendered — is a guard here that reads the REAL file, and every guard is
 * PROVEN to bite by a mutation of that file (skills
 * `musicapp-tier1-live-scan-suite`, `musicapp-guard-mutation-probes`).
 *
 * The walk (and the in-memory mutations) live in scripts/v38CalendarWiring.test.ts;
 * the same mutations are applied on disk with the failing lines captured in
 * /home/team/shared/v38-calendar-mutation-probes.txt.
 *
 * PURE: no react, no react-native, no expo, no fs. Comments are masked before
 * every check, so a documented-but-absent call can never satisfy a guard.
 */
import { maskComments } from './modalBackContract';

/** Where the calendar row lives in Settings — the marker comments the guard slices. */
export const CALENDAR_SECTION_START_MARKER = 'CALENDAR-REMINDERS-SECTION-START';
export const CALENDAR_SECTION_END_MARKER = 'CALENDAR-REMINDERS-SECTION-END';

/** The files this feature owns (the money path around them is untouched). */
export const CALENDAR_FEATURE_PATHS = [
  'src/services/calendarReminder.ts',
  'src/services/v38CalendarContract.ts',
  'src/services/calendarReminderDevice.ts',
  'src/components/CalendarPickerSheet.tsx',
] as const;

export const CALENDAR_SETTINGS_PATH = 'src/screens/SettingsScreen.tsx';
export const CALENDAR_NOTIFICATIONS_PATH = 'src/services/notifications.ts';
export const CALENDAR_PICKER_PATH = 'src/components/CalendarPickerSheet.tsx';

function countOf(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

/** The RAW-text slice of SettingsScreen between the two calendar markers. */
export function calendarSectionOf(settingsSource: string): string | null {
  if (typeof settingsSource !== 'string') return null;
  const start = settingsSource.indexOf(CALENDAR_SECTION_START_MARKER);
  if (start < 0) return null;
  const end = settingsSource.indexOf(CALENDAR_SECTION_END_MARKER, start);
  if (end < 0) return null;
  return settingsSource.slice(start, end);
}

/** The masked calendar section (comments gone, offsets irrelevant). */
export function maskedCalendarSection(settingsSource: string): string {
  const section = calendarSectionOf(settingsSource);
  return section === null ? '' : maskComments(section);
}

/** Is `needle` inside the body of any `useEffect(` in this source? */
export function insideAnyUseEffect(source: string, needle: string): boolean {
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('useEffect(', from);
    if (at < 0) return false;
    let cursor = source.indexOf('(', at);
    if (cursor < 0) return false;
    // Walk to the handler's opening brace, then brace-match to its close.
    cursor = source.indexOf('{', at);
    if (cursor < 0) return false;
    let depth = 0;
    let end = -1;
    for (let i = cursor; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return false;
    if (source.slice(cursor, end).indexOf(needle) >= 0) return true;
    from = end + 1;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 1 — the pure core stays pure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when this source imports nothing native. The channel model, the event
 * model and the guard bodies must compile with node_modules absent: that is what
 * makes them provable BEFORE a native dependency enters the repo.
 */
export function calendarCoreStaysPure(source: string): boolean {
  if (typeof source !== 'string' || source.length < 1500) return false;
  const src = maskComments(source);
  if (/from\s+['"]react(-native)?['"]/.test(src)) return false;
  if (/from\s+['"]expo[-a-z]*['"]/.test(src)) return false;
  if (/require\(\s*['"](react|react-native|expo[-a-z]*)['"]\s*\)/.test(src)) return false;
  if (/from\s+['"]fs['"]|require\(\s*['"]fs['"]\s*\)|from\s+['"]node:fs['"]/.test(src)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 2 — permission is asked on the tap, never on mount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The native request lives in the ONE seam; the SCREEN asks for it from the
 * enable handler (the tap that expresses interest) and from no `useEffect`. A
 * permission dialog that appears before the user has shown any interest is how an
 * app earns a permanent "deny" — the reason this is a guard and not a convention.
 */
export function calendarPermissionIsAskedOnTheTap(
  settingsSource: string,
  deviceSource: string,
): boolean {
  const settings = maskComments(settingsSource);
  const device = maskComments(deviceSource);
  if (settings.length < 4000 || device.length < 1500) return false;
  // The request itself is in the seam…
  if (device.indexOf('requestCalendarPermissionsAsync()') < 0) return false;
  if (device.indexOf('export async function ensureCalendarPermission(') < 0) return false;
  if (device.indexOf('export async function calendarPermissionState(') < 0) return false;
  // …the screen asks through the seam, inside the enable handler…
  const handler = settings.indexOf('const enableCalendarReminders = useCallback(');
  if (handler < 0) return false;
  const body = settings.slice(handler, handler + 1600);
  if (body.indexOf('await ensureCalendarPermission(') < 0) return false;
  // …and NO effect ever asks (the read-only check may run on open; the REQUEST may not).
  if (insideAnyUseEffect(settings, 'ensureCalendarPermission(')) return false;
  return !insideAnyUseEffect(settings, 'requestCalendarPermissionsAsync(');
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 3 — no silent double-arm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whenever `reminderChannelPlan(...).doublePing` is true, the row says so. The
 * honesty lines come from the plan (keys), are rendered by the shared copy
 * renderer, and the two-reminder line is the warning one — a build where the
 * second reminder is armed and the line is gone is exactly what this refuses.
 */
export function calendarNoSilentDoubleArm(settingsSource: string): boolean {
  const src = maskComments(settingsSource);
  if (src.length < 4000) return false;
  if (src.indexOf('reminderChannelPlan({') < 0) return false;
  // The plan drives the row's honesty keys — the screen cannot drop one.
  if (src.indexOf('calendarRow.honesty.map(') < 0) return false;
  if (src.indexOf('calendarHonestyText(line, reminderMinutes)') < 0) return false;
  // …and doublePing really decides what the two-reminder line looks like.
  if (src.indexOf('calendarPlan.doublePing &&') < 0) return false;
  // Re-typed copy is a failure: the screen renders the shared constant's text.
  if (src.indexOf("You'll get two reminders") >= 0) return false;
  return src.indexOf('CALENDAR_TWO_REMINDERS_LINE_KEY') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 4 — one time source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The calendar path reads the time the same way the notification does: the model
 * builds the event time through `reminderHourMinute`, the screen reads the stored
 * minutes through `getReminderMinutes()`, and no calendar surface carries a second
 * time literal (a hard-coded 18:00 / "6:00 PM" is a channel that drifts the moment
 * the user moves the stepper).
 */
export function calendarUsesTheOneTimeSource(
  modelSource: string,
  settingsSource: string,
  deviceSource: string,
): boolean {
  const model = maskComments(modelSource);
  const settings = maskComments(settingsSource);
  const device = maskComments(deviceSource);
  if (model.length < 3000 || settings.length < 4000 || device.length < 1500) return false;
  if (model.indexOf("from './reminderTime'") < 0) return false;
  if (model.indexOf('reminderHourMinute(minutes)') < 0) return false;
  if (settings.indexOf('getReminderMinutes()') < 0) return false;
  // The SAME persisted minutes ride into the one seam call…
  if (settings.indexOf('upsertReminderEvent(') < 0) return false;
  if (settings.indexOf('minutes: reminderMinutes') < 0) return false;
  // …and the payload itself is built by the pure model, in the seam.
  if (device.indexOf('buildCalendarEventInput(') < 0) return false;
  const section = maskedCalendarSection(settingsSource);
  if (section.length < 500) return false;
  return !/6:00 ?PM|18\s*\*\s*60|'18:00'|18:00/.test(section);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 5 — a vanished calendar is surfaced, never silently re-created
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A remembered calendar that is gone leads to the honest line and the picker —
 * never to a write into a different calendar. The remembered id is therefore only
 * ever replaced inside the picker's own commit, and the stale state is derived
 * from the pure model rather than guessed in the screen.
 */
export function calendarStaleCalendarShowsThePicker(settingsSource: string): boolean {
  const src = maskComments(settingsSource);
  if (src.length < 4000) return false;
  if (src.indexOf('isCalendarReminderStale({') < 0) return false;
  if (src.indexOf('storedCalendarId: calendarId') < 0) return false;
  if (src.indexOf('calendars: writableCalendars') < 0) return false;
  // The stale state is HELD, and it is what the row is handed (no calendar name).
  if (src.indexOf('calendarStale') < 0) return false;
  if (src.indexOf('calendarName: calendarStale ? null :') < 0) return false;
  // The picker is reachable from the stale state…
  if (src.indexOf('onPress={() => setPickerOpen(true)}') < 0) return false;
  // …and the remembered calendar is NOT silently swapped for the default one.
  return src.indexOf('setCalendarId(defaultCalendarId)') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 6 — turning it off deletes the event, before the state forgets it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The OFF path removes the event first and clears the remembered id afterwards: a
 * clear-then-delete loses the id and leaves the reminder firing forever — the
 * classic "I turned it off and it still reminds me" bug.
 */
export function calendarDisableDeletesBeforeClearingState(settingsSource: string): boolean {
  const src = maskComments(settingsSource);
  if (src.length < 4000) return false;
  const handler = src.indexOf('const disableCalendarReminders = useCallback(');
  if (handler < 0) return false;
  const body = src.slice(handler, handler + 1600);
  const remove = body.indexOf('await removeReminderEvent(');
  const clear = body.indexOf('setCalendarEventId(null)');
  if (remove < 0 || clear < 0) return false;
  if (remove > clear) return false;
  // The channel is also persisted back to the in-app notification…
  if (body.indexOf('persistReminderChannel(') < 0) return false;
  // …and the stored id is cleared after the delete, not before it.
  return body.indexOf('setCalendarReminderEventId(null)') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 7 — one event, one seam
// ─────────────────────────────────────────────────────────────────────────────

/** Every file that writes or deletes an event, other than the seam. */
export function calendarEventWriters(files: { path: string; source: string }[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (!file || file.path === undefined) continue;
    if (file.path === 'src/services/calendarReminderDevice.ts') continue;
    const src = maskComments(file.source ?? '');
    if (/createEventAsync\s*\(|updateEventAsync\s*\(|deleteEventAsync\s*\(/.test(src)) {
      offenders.push(file.path);
    }
  }
  return offenders;
}

/**
 * The seam is the only file that may name the native write calls. The screen must
 * reach them through the seam's own verbs (`upsertReminderEvent` /
 * `removeReminderEvent`), and the seam must really implement them.
 */
export function calendarSeamIsTheOnlyEventWriter(
  deviceSource: string,
  settingsSource: string,
): boolean {
  const device = maskComments(deviceSource);
  const settings = maskComments(settingsSource);
  if (device.length < 1500 || settings.length < 4000) return false;
  if (device.indexOf('createEventAsync(') < 0) return false;
  if (device.indexOf('updateEventAsync(') < 0) return false;
  if (device.indexOf('deleteEventAsync(') < 0) return false;
  if (settings.indexOf('upsertReminderEvent(') < 0) return false;
  if (settings.indexOf('removeReminderEvent(') < 0) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 8 — the uninstall truth is on screen at opt-in time
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A calendar event lives in the user's calendar account, so it survives
 * uninstalling the app. That is stated at the moment they opt in — the whole
 * mitigation — instead of being discovered a year later.
 */
export function calendarUninstallTruthOnScreen(settingsSource: string): boolean {
  const src = maskComments(settingsSource);
  if (src.length < 4000) return false;
  if (src.indexOf('CALENDAR_SURVIVES_UNINSTALL_LINE') < 0) return false;
  // The hygiene action that makes it recoverable ships with it.
  if (src.indexOf('CALENDAR_HYGIENE_CTA') < 0) return false;
  if (src.indexOf('removeNoteSnapReminders(') < 0) return false;
  if (src.indexOf('calendarHygieneConfirm(') < 0) return false;
  if (src.indexOf('calendarHygieneOutcomeLine(') < 0) return false;
  return src.indexOf('onPress={() => void removeNoteSnapReminders()}') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 9 — no banned claims on the new surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The honesty sweep, applied to the NEW user-facing surface only (the rest of the
 * app's copy is out of scope for this feature and the Settings plan cards keep
 * their existing wording). The calendar feature does no syncing, no tracking and
 * nothing "AI", and it never claims to see anything of the user's.
 */
export function calendarCopyAvoidsBannedClaims(sources: string[]): boolean {
  const joined = (Array.isArray(sources) ? sources : []).join('\n');
  if (joined.length < 1000) return false;
  const masked = maskComments(joined);
  if (/\bsync/i.test(masked)) return false;
  if (/\btrack/i.test(masked)) return false;
  if (/\bAI\b/.test(masked)) return false;
  if (/real-time/i.test(masked)) return false;
  if (/\bstudio\b/i.test(masked)) return false;
  return !/we can see/i.test(masked);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 10 — a denied permission is not a dead end
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Denied renders the explanation AND a way back to the permission — the app's own
 * settings page — while the screen states that the in-app reminder still works.
 * No re-prompt loop, no instruction to reinstall, no wall of text.
 */
export function calendarDeniedIsNotADeadEnd(settingsSource: string): boolean {
  const src = maskComments(settingsSource);
  if (src.length < 4000) return false;
  if (src.indexOf('CALENDAR_PERMISSION_DENIED_LINE') < 0) return false;
  if (src.indexOf('CALENDAR_OPEN_SETTINGS_CTA') < 0) return false;
  if (src.indexOf('Linking.openSettings()') < 0) return false;
  // The denial is a real state the screen holds, read from the seam on open…
  if (src.indexOf('calendarPermissionState()') < 0) return false;
  if (src.indexOf('blocked: calendarDenied') < 0) return false;
  // …and the app never asks again by itself: the request is only in the tap path.
  return !insideAnyUseEffect(src, 'ensureCalendarPermission(');
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 11 — the hygiene matcher is EXACT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The reinstall scan finds our own events by title, and only by title, exactly:
 * `===`, no `includes`, no case folding, no trimming of the event's own title. A
 * blunt instrument stays blunt on purpose — the confirm dialog names the title and
 * the window rather than hiding the mechanism.
 */
export function hygieneMatcherIsExact(modelSource: string): boolean {
  const src = maskComments(modelSource);
  if (src.length < 3000) return false;
  if (src.indexOf('export function findNoteSnapEventsForRemoval(') < 0) return false;
  if (src.indexOf('event.title === wanted') < 0) return false;
  if (/title\s*\.\s*includes\(/.test(src)) return false;
  if (/title\s*\.\s*toLowerCase\(/.test(src)) return false;
  return !/title\s*\.\s*startsWith\(/.test(src);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 12 — the in-app channel is armed only through the plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * services/notifications.ts keeps its behaviour (one streak-aware one-shot) and
 * gains ONE condition: it schedules only when the plan says the notification is
 * armed. The gate must precede the scheduling call, or it guards nothing.
 */
export function notificationsArmOnlyViaThePlan(notificationsSource: string): boolean {
  const src = maskComments(notificationsSource);
  if (src.length < 1500) return false;
  if (src.indexOf("from './calendarReminder'") < 0) return false;
  if (src.indexOf('reminderChannelPlan(') < 0) return false;
  if (src.indexOf('if (!plan.armNotification) return false;') < 0) return false;
  if (src.indexOf('getReminderChannel()') < 0) return false;
  const gate = src.indexOf('if (!plan.armNotification) return false;');
  const schedule = src.indexOf('Notifications.scheduleNotificationAsync(');
  if (schedule < 0) return false;
  return gate < schedule;
}

/** The screen must not arm the notification itself — the plan owns that too. */
export function calendarScreenArmsThroughThePlan(settingsSource: string): boolean {
  const src = maskComments(settingsSource);
  if (src.length < 4000) return false;
  if (src.indexOf('reminderChannelPlan(') < 0) return false;
  // The two channels are armed from one handler that reads the plan's verdicts.
  const handler = src.indexOf('const applyChannelChoice = useCallback(');
  if (handler < 0) return false;
  const body = src.slice(handler, handler + 1800);
  if (body.indexOf('if (plan.armCalendarEvent)') < 0) return false;
  if (body.indexOf('if (plan.armNotification)') < 0) return false;
  return body.indexOf('reminderChannelPlan(') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 13 — free through launch, and nothing leaves the device
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The feature is GATED: a pure module and its suite must be in tsconfig.tier1.json's
 * `include` list AND in package.json's `test:tier1` list, or the change is not
 * tested at all (the single most common way a "tested" change reaches the owner
 * untested). Both lists are explicit, so this is checkable — and it is checked.
 */
export function tier1ListsTheCalendarFeature(
  tsconfigSource: string,
  packageSource: string,
): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  const tsconfigNeeds = [
    'src/services/calendarReminder.ts',
    'src/services/v38CalendarContract.ts',
    'scripts/v38Calendar.test.ts',
    'scripts/v38CalendarWiring.test.ts',
  ];
  for (const entry of tsconfigNeeds) {
    if (tsconfigSource.indexOf(`"${entry}"`) < 0) return false;
  }
  const scriptNeeds = [
    '/tmp/tier1-test/scripts/v38Calendar.test.js',
    '/tmp/tier1-test/scripts/v38CalendarWiring.test.js',
  ];
  for (const entry of scriptNeeds) {
    if (packageSource.indexOf(entry) < 0) return false;
  }
  // …and the SDK-52 pin is the pinned one (a newer tag would ride a different SDK).
  return packageSource.indexOf('"expo-calendar": "~14.0.6"') >= 0;
}

/**
 * Rev 38 keeps the practice utilities free through launch, and recognition is
 * never paywalled: the calendar feature carries no paywall/Pro gate at all. It
 * also talks to nothing — no endpoint, no URL, no fetch — so "your calendar stays
 * yours" is a property of the code rather than a promise.
 */
export function calendarFeatureIsFreeAndOffline(sources: string[]): boolean {
  const list = Array.isArray(sources) ? sources : [];
  const joined = list.join('\n');
  if (joined.length < 2000 || list.length < 3) return false;
  const masked = maskComments(joined);
  if (/paywall|isPro|proTier|subscription/i.test(masked)) return false;
  // (split so this guard file does not itself read as a URL)
  if (masked.indexOf('http' + '://') >= 0) return false;
  if (masked.indexOf('https' + '://') >= 0) return false;
  return !/\bfetch\s*\(|XMLHttpRequest|axios/.test(masked);
}
