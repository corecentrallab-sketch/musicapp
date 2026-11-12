/**
 * vc55DeviceFixes.test.ts — THE OWNER'S RED ROWS FROM THE vc54 HANDSET PASS (vc55).
 *
 * The owner tested vc54 on the handset (2026-11-11). A5 and the notes lane PASSED.
 * These are the rows that came back red or with a "needs fix" note, and each one
 * is pinned here twice: the pure rule that decides the behaviour, and the wiring
 * read out of the REAL source file, then the same guard run again over mutated
 * bytes so it is proved to bite.
 *
 *   N5  a note-less take says "no melody was heard" — never "outside the window"
 *   N6  an empty lane offers the camera-off take on BOTH surfaces
 *   F2  the full-screen window says it is preparing, with a disabled Play control
 *   D22 no copy blames the camera for notes it did not produce
 *   About the About NoteSnap card is measurably smaller
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  VC55_ABOUT_LAYOUT_PATH,
  VC55_FULLSCREEN_PATH,
  VC55_SCREEN_PATH,
  VC55_SETTINGS_PATH,
  VC55_SYNC_MODEL_PATH,
  aNoteLessTakeSaysNoMelodyWasHeard,
  aTakeWithDroppedNotesStillSaysTheyAreOutside,
  aboutCardIsSmaller,
  anEmptyLaneOffersTheCameraOffTake,
  anUnknownVideoLengthIsNeverTheReason,
  fullScreenSaysItIsPreparing,
  noCopyBlamesTheCameraForTheNotes,
} from '../src/services/vc55DeviceFixContract';
import {
  FULL_SCREEN_PREPARING_CTA,
  FULL_SCREEN_PREPARING_HINT,
  FULL_SCREEN_PREPARING_LINE,
  claimsAWaitDuration,
  fullScreenCanPlay,
  fullScreenIsPreparing,
  fullScreenPrepOnEvent,
  fullScreenPrepOnOpen,
} from '../src/services/videoFullScreenPrep';
import {
  ABOUT_CARD_GEOMETRY,
  ABOUT_CARD_GEOMETRY_BEFORE,
  aboutCardHeight,
  aboutCardSaving,
} from '../src/services/aboutCardLayout';

declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const read = (rel: string): string => String(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const SCREEN = read(VC55_SCREEN_PATH);
const FULLSCREEN = read(VC55_FULLSCREEN_PATH);
const SETTINGS = read(VC55_SETTINGS_PATH);
const MODEL = read(VC55_SYNC_MODEL_PATH);
const ABOUT_LAYOUT = read(VC55_ABOUT_LAYOUT_PATH);

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
// N5 — THE THREE EMPTY CASES READ DIFFERENTLY
// ─────────────────────────────────────────────────────────────────────────────

function testTheThreeEmptyCases(): void {
  console.log('\nN5 — WHAT AN EMPTY LANE SAYS (pure)');
  assert(
    aNoteLessTakeSaysNoMelodyWasHeard(),
    'a take of silence (no notes at all) says no melody was heard — and still owes an action',
  );
  assert(
    aTakeWithDroppedNotesStillSaysTheyAreOutside(),
    'a take that HAS notes but none on this video keeps its own "outside the video" sentence',
  );
  assert(
    anUnknownVideoLengthIsNeverTheReason(),
    'an unknown video length is never a reason: 3 notes on a 0-length video keep all 3 cues and show no sentence',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// F2 — THE WAIT, AND WHAT IT MAY CLAIM
// ─────────────────────────────────────────────────────────────────────────────

function testThePreparingState(): void {
  console.log('\nF2 — THE FULL-SCREEN WAIT (pure)');
  assert(
    fullScreenPrepOnOpen('file:///take.mp4') === 'preparing' &&
      fullScreenPrepOnOpen(null) === 'idle',
    'a window with a file opens PREPARING; a window with no file claims nothing',
  );
  assert(
    fullScreenIsPreparing(fullScreenPrepOnOpen('file:///take.mp4')) === true &&
      fullScreenCanPlay('preparing') === false,
    'while it is preparing the window shows the wait and refuses Play',
  );
  assert(
    fullScreenPrepOnEvent('preparing', 'ready') === 'ready' &&
      fullScreenPrepOnEvent('preparing', 'failed') === 'failed',
    'the wait ends on the player\'s own word — loaded, or failed',
  );
  assert(
    fullScreenPrepOnEvent('ready', 'closed') === 'idle' &&
      fullScreenPrepOnEvent('idle', 'ready') === 'idle',
    'closing resets the wait, and a late event cannot resurrect it',
  );
  const copy = [FULL_SCREEN_PREPARING_LINE, FULL_SCREEN_PREPARING_HINT, FULL_SCREEN_PREPARING_CTA];
  assert(
    copy.every((line) => claimsAWaitDuration(line) === false),
    'no preparing copy claims a duration the app cannot measure',
  );
  assert(
    claimsAWaitDuration('about 5 seconds remaining') === true &&
      claimsAWaitDuration('20s left') === true &&
      claimsAWaitDuration('Preparing…') === false,
    'the duration detector itself bites (control)',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ABOUT — THE CARD IS SMALLER, IN NUMBERS THE SCREEN READS
// ─────────────────────────────────────────────────────────────────────────────

function testTheAboutCard(): void {
  console.log('\nABOUT — THE CARD IS SMALLER (pure)');
  const now = aboutCardHeight();
  const before = aboutCardHeight(ABOUT_CARD_GEOMETRY_BEFORE);
  assert(
    now < before,
    `the compact card is shorter than the one the owner called too large (${now} dp vs ${before} dp)`,
  );
  assert(
    aboutCardSaving() >= 12,
    `it saves at least a dozen dp of Settings page (saved ${aboutCardSaving()} dp)`,
  );
  assert(
    now <= 72,
    `and it stays a compact box (${now} dp, ceiling 72)`,
  );
  assert(
    ABOUT_CARD_GEOMETRY.rowMinHeight < ABOUT_CARD_GEOMETRY_BEFORE.rowMinHeight &&
      ABOUT_CARD_GEOMETRY.stampLineHeight < ABOUT_CARD_GEOMETRY_BEFORE.stampLineHeight,
    'both halves shrank: the row and the stamp line',
  );
  assert(
    ABOUT_LAYOUT.indexOf('export const ABOUT_CARD_GEOMETRY') >= 0,
    'the geometry lives in services/aboutCardLayout, where the gate can read it',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE WIRING — read out of the real source files
// ─────────────────────────────────────────────────────────────────────────────

function testTheWiring(): void {
  console.log('\nTHE WIRING (real source)');

  assert(
    noCopyBlamesTheCameraForTheNotes(MODEL),
    'D22: no copy blames the camera for the notes, and the sentence names the take\'s own recording',
  );
  assert(
    anEmptyLaneOffersTheCameraOffTake(SCREEN),
    'N6: an empty lane offers the camera-off take as a real control, on both surfaces',
  );
  assert(
    fullScreenSaysItIsPreparing(FULLSCREEN),
    'F2: the full-screen window shows the preparing state and disables Play while it waits',
  );
  assert(
    aboutCardIsSmaller(SETTINGS),
    'About: the card is the compact one and its styles read services/aboutCardLayout',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GUARDS BITE — the same real bytes, mutated, must fail
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardsBite(): void {
  console.log('\nTHE GUARDS BITE (mutated real source)');

  // D22 — the wrong-cause sentence put back, word for word.
  const blamedCamera = MODEL.replace(
    'NoteSnap could not hear a melody in the audio it recorded for this take.',
    'NoteSnap could not hear a melody in the sound the camera recorded.',
  );
  assert(
    blamedCamera !== MODEL && noCopyBlamesTheCameraForTheNotes(blamedCamera) === false,
    'GUARD D22 bites: "the sound the camera recorded" is rejected',
  );

  // N6 — the watch page's action removed, leaving the sentence with nowhere to go.
  const deadEnd = SCREEN.split('onPress={() => void recordNotesOnTheirOwn()}').join(
    'onPress={() => undefined}',
  );
  assert(
    deadEnd !== SCREEN && anEmptyLaneOffersTheCameraOffTake(deadEnd) === false,
    'GUARD N6 bites: a camera-off CTA that goes nowhere is rejected',
  );
  const noAction = SCREEN.split('emptyLaneNeedsAnAction(cueSet)').join('false');
  assert(
    noAction !== SCREEN && anEmptyLaneOffersTheCameraOffTake(noAction) === false,
    'GUARD N6 bites: a watch page with no empty-lane action is rejected',
  );
  const emptyTakeStillADeadEnd = SCREEN.split('(!take || take.notes.length === 0) && !takeBusy').join(
    '!take && !takeBusy',
  );
  assert(
    emptyTakeStillADeadEnd !== SCREEN &&
      anEmptyLaneOffersTheCameraOffTake(emptyTakeStillADeadEnd) === false,
    'GUARD N6 bites: the review page leaving a note-less take with no action is rejected',
  );

  // F2 — the window with no preparing state at all (the shipped vc54 behaviour).
  const silentWindow = FULLSCREEN.split('{FULL_SCREEN_PREPARING_LINE}').join('');
  assert(
    silentWindow !== FULLSCREEN && fullScreenSaysItIsPreparing(silentWindow) === false,
    'GUARD F2 bites: a window that never says it is preparing is rejected',
  );
  const deadPlay = FULLSCREEN.replace(
    'disabled={!uri || busy || !fullScreenCanPlay(prep)}',
    'disabled={!uri || busy}',
  );
  assert(
    deadPlay !== FULLSCREEN && fullScreenSaysItIsPreparing(deadPlay) === false,
    'GUARD F2 bites: a Play control that looks live while preparing is rejected',
  );
  const guessedWait = FULLSCREEN.replace("reportPrep('ready')", 'undefined');
  assert(
    guessedWait !== FULLSCREEN && fullScreenSaysItIsPreparing(guessedWait) === false,
    'GUARD F2 bites: a window that never ends its wait on the player\'s word is rejected',
  );

  // About — the big card put back.
  const bigCard = SETTINGS.replace('          chevron\n          compact\n', '          chevron\n');
  assert(
    bigCard !== SETTINGS && aboutCardIsSmaller(bigCard) === false,
    'GUARD ABOUT bites: the About row without the compact row is rejected',
  );
  const inlinedNumbers = SETTINGS.replace(
    '    minHeight: ABOUT_ROW_MIN_HEIGHT,\n    paddingVertical: ABOUT_ROW_PADDING_V,',
    '    minHeight: 52,\n    paddingVertical: 10,',
  );
  assert(
    inlinedNumbers !== SETTINGS && aboutCardIsSmaller(inlinedNumbers) === false,
    'GUARD ABOUT bites: the old 52/10 numbers written back into the style are rejected',
  );

  // A screen that stopped rendering the surfaces at all must not pass vacuously.
  assert(
    anEmptyLaneOffersTheCameraOffTake('const nothing = 1;') === false &&
      fullScreenSaysItIsPreparing('const nothing = 1;') === false &&
      aboutCardIsSmaller('const nothing = 1;') === false,
    'every guard rejects an empty file instead of passing vacuously',
  );
}

testTheThreeEmptyCases();
testThePreparingState();
testTheAboutCard();
testTheWiring();
testTheGuardsBite();

console.log(`\n${passes} passed, ${failures} failed (${passes + failures} checks)`);
if (failures > 0) process.exit(1);
