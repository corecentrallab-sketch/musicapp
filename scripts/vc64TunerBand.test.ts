/**
 * vc64TunerBand.test.ts — THE TUNER GETS ITS OWN PITCH BAND (vc64).
 *
 * THE DEFECT: the melody band was added to the pitch engine for hum takes — an
 * 80 Hz search floor and an 85 Hz high-pass, so a take's handling noise and room
 * rumble stop winning the pitch vote (D39). The tuner reads through the same
 * seam, so it inherited that band: a guitar in drop-D (73.4 Hz) and a 7-string's
 * low B (61.7 Hz) sit UNDER the melody floor and the tuner stopped naming them.
 *
 * WHAT THIS SUITE PINS:
 *
 *   1. THE BAND — `TUNER_PITCH_BAND` searches from 55 Hz with a 45 Hz high-pass
 *      and the same 1200 Hz ceiling, and the MELODY defaults are untouched
 *      (80 Hz floor, 85 Hz high-pass). Narrowing the tuner band back to the
 *      melody band fails here by name.
 *   2. THE NOTE — a synthesised 73.4 Hz take read through the tuner seam
 *      (`tunerReadingFromTake`) with that band comes back as D2, and a 61.7 Hz
 *      take comes back as B1. The same tone read with the melody band does NOT
 *      read D2 — which is exactly the regression this suite exists to catch.
 *   3. NO COLLATERAL — the strings the tuner already named (low E 82.41 Hz,
 *      A3 220 Hz, A4 440 Hz) still read in tune under the tuner band.
 *   4. THE CALL SITE — the screen passes that band to the seam. A guard reads
 *      the real TunerScreen.tsx and is shown to BITE on a copy that drops the
 *      third argument, so a future edit cannot quietly put the melody band back.
 *
 * Plain Node, no react-native, no microphone, no network. Run: npm run test:tier1
 */
