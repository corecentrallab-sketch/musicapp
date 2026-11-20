/**
 * vc61ReadClockTimingsReader.test.ts — THE vc61 SUITE (VC61-SPEC.md, parts 1–4).
 *
 * THE OWNER (11-17), verbatim: *"The speed… is too slow. It's almost unusable… the user also
 * needs to be made aware that the sample is being processed… like some sort of countdown."*
 * And: *"I am unable to read the score as the print is so compressed. There needs to be a full
 * screen option… This really needs a fix."*
 *
 * WHAT THIS SUITE PINS, one section per part of the spec:
 *
 *   1. THE CLOCK — elapsed always, a remaining time only when it is EARNED (a finished read on
 *      this device), never a countdown that runs out and sits at zero; the progress state is
 *      wired to the REAL read and to the REAL busy flag, not a decoration; the take-start
 *      control is NOT disabled by an in-flight read (the owner's row-5 trap); "Try the read
 *      again" is wired to a real re-read of the same take, not to a no-op.
 *   2. THE TIMINGS — every stage is a real `Date.now()` span measured on the device; the staff
 *      draw is `?` because nothing times it (never an invented number); the last few reads are
 *      kept and shown in the decoder probe card; the new modules add no network and no storage.
 *   3. THE READER — the tap is wired, it opens full screen, it is scrollable, the length line
 *      always shows and comes from `scoreLength.ts`, the position is remembered per take, and
 *      there is no synth, no rehearsal bar and no share sheet in it.
 *   4. THE COPY — the lane's sentences say a fact a user can act on: no "coverage", no "lane",
 *      no "staff", and the coverage line is derived from the real numbers.
 *
 * EVERY source guard here is PROVEN TO BITE in this file: the same guard is re-run over a
 * mutated copy of the real bytes and must go FALSE (skills `musicapp-tier1-live-scan-suite`,
 * `musicapp-guard-mutation-probes`). A probe whose mutation does not change the source fails
 * loudly instead of passing quietly.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import { maskComments } from '../src/services/modalBackContract';
import {
  READ_CEILING_LINE,
  READ_CLOCK_TICK_MS,
  READ_STALL_MS,
  READ_THROUGHPUT_MAX_SAMPLES,
  estimateRemainingSec,
  medianThroughput,
  pushThroughput,
  readClock,
  readClockLine,
  readIsStalled,
  readProgress,
  throughputFromRead,
} from '../src/services/takeReadClock';
import {
  READ_DRAW_NOT_MEASURED_NOTE,
  READ_TIMINGS_MAX_KEPT,
  createStageRecorder,
  finishReadTiming,
  pushReadTiming,
  readTimingsAudioLine,
  readTimingsLine,
  timingValue,
} from '../src/services/takeReadTimings';
import {
  NOTATION_READER_EMPTY_LINE,
  NOTATION_READER_HINT,
  NOTATION_READER_TITLE,
  NOTATION_ZOOM_IN_LABEL,
  NOTATION_ZOOM_OUT_LABEL,
  NOTATION_ZOOM_RESET_LABEL,
  NOTATION_READER_POSITION_MAX,
  clampNotationZoom,
  notationReaderLengthLine,
  notationReaderPositionKey,
  notationRenderWidth,
  notationZoomLabel,
  rememberReaderPosition,
  rememberedReaderPosition,
  resetReaderPositions,
  stepNotationZoom,
} from '../src/services/takeNotationReader';
import { scoreLengthLine } from '../src/services/scoreLength';
import { NOTES_COVERAGE_SECONDS, notesCoverageLaneLine, notesCoverageRecordLine } from '../src/services/notesCoverage';
import { STAFF_CLEANED_HONESTY, STAFF_EMPTY_LINE, STAFF_RAW_HONESTY } from '../src/services/takeStaff';

declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
let passes = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passes += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ FAILED: ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const same = actual === expected;
  assert(same, same ? label : `${label} (got ${String(actual)}, wanted ${String(expected)})`);
}

function readRepoFile(relative: string): string {
  return String(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

const SCREEN = readRepoFile('src/screens/PracticeVideoScreen.tsx');
const READER = readRepoFile('src/components/TakeNotationReader.tsx');
const PROBE_CARD = readRepoFile('src/components/TakeDecoderProbeCard.tsx');
const STAFF_CARD = readRepoFile('src/components/TakeStaffCard.tsx');
const SHIPPED_READ = readRepoFile('src/services/captureMidiExport.ts');
const CAPTURE_SEAM = readRepoFile('src/services/coachCapture.ts');
const TIMINGS_MODEL = readRepoFile('src/services/takeReadTimings.ts');
const CLOCK_MODEL = readRepoFile('src/services/takeReadClock.ts');
const READER_MODEL = readRepoFile('src/services/takeNotationReader.ts');
const PACKAGE_JSON = readRepoFile('package.json');
const TIER1_TSCONFIG = readRepoFile('tsconfig.tier1.json');

/** A mutation probe: the source really changed, and the guard really went false. */
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}

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

/** The text from `marker` to the closing of its `useCallback(...)` body. */
function callbackBody(source: string, marker: string): string | null {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const end = source.indexOf('}, [', at);
  return end < 0 ? source.slice(at) : source.slice(at, end);
}

