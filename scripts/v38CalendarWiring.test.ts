/**
 * v38CalendarWiring.test.ts — LIVE-SOURCE GUARDS for the CALENDAR-REMINDER
 * feature (owner-approved 10-10, backlog b033ab48).
 *
 * The walk reads the REAL files: the pure model, the guard module, the device
 * seam, the picker sheet, SettingsScreen and notifications.ts, plus the whole of
 * src/ for the "one importer" scan. Every guard must be TRUE on the real source
 * AND be shown to BITE — the same guards are then run against a mutated copy of
 * the real text and must go FALSE (skill `musicapp-guard-mutation-probes`). The
 * same mutations are applied on disk by /home/team/shared/v38-calendar-probes.py
 * with the failing guard lines captured byte-exactly.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  CALENDAR_DEVICE_SEAM_PATH,
  calendarDeviceSeamOnly,
  calendarPlanHonored,
  calendarSettingWired,
} from '../src/services/calendarReminder';
import {
  CALENDAR_FEATURE_PATHS,
  CALENDAR_NOTIFICATIONS_PATH,
  CALENDAR_PICKER_PATH,
  CALENDAR_SETTINGS_PATH,
  calendarCopyAvoidsBannedClaims,
  calendarCoreStaysPure,
  calendarDeniedIsNotADeadEnd,
  calendarDisableDeletesBeforeClearingState,
  calendarEventWriters,
  calendarFeatureIsFreeAndOffline,
  calendarNoSilentDoubleArm,
  calendarPermissionIsAskedOnTheTap,
  calendarScreenArmsThroughThePlan,
  calendarSectionOf,
  calendarSeamIsTheOnlyEventWriter,
  calendarStaleCalendarShowsThePicker,
  calendarUninstallTruthOnScreen,
  calendarUsesTheOneTimeSource,
  hygieneMatcherIsExact,
  maskedCalendarSection,
  notificationsArmOnlyViaThePlan,
  tier1ListsTheCalendarFeature,
} from '../src/services/v38CalendarContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
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
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}
/** Every .ts/.tsx under src/, plus App.tsx — the scan the "one importer" rule needs. */
function walkSources(): { path: string; source: string }[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: { path: string; source: string }[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir))) {
      const rel = `${dir}/${entry}`;
      const full = path.join(root, rel);
      if (fs.statSync(full).isDirectory()) visit(rel);
      else if (/\.tsx?$/.test(entry)) files.push({ path: rel, source: fs.readFileSync(full, 'utf8') });
    }
  };
  visit('src');
  files.push({ path: 'App.tsx', source: readAppFile('App.tsx') });
  return files;
}

const MODEL = CALENDAR_FEATURE_PATHS[0];
const CONTRACT = CALENDAR_FEATURE_PATHS[1];
const DEVICE = CALENDAR_DEVICE_SEAM_PATH;
const PICKER = CALENDAR_PICKER_PATH;
const SETTINGS = CALENDAR_SETTINGS_PATH;
const NOTIFICATIONS = CALENDAR_NOTIFICATIONS_PATH;

const modelSource = readAppFile(MODEL);
const contractSource = readAppFile(CONTRACT);
const deviceSource = readAppFile(DEVICE);
const pickerSource = readAppFile(PICKER);
const settingsSource = readAppFile(SETTINGS);
const notificationsSource = readAppFile(NOTIFICATIONS);
const tsconfigSource = readAppFile('tsconfig.tier1.json');
const packageSource = readAppFile('package.json');
const featureSources = [
  modelSource,
  contractSource,
  deviceSource,
  pickerSource,
  maskedCalendarSection(settingsSource),
];

console.log('\nv38 calendar — the live-source walk (floors first)');
assert(modelSource.length > 20000, `read ${MODEL} (${modelSource.length} chars)`);
assert(contractSource.length > 15000, `read ${CONTRACT} (${contractSource.length} chars)`);
assert(deviceSource.length > 5000, `read ${DEVICE} (${deviceSource.length} chars)`);
assert(pickerSource.length > 3000, `read ${PICKER} (${pickerSource.length} chars)`);
assert(settingsSource.length > 30000, `read ${SETTINGS} (${settingsSource.length} chars)`);
assert(notificationsSource.length > 2000, `read ${NOTIFICATIONS} (${notificationsSource.length} chars)`);
const section = calendarSectionOf(settingsSource);
assert(section !== null, 'the Settings calendar section is delimited by its markers');
assert(section !== null && section.length > 2000, `the calendar section is a real block (${section === null ? 0 : section.length} chars)`);
const walked = walkSources();
assert(walked.length > 120, `walked ${walked.length} source files for the one-importer scan`);

