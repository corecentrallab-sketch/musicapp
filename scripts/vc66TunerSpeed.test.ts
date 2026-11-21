/**
 * vc66TunerSpeed.test.ts — THE TUNER COMMITS SOONER (vc66, owner 11-21).
 *
 * THE COMPLAINT (owner's vc64 device pass, item 5): "Pass - (but very slow in
 * resolving the key). Make faster.. comment." He is tuning his LOW strings and the
 * tuner names them correctly (E2, D2 — the vc64 band fix), so this is not accuracy:
 * it is the time between playing a note and being told what it is.
 *
 * WHAT WAS SLOW, and what this suite pins:
 *
 *   1. THE LISTENING WINDOW — `TUNER_TAKE_MS` was 700 ms: the mic stayed open for
 *      seven tenths of a second before the app even began to decide. It is 400 ms
 *      now, and the shortened take must still fill the reading window and still
 *      name the strings the owner tunes (A4, low E, drop-D).
 *   2. THE STABLE FRAMES — `TUNER_MIN_CONFIDENT_FRAMES` was 3: the take had to
 *      produce three agreeing frames of tail before anything was named. It is 2
 *      now, and two agreeing frames name the note — while two frames that DISAGREE
 *      still name nothing, because the agreement rule is what keeps an honest miss.
 *   3. THE LIVE STATE — the decide phase used to show one unchanging line, so a
 *      working tuner looked stalled. `tunerHearingLine(tick)` moves, and the screen
 *      renders it from a timer while it decides.
 *
 * EACH GUARD IS MADE TO FAIL WHEN ITS BEHAVIOUR IS REMOVED: the take-window and
 * stable-frame guards are re-run with the PRE-FIX values (700 ms, 3 frames) and must
 * fail, and the live-state guard is re-run against the real screen with the live
 * line and then the timer stripped out of it.
 *
 * NOT IN SCOPE, AND PINNED AS UNCHANGED: the pitch band (55 Hz floor / 45 Hz
 * high-pass / 1200 Hz ceiling — the vc64 fix that makes drop-D and a 7-string's low
 * B audible at all) and the note names.
 *
 * Plain Node, no react-native, no microphone, no network. Run: npm run test:tier1
 */