/** Every `disabled={...}` expression on the screen. */
function disabledExpressions(source: string): string[] {
  const out: string[] = [];
  const re = /disabled=\{([^}]*)\}/g;
  let match = re.exec(source);
  while (match) {
    out.push(match[1]);
    match = re.exec(source);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — THE CLOCK, AND THE WAY OUT OF THE WAIT
// ─────────────────────────────────────────────────────────────────────────────

/** (a) The progress state is wired to the REAL read — not a decoration. */
function readClockIsWiredToTheRealRead(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  // The line is the pure model's, fed the screen's own measured state.
  if (src.indexOf('readClockLine(') < 0) return false;
  if (src.indexOf('readProgress({') < 0) return false;
  if (src.indexOf('elapsedMs: readClockMs,') < 0) return false;
  // The elapsed number TICKS, and it only ticks while the read is in flight.
  if (src.indexOf('if (!takeBusy) return undefined;') < 0) return false;
  if (src.indexOf('setReadClockMs(elapsed);') < 0) return false;
  if (src.indexOf('}, READ_CLOCK_TICK_MS);') < 0) return false;
  // The clock is stamped where the read starts.
  if (src.indexOf('readClockStartRef.current = Date.now();') < 0) return false;
  // The estimate is fed the take's own length and the device's own median speed.
  if (src.indexOf('audioSec: readAudioSec,') < 0) return false;
  if (src.indexOf('throughput: medianReadThroughput(deviceThroughput),') < 0) return false;
  // It is drawn only WHILE the read runs — never a permanent label.
  const clockAt = src.indexOf('readClockLine(');
  const guardAt = src.lastIndexOf('{takeBusy ? (', clockAt);
  if (guardAt < 0 || clockAt - guardAt > 600) return false;
  // And the stall is declared, so the surface can offer the way out.
  return src.indexOf('readIsStalled(elapsed)') >= 0;
}

/** (b) The take-start control is NOT disabled by an in-flight read (owner row 5). */
function theTakeStartIsNotGatedOnTheRead(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  // No control on this screen is disabled by the read's own state.
  for (const expression of disabledExpressions(src)) {
    if (/\btakeBusy\b/.test(expression)) return false;
    if (/\breadStalled\b/.test(expression)) return false;
    if (/\breadFailed\b/.test(expression)) return false;
  }
  // The way out is on screen WHILE the read runs, not only after it.
  const ctaAt = src.indexOf('accessibilityLabel={READ_START_ANOTHER_CTA}');
  if (ctaAt < 0) return false;
  const before = src.slice(Math.max(0, ctaAt - 700), ctaAt);
  if (!/\{takeBusy \|\| readStalled \? \(/.test(before)) return false;
  // It starts a new take through the ONE reset path, and that path never bails on the read.
  if (countOf(src, 'onPress={handleRecordAgain}') < 1) return false;
  const again = callbackBody(src, 'const handleRecordAgain = useCallback(');
  if (!again) return false;
  if (/\btakeBusy\b/.test(again)) return false;
  return again.indexOf('setPhase(\'permissions\')') >= 0;
}

/** "Try the read again" is a REAL re-read of the take already on screen. */
function theRetryReadsTheSameTake(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  if (src.indexOf('accessibilityLabel={READ_RETRY_CTA}') < 0) return false;
  if (src.indexOf('onPress={retryTakeRead}') < 0) return false;
  // It sits in the same place the progress line sits: on a failed or stalled read.
  const ctaAt = src.indexOf('onPress={retryTakeRead}');
  const before = src.slice(Math.max(0, ctaAt - 800), ctaAt);
  if (!/\{readStalled \|\| readFailed \? \(/.test(before)) return false;
  const body = callbackBody(src, 'const retryTakeRead = useCallback(');
  if (!body) return false;
  // A real read: it reaches the ONE seam and writes the result onto the row.
  if (body.indexOf('deriveCaptureTakeFromRecording(') < 0) return false;
  if (body.indexOf('savePracticeVideoTake(') < 0) return false;
  // …of the take's OWN stored audio — no new recording is started from here.
  if (body.indexOf('audioUri') < 0) return false;
  return body.indexOf('startBothCaptures') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — WHERE THE SECONDS GO
// ─────────────────────────────────────────────────────────────────────────────

/** Each stage is a real elapsed span on the device, and the draw is never invented. */
function readStagesAreMeasured(exportSource: string, captureSource: string): boolean {
  const src = maskComments(exportSource);
  const cap = maskComments(captureSource);
  if (src.length < 2000 || cap.length < 1000) return false;
  if (src.indexOf('const uploadStartedAt = Date.now();') < 0) return false;
  if (src.indexOf("deps.onStage?.('upload', Date.now() - uploadStartedAt);") < 0) return false;
  if (src.indexOf('const pitchStartedAt = Date.now();') < 0) return false;
  if (src.indexOf("deps.onStage?.('pitch', Date.now() - pitchStartedAt);") < 0) return false;
  if (src.indexOf('const buildStartedAt = Date.now();') < 0) return false;
  if (src.indexOf("deps.onStage?.('build', Date.now() - buildStartedAt);") < 0) return false;
  if (cap.indexOf('const unpackStartedAt = Date.now();') < 0) return false;
  if (cap.indexOf("deps.onStage?.('clientDecode', Date.now() - unpackStartedAt);") < 0) return false;
  // A stage recorded nowhere measures nothing: the recorder must reach the provider.
  if (src.indexOf('createDefaultSamplesProvider({ onStage: deps.onStage })') < 0) return false;
  return cap.indexOf('createRemoteDecodeProvider({ onStage: deps.onStage })') >= 0;
}

/** The measurements are SURFACED, and the last few are kept for comparison. */
function theTimingsAreShownOnTheProbeCard(cardSource: string, screenSource: string): boolean {
  const card = maskComments(cardSource);
  const src = maskComments(screenSource);
  if (card.length < 2000 || src.length < 6000) return false;
  if (card.indexOf('readTimings?: ReadonlyArray<TakeReadTiming> | null;') < 0) return false;
  if (card.indexOf('readTimingsLine(') < 0) return false;
  if (card.indexOf('READ_DRAW_NOT_MEASURED_NOTE') < 0) return false;
  // The screen measures through the ONE recorder and keeps a short history.
  if (src.indexOf('createStageRecorder()') < 0) return false;
  if (src.indexOf('finishReadTiming({') < 0) return false;
  if (src.indexOf('pushReadTiming(') < 0) return false;
  if (src.indexOf('readTimings={readTimings}') < 0) return false;
  // vc65: the callback still feeds the ONE recorder in both read paths — its shape now
  // also names the step the read has reached (`setReadStep`), so the span recorder is
  // called from inside it rather than handed over as the `onStage` value itself.
  if (src.indexOf('stageRecorder.record(stage, ms);') < 0) return false;
  return src.indexOf('recorder.record(stage, ms);') >= 0;
}

/** The new modules add no network, no storage and nothing native. */
function theTimingsAddNoNewSurface(sources: ReadonlyArray<string>, cardSource: string): boolean {
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 500) return false;
    if (/\bimport\b[^;]*?\bfrom\s+['"](react|react-native|expo[-a-z]*)['"]/.test(src)) return false;
    if (src.indexOf('AsyncStorage') >= 0) return false;
    if (src.indexOf('fetch(') >= 0) return false;
    if (src.indexOf('XMLHttpRequest') >= 0) return false;
    if (src.indexOf('require(') >= 0) return false;
  }
  return maskComments(cardSource).indexOf('fetch(') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — THE FULL-SCREEN READER
// ─────────────────────────────────────────────────────────────────────────────

/** The notation on the card is the tap, and the tap really opens the reader. */
function theReaderOpensFromTheNotationTap(screenSource: string, cardSource: string): boolean {
  const src = maskComments(screenSource);
  const card = maskComments(cardSource);
  if (src.length < 6000 || card.length < 1000) return false;
  // The card's expand control hands the take's OWN abc to its host.
  if (card.indexOf('onPress={() => onExpand(rows.cleanedAbc ?? rows.rawAbc ?? \'\')}') < 0) return false;
  if (card.indexOf('testID="take-staff-expand"') < 0) return false;
  // The host takes that abc and opens the reader with it.
  if (src.indexOf('setReaderAbc(abc);') < 0) return false;
  const expandAt = src.indexOf('setReaderAbc(abc);');
  if (src.slice(Math.max(0, expandAt - 400), expandAt).indexOf('onExpand={(abc) => {') < 0) return false;
  // The reader is really mounted, driven by that state, and can be closed again.
  const mountAt = src.indexOf('<TakeNotationReader');
  if (mountAt < 0) return false;
  const mount = src.slice(mountAt, mountAt + 600);
  if (mount.indexOf('visible={notationOpen}') < 0) return false;
  if (mount.indexOf('onClose={() => setNotationOpen(false)}') < 0) return false;
  if (mount.indexOf('positionKey={notationReaderPositionKey(') < 0) return false;
  return mount.indexOf('abc={readerAbc}') >= 0;
}

/** Full screen, scrollable, the length line always on, the place remembered, nothing else. */
function theReaderIsFullScreenAndRemembersItsPlace(readerSource: string): boolean {
  const src = maskComments(readerSource);
  if (src.length < 2000) return false;
  if (src.indexOf('presentationStyle="fullScreen"') < 0) return false;
  if (src.indexOf('onRequestClose={handleClose}') < 0) return false;
  if (src.indexOf('<ScrollView') < 0) return false;
  // The length line, from the ONE length model, always rendered.
  if (src.indexOf('notationReaderLengthLine(') < 0) return false;
  if (src.indexOf('testID="notation-reader-length"') < 0) return false;
  // The size is the user's, applied by a narrower render box.
  if (src.indexOf('stepNotationZoom(') < 0) return false;
  if (src.indexOf('notationRenderWidth(') < 0) return false;
  // The position is remembered per take, and put back on open.
  if (src.indexOf('rememberedReaderPosition(') < 0) return false;
  if (src.indexOf('rememberReaderPosition(') < 0) return false;
  // It never re-reads, re-times or saves a take.
  if (src.indexOf('deriveCaptureTakeFromRecording') >= 0) return false;
  if (src.indexOf('savePracticeVideoTake') >= 0) return false;
  // No synth, no rehearsal bar, no share sheet (those are the later slice).
  for (const banned of ['expo-sharing', 'expo-av', 'expo-audio', 'AudioPlayer', 'metronome', 'rehearsal', 'Share.']) {
    if (src.indexOf(banned) >= 0) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — THE LANE'S WORDS
// ─────────────────────────────────────────────────────────────────────────────

const JARGON: ReadonlyArray<string> = ['coverage', 'lane', 'staff'];

/** True when every user-facing line is plain English a user can act on. */
function laneCopyIsPlainEnglish(lines: ReadonlyArray<string | null>): boolean {
  let seen = 0;
  for (const line of lines) {
    if (line === null) continue;
    seen += 1;
    if (typeof line !== 'string' || line.trim().length === 0) return false;
    const lower = line.toLowerCase();
    for (const word of JARGON) {
      if (lower.indexOf(word) >= 0) return false;
    }
  }
  return seen > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CLOCK
// ─────────────────────────────────────────────────────────────────────────────

function testTheClock(): void {
  console.log('\nPART 1 — THE CLOCK, AND THE WAY OUT OF THE WAIT');

  assertEq(readClock(0), '0:00', 'the clock reads 0:00 at the start');
  assertEq(readClock(7), '0:07', 'the clock reads seconds the way every other clock in the app does');
  assertEq(readClock(75), '1:15', 'the clock rolls over a minute');

  // NO ESTIMATE BEFORE ONE IS EARNED: elapsed + the honest ceiling.
  const unearned = readProgress({ elapsedMs: 7000, audioSec: 30, throughput: null });
  assertEq(unearned.remainingSec, null, 'no estimate before this device has finished a read');
  assertEq(
    readClockLine(unearned),
    `0:07 so far · ${READ_CEILING_LINE}`,
    'before the first read the lane says the elapsed time and the honest ceiling',
  );
  assert(
    readClockLine(unearned).indexOf('left') < 0,
    'the unearned state never prints a remaining time it cannot know',
  );

  // AN EARNED ESTIMATE: this device reads 2 s of audio per second, so 30 s takes ~15 s.
  const earned = readProgress({ elapsedMs: 7000, audioSec: 30, throughput: 2 });
  assertEq(earned.remainingSec, 8, 'the estimate comes from the take’s own length and this device’s speed');
  assertEq(readClockLine(earned), '0:07 so far · about 0:08 left.', 'the earned state prints the remaining time');

  // NEVER A COUNTDOWN THAT RUNS OUT AND SITS AT ZERO.
  assertEq(
    estimateRemainingSec({ audioSec: 30, elapsedMs: 40000, throughput: 2 }),
    null,
    'a read past its own estimate is not given a negative or zero countdown',
  );
  assert(
    readClockLine(readProgress({ elapsedMs: 40000, audioSec: 30, throughput: 2 })).indexOf('left') < 0,
    'the overrun state falls back to the ceiling sentence, which is still true',
  );
  assertEq(estimateRemainingSec({ audioSec: 30, elapsedMs: 1000, throughput: null }), null, 'no throughput, no estimate');
  assertEq(estimateRemainingSec({ audioSec: 0, elapsedMs: 1000, throughput: 2 }), null, 'no take length, no estimate');
  assertEq(estimateRemainingSec({ audioSec: 30, elapsedMs: 1000, throughput: 0 }), null, 'a zero throughput is not a speed');

  // THE DEVICE'S OWN SPEED: measured, capped, and median so one busy read cannot poison it.
  assertEq(throughputFromRead({ audioSec: 30, readMs: 10000 }), 3, 'the throughput is audio seconds per wall second');
  assertEq(throughputFromRead({ audioSec: 0, readMs: 10000 }), null, 'a zero-length take is not a sample');
  assertEq(throughputFromRead({ audioSec: 30, readMs: 0 }), null, 'a zero-duration read is not a sample');
  assertEq(throughputFromRead({ audioSec: 0.001, readMs: 10000 }), null, 'a sample below the floor is noise');
  assertEq(throughputFromRead({ audioSec: 3000, readMs: 1 }), null, 'a sample above the ceiling is a measurement error');
  assertEq(pushThroughput([], 1).length, 1, 'a sample is kept');
  const capped = pushThroughput([1, 2, 3, 4, 5], 6);
  assertEq(capped.length, READ_THROUGHPUT_MAX_SAMPLES, 'the device keeps a handful of samples, not a history');
  assertEq(capped[capped.length - 1], 6, 'the newest sample is the one kept');
  assertEq(pushThroughput([1, 2], null).length, 2, 'a null sample keeps what was there');
  assertEq(medianThroughput([1, 3, 2]), 2, 'the median, not the mean');
  assertEq(medianThroughput([1, 2, 3, 4]), 2.5, 'an even count averages the middle two');
  assertEq(medianThroughput([]), null, 'no samples means no speed');

  // THE STALL: the lane stops pretending the wait is normal.
  assertEq(readIsStalled(READ_STALL_MS - 1), false, 'a read inside the stall window is not stalled');
  assertEq(readIsStalled(READ_STALL_MS), true, 'a read past the stall window says so');
  assertEq(readIsStalled(Number.NaN), false, 'an unmeasurable clock is not a stall');
  assertEq(READ_CLOCK_TICK_MS > 0, true, 'the clock ticks');

  // (a) THE PROGRESS STATE IS WIRED TO THE REAL READ.
  assertEq(readClockIsWiredToTheRealRead(SCREEN), true, 'the progress line is fed by the real read, not a decoration');
  assertEq(readClockIsWiredToTheRealRead(''), false, 'an empty screen has no clock');

  // (b) THE TAKE-START CONTROL IS NOT DISABLED BY AN IN-FLIGHT READ.
  assertEq(theTakeStartIsNotGatedOnTheRead(SCREEN), true, 'the take-start control is not disabled by an in-flight read');
  assertEq(theTakeStartIsNotGatedOnTheRead(''), false, 'an empty screen offers no way out');

  // THE RETRY IS A REAL RE-READ.
  assertEq(theRetryReadsTheSameTake(SCREEN), true, '"Try the read again" re-reads the take already on screen');
  assertEq(theRetryReadsTheSameTake(''), false, 'an empty screen has no retry');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE TIMINGS
// ─────────────────────────────────────────────────────────────────────────────

function testTheTimings(): void {
  console.log('\nPART 2 — WHERE THE SECONDS GO');

  assertEq(timingValue(8400), '8400ms', 'a measured span prints as milliseconds');
  assertEq(timingValue(null), '?', 'an unmeasured stage prints ?, never a zero');
  assertEq(timingValue(undefined), '?', 'a missing stage prints ?');
  assertEq(timingValue(-1), '?', 'a negative span is not a measurement');
  assertEq(timingValue(12.4), '12ms', 'a span is rounded to whole milliseconds');

  assertEq(
    readTimingsLine(null),
    'read: no read has finished on this phone yet.',
    'before a read finishes the card says so instead of printing zeros',
  );

  const one = {
    at: '2026-11-17T00:00:00.000Z',
    audioSec: 30,
    stages: { upload: 6100, clientDecode: 180, pitch: 1900, build: 220 },
    totalMs: 8400,
  };
  assertEq(
    readTimingsLine(one),
    'read: total=8400ms upload=6100ms unpack=180ms pitch=1900ms build=220ms draw=?',
    'the line prints every stage in one fixed order, newest stage names stable across builds',
  );
  assert(
    readTimingsLine(one).indexOf('draw=?') >= 0,
    'the staff draw is ? because nothing in this build times the paint',
  );
  assert(
    READ_DRAW_NOT_MEASURED_NOTE.indexOf('draw=?') >= 0,
    'the card says why the draw is missing rather than guessing a number',
  );
  const unmeasured = { at: 'x', audioSec: null, stages: { pitch: 1900 }, totalMs: 2000 };
  assert(
    readTimingsLine(unmeasured).indexOf('upload=?') >= 0,
    'a stage that was not measured prints ?, never 0ms',
  );
  assertEq(readTimingsAudioLine(one), 'this read covered 30s of audio', 'the take’s own length sits beside the line');
  assertEq(readTimingsAudioLine(unmeasured), null, 'an unknown take length is not printed');

  // THE HISTORY: the last few reads, newest first, so a slow one sits beside a fast one.
  let history = pushReadTiming([], one);
  history = pushReadTiming(history, { ...one, at: 'second' });
  assertEq(history.length, 2, 'a finished read is kept');
  assertEq(history[0].at, 'second', 'the newest read is first');
  let many = history;
  for (let i = 0; i < 10; i += 1) many = pushReadTiming(many, { ...one, at: `r${i}` });
  assertEq(many.length, READ_TIMINGS_MAX_KEPT, 'only the last few reads are kept');

  // THE RECORDER: real spans only.
  const recorder = createStageRecorder();
  recorder.record('upload', 1234.6);
  recorder.record('pitch', -5);
  recorder.record('build', Number.NaN);
  assertEq(recorder.stages.upload, 1235, 'a measured span is recorded, rounded');
  assertEq(recorder.stages.pitch, undefined, 'a negative span is not recorded');
  assertEq(recorder.stages.build, undefined, 'a non-finite span is not recorded');
  const finished = finishReadTiming({ stages: recorder.stages, totalMs: 2000, audioSec: 30 });
  assertEq(finished.totalMs, 2000, 'the total is what the screen measured');
  assertEq(finished.audioSec, 30, 'the take’s own length rides with the timing');
  assertEq(finishReadTiming({ stages: {}, totalMs: null }).totalMs, null, 'an unmeasured total is null, not zero');
  assertEq(finishReadTiming({ stages: {}, totalMs: 100, audioSec: 0 }).audioSec, null, 'a zero-length take is null');

  // THE WIRING.
  assertEq(readStagesAreMeasured(SHIPPED_READ, CAPTURE_SEAM), true, 'every stage of the read is a real Date.now() span');
  assertEq(readStagesAreMeasured('', CAPTURE_SEAM), false, 'an empty pipeline measures nothing');
  assertEq(theTimingsAreShownOnTheProbeCard(PROBE_CARD, SCREEN), true, 'the timings reach the probe card and the last few are kept');
  assertEq(theTimingsAreShownOnTheProbeCard('', SCREEN), false, 'a card with no timings line fails');
  assertEq(
    theTimingsAddNoNewSurface([TIMINGS_MODEL, CLOCK_MODEL, READER_MODEL], PROBE_CARD),
    true,
    'the clock, the timings and the reader are pure: no network, no storage, nothing native',
  );
  assertEq(theTimingsAddNoNewSurface(['export const x = 1;'], PROBE_CARD), false, 'a module too small to be the real one fails');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE READER
// ─────────────────────────────────────────────────────────────────────────────

function testTheReader(): void {
  console.log('\nPART 3 — THE FULL-SCREEN READER');

  const fourBars = 'X:1\nM:4/4\nL:1/4\nK:C\nC D E F|G A B c|C D E F|G A B c|]';
  const twelveBars = `${fourBars}\n${'C D E F|G A B c|C D E F|G A B c|'.repeat(2)}`;

  // THE LENGTH LINE IS scoreLength.ts's LINE — one source of truth.
  assertEq(
    notationReaderLengthLine(fourBars),
    scoreLengthLine(fourBars),
    'the reader’s length line is exactly the app’s length line, not a second one',
  );
  assertEq(notationReaderLengthLine(fourBars), 'Bars 1\u20134 of 4', 'a short take says how many bars it has');
  assertEq(notationReaderLengthLine(twelveBars), scoreLengthLine(twelveBars), 'a longer take’s line is the same model');
  assertEq(notationReaderLengthLine(''), null, 'no music, no length line (never "Bars 1–0 of 0")');

  // ZOOM: the print gets BIGGER, and a stored value from an older build is snapped into the band.
  assertEq(clampNotationZoom(1), 1, 'the fit level is 1');
  assertEq(clampNotationZoom(1.3), 1.25, 'a stored level snaps to one a control can reach and undo');
  assertEq(clampNotationZoom(9), 2, 'zoom is clamped at the top');
  assertEq(clampNotationZoom(0), 1, 'a zero zoom is the fit level');
  assertEq(clampNotationZoom('nonsense'), 1, 'an unparseable zoom is the fit level');
  assertEq(stepNotationZoom(1, 1), 1.25, 'Bigger steps up');
  assertEq(stepNotationZoom(1, -1), 1, 'Smaller cannot go below the fit level');
  assertEq(stepNotationZoom(2, 1), 2, 'Bigger cannot go past the top');
  assertEq(notationZoomLabel(1.25), '125%', 'the level is printed as a percentage');
  assertEq(notationRenderWidth(320, 1), 320, 'at fit, the score is laid out at the body width');
  assertEq(notationRenderWidth(320, 2), 160, 'zoomed in, the score is laid out NARROWER so the same music draws larger');
  assertEq(notationRenderWidth(320, 99), 160, 'an out-of-band zoom is clamped before it is applied');
  assertEq(notationRenderWidth(50, 1), 120, 'the render box never collapses below the readable minimum');

  // THE POSITION, REMEMBERED PER TAKE.
  resetReaderPositions();
  assertEq(rememberedReaderPosition('row:a').zoom, 1, 'a take opened for the first time starts at fit');
  assertEq(rememberedReaderPosition('row:a').scrollY, 0, 'a take opened for the first time starts at the top');
  rememberReaderPosition('row:a', { zoom: 1.5, scrollY: 220 });
  assertEq(rememberedReaderPosition('row:a').zoom, 1.5, 'closing and reopening returns to the size the user left');
  assertEq(rememberedReaderPosition('row:a').scrollY, 220, 'closing and reopening returns to where the user was');
  assertEq(rememberedReaderPosition('row:b').scrollY, 0, 'one take’s position is never another take’s');
  assertEq(notationReaderPositionKey({ rowId: 'abc', abc: 'X:1' }), 'row:abc', 'a stored take is keyed by its row');
  assert(
    notationReaderPositionKey({ rowId: null, abc: 'X:1' }) !== notationReaderPositionKey({ rowId: null, abc: 'X:2' }),
    'two unstored takes with different notation never share a position',
  );
  resetReaderPositions();
  for (let i = 0; i < NOTATION_READER_POSITION_MAX + 6; i += 1) {
    rememberReaderPosition(`row:${i}`, { zoom: 1.25, scrollY: 10 });
  }
  assertEq(rememberedReaderPosition('row:0').scrollY, 0, 'the oldest remembered position is dropped, not kept for ever');
  assertEq(
    rememberedReaderPosition(`row:${NOTATION_READER_POSITION_MAX + 5}`).scrollY,
    10,
    'the newest position is the one remembered',
  );
  resetReaderPositions();

  // THE WIRING: the tap opens it, and it is what the spec asked for.
  assertEq(theReaderOpensFromTheNotationTap(SCREEN, STAFF_CARD), true, 'tapping the notation opens the reader with the take’s own ABC');
  assertEq(theReaderOpensFromTheNotationTap(SCREEN, ''), false, 'a card with no expand control fails the tap guard');
  assertEq(theReaderIsFullScreenAndRemembersItsPlace(READER), true, 'the reader is full screen, scrollable, remembered, and carries no synth or share sheet');
  assertEq(theReaderIsFullScreenAndRemembersItsPlace(''), false, 'an empty reader component fails');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE COPY
// ─────────────────────────────────────────────────────────────────────────────

function testTheCopy(): void {
  console.log('\nPART 4 — THE LANE’S WORDS, IN PLAIN ENGLISH');

  const coverageLine = notesCoverageLaneLine(NOTES_COVERAGE_SECONDS, 30);
  assertEq(
    coverageLine,
    'Notes cover the first 1:00 of this 0:30 take. That is as far as NoteSnap reads, not anything you played wrong. Trim the clip to the part the notes cover.',
    'the coverage line states the two real numbers in plain English',
  );
  assert(
    notesCoverageLaneLine(12, 30).indexOf('0:12') >= 0,
    'the coverage line is derived from the numbers it is given, not from a typed sentence',
  );
  assert(
    notesCoverageLaneLine(NOTES_COVERAGE_SECONDS, 30) !== notesCoverageLaneLine(NOTES_COVERAGE_SECONDS, 90),
    'a different take length produces a different sentence',
  );

  const laneLines: ReadonlyArray<string | null> = [
    coverageLine,
    notesCoverageRecordLine(),
    STAFF_EMPTY_LINE,
    STAFF_RAW_HONESTY,
    STAFF_CLEANED_HONESTY,
    READ_CEILING_LINE,
    readClockLine(readProgress({ elapsedMs: 3000, audioSec: 30, throughput: null })),
    NOTATION_READER_TITLE,
    NOTATION_READER_HINT,
    NOTATION_READER_EMPTY_LINE,
    NOTATION_ZOOM_IN_LABEL,
    NOTATION_ZOOM_OUT_LABEL,
    NOTATION_ZOOM_RESET_LABEL,
  ];
  assertEq(laneCopyIsPlainEnglish(laneLines), true, 'no lane sentence uses "coverage", "lane" or "staff"');
  assertEq(laneCopyIsPlainEnglish(['The notes coverage stops at 60 seconds.']), false, 'the old jargon line fails the copy guard');
  assertEq(laneCopyIsPlainEnglish(['Notes stop at the end of the staff.']), false, '"staff" is jargon to a user');
  assertEq(laneCopyIsPlainEnglish(['']), false, 'an empty sentence is not a sentence');
  assertEq(laneCopyIsPlainEnglish([]), false, 'no sentences at all is not a copy pass');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE LISTS — a suite that stops running is a gate that is blind
// ─────────────────────────────────────────────────────────────────────────────

function testTheLists(): void {
  console.log('\nTHE GATE LISTS');

  const suiteName = 'vc61ReadClockTimingsReader.test';
  assertEq(PACKAGE_JSON.indexOf(suiteName) >= 0, true, 'this suite is in the test:tier1 chain');
  assertEq(TIER1_TSCONFIG.indexOf(`scripts/${suiteName}.ts`) >= 0, true, 'this suite is in tsconfig.tier1.json');
  for (const module of [
    'src/services/takeReadClock.ts',
    'src/services/takeReadTimings.ts',
    'src/services/takeNotationReader.ts',
  ]) {
    assertEq(TIER1_TSCONFIG.indexOf(`"${module}"`) >= 0, true, `${module} is in the tier1 type-check`);
  }
  assertEq(countOf(PACKAGE_JSON, `scripts/${suiteName}.js`) === 1, true, 'this suite runs exactly once');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. MUTATION PROBES — every guard must bite
// ─────────────────────────────────────────────────────────────────────────────

function testTheProbes(): void {
  console.log('\nMUTATION PROBES — every vc61 guard must bite');

  // 1a — the clock stops ticking (a decoration that never moves).
  const frozenClock = SCREEN.replace('setReadClockMs(elapsed);', 'setReadClockMs(0);');
  probe('part 1: the clock never ticks', frozenClock, SCREEN, () => readClockIsWiredToTheRealRead(frozenClock));
  // 1b — the clock is fed a number nobody measured.
  const fabricatedClock = SCREEN.replace('elapsedMs: readClockMs,', 'elapsedMs: 0,');
  probe('part 1: the clock is fed a fabricated elapsed time', fabricatedClock, SCREEN, () =>
    readClockIsWiredToTheRealRead(fabricatedClock),
  );
  // 1c — the clock loses the take's own length (no estimate can be earned).
  // The screen feeds the estimate from three places; every one of them has to go, or
  // replacing the first match alone leaves the guard's subject standing.
  const lengthlessClock = SCREEN.split('audioSec: readAudioSec,').join('audioSec: null,');
  probe('part 1: the clock loses the take’s length', lengthlessClock, SCREEN, () =>
    readClockIsWiredToTheRealRead(lengthlessClock),
  );

  // 2a — the take-start control is disabled while the read runs (the row-5 trap).
  const gatedStart = SCREEN.replace(
    'accessibilityLabel={READ_START_ANOTHER_CTA}',
    'disabled={takeBusy}\n                accessibilityLabel={READ_START_ANOTHER_CTA}',
  );
  probe('part 1: the new-take control is disabled by an in-flight read', gatedStart, SCREEN, () =>
    theTakeStartIsNotGatedOnTheRead(gatedStart),
  );
  // 2b — the way out is gone entirely.
  const noWayOut = SCREEN.replace('accessibilityLabel={READ_START_ANOTHER_CTA}', 'accessibilityLabel="Start"');
  probe('part 1: the new-take control is removed', noWayOut, SCREEN, () =>
    theTakeStartIsNotGatedOnTheRead(noWayOut),
  );
  // 2c — the reset path bails out while a read is running.
  const bailingStart = SCREEN.replace('const handleRecordAgain = useCallback(() => {', 'const handleRecordAgain = useCallback(() => {\n    if (takeBusy) return;');
  probe('part 1: starting a new take bails out while the read runs', bailingStart, SCREEN, () =>
    theTakeStartIsNotGatedOnTheRead(bailingStart),
  );

  // 3a — the retry is a dead button.
  const deadRetry = SCREEN.replace('onPress={retryTakeRead}', 'onPress={() => {}}');
  probe('part 1: the retry button does nothing', deadRetry, SCREEN, () => theRetryReadsTheSameTake(deadRetry));
  // 3b — the retry re-reads nothing (it no longer reaches the seam).
  const emptyRetry = SCREEN.replace('const read = deriveCaptureTakeFromRecording(', 'const read = Promise.resolve({');
  probe('part 1: the retry re-reads nothing', emptyRetry, SCREEN, () => theRetryReadsTheSameTake(emptyRetry));

  // 4a — a stage is recorded as a made-up number instead of a measured span.
  const inventedUpload = SHIPPED_READ.replace(
    "deps.onStage?.('upload', Date.now() - uploadStartedAt);",
    "deps.onStage?.('upload', 0);",
  );
  probe('part 2: the upload stage reports an invented number', inventedUpload, SHIPPED_READ, () =>
    readStagesAreMeasured(inventedUpload, CAPTURE_SEAM),
  );
  // 4b — the recorder never reaches the provider (the stages are recorded nowhere).
  // The seam records the decode on two paths, so every occurrence goes.
  const unmeasuredClient = CAPTURE_SEAM.split(
    'deps.onStage?.(\'clientDecode\', Date.now() - unpackStartedAt);',
  ).join('void 0;');
  probe('part 2: the phone’s own decode is not measured', unmeasuredClient, CAPTURE_SEAM, () =>
    readStagesAreMeasured(SHIPPED_READ, unmeasuredClient),
  );
  // 4c — the timings are measured and never shown.
  const hiddenTimings = SCREEN.replace('readTimings={readTimings}', '');
  probe('part 2: the timings never reach the card', hiddenTimings, SCREEN, () =>
    theTimingsAreShownOnTheProbeCard(PROBE_CARD, hiddenTimings),
  );
  // 4d — the history is not kept (one read only, nothing to compare).
  // The screen pushes on two paths; both have to go for the history to be gone.
  const noHistory = SCREEN.split('pushReadTiming(').join('pushReadTimingOnce(');
  probe('part 2: the last few reads are not kept', noHistory, SCREEN, () =>
    theTimingsAreShownOnTheProbeCard(PROBE_CARD, noHistory),
  );
  // 4e — a timing module grows a network call.
  const networkedTimings = TIMINGS_MODEL.replace(
    'export type TakeReadStage',
    "export async function postIt() {\n  await fetch('/api/timings');\n}\nexport type TakeReadStage",
  );
  probe('part 2: the timings module grows a network call', networkedTimings, TIMINGS_MODEL, () =>
    theTimingsAddNoNewSurface([networkedTimings, CLOCK_MODEL, READER_MODEL], PROBE_CARD),
  );

  // 5a — the notation tap opens nothing.
  const deadTap = SCREEN.replace('setReaderAbc(abc);', 'void 0;');
  probe('part 3: the notation tap does nothing', deadTap, SCREEN, () =>
    theReaderOpensFromTheNotationTap(deadTap, STAFF_CARD),
  );
  // 5b — the reader is mounted but never shown.
  const hiddenReader = SCREEN.replace('visible={notationOpen}', 'visible={false}');
  probe('part 3: the reader is never shown', hiddenReader, SCREEN, () =>
    theReaderOpensFromTheNotationTap(hiddenReader, STAFF_CARD),
  );
  // 5c — the card's expand control hands over nothing.
  const muteCard = STAFF_CARD.replace(
    'onPress={() => onExpand(rows.cleanedAbc ?? rows.rawAbc ?? \'\')}',
    'onPress={() => onExpand(\'\')}',
  );
  probe('part 3: the card opens the reader with no notation', muteCard, STAFF_CARD, () =>
    theReaderOpensFromTheNotationTap(SCREEN, muteCard),
  );
  // 5d — the reader stops being full screen.
  const windowed = READER.replace('presentationStyle="fullScreen"', 'presentationStyle="pageSheet"');
  probe('part 3: the reader is no longer full screen', windowed, READER, () =>
    theReaderIsFullScreenAndRemembersItsPlace(windowed),
  );
  // 5e — the length line is dropped (a short take looks clipped again).
  const lengthless = READER.replace('testID="notation-reader-length"', 'testID="notation-reader-title"');
  probe('part 3: the length line is dropped', lengthless, READER, () =>
    theReaderIsFullScreenAndRemembersItsPlace(lengthless),
  );
  // 5f — the reader stops remembering where the user was.
  const forgetful = READER.replace('rememberedReaderPosition(positionKey)', '({ zoom: 1, scrollY: 0 })');
  probe('part 3: the reader forgets the position', forgetful, READER, () =>
    theReaderIsFullScreenAndRemembersItsPlace(forgetful),
  );
  // 5g — a synth (or a share sheet) creeps into the reader.
  const noisy = READER.replace(
    "import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';",
    "import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';\nimport * as Sharing from 'expo-sharing';",
  );
  probe('part 3: the reader grows a share sheet', noisy, READER, () =>
    theReaderIsFullScreenAndRemembersItsPlace(noisy),
  );
  // 5h — the reader starts re-reading the take (a second read on a display surface).
  const reReading = READER.replace('const lengthLine = notationReaderLengthLine(abc ?? \'\');', "const again = deriveCaptureTakeFromRecording({});\n  const lengthLine = notationReaderLengthLine(abc ?? '');");
  probe('part 3: the reader re-reads the take', reReading, READER, () =>
    theReaderIsFullScreenAndRemembersItsPlace(reReading),
  );

  // 6a — the copy goes back to the jargon the owner could not act on.
  assertEq(
    laneCopyIsPlainEnglish(['The notes coverage runs to 60 seconds.']),
    false,
    'MUTATION FAILS THE GUARD — part 4: the coverage line goes back to jargon',
  );
  assertEq(
    laneCopyIsPlainEnglish([notesCoverageLaneLine(NOTES_COVERAGE_SECONDS, 30)]),
    true,
    'the shipped coverage line passes the same guard the jargon line fails',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testTheClock();
  testTheTimings();
  testTheReader();
  testTheCopy();
  testTheLists();
  testTheProbes();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
