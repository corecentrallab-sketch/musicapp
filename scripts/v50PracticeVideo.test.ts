/**
 * v50PracticeVideo.test.ts — THE PRACTICE-VIDEO PIPELINE FIX (owner device
 * report 11-04, five defects): the pure rules AND the live source guards, in one
 * run.
 *
 * THE FIVE OWNER-REPORTED DEFECTS, each with the test that would have caught it:
 *
 *   1. "The count timer gets stuck and doesn't count down on 3 & 5 second
 *      intervals."      → the pure deadline clock + `countInTicksToZero`
 *   2. "A large blue screen pops in another window up obscuring the video."
 *                       → `recordSurfaceShowsTheTake`
 *   3. "I did not see any video timer… for trimming the video."
 *                       → the pure `trimTimeline` geometry + `trimTimelineIsDrawn`
 *   4. "Not recording takes… nothing shows up once processed… a dead end."
 *                       → `recordingClockIsStable` (the measured length) +
 *                         `takeCannotBeDropped` (the surface before the decode)
 *   5. "Can't watch anything as there's nothing to watch on the page."
 *                       → `watchSurfaceIsNeverEmpty`
 *
 * Every guard is proven to bite TWICE: here, by mutating the real bytes IN MEMORY
 * (so the regression is permanent in the gate), and once on disk during the
 * build, with the failing output captured in
 * /home/team/shared/v50-mutation-probes.txt.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  COUNT_IN_OPTIONS,
  countInDeadline,
  countInRemainingSec,
  recordingElapsedSec,
} from '../src/services/practiceRecordingOptions';
import { trimTimeline, trimTimelineLine, TRIM_LENGTH_UNKNOWN_LINE } from '../src/services/takeClipTag';
import {
  V50_APP_JSON_PATH,
  V50_BILLING_MODE_PATH,
  V50_CLIP_EDITOR_PATH,
  V50_CLIP_MODULE_PATH,
  V50_OPTIONS_PATH,
  V50_SCREEN_PATH,
  billingPermissionIsDeclared,
  countInTicksToZero,
  recordSurfaceShowsTheTake,
  recordingClockIsStable,
  takeCannotBeDropped,
  trimTimelineIsDrawn,
  v50IsGated,
  watchSurfaceIsNeverEmpty,
} from '../src/services/v50PracticeVideoContract';

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
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  assert(same, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ─── REPO FILE ACCESS (the suite reads the REAL files, as text) ──────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function readRepoFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE COUNT-IN CLOCK (defect 1, the pure half)
// ─────────────────────────────────────────────────────────────────────────────

function testCountInClock(): void {
  console.log('\n— DEFECT 1: the count-in must tick down —');
  for (const choice of COUNT_IN_OPTIONS) {
    if (choice === 0) continue;
    const t0 = 1_000_000;
    const deadline = countInDeadline(choice, t0);
    assertEq(countInRemainingSec(deadline, t0), choice, `a ${choice}s count-in starts at ${choice}`);
    // IT DECREMENTS, once per second, all the way to zero.
    const seen: number[] = [];
    for (let ms = 0; ms <= choice * 1000; ms += 250) {
      seen.push(countInRemainingSec(deadline, t0 + ms));
    }
    const unique = seen.filter((value, index) => index === 0 || value !== seen[index - 1]);
    const expected: number[] = [];
    for (let step = choice; step >= 0; step -= 1) expected.push(step);
    assertEq(unique, expected, `a ${choice}s count-in steps down once per second`);
    assertEq(seen[seen.length - 1], 0, `a ${choice}s count-in reaches 0 at its deadline`);
    // The number never goes backwards and never goes negative.
    let previous = choice;
    let monotone = true;
    for (const value of seen) {
      if (value > previous || value < 0) monotone = false;
      previous = value;
    }
    assert(monotone, `a ${choice}s count-in is monotone and never negative`);
    // A LATE tick (a dropped frame) does not restart it: the deadline is absolute.
    assertEq(countInRemainingSec(deadline, t0 + choice * 1000 + 5000), 0,
      `a ${choice}s count-in is still 0 five seconds late (the deadline cannot be reset)`);
  }
  // A nonsense choice falls back to "off" (never a stuck non-zero count).
  assertEq(countInDeadline(7, 0), 0, 'a choice outside the three real options means no count-in');
  assertEq(countInRemainingSec(Number.NaN, 0), 0, 'a broken deadline reads 0, never NaN');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE RECORDING CLOCK AND THE TAKE'S LENGTH (defects 3 & 4, the pure half)
// ─────────────────────────────────────────────────────────────────────────────

function testRecordingClock(): void {
  console.log('\n— DEFECTS 3 & 4: the take has a real length —');
  const t0 = 5_000_000;
  assertEq(recordingElapsedSec(t0, t0), 0, 'the clock starts at 0:00');
  assertEq(recordingElapsedSec(t0, t0 + 500), 1, 'half a second rounds to 1 (never stuck at 0)');
  assertEq(recordingElapsedSec(t0, t0 + 12_400), 12, '12.4 seconds reads 12');
  assertEq(recordingElapsedSec(t0, t0 + 40_000), 40, 'a 40-second take measures 40 seconds');
  assertEq(recordingElapsedSec(t0, t0 + 180_000), 180, 'the 3-minute cap measures 180 seconds');
  // A stale or missing stamp can never produce a negative or NaN length.
  assertEq(recordingElapsedSec(0, t0), Math.round(t0 / 1000), 'a missing stamp measures from 0, never NaN');
  assertEq(recordingElapsedSec(Number.NaN, t0), 0, 'a broken stamp measures 0, never NaN');
  assertEq(recordingElapsedSec(t0, t0 - 5_000), 0, 'a clock that runs backwards never goes negative');
  // THE MONOTONE RULE: every tick of the same take is >= the one before it.
  let previous = 0;
  let monotone = true;
  for (let ms = 0; ms <= 30_000; ms += 250) {
    const value = recordingElapsedSec(t0, t0 + ms);
    if (value < previous) monotone = false;
    previous = value;
  }
  assert(monotone, 'the clock never goes backwards across 120 ticks');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CLIP'S TIMELINE (defect 3, the pure half)
// ─────────────────────────────────────────────────────────────────────────────

function testTrimTimeline(): void {
  console.log('\n— DEFECT 3: the clip control must draw a timeline —');
  const whole = trimTimeline(null, 40);
  assertEq(whole.unknown, false, 'a measured take has a known length');
  assertEq(whole.durationLabel, '0:40', 'the timeline prints the take’s length');
  assertEq(whole.startFrac, 0, 'the whole take starts at the left edge');
  assertEq(whole.widthFrac, 1, 'the whole take fills the bar');
  assertEq(whole.windowLabel, null, 'no window means no window label');
  assertEq(trimTimelineLine(whole), 'Length 0:40 · sending the whole take', 'the line names the length and the whole take');

  const window = trimTimeline({ startSec: 10, endSec: 25 }, 40);
  assertEq(window.startFrac, 0.25, 'a window at 0:10 of 0:40 starts a quarter in');
  assertEq(window.widthFrac, 0.375, 'a 15-second window covers 37.5% of a 40-second take');
  assertEq(window.windowLabel, '0:10–0:25', 'the window label is the pair’s own label');
  assertEq(trimTimelineLine(window), 'Length 0:40 · sending 0:10–0:25', 'the line names the window');

  // A window that runs past the end is clamped, never drawn outside the bar.
  const clamped = trimTimeline({ startSec: 30, endSec: 999 }, 40);
  assertEq(clamped.widthFrac, 0.25, 'a window past the end is clamped to the bar');
  assert(clamped.startFrac + clamped.widthFrac <= 1.0000001, 'the window never overflows the bar');

  // THE DEFECT: a take stored with no length has no timeline — and SAYS so.
  const unknown = trimTimeline(null, 0);
  assertEq(unknown.unknown, true, 'a take with no measured length is flagged unknown');
  assertEq(trimTimelineLine(unknown), TRIM_LENGTH_UNKNOWN_LINE, 'an unmeasurable length is a sentence, not 0:00');
  assertEq(trimTimeline(null, Number.NaN).unknown, true, 'a NaN length is flagged unknown');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE LIVE SOURCE GUARDS, ON THE REAL FILES
// ─────────────────────────────────────────────────────────────────────────────

function testGuardsOnRealFiles(): void {
  console.log('\n— THE LIVE GUARDS, on the real repo files —');
  const screen = readRepoFile(V50_SCREEN_PATH);
  const options = readRepoFile(V50_OPTIONS_PATH);
  const editor = readRepoFile(V50_CLIP_EDITOR_PATH);
  const clipModule = readRepoFile(V50_CLIP_MODULE_PATH);
  const appJson = readRepoFile(V50_APP_JSON_PATH);
  const pkg = readRepoFile('package.json');
  const tsconfig = readRepoFile('tsconfig.tier1.json');
  const billing = readRepoFile(V50_BILLING_MODE_PATH);

  assert(screen.length > 40000, 'the practice-video screen is the real file');
  assert(countInTicksToZero(screen, options), 'GUARD 1: the count-in ticks down to zero');
  assert(recordingClockIsStable(screen, options), 'GUARD 2: the recording clock moves and the length is measured');
  assert(trimTimelineIsDrawn(editor, clipModule), 'GUARD 3: the clip control draws a timeline');
  assert(takeCannotBeDropped(screen), 'GUARD 4: a completed take cannot be dropped');
  assert(recordSurfaceShowsTheTake(screen), 'GUARD 5: the review surface shows the take it filmed');
  assert(watchSurfaceIsNeverEmpty(screen), 'GUARD 6: the watch surface is never an empty page');
  assert(billingPermissionIsDeclared(appJson, pkg, billing), 'GUARD 7: the billing permission, and nothing else');
  assert(v50IsGated(tsconfig, pkg), 'GUARD 8: this suite and its modules are in the gate');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. MUTATION PROBES — every guard must BITE on the defect it names
// ─────────────────────────────────────────────────────────────────────────────

function replaceOnce(source: string, from: string, to: string): string {
  const at = source.indexOf(from);
  if (at < 0) return source;
  return source.slice(0, at) + to + source.slice(at + from.length);
}

/** Replace every occurrence (a defect can be written in more than one place). */
function replaceAll(source: string, from: string, to: string): string {
  return source.split(from).join(to);
}

