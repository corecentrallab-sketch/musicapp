/**
 * v49DeviceBatch.test.ts — THE vc49 DEVICE BATCH: the pure rules AND the live
 * source guards, in one run.
 *
 * THE FOUR OWNER-REPORTED DEVICE FIXES (email 11-03) each get a guard that
 * FAILS on the defect the owner actually hit:
 *
 *   1. `facing="back"` hardcoded again              → cameraFacingIsUserControlled
 *   2. the record flow completing without the trim  → recordFlowOffersTheTrim
 *   3. the count-in shifting the take's start       → countInCannotShiftTheTakeStart
 *   4. the length control exceeding the 3-min cap   → recordingLengthIsBounded
 *   5. "guitar tab"/"tablature" on the front page   → frontPageCopyIsHonest
 *
 * Each guard is proven to bite TWICE: here, by mutating the real bytes IN MEMORY
 * (so the regression is permanent), and on disk once per guard during the build,
 * with the failing output captured in /home/team/shared/vc49-mutation-probes.txt.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  COUNT_IN_OPTIONS,
  RECORDING_LENGTH_OPTIONS,
  RECORDING_LENGTH_DEFAULT,
  RECORDING_LENGTH_MIN_SECONDS,
  clampRecordingLength,
  countInCountdownLine,
  countInLabel,
  normaliseCountIn,
  recordingClock,
  recordingLengthLabel,
  recordingLengthReached,
  recordingLengthRemaining,
  recordingProgressLine,
} from '../src/services/practiceRecordingOptions';
import { PRACTICE_VIDEO_MAX_SECONDS } from '../src/services/practiceVideoRef';
import {
  V49_CLIP_EDITOR_PATH,
  V49_FRONT_DOOR_PATH,
  V49_HOME_PATH,
  V49_OPTIONS_PATH,
  V49_SCREEN_PATH,
  V49_TIER1_MODULES,
  V49_TIER1_SUITES,
  cameraFacingIsUserControlled,
  countInCannotShiftTheTakeStart,
  frontPageCopyIsHonest,
  frontPageLineFrom,
  recordFlowOffersTheTrim,
  recordingLengthIsBounded,
  v49IsGated,
} from '../src/services/v49DeviceBatchContract';

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

const SCREEN = readAppFile(V49_SCREEN_PATH);
const OPTIONS = readAppFile(V49_OPTIONS_PATH);
const FRONT_DOOR = readAppFile(V49_FRONT_DOOR_PATH);
const HOME = readAppFile(V49_HOME_PATH);
const CLIP_EDITOR = readAppFile(V49_CLIP_EDITOR_PATH);
const TSCONFIG = readAppFile('tsconfig.tier1.json');
const PACKAGE = readAppFile('package.json');

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE COUNT-IN — the pure rules
// ─────────────────────────────────────────────────────────────────────────────

function countInRules(): void {
  console.log('\nthe count-in: off / 3 s / 5 s, and nothing else');
  assertEq(COUNT_IN_OPTIONS.length, 3, 'three choices exist');
  assert(
    COUNT_IN_OPTIONS.indexOf(0) >= 0 && COUNT_IN_OPTIONS.indexOf(3) >= 0 && COUNT_IN_OPTIONS.indexOf(5) >= 0,
    'the choices are off, three seconds and five seconds',
  );
  assertEq(normaliseCountIn(0), 0, 'off stays off');
  assertEq(normaliseCountIn(3), 3, 'three seconds is accepted');
  assertEq(normaliseCountIn(5), 5, 'five seconds is accepted');
  assertEq(normaliseCountIn(7), 0, 'a value that is not a choice falls back to off (never a hidden lead-in)');
  assertEq(normaliseCountIn(Number.NaN), 0, 'a nonsense value falls back to off');
  assertEq(countInLabel(0), 'Off', 'off reads "Off"');
  assertEq(countInLabel(3), '3 s', 'three seconds reads "3 s"');
  assertEq(countInLabel(5), '5 s', 'five seconds reads "5 s"');
  assert(/3/.test(countInCountdownLine(3)), 'the countdown names the seconds left');
  assert(
    /recording|start/i.test(countInCountdownLine(0)),
    'a finished count-in says filming is starting (never "0…")',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE RECORDING LENGTH — bounded by the 3-minute cap
// ─────────────────────────────────────────────────────────────────────────────

function lengthRules(): void {
  console.log('\nthe recording length: chosen by the user, capped at three minutes');
  assertEq(PRACTICE_VIDEO_MAX_SECONDS, 180, 'the app cap is still three minutes');
  assertEq(RECORDING_LENGTH_DEFAULT, PRACTICE_VIDEO_MAX_SECONDS, 'the default length is the cap itself');
  RECORDING_LENGTH_OPTIONS.forEach((option) => {
    assert(option <= PRACTICE_VIDEO_MAX_SECONDS, `the offered length ${option}s is at or below the cap`);
    assertEq(clampRecordingLength(option), option, `${option}s is offered unchanged`);
  });
  assertEq(clampRecordingLength(300), PRACTICE_VIDEO_MAX_SECONDS, '300 s is cut to the cap');
  assertEq(clampRecordingLength(99999), PRACTICE_VIDEO_MAX_SECONDS, 'a huge length is cut to the cap');
  assertEq(clampRecordingLength(0), RECORDING_LENGTH_MIN_SECONDS, 'a zero length is raised to the minimum');
  assertEq(clampRecordingLength(-10), RECORDING_LENGTH_MIN_SECONDS, 'a negative length is raised to the minimum');
  assertEq(clampRecordingLength(Number.NaN), RECORDING_LENGTH_DEFAULT, 'a nonsense length falls back to the default');
  assertEq(recordingClock(0), '0:00', 'the clock starts at 0:00');
  assertEq(recordingClock(7), '0:07', 'seven seconds reads 0:07');
  assertEq(recordingClock(180), '3:00', 'the cap reads 3:00');
  assertEq(recordingLengthLabel(60), '1:00', 'a one-minute length reads 1:00');
  assertEq(recordingLengthRemaining(20, 60), 40, 'twenty seconds into a minute leaves forty');
  assertEq(recordingLengthRemaining(90, 60), 0, 'past the length there is nothing left (never a negative)');
  assertEq(recordingLengthReached(59, 60), false, 'the length is not reached one second early');
  assertEq(recordingLengthReached(60, 60), true, 'the length is reached exactly on time');
  assertEq(recordingLengthReached(61, 60), true, 'and stays reached after it');
  assertEq(recordingLengthReached(200, 9999), true, 'a length beyond the cap can never postpone the stop');
  assert(/0:12/.test(recordingProgressLine(12, 60)), 'the running line names the time recorded');
  assert(/0:48/.test(recordingProgressLine(12, 60)), 'the running line names the time left');
  assert(/1:00/.test(recordingProgressLine(12, 60)), 'the running line names the chosen length');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LIVE-SOURCE GUARDS, on the real files
// ─────────────────────────────────────────────────────────────────────────────

function liveGuards(): void {
  console.log('\nvc49 — the camera flip is a control, not a literal');
  assert(SCREEN.length > 25000, `read ${V49_SCREEN_PATH} (${SCREEN.length} chars)`);
  assert(
    cameraFacingIsUserControlled(SCREEN),
    'the camera reads its facing from state and the flip is locked while a capture runs',
  );

  console.log('\nvc49 — the trim is offered where the user records');
  assert(CLIP_EDITOR.length > 2000, `read ${V49_CLIP_EDITOR_PATH} (${CLIP_EDITOR.length} chars)`);
  assert(
    recordFlowOffersTheTrim(SCREEN),
    'the review surface mounts the ONE clip control, wired to the ONE trim model',
  );

  console.log('\nvc49 — the count-in cannot shift the take start');
  assert(
    countInCannotShiftTheTakeStart(SCREEN),
    'the count-in is a phase before any capture: the two stamps and recordAsync stay together',
  );

  console.log('\nvc49 — the recording length cannot exceed the cap');
  assert(OPTIONS.length > 2000, `read ${V49_OPTIONS_PATH} (${OPTIONS.length} chars)`);
  assert(recordingLengthIsBounded(SCREEN, OPTIONS), 'the length is clamped at the cap and stops the take cleanly');

  console.log('\nvc49 — the front-page copy');
  assertEq(
    frontPageLineFrom(FRONT_DOOR),
    "Find any Song from Jazz and Classical to today's hits",
    "the front-page line is the owner's wording",
  );
  assert(frontPageCopyIsHonest(FRONT_DOOR, HOME), 'the copy claims no tablature and is really rendered on Home');

  console.log('\nvc49 — the gate compiles and runs this batch');
  assert(v49IsGated(TSCONFIG, PACKAGE), 'the module and the suite are in tsconfig.tier1.json and test:tier1');
  assertEq(V49_TIER1_MODULES.length, 3, 'the batch lists the module, the contract and the suite');
  assertEq(V49_TIER1_SUITES.length, 1, 'and exactly one suite to run');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE MUTATION PROBES — every guard must FAIL on the defect it names
// ─────────────────────────────────────────────────────────────────────────────

function mutationProbes(): void {
  console.log('\nvc49 — PROBES: each guard fails on the defect the owner hit');

  // 1. facing hardcoded again
  const hardcodedFacing = SCREEN.replace('facing={facing}', 'facing="back"');
  assert(hardcodedFacing !== SCREEN, 'PROBE 1 setup: the facing prop was replaced with a literal');
  assertEq(
    cameraFacingIsUserControlled(hardcodedFacing),
    false,
    'PROBE 1: facing hardcoded to "back" → the camera-flip guard FAILS',
  );
  // 1b. the control reachable mid-recording
  const unlocked = SCREEN.replace('disabled={flipLocked}', 'disabled={false}');
  assertEq(
    cameraFacingIsUserControlled(unlocked),
    false,
    'PROBE 2: the flip control no longer locked during a take → the camera-flip guard FAILS',
  );
  // 1c. the handler no longer refuses mid-take
  const handlerUnlocked = SCREEN.replace('if (flipLocked) return;', 'if (false) return;');
  assertEq(
    cameraFacingIsUserControlled(handlerUnlocked),
    false,
    'PROBE 3: the flip handler no longer refuses mid-take → the camera-flip guard FAILS',
  );

  // 2. the record flow completes without offering the trim
  const noTrim = SCREEN.replace('<TakeClipTagEditor', '<SomethingElse');
  assert(noTrim !== SCREEN, 'PROBE 4 setup: the clip control was removed from the review surface');
  assertEq(
    recordFlowOffersTheTrim(noTrim),
    false,
    'PROBE 4: the record flow no longer offers the trim → the trim guard FAILS',
  );
  // 2b. a second trim model
  const secondModel = SCREEN.replace(
    'const [trimSpan, setTrimSpan] = useState<TakeTrimSpan | null>(null);',
    'const [trimSpan, setTrimSpan] = useState<TakeTrimSpan | null>(null);\n  const [trimSpan2, setTrimSpan2] = useState<TakeTrimSpan | null>(null);',
  );
  assertEq(
    recordFlowOffersTheTrim(secondModel),
    false,
    'PROBE 5: a SECOND trim model appears → the trim guard FAILS',
  );
  // 2c. the notes editor opens itself over the review surface again
  const autoEditor = SCREEN.replace(
    'if (!persisted.uri) setErrorLine(PRACTICE_VIDEO_NOT_KEPT_LINE);',
    'if (!persisted.uri) setErrorLine(PRACTICE_VIDEO_NOT_KEPT_LINE);\n      setEditorOpen(true);',
  );
  assertEq(
    recordFlowOffersTheTrim(autoEditor),
    false,
    'PROBE 6: the notes editor auto-opens over the trim → the trim guard FAILS',
  );
  // 2d. the window no longer persisted on the row (both writers replaced)
  const notPersisted = SCREEN.split('await attachPracticeVideo(row.rowId, updated);').join(
    'await Promise.resolve();',
  );
  assertEq(
    recordFlowOffersTheTrim(notPersisted),
    false,
    'PROBE 7: the window is no longer stored on the row → the trim guard FAILS',
  );

  // 3. the count-in shifts the take start
  const countInInsideCapture = SCREEN.replace(
    'const startBothCaptures = useCallback(async () => {\n    if (armedRef.current || !cameraRef.current) return;',
    'const startBothCaptures = useCallback(async () => {\n    if (armedRef.current || !cameraRef.current) return;\n    await new Promise((resolve) => setTimeout(resolve, countInSec * 1000));',
  );
  assert(
    countInInsideCapture !== SCREEN,
    'PROBE 8 setup: a count-in delay was moved INSIDE the capture start',
  );
  assertEq(
    countInCannotShiftTheTakeStart(countInInsideCapture),
    false,
    'PROBE 8: the count-in runs inside the capture → the clock guard FAILS',
  );
  // 3b. Start no longer routes through the count-in phase
  const noCountInPhase = SCREEN.replace("setPhase('count_in');", "setPhase('recording');");
  assertEq(
    countInCannotShiftTheTakeStart(noCountInPhase),
    false,
    'PROBE 9: Start no longer enters the count-in phase → the clock guard FAILS',
  );
  // 3c. the capture starts before the countdown ends
  const earlyStart = SCREEN.replace(
    'if (left <= 0) {\n        clearInterval(timer);\n        void startBothCaptures();',
    'if (left <= 0) {\n        clearInterval(timer);\n        void startBothCaptures();\n      }\n      if (left > 0) {\n        void startBothCaptures();',
  );
  assert(earlyStart !== SCREEN, 'PROBE 10 setup: the capture is started on a non-zero tick too');
  assertEq(
    countInCannotShiftTheTakeStart(earlyStart),
    false,
    'PROBE 10: the capture can start before the count reaches zero → the clock guard FAILS',
  );

  // 4. the length control exceeds the cap
  const unclampedWrite = SCREEN.replace(
    'setRecordingLengthSec(clampRecordingLength(option))',
    'setRecordingLengthSec(option)',
  );
  assertEq(
    recordingLengthIsBounded(unclampedWrite, OPTIONS),
    false,
    'PROBE 11: the length is written without the clamp → the length guard FAILS',
  );
  const unclampedUse = SCREEN.replace(
    'const limit = clampRecordingLength(recordingLengthSec);',
    'const limit = recordingLengthSec;',
  );
  assertEq(
    recordingLengthIsBounded(unclampedUse, OPTIONS),
    false,
    'PROBE 12: the length is used without the clamp → the length guard FAILS',
  );
  const clampBroken = OPTIONS.replace(
    'return Math.min(PRACTICE_VIDEO_MAX_SECONDS, Math.max(RECORDING_LENGTH_MIN_SECONDS, seconds));',
    'return Math.max(RECORDING_LENGTH_MIN_SECONDS, seconds);',
  );
  assertEq(
    recordingLengthIsBounded(SCREEN, clampBroken),
    false,
    'PROBE 13: the clamp no longer holds the cap → the length guard FAILS',
  );
  const noAutoStop = SCREEN.replace('recordingLengthReached(seconds, limit)', 'recordingLengthReached(seconds, 9999)');
  assertEq(
    recordingLengthIsBounded(noAutoStop, OPTIONS),
    false,
    'PROBE 14: reaching the length no longer stops the take → the length guard FAILS',
  );
  const noHardCap = SCREEN.replace(
    'maxDuration: PRACTICE_VIDEO_MAX_SECONDS,',
    'maxDuration: 999999,',
  );
  assertEq(
    recordingLengthIsBounded(noHardCap, OPTIONS),
    false,
    'PROBE 15: the camera call loses its own cap → the length guard FAILS',
  );

  // 5. the front-page copy
  const guitarAt = FRONT_DOOR.indexOf('export const HOME_PROMISE_GUITAR');
  const guitarEnd = FRONT_DOOR.indexOf(';', guitarAt) + 1;
  const tabCopy =
    FRONT_DOOR.slice(0, guitarAt) +
    'export const HOME_PROMISE_GUITAR = "Find any song — guitar tabs, official tablature";' +
    FRONT_DOOR.slice(guitarEnd);
  assert(tabCopy !== FRONT_DOOR, 'PROBE 16 setup: the guitar line was replaced with a "guitar tabs" claim');
  assertEq(
    frontPageCopyIsHonest(tabCopy, HOME),
    false,
    'PROBE 16: "guitar tabs" / "tablature" in the promise → the front-page guard FAILS',
  );
  const allGenresAt = FRONT_DOOR.indexOf('export const HOME_PROMISE_ALL_GENRES');
  const allGenresEnd = FRONT_DOOR.indexOf(';', allGenresAt) + 1;
  const oldWording =
    FRONT_DOOR.slice(0, allGenresAt) +
    'export const HOME_PROMISE_ALL_GENRES = "Find any song — classical to today\'s hits";' +
    FRONT_DOOR.slice(allGenresEnd);
  assert(oldWording !== FRONT_DOOR, 'PROBE 17 setup: the constant was replaced with the old line');
  assertEq(
    frontPageCopyIsHonest(oldWording, HOME),
    false,
    "PROBE 17: the old line without jazz → the front-page guard FAILS",
  );
  const unrendered = HOME.replace('{homePromiseCopy(onboarding?.instrument)}', '{HOME_PROMISE_ALL_GENRES}');
  assertEq(
    frontPageCopyIsHonest(FRONT_DOOR, unrendered),
    false,
    'PROBE 18: the line is defined but no longer rendered on Home → the front-page guard FAILS',
  );

  // 6. the gate
  const ungated = TSCONFIG.replace('"src/services/practiceRecordingOptions.ts",', '');
  assertEq(v49IsGated(ungated, PACKAGE), false, 'PROBE 19: the module dropped from tsconfig → the gate guard FAILS');
  const unrun = PACKAGE.replace('/tmp/tier1-test/scripts/v49DeviceBatch.test.js', '');
  assertEq(v49IsGated(TSCONFIG, unrun), false, 'PROBE 20: the suite dropped from test:tier1 → the gate guard FAILS');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. the real bytes are untouched by the probes (they ran in memory)
// ─────────────────────────────────────────────────────────────────────────────

function diskIsUnchanged(): void {
  console.log('\nvc49 — the real files are unchanged by the probes');
  assertEq(readAppFile(V49_SCREEN_PATH).length, SCREEN.length, 'the screen on disk is what was read');
  assertEq(readAppFile(V49_OPTIONS_PATH).length, OPTIONS.length, 'the options module on disk is unchanged');
  assertEq(readAppFile(V49_FRONT_DOOR_PATH).length, FRONT_DOOR.length, 'the front door on disk is unchanged');
  assert(cameraFacingIsUserControlled(readAppFile(V49_SCREEN_PATH)), '…and the guards still pass on it');
}

countInRules();
lengthRules();
liveGuards();
mutationProbes();
diskIsUnchanged();

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