import {
  DEFAULT_MIN_FREQ_HZ,
  HIGHPASS_CUTOFF_HZ,
} from '../src/services/pitchDetection';
import {
  TUNER_PITCH_BAND,
  TUNER_TAKE_MS,
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

/** A pure sine take at the tuner's own take length — deterministic, no noise. */
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

// ─── 1. The band, and the melody band it must not touch ─────────────────────

function testTheBand(): void {
  console.log('\n— the tuner’s own band —');
  assertEq(TUNER_PITCH_BAND.minFreqHz, 55, 'the tuner searches from 55 Hz (below a 7-string’s low B)');
  assertEq(TUNER_PITCH_BAND.highPassHz, 45, 'the tuner’s high-pass is 45 Hz (a plucked low string passes)');
  assertEq(TUNER_PITCH_BAND.maxFreqHz, 1200, 'the tuner keeps the 1200 Hz ceiling');

  // The melody band is the reason this exists, and it must NOT move: hum takes
  // still need the room kept out of the pitch vote.
  assertEq(DEFAULT_MIN_FREQ_HZ, 80, 'the MELODY floor is untouched at 80 Hz');
  assertEq(HIGHPASS_CUTOFF_HZ, 85, 'the MELODY high-pass is untouched at 85 Hz');

  // The band must actually contain the notes it is for, with room either side.
  assert(
    (TUNER_PITCH_BAND.minFreqHz as number) < 61.7 && (TUNER_PITCH_BAND.minFreqHz as number) < 73.4,
    'the floor sits below both drop-D (73.4 Hz) and low B (61.7 Hz)',
  );
  assert(
    (TUNER_PITCH_BAND.highPassHz as number) < 61.7,
    'the high-pass sits below low B, so the fundamental survives',
  );
}

// ─── 2. The note: drop-D and low B through the tuner seam ───────────────────

function testTheLowTunings(): void {
  console.log('\n— drop-D and a 7-string’s low B, through the tuner seam —');

  const dropD = readThroughTuner(73.4);
  assertEq(dropD.kind, 'note', 'a 73.4 Hz take is named at all');
  assertEq(named(dropD), 'D2', 'a 73.4 Hz take reads D2 (drop-D)');
  assert(
    dropD.kind === 'note' && Math.abs(dropD.cents) <= 5,
    'and it reads in tune, not sharp or flat',
  );
  assert(
    dropD.kind === 'note' && Math.abs(dropD.frequencyHz - 73.4) <= 1,
    `and the reported frequency is the string's (${dropD.kind === 'note' ? dropD.frequencyHz : 0} Hz)`,
  );

  const lowB = readThroughTuner(61.7);
  assertEq(named(lowB), 'B1', 'a 61.7 Hz take reads B1 (7-string low B)');
  assert(lowB.kind === 'note' && Math.abs(lowB.cents) <= 5, 'and low B reads in tune');

  // THE REGRESSION ITSELF: with the melody band (no options), the same take does
  // not read D2. If the tuner's band is ever narrowed back to the melody band,
  // the assertions above fail — and this one names why.
  const melodyBand = tunerReadingFromTake(sine(73.4), 44100);
  assert(
    named(melodyBand) !== 'D2',
    `the melody band does NOT read drop-D (it reads ${named(melodyBand) || 'nothing'}) — which is why the tuner carries its own`,
  );
}

// ─── 3. No collateral: what the tuner already named still reads ─────────────

function testNothingElseMoved(): void {
  console.log('\n— the strings that already read still read —');
  const lowE = readThroughTuner(82.41);
  assertEq(named(lowE), 'E2', 'a guitar’s low E (82.41 Hz) is still E2');
  const a3 = readThroughTuner(220);
  assertEq(named(a3), 'A3', '220 Hz is still A3');
  const a4 = readThroughTuner(440);
  assertEq(named(a4), 'A4', '440 Hz is still A4');
  assert(a4.kind === 'note' && Math.abs(a4.cents) <= 5, 'and A4 is still in tune');

  const silence = tunerReadingFromTake(new Float32Array(44100), 44100, TUNER_PITCH_BAND);
  assertEq(silence.kind, 'no-signal', 'silence is still an honest no-signal with the tuner band');
}

// ─── 4. The call site really passes the band ────────────────────────────────

/**
 * Does the screen hand the tuner band to the seam? Whitespace- and name-tolerant
 * on purpose (defect class 13: a guard keyed to exact source text dies when the
 * text is rewritten) — but it fails the moment the third argument is dropped,
 * which is the regression that matters.
 */
export function callSiteCarriesTheTunerBand(screenSource: string): boolean {
  // Comments are masked first, so a comment that MENTIONS the band cannot satisfy
  // the guard on its own.
  const src = screenSource
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  return /tunerReadingFromTake\([^)]*TUNER_PITCH_BAND/.test(src);
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

function testTheCallSite(): void {
  console.log('\n— the screen passes the tuner band to the seam —');
  const screen = readAppFile(V39_TUNER_SCREEN_PATH);
  assert(screen.length > 4000, 'the real TunerScreen.tsx was read');

  assertEq(callSiteCarriesTheTunerBand(screen), true, 'TunerScreen passes TUNER_PITCH_BAND to tunerReadingFromTake');
  assert(
    /import[\s\S]{0,600}TUNER_PITCH_BAND[\s\S]{0,600}from '\.\.\/services\/tuner'/.test(screen),
    'and it takes the band from the tuner service, not a local copy',
  );

  // THE GUARD MUST BITE: the same real source with the band argument removed.
  const withoutBand = screen.replace(/tunerReadingFromTake\(([^)]*?), TUNER_PITCH_BAND\)/, 'tunerReadingFromTake($1)');
  assert(withoutBand !== screen, 'MUTATION: the call site could be stripped for the probe');
  assertEq(
    callSiteCarriesTheTunerBand(withoutBand),
    false,
    'MUTATION: a screen that drops the band fails the guard',
  );
  // …and a guard must not pass on nothing.
  assertEq(callSiteCarriesTheTunerBand(''), false, 'MUTATION: an empty source fails the guard');
  assertEq(
    callSiteCarriesTheTunerBand('// tunerReadingFromTake(samples, rate, TUNER_PITCH_BAND)\n'),
    false,
    'MUTATION: a comment that names the band is not a call',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testTheBand();
  testTheLowTunings();
  testNothingElseMoved();
  testTheCallSite();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
