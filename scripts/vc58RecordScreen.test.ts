/**
 * vc58RecordScreen.test.ts — THE RECORD SCREEN: THE COPY AND THE STOP BUTTON (vc58).
 *
 * THE OWNER'S vc57 PASS (11-13) produced two asks on this one screen:
 *   • the 60-second line was in the shipped bundle and was never SEEN (C1);
 *   • the copy changes, verbatim, and the red Stop moved under the Flip while
 *     filming (items 2 and 3).
 *
 * THIS SUITE PINS:
 *   1. THE COPY — the live constants are the owner's words, every kept line is
 *      rendered from its constant, and every deleted sentence is gone from both the
 *      live copy and the rendered screen;
 *   2. THE COVERAGE LINE'S PLACEMENT — one render, above the camera, as a bare
 *      sibling: on screen without scrolling, not behind a conditional;
 *   3. THE STOP BUTTON'S POSITION — under the Flip row, above the recording block,
 *      and only while recording.
 *
 * EVERY GUARD IS RUN AGAIN OVER MUTATED REAL BYTES AND MUST FAIL THERE. A guard that
 * does not bite is worse than none — and the guard that shipped this defect (a
 * count of `{NOTES_COVERAGE_RECORD_LINE}` occurrences) is the proof: it was green
 * while the line was invisible.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  theRecordBodyShowsTheLimitAboveTheCamera,
  maskCommentsKeepingLines,
} from '../src/services/notesCoverage';
import {
  VC58_SCREEN_PATH,
  theRecordScreenSaysOnlyTheOwnersCopy,
  theStopButtonSitsUnderTheFlip,
} from '../src/services/vc58RecordScreenContract';
import { VIDEO_RECORD_HONESTY, VIDEO_STAYS_ON_PHONE_LINE } from '../src/services/videoTakeSync';
import {
  PRACTICE_VIDEO_TIPS_BODY,
  PRACTICE_VIDEO_TIPS_LABEL,
} from '../src/services/practiceVideoRef';

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

function readRepoFile(relative: string): string {
  return String(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

/** The live copy, as the app really has it. */
const SCREEN = readRepoFile(VC58_SCREEN_PATH);
const COVERAGE_RENDER = '<Text style={styles.coverageLine}>{NOTES_COVERAGE_RECORD_LINE}</Text>';

function copyOf(screen: string, overrides: Partial<Record<string, string>> = {}) {
  return {
    listening: VIDEO_RECORD_HONESTY,
    privacy: VIDEO_STAYS_ON_PHONE_LINE,
    tipsLabel: PRACTICE_VIDEO_TIPS_LABEL,
    tipsBody: PRACTICE_VIDEO_TIPS_BODY,
    screen,
    ...overrides,
  };
}

