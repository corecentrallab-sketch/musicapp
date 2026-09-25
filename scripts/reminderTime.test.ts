/**
 * Customizable practice-reminder TIME (owner request 09-25).
 *
 * The nudge stays ONE one-shot a day, outside play; only the fixed 18:00 becomes
 * a persisted user choice (default unchanged). This suite pins the value math,
 * the row copy, the scheduler using the persisted time — and, with live scans of
 * SettingsScreen.tsx / notifications.ts / storage.ts, that the surfaces really
 * use them (a green logic test over unwired modules proves nothing).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  DEFAULT_REMINDER_MINUTES,
  REMINDER_MINUTE_STEP,
  REMINDER_MINUTES_STORAGE_KEY,
  formatReminderTime,
  normalizeReminderMinutes,
  parseStoredReminderMinutes,
  reminderHourMinute,
  reminderScheduleUsesStoredTime,
  reminderSettingCopy,
  reminderSettingWired,
  stepReminderMinutes,
} from '../src/services/reminderTime';
import { nextNudgeTime } from '../src/services/practiceReinforcementView';
declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

const fs = require('fs');
const pathMod = require('path');
const read = (rel: string) => fs.readFileSync(pathMod.join(process.cwd(), rel), 'utf8');

try {
  console.log('\nthe default time is the old behaviour');
  assertEq(DEFAULT_REMINDER_MINUTES, 1080, 'default is 18:00 (1080 minutes) — unchanged for existing users');
  assertEq(REMINDER_MINUTE_STEP, 5, 'the picker steps 5 minutes');
  assertEq(REMINDER_MINUTES_STORAGE_KEY, '@notesnap/reminderMinutes', 'the persisted key follows the @notesnap/ pattern');
  assertEq(formatReminderTime(DEFAULT_REMINDER_MINUTES), '6:00 PM', 'the default renders as 6:00 PM');
  assertEq(reminderSettingCopy(DEFAULT_REMINDER_MINUTES), 'At 6:00 PM, remind me if I have not practiced.', 'the row copy keeps its wording at the default');
  assertEq(reminderSettingCopy(19 * 60 + 30), 'At 7:30 PM, remind me if I have not practiced.', 'the row shows the CHOSEN time');

  console.log('\nthe value stays a real minute of the day');
  assertEq(normalizeReminderMinutes(450), 450, '7:30 AM survives');
  assertEq(normalizeReminderMinutes(451), 450, 'a non-step value snaps to the nearest 5 minutes');
  assertEq(normalizeReminderMinutes('1080'), 1080, 'a stored string parses');
  assertEq(normalizeReminderMinutes(NaN), DEFAULT_REMINDER_MINUTES, 'garbage falls back to the default');
  assertEq(normalizeReminderMinutes(-30), 0, 'below the day clamps to midnight');
  assertEq(normalizeReminderMinutes(5000), 23 * 60 + 55, 'beyond the day clamps to 23:55');
  assertEq(parseStoredReminderMinutes(null), DEFAULT_REMINDER_MINUTES, 'an unset stored value is the default');
  assertEq(parseStoredReminderMinutes(''), DEFAULT_REMINDER_MINUTES, 'an empty stored value is the default');
  assertEq(parseStoredReminderMinutes('not a number'), DEFAULT_REMINDER_MINUTES, 'a corrupt value is the default');
  assertEq(parseStoredReminderMinutes('870'), 870, 'a persisted 14:30 comes back as 14:30');

  console.log('\nstepping (the picker) wraps inside the day');
  assertEq(stepReminderMinutes(1080, -60), 1020, 'an hour earlier');
  assertEq(stepReminderMinutes(1080, 5), 1085, 'five minutes later');
  assertEq(stepReminderMinutes(0, -5), 1435, 'midnight minus five wraps to 23:55');
  assertEq(stepReminderMinutes(1435, 5), 0, '23:55 plus five wraps to midnight');
  assertEq(stepReminderMinutes(undefined, 5), 1085, 'an unset value steps from the default');
  assertEq(reminderHourMinute(1170).hour, 19, 'hour for 19:30');
  assertEq(reminderHourMinute(1170).minute, 30, 'minute for 19:30');
  assertEq(formatReminderTime(0), '12:00 AM', 'midnight renders as 12:00 AM');
  assertEq(formatReminderTime(12 * 60 + 5), '12:05 PM', 'noon-ish renders as 12:05 PM');

  console.log('\nthe one-shot scheduler uses the persisted time');
  const now = new Date(2026, 8, 25, 10, 0, 0);
  const scheduled = nextNudgeTime(now, 19, 30);
  assert(scheduled !== null, 'a future reminder time today is schedulable');
  assertEq(scheduled ? scheduled.getHours() : -1, 19, 'scheduled at the chosen hour');
  assertEq(scheduled ? scheduled.getMinutes() : -1, 30, 'scheduled at the chosen minute');
  assertEq(nextNudgeTime(now, 9, 0), null, 'a time that already passed today schedules nothing (no late nag)');
  const defaultScheduled = nextNudgeTime(now, DEFAULT_REMINDER_MINUTES / 60, DEFAULT_REMINDER_MINUTES % 60);
  assertEq(
    defaultScheduled ? defaultScheduled.getHours() : -1,
    18,
    'the default hour still behaves exactly as before',
  );

  console.log('\nlive surfaces are wired (recognition + settings + storage + scheduler)');
  const settings = read('src/screens/SettingsScreen.tsx');
  const notifications = read('src/services/notifications.ts');
  const storage = read('src/services/storage.ts');
  assert(settings.length > 5000, `SettingsScreen.tsx is the real source (${settings.length} chars)`);
  assert(reminderSettingWired(settings), 'SettingsScreen renders reminderSettingCopy(...) and is wired to the stepper + persist callback');
  assert(settings.includes('formatReminderTime(reminderMinutes)'), 'the picker shows the chosen time');
  assert(
    settings.includes('At 6:00 PM, remind me if I have not practiced.') === false,
    'the hardcoded 6:00 PM row copy is GONE',
  );
  assert(reminderScheduleUsesStoredTime(notifications), 'notifications.ts reads the stored time and arms the one-shot with it');
  assert(notifications.includes('rescheduleStreakNudgeForTimeChange('), 'a time change cancels + re-arms the single one-shot');
  assert(storage.includes("REMINDER_MINUTES: '@notesnap/reminderMinutes'"), 'storage declares the reminder key');
  assert(storage.includes('export async function getReminderMinutes'), 'storage exposes getReminderMinutes()');
  assert(storage.includes('export async function setReminderMinutes'), 'storage exposes setReminderMinutes()');

  console.log('\nthe guards are not vacuous (pre-fix fixtures fail)');
  assertEq(
    reminderSettingWired(
      '<Text style={styles.infoText}>At 6:00 PM, remind me if I have not practiced.</Text>',
    ),
    false,
    'the pre-fix fixed-time row fails the Settings contract',
  );
  assertEq(
    reminderSettingWired(settings.replace('stepReminderMinutes(', 'stepNothing(')),
    false,
    'a row that loses its stepper wiring fails',
  );
  assertEq(
    reminderScheduleUsesStoredTime('const when = nextNudgeTime(new Date());'),
    false,
    'the pre-fix fixed-hour scheduler fails the contract',
  );
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
if (failures > 0) {
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
console.log(`\n${passes} passed, ${failures} failed\n`);