// ── GUARD 1 — the pure core stays pure ────────────────────────────────────────
console.log('\nv38 guard 1 — the pure core imports nothing native');
assertEq(calendarCoreStaysPure(modelSource), true, 'calendarReminder.ts is pure');
assertEq(calendarCoreStaysPure(contractSource), true, 'v38CalendarContract.ts is pure');

// ── GUARD 2 — permission on the tap, never on mount ──────────────────────────
console.log('\nv38 guard 2 — the permission is asked on the tap');
assertEq(
  calendarPermissionIsAskedOnTheTap(settingsSource, deviceSource),
  true,
  'the screen asks through the seam inside the enable handler, and no effect ever asks',
);
assert(
  deviceSource.indexOf('requestCalendarPermissionsAsync()') >= 0,
  'the seam really holds the only request call',
);
assert(
  deviceSource.indexOf('isAvailableAsync()') >= 0,
  'the seam checks the device has a calendar provider at all',
);

// ── GUARD 3 — no silent double-arm ───────────────────────────────────────────
console.log('\nv38 guard 3 — no silent double-arm');
assertEq(calendarNoSilentDoubleArm(settingsSource), true, 'the row renders the plan’s honesty keys and the doublePing warning');
assertEq(calendarScreenArmsThroughThePlan(settingsSource), true, 'both channels are armed from the plan’s verdicts, in one handler');
assertEq(calendarPlanHonored(settingsSource), true, 'the calendar channel is armed through the plan and the screen holds no native call');

// ── GUARD 4 — one time source ────────────────────────────────────────────────
console.log('\nv38 guard 4 — one time source for both channels');
assertEq(
  calendarUsesTheOneTimeSource(modelSource, settingsSource, deviceSource),
  true,
  'the event time comes from reminderHourMinute over the SAME persisted minutes',
);

// ── GUARD 5 — a vanished calendar is surfaced, never silently re-created ─────
console.log('\nv38 guard 5 — a vanished calendar leads to the picker');
assertEq(calendarStaleCalendarShowsThePicker(settingsSource), true, 'the stale state is held, shown, and the picker is reachable');

// ── GUARD 6 — turning it off deletes first ───────────────────────────────────
console.log('\nv38 guard 6 — the OFF path deletes the event before it forgets the id');
assertEq(calendarDisableDeletesBeforeClearingState(settingsSource), true, 'removeReminderEvent runs before the stored id is cleared');

