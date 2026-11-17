/**
 * vc60TakeStaffAndLane.test.ts — THE TAKE'S STAFF, AND THE LANE'S HONEST SENTENCES.
 *
 * FOUR GUARDS, EACH RUN AGAIN OVER MUTATED REAL BYTES AND REQUIRED TO FAIL THERE:
 *
 *   GUARD 1 — the take's staves are whole-work, get the viewport, and carry the
 *             honest length line (owner: "hum/sing shows only ~4 bars").
 *   GUARD 2 — the practice-video page takes its sentence from the FACTS
 *             (takeReadVerdict.ts), so a failed decode cannot print the melody
 *             verdict again — the vc60 lie.
 *   GUARD 3 — the lane's own empty sentence is still its fallback
 *             (`?? OVERLAY_EMPTY_LINE`). NOTHING asserted this before vc60: deleting
 *             the fallback rendered `<Text>{null}</Text>` and every suite stayed green.
 *   GUARD 4 — the level gate: the recorder's own metering, then the decoder's peak,
 *             and never a file-size or duration check.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  theLaneKeepsItsEmptySentence,
  theSurfacePicksItsSentence,
  takeStaffShowsTheWholeTake,
} from '../src/services/vc60Contract';
import {
  TAKE_DECODE_FAILED_LINE,
  TAKE_NO_SOUND_LINE,
  TAKE_SOUND_FLOOR_DBFS,
  levelIsNoSound,
  peakDbFromAmplitude,
  takeLevelDbFS,
  takeReadLine,
  takeReadOutcome,
} from '../src/services/takeReadVerdict';
import { VIDEO_NO_MELODY_LINE, laneEmptyLine } from '../src/services/videoTakeSync';
import { OVERLAY_EMPTY_LINE } from '../src/services/videoOverlayLayout';

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
    console.error(`  ✗ ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const same = actual === expected;
  assert(same, same ? label : `${label} (got ${String(actual)}, wanted ${String(expected)})`);
}

function readRepoFile(relative: string): string {
  return String(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

const CARD = readRepoFile('src/components/TakeStaffCard.tsx');
const SCREEN = readRepoFile('src/screens/PracticeVideoScreen.tsx');
const EXPORT = readRepoFile('src/services/captureMidiExport.ts');

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE TAKE'S STAFF
// ─────────────────────────────────────────────────────────────────────────────

function testTheStaff(): void {
  console.log('\nTHE TAKE\u2019S STAFF SHOWS THE WHOLE TAKE, AND SAYS HOW LONG IT IS');

  assert(
    takeStaffShowsTheWholeTake(CARD),
    'GUARD 1: both staves are whole-work, both get the viewport, and the length line is the take\u2019s own',
  );
  // Controls: the card really is the two-staff surface, so the guard reads a live file.
  assert(
    CARD.indexOf('<AbcScoreView') >= 0 && CARD.indexOf('<ScoreLengthLine') >= 0,
    'control: the card renders the app\u2019s own viewer and the app\u2019s own length line',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE LANE'S SENTENCES
// ─────────────────────────────────────────────────────────────────────────────

function testTheSentences(): void {
  console.log('\nTHE PRACTICE-VIDEO PAGE SPEAKS THE FACTS, NOT A TERNARY');

  assert(
    theSurfacePicksItsSentence(SCREEN),
    'GUARD 2: the verdict goes through takeReadVerdict (unavailable / decode-failed / no-sound / no-melody)',
  );
  assert(
    theLaneKeepsItsEmptySentence(SCREEN),
    'GUARD 3: the lane\u2019s empty sentence is still the fallback it draws with',
  );
  // The lane's fallback is REACHABLE: a lane with cues has no sentence of its own.
  assertEq(
    laneEmptyLine({ cues: [{ index: 0, midi: 60, startSec: 0, endSec: 1 }], inVideoCount: 1, droppedCount: 0, totalCount: 1, droppedReason: null, timelineSec: 1 } as any, false),
    null,
    'GUARD 3 control: a lane with cues draws no sentence, so the fallback is what an EMPTY lane shows',
  );
  assert(
    OVERLAY_EMPTY_LINE.length > 0 && String(OVERLAY_EMPTY_LINE) !== String(VIDEO_NO_MELODY_LINE),
    'GUARD 3 control: the fallback is a real sentence of its own, not the melody verdict repeated',
  );

  // THE FOUR VERDICTS, in the one order they may be decided.
  assertEq(takeReadOutcome({ unavailable: true, decodeFailed: true, noSound: true }), 'unavailable', 'a build with no reader outranks everything');
  assertEq(takeReadOutcome({ decodeFailed: true, noSound: true }), 'decode-failed', 'a failed decode outranks "no sound"');
  assertEq(takeReadOutcome({ noSound: true }), 'no-sound', 'a take with no sound is its own verdict');
  assertEq(takeReadOutcome({}), 'no-melody', 'the melody verdict is the last resort, not the first');
  assertEq(takeReadLine('no-melody'), VIDEO_NO_MELODY_LINE, 'the melody verdict is the LANE\u2019s own sentence');
  assertEq(takeReadLine('decode-failed'), TAKE_DECODE_FAILED_LINE, 'a failed decode has its own sentence');
  assertEq(takeReadLine('no-sound'), TAKE_NO_SOUND_LINE, 'a take of nothing has its own sentence');
  assert(
    String(TAKE_DECODE_FAILED_LINE) !== String(VIDEO_NO_MELODY_LINE) && String(TAKE_NO_SOUND_LINE) !== String(VIDEO_NO_MELODY_LINE),
    'control: the three sentences are three different sentences',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LEVEL GATE
// ─────────────────────────────────────────────────────────────────────────────

function testTheLevelGate(): void {
  console.log('\nTHE LEVEL GATE: THE METERING FIRST, THE DECODER\u2019S PEAK SECOND');

  assertEq(TAKE_SOUND_FLOOR_DBFS, -45, 'the floor is \u2248 \u221245 dBFS, in ONE constant');
  assert(levelIsNoSound(-60), 'a take metered at \u221260 dBFS holds no sound');
  assert(!levelIsNoSound(-20), 'a take metered at \u221220 dBFS holds sound');
  assert(!levelIsNoSound(null), 'an UNMEASURED take is never called sound-less');
  assertEq(peakDbFromAmplitude(1), 0, 'a full-scale peak is 0 dBFS');
  assertEq(Math.round(peakDbFromAmplitude(0.01) as number), -40, 'a 0.01 peak is \u221240 dBFS');
  assertEq(peakDbFromAmplitude(0), Number.NEGATIVE_INFINITY, 'a zero peak is digital nothing');
  assertEq(takeLevelDbFS({ meteredDbFS: -12, decodedPeak: 0 }), -12, 'the recorder\u2019s metering wins when it exists');
  assertEq(Math.round(takeLevelDbFS({ meteredDbFS: null, decodedPeak: 0.001 }) as number), -60, 'the decoder\u2019s peak is the fallback');
  assertEq(takeLevelDbFS({ meteredDbFS: null, decodedPeak: null }), null, 'no measurement at all is null, never a verdict');

  // THE SEAM ITSELF: the gate exists, and it is the level — not the file size.
  assert(
    EXPORT.indexOf('levelIsNoSound(meteredLevel)') >= 0 &&
      EXPORT.indexOf('captured?.peak') >= 0 &&
      EXPORT.indexOf('decodeFailed: true') >= 0,
    'the ONE decode path gates on the level and marks a failed decode as its own fact',
  );
  assert(
    !/hasNonEmptyFile|sizeBytes\s*>|durationSec\s*<\s*1/.test(EXPORT),
    'the gate uses NO file-size or duration check (a quiet .m4a has a normal size)',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE GUARDS BITE
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardsBite(): void {
  console.log('\nTHE GUARDS BITE (mutated real source)');

  // (a) GUARD 1: the whole-work treatment dropped from the take's staves — the vc58
  //     shape, where the box clipped at its floor and nothing could scroll.
  const noWholeWork = CARD.split('              wholeWork\n').join('');
  assert(
    noWholeWork !== CARD && takeStaffShowsTheWholeTake(noWholeWork) === false,
    'GUARD 1 bites: a take staff without wholeWork is rejected',
  );

  // (b) GUARD 1: the length line removed — the owner cannot tell a short take from a
  //     clipped one.
  const noLength = CARD.replace(
    "          <ScoreLengthLine abc={rows.rawAbc ?? ''} style={styles.lengthLine} />\n",
    '',
  );
  assert(
    noLength !== CARD && takeStaffShowsTheWholeTake(noLength) === false,
    'GUARD 1 bites: a staff with no honest length line is rejected',
  );

  // (c) GUARD 1: a TYPED length printed on the card (a length the music did not give).
  const typedLength = CARD.replace(
    "          <ScoreLengthLine abc={rows.rawAbc ?? ''} style={styles.lengthLine} />",
    "          <Text style={styles.honesty}>{'Bars 1\u20134 of 4'}</Text>",
  );
  assert(
    typedLength !== CARD && takeStaffShowsTheWholeTake(typedLength) === false,
    'GUARD 1 bites: a typed bar count is rejected',
  );

  // (d) GUARD 2: the vc60 lie put back — the ternary that sent a failed decode to
  //     the melody verdict.
  const lieBack = SCREEN.replace(
    'takeReadLine(takeReadOutcome(derived), {',
    'derived.unavailable ? derived.message ?? VIDEO_TAKE_FAILED_LINE : VIDEO_NO_MELODY_LINE || (takeReadLine(takeReadOutcome(derived), {',
  );
  assert(
    lieBack !== SCREEN && theSurfacePicksItsSentence(lieBack) === false,
    'GUARD 2 bites: the old ternary landing on the melody verdict is rejected',
  );

  // (e) GUARD 2: the screen stops asking the verdict module at all.
  // vc61 renders the reader on a SECOND surface too, so every occurrence has to go
  // — replacing the first match alone leaves the guard's subject in place.
  const noChooser = SCREEN.split('takeReadLine(takeReadOutcome(derived)').join('derived.message ?? (derived');
  assert(
    noChooser !== SCREEN && theSurfacePicksItsSentence(noChooser) === false,
    'GUARD 2 bites: a surface that decides its own sentence is rejected',
  );

  // (f) GUARD 3: the lane's fallback deleted — the shape that rendered <Text>{null}</Text>
  //     while every suite stayed green.
  const noFallback = SCREEN.replace(
    'laneEmptyLine(cueSet, takeBusy) ?? OVERLAY_EMPTY_LINE',
    'laneEmptyLine(cueSet, takeBusy)',
  );
  assert(
    noFallback !== SCREEN && theLaneKeepsItsEmptySentence(noFallback) === false,
    'GUARD 3 bites: an empty lane with no sentence of its own is rejected',
  );

  // (g) GUARD 3: the sentence computed but never handed to the lane.
  const notHandedOver = SCREEN.split('emptyLine={cueEmptyLine}').join('emptyLine={null}');
  assert(
    notHandedOver !== SCREEN && theLaneKeepsItsEmptySentence(notHandedOver) === false,
    'GUARD 3 bites: a lane that is not given the sentence is rejected',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testTheStaff();
  testTheSentences();
  testTheLevelGate();
  testTheGuardsBite();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
