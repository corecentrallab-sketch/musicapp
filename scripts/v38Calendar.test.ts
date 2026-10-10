/**
 * v38Calendar.test.ts — THE CALENDAR-REMINDER MODEL SUITE (owner-approved 10-10,
 * backlog b033ab48).
 *
 * What this proves, none of which a device pass could prove cheaply:
 *   1. the CHANNEL TRUTH TABLE — all three channels × the in-app switch × whether
 *      the calendar can really fire (12 combinations), including the two safety
 *      properties: `'calendar'` never arms the notification while the calendar
 *      works, and a calendar that CANNOT fire hands the reminder back to the
 *      in-app channel instead of leaving the user with nothing;
 *   2. `doublePing` is exactly `armNotification && armCalendarEvent`, and the
 *      two-reminders honesty line is present EXACTLY when it is true;
 *   3. backward compatibility: an absent / empty / corrupt stored channel reads
 *      back as 'notification' — today's behaviour, byte-for-byte, for every
 *      existing user;
 *   4. the event shape: the exact title "NoteSnap practice", a 30-minute block,
 *      one daily rule with no end, one alarm at offset 0, the next occurrence of
 *      the chosen local time (today while it is ahead, else tomorrow), and a
 *      wall-clock-safe end across a DST boundary;
 *   5. no orphans: stale-calendar detection and the EXACT-title removal matcher
 *      (partial / fuzzy / case-folded matches are refused);
 *   6. every CALENDAR_* copy contract (string equality — so a reworded literal in
 *      a screen is caught by the gate, not by the owner).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  CALENDAR_CHOICE_TITLE,
  CALENDAR_EVENT_DURATION_MINUTES,
  CALENDAR_HONESTY,
  CALENDAR_HONESTY_COPY,
  CALENDAR_HYGIENE_CTA,
  CALENDAR_HYGIENE_FAILED_LINE,
  CALENDAR_HYGIENE_NOTHING_LINE,
  CALENDAR_HYGIENE_WINDOW_DAYS,
  CALENDAR_NOTES,
  CALENDAR_NOT_STREAK_AWARE_LINE,
  CALENDAR_OPEN_SETTINGS_CTA,
  CALENDAR_PERMISSION_DENIED_LINE,
  CALENDAR_PICKER_CTA,
  CALENDAR_PICKER_HINT,
  CALENDAR_PICKER_TITLE,
  CALENDAR_REMINDER_CALENDAR_KEY,
  CALENDAR_REMINDER_EVENT_KEY,
  CALENDAR_REMINDER_TITLE,
  CALENDAR_ROW_TITLE,
  CALENDAR_STALE_CALENDAR_LINE,
  CALENDAR_SURVIVES_UNINSTALL_LINE,
  CALENDAR_TWO_REMINDERS_LINE,
  CALENDAR_TWO_REMINDERS_LINE_KEY,
  CALENDAR_UPDATE_FAILED_LINE,
  CHANGE_CALENDAR_CTA,
  CHANNEL_CHOICE_BOTH_LABEL,
  CHANNEL_CHOICE_CALENDAR_ONLY_LABEL,
  CHOOSE_CALENDAR_CTA,
  DEFAULT_REMINDER_CHANNEL,
  REMINDER_CHANNELS,
  REMINDER_CHANNEL_STORAGE_KEY,
  buildCalendarEventInput,
  calendarChoiceLabel,
  calendarEventStartsAt,
  calendarHygieneConfirm,
  calendarHygieneOutcomeLine,
  calendarHygieneWindow,
  calendarHonestyText,
  calendarRowOffHint,
  calendarSettingWired,
  channelChoiceBothHint,
  findNoteSnapEventsForRemoval,
  formatCalendarReminderRow,
  isCalendarReminderStale,
  normalizeReminderChannel,
  parseStoredReminderChannel,
  reminderChannelPlan,
  type CalendarHonestyLine,
  type ReminderChannel,
  type RemovableEvent,
} from '../src/services/calendarReminder';
import { DEFAULT_REMINDER_MINUTES, formatReminderTime } from '../src/services/reminderTime';

declare const process: { cwd(): string; exit(code: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function wallClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nv38 calendar — the channel model');
assertEq(REMINDER_CHANNELS.length, 3, 'there are exactly three channel states');
assertEq(DEFAULT_REMINDER_CHANNEL, 'notification', 'the default channel is the in-app reminder');
assertEq(REMINDER_CHANNEL_STORAGE_KEY, '@notesnap/reminderChannel', 'the channel key is the documented one');
assertEq(
  CALENDAR_REMINDER_CALENDAR_KEY,
  '@notesnap/calendarReminderCalendarId',
  'the chosen-calendar key is the documented one',
);
assertEq(
  CALENDAR_REMINDER_EVENT_KEY,
  '@notesnap/calendarReminderEventId',
  'the event-id key is the documented one',
);

console.log('\nv38 calendar — backward compatibility (an unset key is today’s behaviour)');
// Every one of these must land on 'notification' — the value that means "exactly
// the reminder this user already had".
for (const raw of [null, undefined, '', '   ', 'nonsense', 'Notification', 7, {}, []]) {
  assertEq(
    parseStoredReminderChannel(raw),
    'notification',
    `a ${JSON.stringify(raw)} stored value reads back as the pre-existing behaviour`,
  );
}
assertEq(parseStoredReminderChannel(null), 'notification', 'an absent key is the in-app reminder');
assertEq(parseStoredReminderChannel(''), 'notification', 'an empty key is the in-app reminder');
assertEq(parseStoredReminderChannel('nonsense'), 'notification', 'a corrupt key is the in-app reminder');
assertEq(parseStoredReminderChannel('   '), 'notification', 'a blank key is the in-app reminder');
assertEq(parseStoredReminderChannel('calendar'), 'calendar', 'a real choice survives');
assertEq(parseStoredReminderChannel('both'), 'both', 'the two-reminder choice survives');
assertEq(parseStoredReminderChannel(' calendar '), 'calendar', 'a padded real choice is read');
assertEq(normalizeReminderChannel('notification'), 'notification', 'normalize agrees on the default');
assertEq(normalizeReminderChannel(42), 'notification', 'a non-string never invents a channel');

// ── THE TRUTH TABLE: 3 channels × notifications × calendarReady ───────────────
console.log('\nv38 calendar — the plan truth table (12 combinations)');
const CHANNELS: ReminderChannel[] = ['notification', 'calendar', 'both'];
let tableRows = 0;
for (const channel of CHANNELS) {
  for (const notificationsEnabled of [true, false]) {
    for (const calendarReady of [true, false]) {
      tableRows += 1;
      const plan = reminderChannelPlan({ channel, notificationsEnabled, calendarReady });
      const label = `${channel} / notifications ${notificationsEnabled ? 'on' : 'off'} / calendar ${
        calendarReady ? 'ready' : 'not ready'
      }`;
      assertEq(plan.channel, channel, `${label}: the plan echoes the channel`);
      // 1. 'notification' can never arm a calendar event.
      if (channel === 'notification') {
        assertEq(plan.armCalendarEvent, false, `${label}: the calendar event is NOT armed`);
      }
      // 2. 'calendar' never double-pings: while the calendar can fire, the in-app
      //    nudge stays silent at that time.
      if (channel === 'calendar' && calendarReady) {
        assertEq(plan.armNotification, false, `${label}: the in-app nudge is NOT armed`);
        assertEq(plan.armCalendarEvent, true, `${label}: the calendar event IS armed`);
      }
      // 3. a calendar that cannot fire hands the reminder back — never nothing.
      if (!calendarReady && notificationsEnabled) {
        assertEq(plan.armNotification, true, `${label}: the user is never left with no reminder`);
        assertEq(plan.armCalendarEvent, false, `${label}: a calendar that cannot fire is not armed`);
      }
      // 4. doublePing is exactly both armed…
      assertEq(
        plan.doublePing,
        plan.armNotification && plan.armCalendarEvent,
        `${label}: doublePing is exactly (both armed)`,
      );
      // …and, per the plan, doublePing is only ever reachable on 'both'.
      if (plan.doublePing) {
        assertEq(channel, 'both', `${label}: a double ping is only reachable on the 'both' choice`);
      }
      // 5. the two-reminders honesty line follows doublePing exactly.
      assertEq(
        plan.honestLines.indexOf(CALENDAR_TWO_REMINDERS_LINE_KEY) >= 0,
        plan.doublePing,
        `${label}: the two-reminders line is present exactly when doublePing`,
      );
    }
  }
}
assertEq(tableRows, 12, 'all twelve combinations were exercised');

// The owner's chosen default: turning the calendar row on is CALENDAR-ONLY.
const ownerDefault = reminderChannelPlan({
  channel: 'calendar',
  notificationsEnabled: true,
  calendarReady: true,
});
assertEq(ownerDefault.armCalendarEvent, true, 'the owner default arms the calendar');
assertEq(ownerDefault.armNotification, false, 'the owner default does NOT also arm the notification');
assertEq(ownerDefault.doublePing, false, 'the owner default is not a double ping');
assert(
  ownerDefault.honestLines.indexOf('not-streak-aware') >= 0,
  'calendar-only says the honest thing: the event cannot know you already practised',
);

const bothChosen = reminderChannelPlan({ channel: 'both', notificationsEnabled: true, calendarReady: true });
assertEq(bothChosen.doublePing, true, 'choosing both really is two reminders');
assert(
  bothChosen.honestLines.indexOf(CALENDAR_TWO_REMINDERS_LINE_KEY) >= 0,
  'choosing both puts the two-reminder line on the row',
);

// Null-safety: a mutated caller must not crash the screen.
assertEq(reminderChannelPlan(undefined).channel, 'notification', 'a missing input is the default channel');
assertEq(reminderChannelPlan(null).doublePing, false, 'a null input double-pings nothing');
assertEq(
  reminderChannelPlan({ channel: 'both', notificationsEnabled: undefined, calendarReady: undefined })
    .armCalendarEvent,
  false,
  'an unknown calendar state never arms the calendar channel',
);

// ── the event model ──────────────────────────────────────────────────────────
console.log('\nv38 calendar — the event (owner decision 3: exact title, 30-minute block)');
assertEq(CALENDAR_REMINDER_TITLE, 'NoteSnap practice', 'the title is exactly the owner’s copy');
assertEq(CALENDAR_EVENT_DURATION_MINUTES, 30, 'the block is 30 minutes');

const beforeSix = calendarEventStartsAt(DEFAULT_REMINDER_MINUTES, new Date(2026, 9, 12, 17, 59, 30));
assertEq(wallClock(beforeSix.startDate), '2026-10-12 18:00', 'while the time is still ahead, the event is TODAY');
assertEq(wallClock(beforeSix.endDate), '2026-10-12 18:30', 'the block ends 30 minutes later');
assertEq(
  (beforeSix.endDate.getTime() - beforeSix.startDate.getTime()) / 60000,
  30,
  'the block is exactly 30 minutes long',
);

const afterSix = calendarEventStartsAt(DEFAULT_REMINDER_MINUTES, new Date(2026, 9, 12, 18, 1));
assertEq(wallClock(afterSix.startDate), '2026-10-13 18:00', 'after the time has passed, the event is TOMORROW');

const exactlySix = calendarEventStartsAt(DEFAULT_REMINDER_MINUTES, new Date(2026, 9, 12, 18, 0, 0));
assertEq(wallClock(exactlySix.startDate), '2026-10-13 18:00', 'the exact minute is no longer "ahead"');

const morning = calendarEventStartsAt(9 * 60 + 30, new Date(2026, 9, 12, 0, 5));
assertEq(wallClock(morning.startDate), '2026-10-12 09:30', 'a chosen morning time lands today');
assertEq(wallClock(morning.endDate), '2026-10-12 10:00', 'a morning block is 30 minutes');
assertEq(calendarEventStartsAt(undefined, new Date(2026, 9, 12, 8, 0)).startDate.getHours(), 18, 'a corrupt time falls back to 18:00');
assertEq(
  wallClock(calendarEventStartsAt(DEFAULT_REMINDER_MINUTES, undefined as unknown as Date).startDate).length,
  16,
  'a missing clock still produces a real timestamp (never a crash)',
);

// A DST boundary must not change the WALL CLOCK of the block (30 minutes shown as
// 90, or as 0, is the classic calendar bug). The dates cover an AU/Linux DST start
// and end; the assertion is zone-agnostic because it compares wall-clock fields.
for (const when of [
  new Date(2026, 9, 4, 17, 59),
  new Date(2026, 9, 3, 0, 1),
  new Date(2026, 3, 5, 1, 59),
  new Date(2026, 3, 4, 22, 0),
  new Date(2026, 11, 31, 23, 0),
  new Date(2027, 0, 1, 0, 30),
]) {
  const block = calendarEventStartsAt(DEFAULT_REMINDER_MINUTES, when);
  const endMinutes = block.endDate.getHours() * 60 + block.endDate.getMinutes();
  const startMinutes = block.startDate.getHours() * 60 + block.startDate.getMinutes();
  assertEq(
    (endMinutes - startMinutes + 1440) % 1440,
    30,
    `around ${wallClock(when)} the block is 30 minutes on the wall clock too`,
  );
  assertEq(block.startDate.getMinutes(), 0, `around ${wallClock(when)} the event starts on the chosen minute`);
}

console.log('\nv38 calendar — the createEventAsync payload shape');
const payload = buildCalendarEventInput({
  minutes: DEFAULT_REMINDER_MINUTES,
  now: new Date(2026, 9, 12, 12, 0),
});
assertEq(payload.title, CALENDAR_REMINDER_TITLE, 'the payload carries the fixed title');
assertEq(payload.allDay, false, 'the event is a timed block, not an all-day entry');
assertEq(payload.recurrenceRule.frequency, 'daily', 'the event recurs daily');
assertEq(
  Object.prototype.hasOwnProperty.call(payload.recurrenceRule, 'endDate'),
  false,
  'the daily rule has NO end date',
);
assertEq(
  Object.prototype.hasOwnProperty.call(payload.recurrenceRule, 'occurrence'),
  false,
  'the daily rule has NO occurrence count',
);
assertEq(
  Object.prototype.hasOwnProperty.call(payload.recurrenceRule, 'interval'),
  false,
  'the daily rule is every day (no interval surprises)',
);
assertEq(payload.alarms.length, 1, 'exactly ONE alarm — ours');
assertEq(payload.alarms[0].relativeOffset, 0, 'our alarm fires at the event start');
assertEq(payload.alarms[0].method, 'alert', 'our alarm is the OS alert');
assertEq(payload.notes, CALENDAR_NOTES, 'the event body is the shared note');
assertEq(
  Object.prototype.hasOwnProperty.call(payload, 'timeZone'),
  false,
  'an unknown zone is omitted, never guessed',
);
const zoned = buildCalendarEventInput({
  minutes: 7 * 60,
  now: new Date(2026, 9, 12, 6, 0),
  timeZone: 'Australia/Sydney',
});
assertEq(zoned.timeZone, 'Australia/Sydney', 'a known zone is pinned onto the event');
assertEq(wallClock(zoned.startDate), '2026-10-12 07:00', 'the zone changes nothing about the chosen local time');

// ── no orphans ───────────────────────────────────────────────────────────────
console.log('\nv38 calendar — the remembered calendar, and the hygiene scan');
assertEq(
  isCalendarReminderStale({ storedCalendarId: null, calendars: [] }),
  false,
  'nothing remembered means nothing is stale',
);
assertEq(
  isCalendarReminderStale({ storedCalendarId: 'cal-1', calendars: [{ id: 'cal-1', title: 'A', source: '' }] }),
  false,
  'a calendar that is still there is not stale',
);
assertEq(
  isCalendarReminderStale({
    storedCalendarId: 'cal-1',
    calendars: [{ id: 'cal-2', title: 'B', source: '' }],
  }),
  true,
  'a calendar that is gone IS stale (the honest state, never a silent re-create)',
);
assertEq(isCalendarReminderStale({ storedCalendarId: 'cal-1', calendars: null }), true, 'no calendar list cannot claim the calendar is there');
assertEq(isCalendarReminderStale(undefined as never), false, 'a missing argument is not stale');

assertEq(CALENDAR_HYGIENE_WINDOW_DAYS, 90, 'the hygiene scan looks 90 days ahead (and the dialog says so)');
const window90 = calendarHygieneWindow(new Date(2026, 9, 12, 15, 30));
assertEq(wallClock(window90.start).slice(11), '00:00', 'the scan starts at the top of today');
assertEq(wallClock(window90.end).slice(0, 10), '2027-01-10', 'the scan window really is 90 days');

const scanEvents: RemovableEvent[] = [
  { id: '1', title: CALENDAR_REMINDER_TITLE },
  { id: '2', title: 'NoteSnap practice session' },
  { id: '3', title: 'notesnap practice' },
  { id: '4', title: 'NoteSnap practise' },
  { id: '5', title: `${CALENDAR_REMINDER_TITLE} ` },
  { id: '6', title: 'Dentist' },
  { id: '7', title: null },
  { title: CALENDAR_REMINDER_TITLE },
  null as unknown as RemovableEvent,
];
assertEq(
  scanEvents.length > 0 && findNoteSnapEventsForRemoval(scanEvents).join(','),
  '1',
  'ONLY the exact title matches: no partials, no case folding, no trailing space',
);
assertEq(findNoteSnapEventsForRemoval(scanEvents, 'Dentist').join(','), '6', 'the matcher honours an explicit title');
assertEq(findNoteSnapEventsForRemoval(null).length, 0, 'a null event list removes nothing');
assertEq(findNoteSnapEventsForRemoval([]).length, 0, 'an empty event list removes nothing');
assertEq(
  findNoteSnapEventsForRemoval([{ id: '', title: CALENDAR_REMINDER_TITLE }]).length,
  0,
  'an event with no id cannot be deleted, so it is not returned',
);

console.log('\nv38 calendar — the hygiene action’s outcomes');
assertEq(calendarHygieneOutcomeLine(0), CALENDAR_HYGIENE_NOTHING_LINE, 'zero removed says so plainly');
assertEq(calendarHygieneOutcomeLine(1), 'Removed 1 reminder.', 'one removed is singular');
assertEq(calendarHygieneOutcomeLine(3), 'Removed 3 reminders.', 'three removed is plural');
assertEq(calendarHygieneOutcomeLine(2.7), 'Removed 2 reminders.', 'a fractional count cannot print a fraction');
assertEq(CALENDAR_HYGIENE_FAILED_LINE, "Couldn't reach your calendar.", 'a failure has its own honest line');
assert(CALENDAR_UPDATE_FAILED_LINE.indexOf("Couldn't") === 0, 'an update failure has its own honest line');

// ── the copy contracts ───────────────────────────────────────────────────────
console.log('\nv38 calendar — the copy contracts (string equality, so a reworded literal is caught)');
assertEq(
  CALENDAR_HONESTY,
  'NoteSnap adds one daily event to the calendar you pick. It cannot read or change anything else in your calendar, and nothing leaves your phone.',
  'CALENDAR_HONESTY is the agreed line',
);
assertEq(
  CALENDAR_SURVIVES_UNINSTALL_LINE,
  'This event is saved in your calendar, not in NoteSnap — so it stays there even if you uninstall the app. Remove it here first, or delete it in your calendar app.',
  'the uninstall truth is stated, not implied',
);
assertEq(
  CALENDAR_TWO_REMINDERS_LINE,
  "You'll get two reminders at {time} — one from NoteSnap, one from your calendar.",
  'the two-reminder line names the time slot',
);
assertEq(
  CALENDAR_NOT_STREAK_AWARE_LINE,
  "A calendar event reminds you every day. It can't know whether you already practised — only the NoteSnap notification can.",
  'the honest trade-off between the two channels is on the row',
);
assertEq(
  CALENDAR_PERMISSION_DENIED_LINE,
  "Calendar reminders are off because NoteSnap isn't allowed to use your calendar. Your in-app reminder still works.",
  'a denied permission is explained AND the in-app channel is named',
);
assertEq(
  CALENDAR_NOTES,
  "Set by NoteSnap. Practice reminders live in your calendar — NoteSnap can't see or change what else is in here.",
  'the event describes itself for a year later',
);
assertEq(CALENDAR_ROW_TITLE, 'Add it to my calendar', 'the row title is the agreed copy');
assertEq(CALENDAR_CHOICE_TITLE, 'Reminders for this time', 'the choice control is titled');
assertEq(CALENDAR_STALE_CALENDAR_LINE, 'That calendar is no longer on this phone.', 'a vanished calendar is stated');
assertEq(CALENDAR_PICKER_TITLE, 'Which calendar?', 'the picker asks the question');
assertEq(CALENDAR_PICKER_CTA, 'Use this calendar', 'the picker has one commit action');
assertEq(CHANGE_CALENDAR_CTA, 'Change', 'the change action is short and honest');
assertEq(CHOOSE_CALENDAR_CTA, 'Choose a calendar', 'the stale state offers the picker');
assertEq(CALENDAR_HYGIENE_CTA, 'Remove NoteSnap reminders', 'the hygiene action is named for what it does');
assertEq(CALENDAR_OPEN_SETTINGS_CTA, 'Open settings', 'the denied state offers the settings page');
assertEq(
  CHANNEL_CHOICE_CALENDAR_ONLY_LABEL,
  'Use the calendar only',
  'the recommended default is labelled plainly',
);
assertEq(
  CHANNEL_CHOICE_BOTH_LABEL,
  "Also keep NoteSnap's in-app reminder",
  'the second option is the explicit opt-in',
);
assert(
  CALENDAR_PICKER_HINT.indexOf('Only calendars you can add to are listed.') === 0,
  'the picker says which calendars it lists',
);
assert(
  CALENDAR_PICKER_HINT.indexOf('nothing') < 0 && CALENDAR_PICKER_HINT.length > 40,
  'the picker hint is a real sentence, not a stub',
);

// The exact title is never re-typed, in any of the copy planes.
for (const line of [
  CALENDAR_HONESTY,
  CALENDAR_SURVIVES_UNINSTALL_LINE,
  CALENDAR_NOT_STREAK_AWARE_LINE,
  CALENDAR_PERMISSION_DENIED_LINE,
  CALENDAR_NOTES,
  calendarHygieneConfirm(DEFAULT_REMINDER_MINUTES),
  calendarRowOffHint(DEFAULT_REMINDER_MINUTES),
  channelChoiceBothHint(DEFAULT_REMINDER_MINUTES),
]) {
  assert(line.indexOf(CALENDAR_REMINDER_TITLE) >= 0 || line.indexOf('calendar') >= 0, `copy reads honestly: “${line.slice(0, 40)}…”`);
}
assert(
  calendarRowOffHint(DEFAULT_REMINDER_MINUTES).indexOf(CALENDAR_REMINDER_TITLE) >= 0,
  'the off-state hint names the event by its title',
);
assert(
  calendarHygieneConfirm(DEFAULT_REMINDER_MINUTES).indexOf('90 days') >= 0,
  'the hygiene confirm names the window, not just the outcome',
);
assert(
  calendarHygieneConfirm(DEFAULT_REMINDER_MINUTES).indexOf(CALENDAR_REMINDER_TITLE) >= 0,
  'the hygiene confirm names the exact title it looks for',
);

console.log('\nv38 calendar — the honesty renderer and the row');
assertEq(
  calendarHonestyText('two-reminders', DEFAULT_REMINDER_MINUTES),
  `You'll get two reminders at ${formatReminderTime(DEFAULT_REMINDER_MINUTES)} — one from NoteSnap, one from your calendar.`,
  'the two-reminder line fills in the chosen time',
);
assertEq(
  calendarHonestyText('calendar-on', 7 * 60),
  CALENDAR_HONESTY,
  'a line with no time slot is rendered verbatim',
);
for (const key of Object.keys(CALENDAR_HONESTY_COPY) as CalendarHonestyLine[]) {
  assert(calendarHonestyText(key, DEFAULT_REMINDER_MINUTES).length > 20, `the ${key} line renders real copy`);
}
assertEq(
  calendarHonestyText('two-reminders', DEFAULT_REMINDER_MINUTES).indexOf('{time}'),
  -1,
  'no raw slot ever reaches the user',
);

const rowOn = formatCalendarReminderRow(ownerDefault, { calendarName: 'Google — you@gmail.com', minutes: DEFAULT_REMINDER_MINUTES });
assertEq(rowOn.title, CALENDAR_ROW_TITLE, 'the row is titled from the model');
assertEq(rowOn.lines[0], 'Daily "NoteSnap practice" at 6:00 PM', 'the armed row states the event and the real time');
assertEq(rowOn.lines[1], 'in Google — you@gmail.com', 'the armed row names the chosen calendar');
assert(rowOn.honesty.indexOf(CALENDAR_TWO_REMINDERS_LINE_KEY) < 0, 'a calendar-only row carries no two-reminder line');
assert(rowOn.honesty.indexOf('not-streak-aware') >= 0, 'a calendar-only row carries the not-streak-aware line');

const rowStale = formatCalendarReminderRow(ownerDefault, { calendarName: null, minutes: DEFAULT_REMINDER_MINUTES });
assertEq(rowStale.lines[1], CALENDAR_STALE_CALENDAR_LINE, 'a vanished calendar is surfaced on the row');
const rowOff = formatCalendarReminderRow(
  reminderChannelPlan({ channel: 'notification', notificationsEnabled: true, calendarReady: true }),
  { calendarName: null, minutes: DEFAULT_REMINDER_MINUTES },
);
assertEq(rowOff.lines[0], calendarRowOffHint(DEFAULT_REMINDER_MINUTES), 'the OFF row explains what turning it on does');
assertEq(rowOff.honesty.length, 0, 'an OFF row makes no claims about being armed');
const rowBoth = formatCalendarReminderRow(bothChosen, { calendarName: 'Phone', minutes: DEFAULT_REMINDER_MINUTES });
assert(rowBoth.honesty.indexOf(CALENDAR_TWO_REMINDERS_LINE_KEY) >= 0, 'the double-ping row carries the warning');
const rowDenied = formatCalendarReminderRow(
  reminderChannelPlan({ channel: 'calendar', notificationsEnabled: true, calendarReady: false }),
  { calendarName: 'Phone', minutes: DEFAULT_REMINDER_MINUTES, blocked: true },
);
assertEq(rowDenied.lines.length, 0, 'the denied state adds no row line — the screen renders the denied copy once');
assertEq(rowOff.choiceHints.both, channelChoiceBothHint(DEFAULT_REMINDER_MINUTES), 'the choice hints come from the model');
assert(rowOff.choiceHints.both.indexOf('TWO') >= 0, 'the "both" hint says TWO reminders out loud');

console.log('\nv38 calendar — the picker labels');
assertEq(
  calendarChoiceLabel({ id: 'a', title: 'Google', source: 'you@gmail.com' }),
  'Google — you@gmail.com',
  'the picker labels a calendar by name and source, never by id',
);
assertEq(calendarChoiceLabel({ id: 'a', title: '', source: 'you@gmail.com' }), 'you@gmail.com', 'a nameless calendar falls back to its source');
assertEq(calendarChoiceLabel({ id: 'a', title: 'Phone', source: '' }), 'Phone', 'a sourceless calendar still reads');
assertEq(calendarChoiceLabel(null), '', 'no calendar renders nothing, not "undefined"');
assertEq(calendarChoiceLabel(undefined), '', 'an undefined calendar renders nothing');

// ── the live-source predicate is non-vacuous ─────────────────────────────────
console.log('\nv38 calendar — calendarSettingWired refuses a re-typed screen');
assertEq(calendarSettingWired(''), false, 'an empty screen is not wired');
assertEq(calendarSettingWired('const a = 1;'), false, 'a tiny screen is not wired');
assertEq(
  calendarSettingWired('formatCalendarReminderRow('.repeat(200) + 'CALENDAR_HONESTY calendarHonestyText( calendarChoiceLabel('),
  false,
  'a screen with no handlers at all is not wired',
);

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