import {
  DEFAULT_WINDOW_SAMPLES,
  detectPitchFrames,
  type PitchFrame,
} from '../src/services/pitchDetection';
import {
  TUNER_HEARING_LINE,
  TUNER_HEARING_TICK_MS,
  TUNER_HEARING_WORD,
  TUNER_MIN_CONFIDENT_FRAMES,
  TUNER_PITCH_BAND,
  TUNER_READING_FRAMES,
  TUNER_TAKE_MS,
  noteNameFromMidi,
  tunerHearingLine,
  tunerReadingFromFrames,
  tunerReadingFromTake,
  type TunerReading,
} from '../src/services/tuner';
import { V39_TUNER_SCREEN_PATH } from '../src/services/v39UiContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passes++;
    return;
  }
  failures.push(label);
  console.error(`FAIL  ${label}`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} — expected ${String(expected)}, got ${String(actual)}`);
}

/** The note a reading names, or '' when it names nothing. */
function named(reading: TunerReading): string {
  return reading.kind === 'note' ? reading.display : '';
}

/** A deterministic frame series at one pitch — no randomness, no clock. */
function frames(midi: number | null, count: number, rms = 0.25): PitchFrame[] {
  const out: PitchFrame[] = [];
  for (let i = 0; i < count; i++) out.push({ tSec: i * 0.025, midi, rms });
  return out;
}

/** A pure sine take at the tuner's OWN (shortened) take length. */
function sine(hz: number, sampleRate = 44100, amplitude = 0.6): Float32Array {
  const length = Math.round((TUNER_TAKE_MS / 1000) * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

/** The tuner's real path: a take's samples → one reading, with the tuner's band. */
function readThroughTuner(hz: number): TunerReading {
  return tunerReadingFromTake(sine(hz), 44100, TUNER_PITCH_BAND);
}

/** Strip comments, so a comment that MENTIONS a behaviour cannot satisfy a guard. */
function maskComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
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

// ─── GUARD 1 — the listening window is short ────────────────────────────────

/** The window this fix set. A future change must stay AT OR UNDER it. */
export const TUNER_TAKE_BUDGET_MS = 400;

/**
 * Is the listening window short enough to feel like an answer rather than a wait?
 * Named and exported so the gate can run it against the real constant AND against
 * the value it replaced — a guard that can only be called with the current value
 * proves nothing.
 */
export function listeningWindowIsShort(ms: number): boolean {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 && ms <= TUNER_TAKE_BUDGET_MS;
}

function testTheListeningWindow(): void {
  console.log('\n— 1. the listening window —');

  assertEq(
    listeningWindowIsShort(TUNER_TAKE_MS),
    true,
    `the tuner listens for ${TUNER_TAKE_MS} ms before it decides (was 700)`,
  );
  assertEq(
    listeningWindowIsShort(700),
    false,
    'MUTATION: the 700 ms window this fix replaced fails the guard',
  );
  assertEq(listeningWindowIsShort(0), false, 'MUTATION: a zero-length take is not a short take');
  assertEq(listeningWindowIsShort(Number.NaN), false, 'MUTATION: a NaN window fails the guard');

  // A shorter window must still be LONG ENOUGH: the pitch engine analyses whole
  // 2048-sample windows and the reading rule takes the last TUNER_READING_FRAMES,
  // so the take has to yield at least that many frames or the tuner would go from
  // slow to silent.
  const framesFromTheShortTake = detectPitchFrames(sine(440), 44100, TUNER_PITCH_BAND);
  assert(
    framesFromTheShortTake.length >= TUNER_READING_FRAMES,
    `a ${TUNER_TAKE_MS} ms take still yields ${framesFromTheShortTake.length} frames (the reading needs ${TUNER_READING_FRAMES})`,
  );
  assert(
    (TUNER_TAKE_MS / 1000) * 44100 > DEFAULT_WINDOW_SAMPLES,
    'and it is longer than one analysis window, so there is a pitch to read at all',
  );

  // THE POINT OF THE CHANGE, END TO END: the strings the owner tunes are still
  // named, through the real engine, on the real (shorter) take.
  const a4 = readThroughTuner(440);
  assertEq(named(a4), 'A4', 'a 440 Hz take is still named A4 on the short take');
  assert(a4.kind === 'note' && Math.abs(a4.cents) <= 5, 'and it is still read in tune');
  const lowE = readThroughTuner(82.41);
  assertEq(named(lowE), 'E2', 'the guitar’s low E (82.41 Hz) is still named E2 on the short take');
  const dropD = readThroughTuner(73.4);
  assertEq(named(dropD), 'D2', 'drop-D (73.4 Hz) is still named D2 on the short take');
}

// ─── GUARD 2 — fewer stable frames name the note ────────────────────────────

/** The stable-frame count this fix set. A future change must stay AT OR UNDER it. */
export const TUNER_STABLE_FRAMES_BUDGET = 2;

/** Are few enough agreeing frames required that the tuner commits on a pluck? */
export function stableFramesRequiredIsFew(count: number): boolean {
  return (
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= TUNER_STABLE_FRAMES_BUDGET
  );
}

function testTheStableFrames(): void {
  console.log('\n— 2. the stable frames —');

  assertEq(
    stableFramesRequiredIsFew(TUNER_MIN_CONFIDENT_FRAMES),
    true,
    `${TUNER_MIN_CONFIDENT_FRAMES} agreeing frames name a note (was 3)`,
  );
  assertEq(
    stableFramesRequiredIsFew(3),
    false,
    'MUTATION: the 3-frame rule this fix replaced fails the guard',
  );
  assertEq(stableFramesRequiredIsFew(0), false, 'MUTATION: zero frames is not "few", it is nothing');
  assertEq(stableFramesRequiredIsFew(2.5), false, 'MUTATION: a fractional count fails the guard');

  // THE BEHAVIOUR: two agreeing frames now name the note…
  const twoFrames = tunerReadingFromFrames(frames(69, 2));
  assertEq(named(twoFrames), 'A4', 'two agreeing frames name the note');
  assertEq(
    twoFrames.kind === 'note' ? twoFrames.confidentFrames : 0,
    2,
    'and the reading says how few frames it came from',
  );
  // …and the PRE-FIX rule refused exactly that take, which is the wait this fix
  // removes.
  assertEq(
    tunerReadingFromFrames(frames(69, 2), { minConfidentFrames: 3 }).kind,
    'no-signal',
    'MUTATION: the old 3-frame rule names nothing from those same two frames',
  );

  // ONE frame is still not a note — the tuner does not guess from a single click.
  const oneFrame = tunerReadingFromFrames(frames(69, 1));
  assertEq(oneFrame.kind, 'no-signal', 'one frame is still not a note');
  assertEq(
    oneFrame.kind === 'no-signal' ? oneFrame.reason : '',
    'unclear',
    'and it says so as "unclear", not as a name',
  );
  // TWO DISAGREEING frames are still not a note: the agreement rule survives the
  // lower frame count, so a take spanning two strings is never named after either.
  const disagreeing = tunerReadingFromFrames([...frames(45, 1), ...frames(69, 1)]);
  assertEq(disagreeing.kind, 'no-signal', 'two frames a semitone or more apart name nothing');
}

// ─── GUARD 3 — the decide phase is alive ────────────────────────────────────

/**
 * Does the screen show a line that MOVES while it decides? Two facts are required,
 * and both are what a regression would remove: the screen renders the animated
 * line from the service (`tunerHearingLine(`), and a repeating timer advances it
 * (a `setInterval` whose body updates state). Comments are masked first, so a
 * comment describing the behaviour cannot satisfy the guard on its own.
 */
export function hearingStateIsLive(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.trim().length === 0) return false;
  const rendersTheLiveLine = src.indexOf('tunerHearingLine(') >= 0;
  const aTimerAdvancesIt = /setInterval\([^;]{0,160}set[A-Z]\w*\(/.test(src);
  return rendersTheLiveLine && aTimerAdvancesIt;
}

function testTheLiveState(): void {
  console.log('\n— 3. the live "hearing…" state —');

  // THE LINE ITSELF: it moves, it never empties, and it always says the word.
  assertEq(tunerHearingLine(0), 'Hearing.', 'the live line starts at one dot');
  assertEq(tunerHearingLine(1), 'Hearing..', 'and advances');
  assertEq(tunerHearingLine(2), 'Hearing...', 'and advances again');
  assertEq(tunerHearingLine(3), 'Hearing.', 'and wraps back round');
  assert(
    tunerHearingLine(0) !== tunerHearingLine(1),
    'consecutive ticks differ, so the line is visibly alive and not a frozen string',
  );
  assert(
    tunerHearingLine(0).indexOf(TUNER_HEARING_WORD) === 0 &&
      tunerHearingLine(1).indexOf(TUNER_HEARING_WORD) === 0,
    'every tick reads as the same word, so the meaning never flickers',
  );
  assert(
    tunerHearingLine(Number.NaN).indexOf(TUNER_HEARING_WORD) === 0 &&
      tunerHearingLine(-4).indexOf(TUNER_HEARING_WORD) === 0,
    'a nonsense tick still produces the line, never an empty or "undefined" one',
  );
  assert(
    TUNER_HEARING_LINE.indexOf(TUNER_HEARING_WORD) === 0 && TUNER_HEARING_LINE.length > 0,
    'the static line the accessibility label uses says the same word',
  );
  assert(
    TUNER_HEARING_TICK_MS > 0 && TUNER_HEARING_TICK_MS <= 500,
    `the dots advance every ${TUNER_HEARING_TICK_MS} ms — fast enough to look alive`,
  );

  // THE SCREEN: it renders that line from a timer while it decides.
  const screen = readAppFile(V39_TUNER_SCREEN_PATH);
  assert(screen.length > 4000, 'the real TunerScreen.tsx was read');
  assertEq(hearingStateIsLive(screen), true, 'TunerScreen shows a hearing line a timer advances');
  assert(
    screen.indexOf("'Reading that take…'") < 0,
    'and the old unchanging "Reading that take…" line is gone',
  );

  // THE GUARD MUST BITE: the same real source with the live line stripped back to
  // the static constant, then with the timer removed.
  const staticLine = screen.replace(/tunerHearingLine\(hearingTick\)/g, 'TUNER_HEARING_LINE');
  assert(staticLine !== screen, 'MUTATION: the live line could be stripped for the probe');
  assertEq(
    hearingStateIsLive(staticLine),
    false,
    'MUTATION: a screen showing one unchanging line fails the guard',
  );
  const noTimer = screen.replace(/setInterval\(/g, 'setTimeout(');
  assert(noTimer !== screen, 'MUTATION: the ticker could be removed for the probe');
  assertEq(
    hearingStateIsLive(noTimer),
    false,
    'MUTATION: a screen whose line never advances fails the guard',
  );
  // …and the guard must not pass on nothing, or on a comment.
  assertEq(hearingStateIsLive(''), false, 'MUTATION: an empty source fails the guard');
  assertEq(
    hearingStateIsLive('// the screen calls tunerHearingLine(hearingTick) on a setInterval\n'),
    false,
    'MUTATION: a comment that describes the behaviour is not the behaviour',
  );
}

// ─── Nothing else moved: the band and the note names ────────────────────────

function testNothingElseMoved(): void {
  console.log('\n— the pitch band and the note names are untouched —');
  assertEq(TUNER_PITCH_BAND.minFreqHz, 55, 'the tuner still searches from 55 Hz');
  assertEq(TUNER_PITCH_BAND.highPassHz, 45, 'the tuner high-pass is still 45 Hz');
  assertEq(TUNER_PITCH_BAND.maxFreqHz, 1200, 'the tuner keeps the 1200 Hz ceiling');
  assertEq(noteNameFromMidi(40)?.display, 'E2', 'MIDI 40 is still E2');
  assertEq(noteNameFromMidi(38)?.display, 'D2', 'MIDI 38 is still D2');
  assertEq(noteNameFromMidi(35)?.display, 'B1', 'MIDI 35 is still B1 (a 7-string’s low B)');
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testTheListeningWindow();
  testTheStableFrames();
  testTheLiveState();
  testNothingElseMoved();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