/** Replace INSIDE the review surface's own JSX block (it shares strings with playback). */
function replaceInReview(source: string, from: string, to: string): string {
  const at = source.indexOf("{phase === 'review' ? (");
  const end = source.indexOf('\n        ) : null}', at);
  if (at < 0 || end < 0) return source;
  const block = source.slice(at, end);
  const replaced = block.split(from).join(to);
  return source.slice(0, at) + replaced + source.slice(end);
}

function testMutations(): void {
  console.log('\n— MUTATION PROBES: each guard must fail on its own defect —');
  const screen = readRepoFile(V50_SCREEN_PATH);
  const options = readRepoFile(V50_OPTIONS_PATH);
  const editor = readRepoFile(V50_CLIP_EDITOR_PATH);
  const clipModule = readRepoFile(V50_CLIP_MODULE_PATH);
  const appJson = readRepoFile(V50_APP_JSON_PATH);
  const pkg = readRepoFile('package.json');
  const billing = readRepoFile(V50_BILLING_MODE_PATH);

  // DEFECT 1 — the unstable callback back in the count-in's dependencies.
  const restartable = replaceOnce(screen, '}, [phase, countInSec]);', '}, [phase, countInSec, startBothCaptures]);');
  assert(restartable !== screen, 'probe: the count-in deps line was found');
  assert(!countInTicksToZero(restartable, options),
    'MUTATION 1a: a callback in the count-in’s deps restarts the count → guard fails');
  const notRef = replaceOnce(screen, 'startBothCapturesRef.current();', 'void startBothCaptures();');
  assert(!countInTicksToZero(notRef, options),
    'MUTATION 1b: calling the callback directly (no ref) → guard fails');
  const resetInside = replaceOnce(screen,
    'const left = countInRemainingSec(deadline, Date.now());',
    'const left = countInRemainingSec(deadline, Date.now()); setCountInLeft(countInSec);');
  assert(!countInTicksToZero(resetInside, options),
    'MUTATION 1c: resetting the number back to the choice inside the timer → guard fails');

  // DEFECTS 3 & 4 — the recording clock restarted, and the length read from a tick.
  const clockRestart = replaceOnce(screen, '}, [phase, recordingLengthSec]);', '}, [phase, recordingLengthSec, handleStop]);');
  assert(!recordingClockIsStable(clockRestart, options),
    'MUTATION 2a: `handleStop` back in the recording clock’s deps → guard fails');
  const lengthFromTick = replaceOnce(screen, 'durationSec,\n', 'durationSec: elapsedRef.current,\n');
  assert(!recordingClockIsStable(lengthFromTick, options),
    'MUTATION 2b: the stored length read from the last tick → guard fails');

  // DEFECT 3 — the clip control without its timeline.
  const noDisable = editor.split('disabled={!canTrim}').join('');
  assert(!trimTimelineIsDrawn(noDisable, clipModule),
    'MUTATION 3a: ± controls left enabled with no length → guard fails');
  const noBar = replaceOnce(editor, 'styles.timelineWindow', 'styles.nothing');
  assert(!trimTimelineIsDrawn(noBar, clipModule),
    'MUTATION 3b: the bar’s window removed → guard fails');
  const noGeometry = replaceOnce(clipModule, 'export function trimTimeline(', 'export function trimTimelineGone(');
  assert(!trimTimelineIsDrawn(editor, noGeometry),
    'MUTATION 3c: the pure geometry removed → guard fails');

  // DEFECT 4 — the take dropped before it is rendered.
  const noBound = replaceOnce(screen, 'settleWithin(', '(await (');
  assert(!takeCannotBeDropped(noBound), 'MUTATION 4a: an unbounded decode → guard fails');
  const decodeFirst = replaceOnce(screen, "setPhase('review');", "setPhase('keeping');");
  assert(!takeCannotBeDropped(decodeFirst), 'MUTATION 4b: never reaching the review surface → guard fails');
  const takeOnlyInState = replaceOnce(screen, 'savePracticeVideoTake(rowId, derivedTake)', 'rowId');
  assert(!takeCannotBeDropped(takeOnlyInState),
    'MUTATION 4c: the take kept only in React state (never written to the row) → guard fails');
  const silentCamera = replaceAll(screen, 'videoFailureRef.current = VIDEO_CAPTURE_FAILED_LINE;', 'void 0;');
  assert(!takeCannotBeDropped(silentCamera),
    'MUTATION 4d: the camera’s refusal swallowed again → guard fails');

  // DEFECT 2 — the modal that opened itself, and a surface with no video.
  const autoOpen = replaceOnce(screen, 'setTakeLine(written ? null : VIDEO_TAKE_SAVE_FAILED_LINE);',
    'setTakeLine(written ? null : VIDEO_TAKE_SAVE_FAILED_LINE); if (take && saved) setEditorOpen(true);');
  assert(!recordSurfaceShowsTheTake(autoOpen),
    'MUTATION 5a: the notes editor opening itself over the take → guard fails');
  const noVideoOnSurface = replaceInReview(screen, 'source={{ uri: ref.uri }}', 'source={{ uri: null }}');
  assert(!recordSurfaceShowsTheTake(noVideoOnSurface),
    'MUTATION 5b: the review surface without the take’s video → guard fails');

  // DEFECT 5 — the empty watch page.
  const emptyWatch = replaceOnce(screen, '{noVideoLine}', '{VIDEO_MISSING_LINE}');
  assert(!watchSurfaceIsNeverEmpty(emptyWatch),
    'MUTATION 6a: one generic line instead of the three honest cases → guard fails');
  const noWayOut = replaceOnce(screen, 'onPress={handleRecordAgain}', 'onPress={() => undefined}');
  assert(!watchSurfaceIsNeverEmpty(noWayOut), 'MUTATION 6b: no way out of the empty page → guard fails');

  // THE SCOPED EXTRA — the permission, and nothing else.
  const noPermission = appJson.replace('        "com.android.vending.BILLING"\n', '');
  assert(!billingPermissionIsDeclared(noPermission, pkg, billing),
    'MUTATION 7a: the billing permission removed → guard fails');
  const withLibrary = pkg.replace('"expo": "~52.0.0"', '"expo": "~52.0.0", "react-native-iap": "^12.0.0"');
  assert(!billingPermissionIsDeclared(appJson, withLibrary, billing),
    'MUTATION 7b: a billing SDK added alongside the permission → guard fails');
  const billingOn = replaceOnce(billing, 'BILLING_ENABLED: boolean = false', 'BILLING_ENABLED: boolean = true');
  assert(!billingPermissionIsDeclared(appJson, pkg, billingOn),
    'MUTATION 7c: the build turned back into a shop → guard fails');

  // THE GATE ITSELF.
  const ungated = pkg.replace('/tmp/tier1-test/scripts/v50PracticeVideo.test.js', '');
  assert(!v50IsGated(readRepoFile('tsconfig.tier1.json'), ungated),
    'MUTATION 8: this suite dropped from the chain → guard fails');
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

console.log('v50 practice-video pipeline — five owner-reported defects');
testCountInClock();
testRecordingClock();
testTrimTimeline();
testGuardsOnRealFiles();
testMutations();

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
