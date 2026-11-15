/**
 * vc58NotesRegression.test.ts — THE vc57 HANDSET PASS'S NOTES-LANE ROWS (N1, C2/C3).
 *
 * The lead's order for this slice: PROVE frame-for-frame equality of the sliced
 * read on the same buffer FIRST, then fix. So section 1 is the proof (with the
 * DEFAULT clock and yield — the vc55 gate injected both, which is why it could not
 * see a device-only failure), and sections 2-4 are the two rules the row broke and
 * the source guards that keep them wired.
 *
 * Every guard is run again over MUTATED bytes and must FAIL there. A guard that
 * does not bite is worse than none.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  VC58_PITCH_PATH,
  VC58_SCREEN_PATH,
  VC58_SYNC_PATH,
  framesAreIdentical,
  maskComments,
  theBoundIsNotAVerdictOnTheMelody,
  theCoverageAxisKnowsTheMeasuredLength,
  theLaneNeverCallsAVerdictWhileReading,
} from '../src/services/vc58NotesRegressionContract';
import { detectPitchFrames, detectPitchFramesAsync } from '../src/services/pitchDetection';
import {
  VIDEO_NO_MELODY_LINE,
  VIDEO_NOTES_STILL_READING_LINE,
  VIDEO_NOTES_OUTSIDE_LINE,
  laneEmptyLine,
  noteCuesForVideo,
} from '../src/services/videoTakeSync';
import { notesCoverageLaneNotice } from '../src/services/notesCoverage';

declare const require: (name: string) => any;
const fs = require('fs');
const path = require('path');
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const ROOT = process.cwd();
let passes = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passes += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ ${label}`);
  }
}

function readRepoFile(relative: string): string {
  return String(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

/**
 * A REAL melody: eight plucked notes (C4 up to A4 and back), three harmonics, an
 * exponential decay per note and a noise floor under the RMS gate. Deterministic —
 * a fixed-seed PRNG, so the gate compares the same bytes on every run.
 */