function replaceLast(source: string, needle: string, replacement: string): string {
  const at = source.lastIndexOf(needle);
  if (at < 0) return source;
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

/** The Stop block as it stands, so a mutation can move the real thing. */
function stopBlock(source: string): string {
  const at = source.indexOf("        {phase === 'recording' ? (\n          <TouchableOpacity\n            style={styles.stopBtn}");
  if (at < 0) return '';
  const end = source.indexOf('        ) : null}\n', at);
  if (end < 0) return '';
  return source.slice(at, end + '        ) : null}\n'.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE COPY
// ─────────────────────────────────────────────────────────────────────────────

function testTheCopy(): void {
  console.log('\nTHE COPY (the owner\'s words, 11-13)');

  assert(
    VIDEO_RECORD_HONESTY === 'NoteSnap is listening to your take.',
    'the kept line is exactly the owner\'s first line, and nothing after it',
  );
  assert(
    VIDEO_STAYS_ON_PHONE_LINE ===
      'The video stays on your phone for your privacy until you share it yourself.',
    'the privacy line is the owner\'s wording, verbatim',
  );
  assert(PRACTICE_VIDEO_TIPS_LABEL === 'Tips', 'the Tip block is labelled Tips');
  assert(
    PRACTICE_VIDEO_TIPS_BODY.indexOf('Turn off all your notifications for recording your NoteSnap video take.') === 0,
    'the Tip block opens with the owner\'s first sentence',
  );
  assert(
    PRACTICE_VIDEO_TIPS_BODY.indexOf('Then try performing the piece in one whole take.') > 0,
    'and closes with the owner\'s last one',
  );

  const maxLineGone =
    maskCommentsKeepingLines(readRepoFile('src/services/practiceVideoRef.ts')).indexOf(
      'PRACTICE_VIDEO_MAX_LINE',
    ) < 0;
  const countInHintGone =
    maskCommentsKeepingLines(readRepoFile('src/services/practiceRecordingOptions.ts')).indexOf(
      'COUNT_IN_HINT',
    ) < 0;
  assert(
    maxLineGone && countInHintGone,
    'the two deleted sentences are gone from the modules, not just unrendered',
  );

  assert(
    theRecordScreenSaysOnlyTheOwnersCopy(copyOf(SCREEN)),
    'GUARD 1: the record screen says only what the owner asked it to say, and renders every kept line from its constant',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE COVERAGE LINE'S PLACEMENT (C1)
// ─────────────────────────────────────────────────────────────────────────────

function testTheCoverageLineIsVisible(): void {
  console.log('\nTHE COVERAGE LINE IS IN THE VISIBLE TREE (C1)');

  assert(
    theRecordBodyShowsTheLimitAboveTheCamera(SCREEN),
    'GUARD 2: one render of the coverage line, above the camera, as a bare sibling — on screen without scrolling',
  );
  const cameraAt = SCREEN.indexOf('<View style={styles.preview}>');
  const titleAt = SCREEN.lastIndexOf('{PRACTICE_VIDEO_SCREEN_TITLE}', cameraAt);
  const renderAt = SCREEN.indexOf(COVERAGE_RENDER, titleAt);
  assert(
    renderAt > titleAt && renderAt < cameraAt,
    'control: it really sits between the record body\'s title and the camera preview',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE STOP BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function testTheStopButton(): void {
  console.log('\nTHE STOP BUTTON SITS UNDER THE FLIP (item 3)');

  assert(
    theStopButtonSitsUnderTheFlip(SCREEN),
    'GUARD 3: the in-recording Stop is under the Flip row and above the recording block',
  );
  const flip = SCREEN.indexOf('style={styles.flipRow}');
  const stop = SCREEN.indexOf('style={styles.stopBtn}');
  assert(
    flip >= 0 && stop > flip,
    'control: the flip row is still there and the Stop is after it',
  );
  const start = SCREEN.indexOf('style={styles.startBtnRound}');
  assert(
    start > flip,
    'vc52 is untouched: the green round Start still sits under the Flip',
  );
  assert(
    SCREEN.indexOf('style={styles.stopBtn}') === SCREEN.lastIndexOf('style={styles.stopBtn}'),
    'there is exactly ONE Stop on the surface — the button moved, it was not copied',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE GUARDS BITE
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardsBite(): void {
  console.log('\nTHE GUARDS BITE (mutated real source)');

  // (a) The render deleted outright.
  const deleted = replaceLast(SCREEN, COVERAGE_RENDER, '');
  assert(
    deleted !== SCREEN && theRecordBodyShowsTheLimitAboveTheCamera(deleted) === false,
    'GUARD 2 bites: a record body that no longer renders the line is rejected',
  );

  // (b) The render put behind a conditional that is false before recording.
  const gated = replaceLast(
    SCREEN,
    COVERAGE_RENDER,
    '{phase === \'recording\' ? (\n          ' + COVERAGE_RENDER + '\n        ) : null}',
  );
  assert(
    gated !== SCREEN && theRecordBodyShowsTheLimitAboveTheCamera(gated) === false,
    'GUARD 2 bites: the line wrapped in a phase conditional is rejected, not counted as present',
  );

  // (c) The render moved BELOW the camera — present, counted, and off the fold.
  const belowTheCamera = (() => {
    const withoutLine = replaceLast(SCREEN, COVERAGE_RENDER + '\n', '');
    const flipComment = '        {/* ── vc49: THE CAMERA FLIP';
    const at = withoutLine.indexOf(flipComment);
    if (at < 0) return withoutLine;
    return withoutLine.slice(0, at) + '        ' + COVERAGE_RENDER + '\n' + withoutLine.slice(at);
  })();
  assert(
    belowTheCamera !== SCREEN && theRecordBodyShowsTheLimitAboveTheCamera(belowTheCamera) === false,
    'GUARD 2 bites: the line rendered under the camera is rejected — this is the vc57 defect',
  );

  // (d) A deleted sentence restored in the live copy.
  const restored = copyOf(SCREEN, {
    listening:
      'NoteSnap is listening to your take. The notes you see afterwards come from what it hears in the sound — the video is the picture, not the source of the notes.',
  });
  assert(
    theRecordScreenSaysOnlyTheOwnersCopy(restored) === false,
    'GUARD 1 bites: the deleted half of that paragraph put back in the copy is rejected',
  );
  const maxLineBack = copyOf(SCREEN, { privacy: 'Up to 3 minutes per practice video — you can stop at any time.' });
  assert(
    theRecordScreenSaysOnlyTheOwnersCopy(maxLineBack) === false,
    'GUARD 1 bites: the deleted "Up to 3 minutes" sentence put back is rejected',
  );

  // (e) The kept line typed inline instead of rendered from its constant.
  const typedInline = SCREEN.split('{VIDEO_RECORD_HONESTY}').join(
    'NoteSnap is listening to your take.',
  );
  assert(
    typedInline !== SCREEN && theRecordScreenSaysOnlyTheOwnersCopy(copyOf(typedInline)) === false,
    'GUARD 1 bites: the kept line typed into the screen instead of rendered is rejected',
  );

  // (f) The Stop moved back to the bottom of the recording block.
  const block = stopBlock(SCREEN);
  assert(block.length > 0, 'control: the Stop block can be lifted out of the real screen');
  const stopAtTheBottom = (() => {
    const without = SCREEN.replace(block, '');
    const levelAt = without.indexOf('style={styles.levelRow}');
    const closeAt = without.indexOf('</View>', levelAt);
    if (levelAt < 0 || closeAt < 0) return without;
    const insertAt = closeAt + '</View>'.length;
    return without.slice(0, insertAt) + '\n' + block + without.slice(insertAt);
  })();
  assert(
    theStopButtonSitsUnderTheFlip(stopAtTheBottom) === false,
    'GUARD 3 bites: the Stop back at the bottom of the recording block is rejected',
  );

  // (g) The Stop un-gated, so it is on screen before anything is filmed.
  const unGated = SCREEN.replace(block, block.replace("{phase === 'recording' ? (", '{true ? ('));
  assert(
    unGated !== SCREEN && theStopButtonSitsUnderTheFlip(unGated) === false,
    'GUARD 3 bites: a Stop that is not gated on recording (the vc52 layout changed) is rejected',
  );

  // (h) The guard is not vacuous on nonsense.
  assert(
    theRecordBodyShowsTheLimitAboveTheCamera('') === false &&
      theRecordBodyShowsTheLimitAboveTheCamera('const nothing = 1;') === false,
    'GUARD 2 does not pass a screen that has no record body at all',
  );
  assert(
    theStopButtonSitsUnderTheFlip('') === false,
    'GUARD 3 does not pass a screen that has no Stop at all',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

testTheCopy();
testTheCoverageLineIsVisible();
testTheStopButton();
testTheGuardsBite();

console.log(`\n${passes} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach((label) => console.error(`  FAILED: ${label}`));
  process.exit(1);
}