// ── GUARD 7 — one event, one seam ────────────────────────────────────────────
console.log('\nv38 guard 7 — one event, one importer');
const offenders = calendarEventWriters(walked);
assertEq(offenders.length, 0, `no file outside the seam writes an event (${offenders.join(', ') || 'none'})`);
assertEq(
  calendarSeamIsTheOnlyEventWriter(deviceSource, settingsSource),
  true,
  'the seam implements create/update/delete and the screen only calls the seam verbs',
);
const importers = walked.filter((file) =>
  /from\s+['"]expo-calendar['"]|require\(\s*['"]expo-calendar['"]\s*\)/.test(file.source),
);
assertEq(
  importers.map((file) => file.path).join(','),
  DEVICE,
  `expo-calendar is imported by exactly one file (${importers.map((f) => f.path).join(', ') || 'none'})`,
);
assertEq(calendarDeviceSeamOnly(deviceSource, true), true, 'the seam IS allowed to import the native module');
assertEq(calendarDeviceSeamOnly(settingsSource, false), true, 'the Settings screen is not an importer');
assertEq(
  deviceSource.indexOf("from 'expo-calendar'") >= 0,
  true,
  'the pin rides the next EAS batch: the dependency is imported, not stubbed',
);

// ── GUARD 8 — the uninstall truth is on screen ───────────────────────────────
console.log('\nv38 guard 8 — the uninstall truth ships with the opt-in');
assertEq(calendarUninstallTruthOnScreen(settingsSource), true, 'the enable confirmation and the hygiene action are both wired');

// ── GUARD 9 — no banned claims on the new surface ────────────────────────────
console.log('\nv38 guard 9 — no banned claims');
assertEq(calendarCopyAvoidsBannedClaims(featureSources), true, 'the new surface makes none of the retired claims');

// ── GUARD 10 — a denied permission is not a dead end ─────────────────────────
console.log('\nv38 guard 10 — denied is not a dead end');
assertEq(calendarDeniedIsNotADeadEnd(settingsSource), true, 'the denied state explains itself and offers the settings page');

// ── GUARD 11 — the hygiene matcher is exact ──────────────────────────────────
console.log('\nv38 guard 11 — the hygiene scan matches exactly');
assertEq(hygieneMatcherIsExact(modelSource), true, 'findNoteSnapEventsForRemoval compares titles exactly');

// ── GUARD 12 — the in-app channel is armed only through the plan ─────────────
console.log('\nv38 guard 12 — notifications.ts is gated by the plan');
assertEq(notificationsArmOnlyViaThePlan(notificationsSource), true, 'the nudge is armed only when the plan says so, before the schedule call');
assert(
  notificationsSource.indexOf('getReminderMinutes()') >= 0 && notificationsSource.indexOf('reminderHourMinute(') >= 0,
  'the nudge still reads the one persisted time (no behaviour copy)',
);

// ── GUARD 13 — free through launch, and nothing leaves the device ────────────
console.log('\nv38 guard 13 — free through launch, nothing leaves the device');
assertEq(calendarFeatureIsFreeAndOffline(featureSources), true, 'no paywall token, no URL, no network call in the calendar path');

// ── GUARD 14 — the feature is actually GATED ────────────────────────────────
console.log('\nv38 guard 14 — the feature is in BOTH explicit tier1 lists');
assertEq(
  tier1ListsTheCalendarFeature(tsconfigSource, packageSource),
  true,
  'the new modules and both suites are in tsconfig.tier1.json AND package.json, at the SDK-52 pin',
);

// ── the guards are not vacuous ──────────────────────────────────────────────
console.log('\nv38 — the guards are not vacuous (empty input)');
assertEq(calendarCoreStaysPure(''), false, 'an empty model is not pure-by-omission');
assertEq(calendarPermissionIsAskedOnTheTap('', ''), false, 'an empty pair asks nothing');
assertEq(calendarNoSilentDoubleArm(''), false, 'an empty screen says nothing about double pings');
assertEq(calendarUsesTheOneTimeSource('', '', ''), false, 'an empty trio has no time source');
assertEq(calendarStaleCalendarShowsThePicker(''), false, 'an empty screen surfaces no stale calendar');
assertEq(calendarDisableDeletesBeforeClearingState(''), false, 'an empty screen deletes nothing');
assertEq(calendarSeamIsTheOnlyEventWriter('', ''), false, 'an empty pair writes no event');
assertEq(calendarUninstallTruthOnScreen(''), false, 'an empty screen states no truth');
assertEq(calendarCopyAvoidsBannedClaims([]), false, 'no sources pass the copy sweep');
assertEq(calendarCopyAvoidsBannedClaims(['a', 'b']), false, 'a stub copy set passes nothing');
assertEq(calendarDeniedIsNotADeadEnd(''), false, 'an empty screen has no way out of a denial');
assertEq(hygieneMatcherIsExact(''), false, 'an empty model matches nothing');
assertEq(notificationsArmOnlyViaThePlan(''), false, 'an empty scheduler is gated by nothing');
assertEq(calendarScreenArmsThroughThePlan(''), false, 'an empty screen arms nothing through the plan');
assertEq(calendarPlanHonored(''), false, 'an empty screen honours no plan');
assertEq(calendarFeatureIsFreeAndOffline([]), false, 'an empty source set is not free-and-offline-by-omission');
assertEq(tier1ListsTheCalendarFeature('', ''), false, 'empty lists do not gate the feature');
assertEq(calendarEventWriters([]).length, 0, 'an empty walk has no offenders (and the floor above catches it)');
assertEq(calendarSectionOf('nothing here'), null, 'a source without markers has no calendar section');
assertEq(maskedCalendarSection('nothing here'), '', 'an unmarked source yields an empty section');

// ══════════════════════════════════════════════════════════════════════════════
// MUTATIONS — every guard must go FALSE on a mutated copy of the REAL text
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nv38 — MUTATION PROBES (each guard must bite)');

function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}

// 1 — the pure core grows a native import.
const impureCore = modelSource.replace(
  "import { formatReminderTime, reminderHourMinute } from './reminderTime';",
  "import { Platform } from 'react-native';\nimport { formatReminderTime, reminderHourMinute } from './reminderTime';",
);
probe('guard 1: calendarReminder.ts imports react-native', impureCore, modelSource, () =>
  calendarCoreStaysPure(impureCore),
);

