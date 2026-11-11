/**
 * vc55NotesLaneTimeline.test.ts — THE NOTES LANE'S AXIS, PINNED (vc55).
 *
 * THE OWNER, vc53 handset pass (2026-11-11): "Does not show anything in the piano
 * bar - says 'No notes to draw - there was no readable melody in this take'. I
 * have tried x3 takes."
 *
 * WHAT WAS ACTUALLY WRONG. The lane is handed two things: the cues, and a length
 * for its x-axis. The cues come from `noteCuesForVideo`, which - since vc54 -
 * falls back to the TAKE'S OWN SPAN when the video's stored length is unknown,
 * and returns that timeline as `timelineSec`. The screen then handed both lanes
 * `videoDurationSec={Math.max(0, Number(ref?.durationSec) || 0)}` - the stored
 * number the cue builder had just had to fall back FROM. `overlayLayout` places
 * nothing on a zero-length axis (`if (duration <= 0) return;`), so on a row whose
 * length was never stored the notes arrived at the lane and died at the pixel:
 * no note, no sentence (vc54), an empty "piano bar".
 *
 * Two different answers to one question - "how long is this timeline" - and the
 * pixels took the one that can be zero. The fix is one answer: the lane draws on
 * `cueSet.timelineSec`, which IS the axis the cues were computed on.
 *
 * THIS SUITE PINS BOTH HALVES:
 *   • the pure mechanism (a zero axis draws nothing; the cue timeline draws every
 *     note) - so the defect is reproducible without a handset;
 *   • the WIRING, read from the real screen text - so the two can never disagree
 *     again, on either lane (watch page and full-screen notes window).
 *
 * EVERY source guard is proven to bite IN THIS SUITE by mutating the real bytes in
 * memory and re-running the same guard (the repo's guard-mutation convention), and
 * the same mutation was run ON DISK against the compiled gate - the failing line
 * is in the PR body.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  VC55_LANE_PATH,
  VC55_SCREEN_PATH,
  aZeroAxisDrawsNothingEvenWithCues,
  everyLaneChoosesItsSentenceFromTheModel,
  everyLaneDrawsOnTheCueTimeline,
  laneElements,
  noLaneIsFedTheStoredVideoLength,
  takeSpanIsTheTimelineWhenTheVideoHasNoLength,
  theLaneRendersEveryNoteItemItIsGiven,
} from '../src/services/notesLaneTimelineContract';

declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SCREEN = String(fs.readFileSync(path.join(ROOT, VC55_SCREEN_PATH), 'utf8'));
const LANE = String(fs.readFileSync(path.join(ROOT, VC55_LANE_PATH), 'utf8'));

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

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE MECHANISM — a zero axis draws nothing, the cue timeline draws the take
// ─────────────────────────────────────────────────────────────────────────────

function testTheMechanism(): void {
  console.log('\nTHE MECHANISM (pure)');
  assert(
    takeSpanIsTheTimelineWhenTheVideoHasNoLength(),
    'a take of 3 notes on a video with no stored length keeps all 3 cues and carries the take span as its timeline',
  );
  assert(
    aZeroAxisDrawsNothingEvenWithCues(),
    'the SAME cues draw 0 notes on a zero-length axis and all 3 on the timeline the cue builder returned',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE WIRING — read from the real screen
// ─────────────────────────────────────────────────────────────────────────────

function testTheWiring(): void {
  console.log('\nTHE WIRING (real source)');

  const lanes = laneElements(SCREEN);
  assert(lanes.length === 2, `the screen renders the lane on both surfaces (found ${lanes.length}: watch page + full-screen notes window)`);

  assert(
    everyLaneDrawsOnTheCueTimeline(SCREEN),
    'EVERY lane is handed the cue timeline: videoDurationSec={cueSet.timelineSec}',
  );
  assert(
    noLaneIsFedTheStoredVideoLength(SCREEN),
    'NO lane is handed the stored video length (ref?.durationSec), which is 0 when it was never stored',
  );
  assert(
    everyLaneChoosesItsSentenceFromTheModel(SCREEN),
    'EVERY lane takes its empty sentence from the surface (emptyLine={cueEmptyLine}), never from the lane itself',
  );
  assert(
    theLaneRendersEveryNoteItemItIsGiven(LANE),
    'the lane renders every note item in the draw list, and shows its sentence only when it has no cues at all',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE GUARDS BITE — the same real bytes, mutated, must fail
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardsBite(): void {
  console.log('\nTHE GUARDS BITE (mutated real source)');

  // The regression exactly as it shipped: the axis went back to the stored length.
  const revertedAxis = SCREEN.split('videoDurationSec={cueSet.timelineSec}').join(
    'videoDurationSec={Math.max(0, Number(ref?.durationSec) || 0)}',
  );
  assert(revertedAxis !== SCREEN, 'the axis can be reverted in memory (control: the mutation applies)');
  assert(
    everyLaneDrawsOnTheCueTimeline(revertedAxis) === false,
    'GUARD 1 bites: the lane fed the stored length is rejected',
  );
  assert(
    noLaneIsFedTheStoredVideoLength(revertedAxis) === false,
    'GUARD 2 bites: a lane fed ref?.durationSec is rejected',
  );

  // The fix applied to one surface only — the class this repo has shipped before.
  const firstLane = SCREEN.indexOf('videoDurationSec={cueSet.timelineSec}');
  const halfFixed =
    SCREEN.slice(0, firstLane) +
    'videoDurationSec={Math.max(0, Number(ref?.durationSec) || 0)}' +
    SCREEN.slice(firstLane + 'videoDurationSec={cueSet.timelineSec}'.length);
  assert(
    everyLaneDrawsOnTheCueTimeline(halfFixed) === false,
    'GUARD 1 bites: a half-fixed screen (one lane right, one wrong) is rejected',
  );

  // The sentence taken back into the lane.
  const laneWithoutTheSentence = SCREEN.split('emptyLine={cueEmptyLine}').join('');
  assert(
    everyLaneChoosesItsSentenceFromTheModel(laneWithoutTheSentence) === false,
    'GUARD 3 bites: a lane that chooses its own sentence is rejected',
  );

  // A screen that stopped rendering the lane at all must not pass vacuously.
  assert(
    everyLaneDrawsOnTheCueTimeline('const nothing = 1;') === false,
    'GUARD 1 bites: a screen with no lane at all is rejected, not passed vacuously',
  );

  // A renderer that grew its own filter over the draw list.
  const filteredLane = LANE.split('.filter((item) => item.kind === \'note\')').join(
    '.filter((item) => item.kind === \'note\' && videoDurationSec > 0)',
  );
  assert(
    filteredLane !== LANE && theLaneRendersEveryNoteItemItIsGiven(filteredLane) === false,
    'GUARD 6 bites: a lane that filters its own notes by a length is rejected',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

testTheMechanism();
testTheWiring();
testTheGuardsBite();

console.log(`\n${passes} passed, ${failures} failed (${passes + failures} checks)`);
if (failures > 0) process.exit(1);