function melodyBuffer(sampleRate: number, seconds: number): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const midis = [60, 62, 64, 65, 67, 69, 67, 64];
  const per = Math.floor(n / midis.length);
  let seed = 123456789;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < n; i++) {
    const idx = Math.min(midis.length - 1, Math.floor(i / per));
    const freq = 440 * Math.pow(2, (midis[idx] - 69) / 12);
    const t = (i % per) / sampleRate;
    const env = Math.exp(-2.2 * t) * (t < 0.01 ? t / 0.01 : 1);
    const sample =
      Math.sin(2 * Math.PI * freq * t) +
      0.5 * Math.sin(2 * Math.PI * 2 * freq * t) +
      0.25 * Math.sin(2 * Math.PI * 3 * freq * t);
    out[i] = 0.28 * env * sample + 0.002 * (rand() * 2 - 1);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE PRIME SUSPECT, MEASURED: the sliced read against the blocking read
// ─────────────────────────────────────────────────────────────────────────────

async function testTheSlicedReadIsTheSameRead(): Promise<void> {
  console.log('\n1. THE SLICED READ IS THE SAME READ (default clock, default yield)');

  const sampleRate = 22050;
  const samples = melodyBuffer(sampleRate, 8);

  const blocking = detectPitchFrames(samples, sampleRate);
  const sliced = await detectPitchFramesAsync(samples, sampleRate);

  assert(blocking.length > 0, `control: the melody buffer produces frames (${blocking.length})`);
  const voiced = blocking.filter((frame) => frame.midi !== null).length;
  assert(voiced > blocking.length * 0.5, `control: the buffer really is a melody (${voiced}/${blocking.length} frames voiced)`);

  assert(
    framesAreIdentical(blocking, sliced),
    `the sliced read returns the SAME frames as the blocking read (${sliced.length} frames, default setTimeout yield)`,
  );

  // The comparator itself must bite, or the assertion above proves nothing.
  const dropped = sliced.slice(1);
  const halfStep = sliced.map((frame, index) =>
    index === 40 ? { ...frame, midi: frame.midi === null ? 60 : frame.midi + 1 } : frame,
  );
  const empty = sliced.map((frame) => ({ ...frame, midi: null }));
  assert(!framesAreIdentical(blocking, dropped), 'the comparator bites: a read that dropped a frame is rejected');
  assert(!framesAreIdentical(blocking, halfStep), 'the comparator bites: a read that moved one pitch is rejected');
  assert(!framesAreIdentical(blocking, empty), 'the comparator bites: a read that voiced nothing is rejected');

  // And the vc54 shape the handset row is about: a take whose melody IS readable
  // must not come back empty. This is the whole of N1 in one line.
  assert(
    sliced.filter((frame) => frame.midi !== null).length === voiced,
    'a melody take reads the SAME number of voiced frames through the sliced path — it cannot come back "no melody"',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. R1 — "no melody was heard" is a verdict, not a loading state
// ─────────────────────────────────────────────────────────────────────────────

function testTheLaneDoesNotVerdictWhileReading(): void {
  console.log('\n2. THE LANE DOES NOT PRONOUNCE WHILE THE READ IS RUNNING');

  const emptySet = noteCuesForVideo(null, { videoDurationSec: 30 });
  const outsideSet = noteCuesForVideo(
    { notes: [{ midi: 60, startSec: 90, durationSec: 1 }], tempoBpm: 120, durationSec: 91, key: null, capturedAt: '' } as any,
    { videoDurationSec: 30 },
  );

  assert(
    laneEmptyLine(emptySet, true) === VIDEO_NOTES_STILL_READING_LINE,
    'a take still being read says it is READING — the exact sentence the owner saw on vc57 is not spoken',
  );
  assert(
    laneEmptyLine(emptySet, true) !== VIDEO_NO_MELODY_LINE,
    'and it is NOT "No melody was heard in this take." (N1)',
  );
  assert(
    laneEmptyLine(emptySet, false) === VIDEO_NO_MELODY_LINE,
    'once the read has finished and produced nothing, the honest verdict IS spoken',
  );
  assert(
    laneEmptyLine(outsideSet, false) === VIDEO_NOTES_OUTSIDE_LINE,
    'a take WITH notes that fall outside the window still gets its own sentence (vc54/defect 2)',
  );
  assert(
    laneEmptyLine(outsideSet, true) === VIDEO_NOTES_STILL_READING_LINE,
    'while reading, even that sentence waits — the lane has no facts yet',
  );
  const drawn = noteCuesForVideo(
    { notes: [{ midi: 60, startSec: 1, durationSec: 1 }], tempoBpm: 120, durationSec: 2, key: null, capturedAt: '' } as any,
    { videoDurationSec: 30 },
  );
  assert(laneEmptyLine(drawn, false) === null, 'a lane with cues says nothing at all (it draws them)');
  assert(laneEmptyLine(drawn, true) === null, 'and a lane with cues says nothing even mid-read');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. R3 — C2/C3: the coverage notice has an axis with no notes
// ─────────────────────────────────────────────────────────────────────────────

function testTheCoverageNoticeHasAnAxis(): void {
  console.log('\n3. THE COVERAGE NOTICE HAS AN AXIS EVEN WITH NO NOTES (C2/C3)');

  const noTake = noteCuesForVideo(null, { videoDurationSec: 0, fallbackDurationSec: 125 });
  assert(noTake.timelineSec === 125, `an unread take on a 125 s filming has a 125 s axis (got ${noTake.timelineSec})`);
  assert(
    notesCoverageLaneNotice(noTake.timelineSec) !== null,
    'so the lane states the coverage limit while there are still no cues (the row C2/C3 came back on)',
  );

  const inside = noteCuesForVideo(null, { videoDurationSec: 0, fallbackDurationSec: 42 });
  assert(inside.timelineSec === 42, 'a filming inside the coverage keeps its measured length');
  assert(
    notesCoverageLaneNotice(inside.timelineSec) === null,
    'and a take inside the coverage says nothing — a limit the user does not have is not worth a line',
  );

  const stored = noteCuesForVideo(null, { videoDurationSec: 30, fallbackDurationSec: 125 });
  assert(
    stored.timelineSec === 30,
    'a STORED video length still wins over the session measurement — one axis, no second opinion',
  );

  const withTake = noteCuesForVideo(
    { notes: [{ midi: 60, startSec: 1, durationSec: 2 }], tempoBpm: 120, durationSec: 3, key: null, capturedAt: '' } as any,
    { videoDurationSec: 0, fallbackDurationSec: 20 },
  );
  assert(withTake.timelineSec === 20, 'the take span and the measurement agree on one axis (largest wins)');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE WIRING, read out of the real files, then mutated
// ─────────────────────────────────────────────────────────────────────────────

function testTheWiring(): void {
  console.log('\n4. THE WIRING (real source)');

  const screen = readRepoFile(VC58_SCREEN_PATH);
  const sync = readRepoFile(VC58_SYNC_PATH);
  const pitch = readRepoFile(VC58_PITCH_PATH);

  assert(
    theLaneNeverCallsAVerdictWhileReading(screen),
    'R1 wired: the lane’s empty sentence is decided by the in-flight read (laneEmptyLine(cueSet, takeBusy))',
  );
  assert(
    theBoundIsNotAVerdictOnTheMelody(screen),
    'R2 wired: the bound resolves to "still reading" and the read is applied when it lands',
  );
  assert(
    theCoverageAxisKnowsTheMeasuredLength(screen),
    'R3 wired: the cue timeline is handed the measured filming length',
  );
  assert(
    sync.indexOf('VIDEO_NOTES_STILL_READING_LINE') >= 0,
    'the reading sentence lives in the sync model, next to the verdict it must not impersonate',
  );
  assert(
    pitch.indexOf('export async function detectPitchFramesAsync(') >= 0,
    'the sliced read still exists (the fix is the verdict, not the slicing — D23 stays fixed)',
  );
}

function testTheGuardsBite(): void {
  console.log('\n5. THE GUARDS BITE (mutated real source)');

  const screen = readRepoFile(VC58_SCREEN_PATH);

  // (a) R1 reverted to the vc57 shape: the lane decides from the cue set alone.
  const vc57Shape = screen.split('laneEmptyLine(cueSet, takeBusy)').join('videoCueEmptyLine(cueSet)');
  assert(vc57Shape !== screen, 'control: the lane call can be reverted in memory');
  assert(
    theLaneNeverCallsAVerdictWhileReading(vc57Shape) === false,
    'GUARD 1 bites: the vc57 lane call (a verdict while reading) is rejected — N1 comes back',
  );

  // (b) R2 reverted: the bound turns into a no-melody verdict again.
  const verdictAtTheBound = screen.replace(
    'settleWithin(read, TAKE_DECODE_TIMEOUT_MS, null)',
    'settleWithin(read, TAKE_DECODE_TIMEOUT_MS, { take: null, unavailable: true, message: VIDEO_TAKE_STILL_READING_LINE })',
  );
  assert(verdictAtTheBound !== screen, 'control: the bound can be reverted in memory');
  assert(
    theBoundIsNotAVerdictOnTheMelody(verdictAtTheBound) === false,
    'GUARD 2 bites: a bound that resolves to a null take (a verdict) is rejected',
  );

  // (c) R2's late landing removed: the read is thrown away at the bound.
  const noLate = screen.split('applyDerivedTake(late)').join('undefined');
  assert(
    theBoundIsNotAVerdictOnTheMelody(noLate) === false,
    'GUARD 2 bites: a screen that never applies the late read is rejected',
  );

  // (d) R3 reverted: the axis falls back to the take span alone.
  const noMeasured = screen.split('fallbackDurationSec: measuredTakeSec').join('fallbackDurationSec: 0');
  assert(
    theCoverageAxisKnowsTheMeasuredLength(noMeasured) === false,
    'GUARD 3 bites: an axis that ignores the measured length is rejected — C2/C3 comes back',
  );

  // (e) THE COMMENT TRAP (defect class 14): the guard must read CODE, not prose.
  const inAComment = `// laneEmptyLine(cueSet, takeBusy)\n/* videoCueEmptyLine(cueSet) */\nconst nothing = 1;\n`;
  assert(
    theLaneNeverCallsAVerdictWhileReading(inAComment) === false,
    'GUARD 1 bites on a screen whose only match is inside a COMMENT (a probe must skip comments)',
  );
  assert(
    maskComments('const a = 1; // videoCueEmptyLine(cueSet)\n').indexOf('videoCueEmptyLine') < 0,
    'the masker really removes a line comment',
  );
  assert(
    maskComments('/* x */ const b = 2;').indexOf('const b = 2;') >= 0,
    'and it keeps the code beside it',
  );
}

async function main(): Promise<void> {
  await testTheSlicedReadIsTheSameRead();
  testTheLaneDoesNotVerdictWhileReading();
  testTheCoverageNoticeHasAnAxis();
  testTheWiring();
  testTheGuardsBite();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    failures.forEach((label) => console.error(`  FAILED: ${label}`));
    process.exit(1);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