// 2a — the permission request moves into a mount effect.
const permissionOnMount = settingsSource.replace(
  '    getReminderChannel().then(setReminderChannel);',
  '    void ensureCalendarPermission();\n    getReminderChannel().then(setReminderChannel);',
);
probe('guard 2: ensureCalendarPermission called from the mount effect', permissionOnMount, settingsSource, () =>
  calendarPermissionIsAskedOnTheTap(permissionOnMount, deviceSource),
);
// 2b — the enable handler stops asking at all (the tap does nothing).
const noAskOnTap = settingsSource.replace(
  '    const granted = await ensureCalendarPermission();',
  '    const granted = true;',
);
probe('guard 2: the enable tap never asks for permission', noAskOnTap, settingsSource, () =>
  calendarPermissionIsAskedOnTheTap(noAskOnTap, deviceSource),
);

// 3a — the row stops rendering the plan's honesty keys (the warning is gone).
const noHonestyMap = settingsSource.replace(
  'calendarRow.honesty.map(',
  "['calendar-on', 'not-streak-aware'].map(",
);
probe('guard 3: the two-reminder warning is dropped from the render', noHonestyMap, settingsSource, () =>
  calendarNoSilentDoubleArm(noHonestyMap),
);
// 3b — the doublePing flag stops being load-bearing.
const noDoublePingGate = settingsSource.replace('calendarPlan.doublePing &&', 'true &&');
probe('guard 3: the doublePing gate is neutered', noDoublePingGate, settingsSource, () =>
  calendarNoSilentDoubleArm(noDoublePingGate),
);
// 3c — the screen arms the channels itself instead of through the plan's verdicts.
const ownVerdicts = settingsSource.replace(
  '      if (plan.armNotification) {',
  '      if (true) {',
);
probe('guard 3/12: the handler stops reading the plan verdict', ownVerdicts, settingsSource, () =>
  calendarScreenArmsThroughThePlan(ownVerdicts),
);

// 4a — the event time becomes a second literal.
const secondTimeSource = settingsSource.replace('minutes: reminderMinutes', 'minutes: 18 * 60');
probe('guard 4: a hard-coded 18:00 replaces the persisted minutes', secondTimeSource, settingsSource, () =>
  calendarUsesTheOneTimeSource(modelSource, secondTimeSource, deviceSource),
);
// 4b — the model stops deriving the hour/minute from the one source.
const ownClock = modelSource.replace('reminderHourMinute(minutes)', '{ hour: 18, minute: 0 }');
probe('guard 4: the model invents its own clock', ownClock, modelSource, () =>
  calendarUsesTheOneTimeSource(ownClock, settingsSource, deviceSource),
);

// 5a — the picker is unreachable from the row.
const noPicker = settingsSource.replace('onPress={() => setPickerOpen(true)}', 'onPress={() => undefined}');
probe('guard 5: nothing can open the calendar picker', noPicker, settingsSource, () =>
  calendarStaleCalendarShowsThePicker(noPicker),
);
// 5b — the remembered calendar is silently swapped for the default.
const silentSwap = settingsSource.replace(
  '    const remembered = calendarId && calendars.some((calendar) => calendar.id === calendarId) ? calendarId : null;',
  '    setCalendarId(defaultCalendarId);\n    const remembered = calendarId && calendars.some((calendar) => calendar.id === calendarId) ? calendarId : null;',
);
probe('guard 5: the remembered calendar is silently replaced by the default', silentSwap, settingsSource, () =>
  calendarStaleCalendarShowsThePicker(silentSwap),
);

// 6 — the id is cleared BEFORE the delete (the reminder keeps firing).
const clearThenDelete = settingsSource.replace(
  '    if (calendarEventId) await removeReminderEvent(calendarEventId);\n    await setCalendarReminderEventId(null);',
  '    await setCalendarReminderEventId(null);\n    if (calendarEventId) await removeReminderEvent(calendarEventId);',
);
probe('guard 6: state is cleared before the event is deleted', clearThenDelete, settingsSource, () =>
  calendarDisableDeletesBeforeClearingState(clearThenDelete),
);

