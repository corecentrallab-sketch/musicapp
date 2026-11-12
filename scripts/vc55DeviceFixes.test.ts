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
  fullScreenPaintsBeforeThePlayerMounts,
  fullScreenSaysItIsPreparing,
  noCopyBlamesTheCameraForTheNotes,
  theNotesReadNoLongerFreezesTheScreen,
  thePressIsStampedAndThePagePlayerPauses,
} from '../src/services/vc55DeviceFixContract';
import {
  createFullScreenOpenTimeline,
  shouldMountFullScreenPlayer,
} from '../src/services/videoFullScreenOpen';
import { detectPitchFrames, detectPitchFramesAsync } from '../src/services/pitchDetection';
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
const PITCH_SRC = read('src/services/pitchDetection.ts');
const DECODE_SRC = read('src/services/captureMidiExport.ts');

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
  // BOTH ends of the wait (onLoad and the first frame) report ready, so the
  // probe has to take them all out — `replace` only ever took the first one,
  // which left the guard satisfied and this probe failing.
  const guessedWait = FULLSCREEN.split("reportPrep('ready')").join('undefined');
  assert(
    guessedWait !== FULLSCREEN && fullScreenSaysItIsPreparing(guessedWait) === false,
    'GUARD F2 bites: a window that never ends its wait on the player\'s word is rejected',
  );
  const ctaStillSaysPlay = FULLSCREEN.split('FULL_SCREEN_PREPARING_CTA').join("'Play'");
  assert(
    ctaStillSaysPlay !== FULLSCREEN && fullScreenSaysItIsPreparing(ctaStillSaysPlay) === false,
    'GUARD F2 bites: a Play control still labelled Play while it waits is rejected',
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
  const ungatedCompact = SETTINGS.split('compact && styles.aboutRowCompact').join(
    'styles.aboutRowCompact',
  );
  assert(
    ungatedCompact !== SETTINGS && aboutCardIsSmaller(ungatedCompact) === false,
    'GUARD ABOUT bites: a compact row style that any row can wear is rejected',
  );

  // A screen that stopped rendering the surfaces at all must not pass vacuously.
  assert(
    anEmptyLaneOffersTheCameraOffTake('const nothing = 1;') === false &&
      fullScreenSaysItIsPreparing('const nothing = 1;') === false &&
      aboutCardIsSmaller('const nothing = 1;') === false,
    'every guard rejects an empty file instead of passing vacuously',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// F2, THE OTHER HALF (vc56) — THE WINDOW OPENS ON THE PRESS
// ─────────────────────────────────────────────────────────────────────────────

function audio(seconds: number, rate: number, hz: number): Float32Array {
  const n = Math.round(seconds * rate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i += 1) samples[i] = 0.4 * Math.sin((2 * Math.PI * hz * i) / rate);
  return samples;
}

async function testTheOpenPath(): Promise<void> {
  console.log('\nF2b — THE WINDOW PAINTS BEFORE THE PLAYER (pure)');
  assert(
    shouldMountFullScreenPlayer(true, false) === false &&
      shouldMountFullScreenPlayer(true, true) === true &&
      shouldMountFullScreenPlayer(false, true) === false,
    'the player is mounted only once the window is OPEN and PAINTED — never with the window',
  );

  const timeline = createFullScreenOpenTimeline(() => 1000, 500);
  timeline.mark('windowPainted', 620);
  timeline.mark('playerMounted', 700);
  timeline.mark('loaded', 1900);
  timeline.mark('firstFrame', 1950);
  const split = timeline.split();
  assert(
    split.tapToPaintMs === 120 &&
      split.paintToMountMs === 80 &&
      split.mountToLoadedMs === 1200 &&
      split.mountToFirstFrameMs === 1250 &&
      split.tapToLoadedMs === 1400,
    'the split measures press -> paint -> mount -> file -> frame, in ms',
  );
  assert(
    timeline.line().indexOf('[fullscreen-open]') === 0 &&
      timeline.line().indexOf('tap->paint=120ms') > 0 &&
      timeline.line().indexOf('paint->mount=80ms') > 0,
    'the whole split is reported on ONE tagged console line',
  );

  const partial = createFullScreenOpenTimeline(() => 0, null);
  partial.mark('windowPainted', 10);
  assert(
    partial.split().tapToPaintMs === null && partial.split().mountToLoadedMs === null,
    'a stage that never happened reads UNKNOWN, never 0 ms',
  );

  const twice = createFullScreenOpenTimeline(() => 0, 0);
  twice.mark('windowPainted', 5);
  twice.mark('windowPainted', 900);
  assert(
    twice.at('windowPainted') === 5,
    'a stage stamped twice keeps its FIRST time, so a re-render cannot inflate the split',
  );

  console.log('\nF2c — THE NOTES READ NO LONGER FREEZES THE TAP (pure + real samples)');
  const samples = audio(1.5, 22050, 440);
  const blocking = detectPitchFrames(samples, 22050);
  let yields = 0;
  const sliced = await detectPitchFramesAsync(samples, 22050, {}, {
    yieldToUi: () => {
      yields += 1;
      return Promise.resolve();
    },
  });
  const identical =
    sliced.length === blocking.length &&
    sliced.length > 0 &&
    sliced.every(
      (frame, i) =>
        frame.tSec === blocking[i].tSec &&
        frame.midi === blocking[i].midi &&
        frame.rms === blocking[i].rms,
    );
  assert(identical, `the sliced read returns the SAME frames as the blocking read (${sliced.length} frames)`);
  assert(yields > 0, `the sliced read really hands the thread back (${yields} yields over 1.5 s of audio)`);

  let fakeNow = 0;
  let forcedYields = 0;
  await detectPitchFramesAsync(samples, 22050, {}, {
    now: () => {
      fakeNow += 8;
      return fakeNow;
    },
    yieldToUi: () => {
      forcedYields += 1;
      return Promise.resolve();
    },
  });
  assert(forcedYields > 10, `the slice is bounded in TIME, not in frames (${forcedYields} slices)`);

  console.log('\nF2d — THE SHIPPED WIRING (real source)');
  assert(
    fullScreenPaintsBeforeThePlayerMounts(FULLSCREEN),
    'the window mounts its player behind the painted gate, on frame callbacks, and reports the split',
  );
  assert(
    theNotesReadNoLongerFreezesTheScreen(DECODE_SRC, PITCH_SRC),
    'the decode seam awaits the sliced read and the blocking call is gone',
  );
  assert(
    thePressIsStampedAndThePagePlayerPauses(SCREEN),
    'the press is stamped for the split, and the page player lets go of the file first',
  );

  console.log('\nF2b/c/d — THE GUARDS BITE (mutated source)');
  const playerFirst = FULLSCREEN.replace('{playerMounted ? (', '{true ? (');
  assert(
    playerFirst !== FULLSCREEN && fullScreenPaintsBeforeThePlayerMounts(playerFirst) === false,
    'GUARD F2b bites: a player mounted in the same commit as the window is rejected',
  );
  const ungated = FULLSCREEN.replace(
    'shouldMountFullScreenPlayer(visible, windowPainted)',
    'true',
  );
  assert(
    ungated !== FULLSCREEN && fullScreenPaintsBeforeThePlayerMounts(ungated) === false,
    'GUARD F2b bites: a window with no paint gate at all is rejected',
  );
  const noTiming = FULLSCREEN.split('timeline.current.line()').join('undefined');
  assert(
    noTiming !== FULLSCREEN && fullScreenPaintsBeforeThePlayerMounts(noTiming) === false,
    'GUARD F2b bites: a window that opens without measuring itself is rejected',
  );
  const blockingBack = DECODE_SRC.replace(
    'await detectPitchFramesAsync(captured.samples, captured.sampleRate)',
    'detectPitchFrames(captured.samples, captured.sampleRate)',
  );
  assert(
    blockingBack !== DECODE_SRC &&
      theNotesReadNoLongerFreezesTheScreen(blockingBack, PITCH_SRC) === false,
    'GUARD F2c bites: the blocking read put back into the seam is rejected',
  );
  const noYield = PITCH_SRC.split('await yieldToUi()').join('undefined');
  assert(
    noYield !== PITCH_SRC && theNotesReadNoLongerFreezesTheScreen(DECODE_SRC, noYield) === false,
    'GUARD F2c bites: a "sliced" read that never yields is rejected',
  );
  const noStamp = SCREEN.split('    noteFullScreenTap();').join('');
  assert(
    noStamp !== SCREEN && thePressIsStampedAndThePagePlayerPauses(noStamp) === false,
    'GUARD F2d bites: a press that is not stamped is rejected',
  );
  const noRelease = SCREEN.replace(
    '    void reviewVideoRef.current?.pauseAsync().catch(() => undefined);\n',
    '',
  );
  assert(
    noRelease !== SCREEN && thePressIsStampedAndThePagePlayerPauses(noRelease) === false,
    'GUARD F2d bites: a page player still holding the file is rejected',
  );
  assert(
    fullScreenPaintsBeforeThePlayerMounts('const nothing = 1;') === false &&
      theNotesReadNoLongerFreezesTheScreen('const nothing = 1;', 'const nothing = 1;') === false &&
      thePressIsStampedAndThePagePlayerPauses('const nothing = 1;') === false,
    'every new guard rejects an empty file instead of passing vacuously',
  );
}

void (async () => {
  testTheThreeEmptyCases();
  testThePreparingState();
  testTheAboutCard();
  testTheWiring();
  testTheGuardsBite();
  await testTheOpenPath();

  console.log(`\n${passes} passed, ${failures} failed (${passes + failures} checks)`);
  if (failures > 0) process.exit(1);
})();