// 7a — a second file starts writing events.
const secondWriter = pickerSource.replace(
  'export const CalendarPickerSheet',
  'async function writeOwnEvent(id: string) {\n  await createEventAsync(id, {});\n}\nexport const CalendarPickerSheet',
);
probe('guard 7: the picker sheet grows its own event write', secondWriter, pickerSource, () =>
  calendarEventWriters([{ path: PICKER, source: secondWriter }]).length === 0,
);
// 7b — the screen stops calling the seam's write verb.
const noSeamVerb = settingsSource.replace('upsertReminderEvent({', 'writeReminderNow({');
probe('guard 7: the screen bypasses the seam verb', noSeamVerb, settingsSource, () =>
  calendarSeamIsTheOnlyEventWriter(deviceSource, noSeamVerb),
);

// 8 — the uninstall truth leaves the surface.
const noUninstallTruth = settingsSource.replace(
  'onPress={() => void removeNoteSnapReminders()}',
  'onPress={() => undefined}',
);
probe('guard 8: the hygiene action is unwired', noUninstallTruth, settingsSource, () =>
  calendarUninstallTruthOnScreen(noUninstallTruth),
);

// 9 — a retired claim appears on the new surface.
const bannedClaim = modelSource.replace(
  'and nothing leaves your phone.',
  'and nothing you do here is tracked.',
);
probe('guard 9: the copy starts claiming tracking', bannedClaim, modelSource, () =>
  calendarCopyAvoidsBannedClaims([bannedClaim, contractSource, deviceSource, pickerSource, maskedCalendarSection(settingsSource)]),
);

// 10 — the denied state loses its way out.
const noWayOut = settingsSource.replace('{CALENDAR_OPEN_SETTINGS_CTA}', "{'Settings'}");
probe('guard 10: the denied state loses its settings action', noWayOut, settingsSource, () =>
  calendarDeniedIsNotADeadEnd(noWayOut),
);

// 11 — the title scan goes fuzzy.
const fuzzyMatcher = modelSource.replace('event.title === wanted', 'String(event.title).includes(wanted)');
probe('guard 11: the hygiene scan becomes a partial match', fuzzyMatcher, modelSource, () =>
  hygieneMatcherIsExact(fuzzyMatcher),
);

// 12 — the notification gate is neutered (the nudge fires regardless of channel).
const ungatedNudge = notificationsSource.replace(
  'if (!plan.armNotification) return false;',
  'if (false) return false;',
);
probe('guard 12: the nudge ignores the plan', ungatedNudge, notificationsSource, () =>
  notificationsArmOnlyViaThePlan(ungatedNudge),
);

// 13a — a network call appears in the calendar path.
const networked = deviceSource.replace(
  'export async function localTimeZone(',
  'async function postUsage() {\n  await fetch(endpoint);\n}\nexport async function localTimeZone(',
);
probe('guard 13: the calendar path grows a network call', networked, deviceSource, () =>
  calendarFeatureIsFreeAndOffline([modelSource, contractSource, networked, pickerSource, maskedCalendarSection(settingsSource)]),
);
// 13b — a paywall token appears in the calendar path.
const paywalled = pickerSource.replace(
  'export const CalendarPickerSheet',
  'const isPro = false;\nexport const CalendarPickerSheet',
);
probe('guard 13: the calendar path grows a Pro gate', paywalled, pickerSource, () =>
  calendarFeatureIsFreeAndOffline([modelSource, contractSource, deviceSource, paywalled, maskedCalendarSection(settingsSource)]),
);

// 14a — the suite is dropped from the gate list.
const unlistedSuite = packageSource.replace(
  ' && node /tmp/tier1-test/scripts/v38CalendarWiring.test.js',
  '',
);
probe('guard 14: the wiring suite leaves the test:tier1 list', unlistedSuite, packageSource, () =>
  tier1ListsTheCalendarFeature(tsconfigSource, unlistedSuite),
);
// 14b — the module is dropped from the compile list.
const unlistedModule = tsconfigSource.replace('    "src/services/calendarReminder.ts",\n', '');
probe('guard 14: the model leaves tsconfig.tier1.json', unlistedModule, tsconfigSource, () =>
  tier1ListsTheCalendarFeature(unlistedModule, packageSource),
);
// 14c — the pin drifts to a different SDK's tag.
const wrongPin = packageSource.replace('"expo-calendar": "~14.0.6"', '"expo-calendar": "~15.0.0"');
probe('guard 14: the SDK-52 pin is bumped to a newer SDK tag', wrongPin, packageSource, () =>
  tier1ListsTheCalendarFeature(tsconfigSource, wrongPin),
);

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
