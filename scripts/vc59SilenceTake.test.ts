/**
 * vc59SilenceTake.test.ts — THE SILENCE-TAKE FIX (D24 + D25).
 *
 * TWO GUARDS, EACH RUN AGAIN OVER MUTATED REAL BYTES AND REQUIRED TO FAIL THERE:
 *
 *   GUARD 1 — the camera-off retake does not stop itself: `recordSeparateTake`'s
 *             body contains no `stopRecording`, the stop is a control the user
 *             presses, and the window it opens mounts no camera (D25, plus the
 *             watch page's camera flip).
 *   GUARD 2 — the review surface speaks its own no-melody verdict and never the
 *             MIDI export's sentence (D24).
 *
 * The shipped guards counted the CTA string twice — on a button that could not
 * record and on a page that talked about a MIDI file. That is the class of green
 * gate this suite replaces: a count of a button is not a fact about its behaviour.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  VC59_SCREEN_PATH,
  theCameraOffRetakeWaitsForTheUserToStop,
  theSurfaceSpeaksItsOwnNoMelodySentence,
} from '../src/services/vc59SilenceTakeContract';

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

const SCREEN = readRepoFile(VC59_SCREEN_PATH);

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE RETAKE THAT RECORDS (D25)
// ─────────────────────────────────────────────────────────────────────────────

function testTheRetakeRecords(): void {
  console.log('\nTHE CAMERA-OFF RETAKE RECORDS UNTIL THE USER STOPS IT (D25)');

  assert(
    theCameraOffRetakeWaitsForTheUserToStop(SCREEN),
    'GUARD 1: the retake opens a record window and waits for the user to press Stop',
  );
  // Controls: the two functions and the window are really there, so the guard is
  // reading a live screen and not an empty one.
  assert(
    SCREEN.indexOf('const recordSeparateTake = useCallback(') >= 0 &&
      SCREEN.indexOf('const stopSeparateTake = useCallback(') >= 0,
    'control: both halves of the take (start, stop) exist as their own callbacks',
  );
  assert(
    SCREEN.indexOf("| 'notes_only'") >= 0,
    'control: the record window is a phase on the machine, not a second flag',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SENTENCE (D24)
// ─────────────────────────────────────────────────────────────────────────────

function testTheSentence(): void {
  console.log('\nTHE REVIEW PAGE SPEAKS ITS OWN VERDICT (D24)');

  assert(
    theSurfaceSpeaksItsOwnNoMelodySentence(SCREEN),
    'GUARD 2: the landing surface says "no melody was heard", never the MIDI export\'s message',
  );
  assert(
    SCREEN.indexOf('MIDI_NO_MELODY_MESSAGE') < 0,
    'control: the export\'s sentence is not on this surface at all',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE GUARDS BITE
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardsBite(): void {
  console.log('\nTHE GUARDS BITE (mutated real source)');

  // (a) D25 put back: the start stops the take on the next line. This is the
  // defect exactly as it shipped — a start and a stop with nothing in between.
  const immediateStop = SCREEN.replace(
    '    notesOnlyStartedAtRef.current = Date.now();',
    '    const stopped = await recorder.stopRecording();\n    notesOnlyStartedAtRef.current = Date.now();',
  );
  assert(
    immediateStop !== SCREEN && theCameraOffRetakeWaitsForTheUserToStop(immediateStop) === false,
    'GUARD 1 bites: a start that stops itself on the next line is rejected',
  );

  // (b) The camera gate reverted to "every phase but review" — the watch page's
  // flip into a live preview for a take that films nothing.
  const cameraBack = SCREEN.split("phase !== 'review' && phase !== 'notes_only'").join(
    "phase !== 'review'",
  );
  assert(
    cameraBack !== SCREEN && theCameraOffRetakeWaitsForTheUserToStop(cameraBack) === false,
    'GUARD 1 bites: a live camera in the camera-off window is rejected',
  );

  // (c) The window's Stop unwired — the clock and the meter with no way to end the
  // take (a recording that only the user's back button can leave).
  const stopUnwired = SCREEN.replace(
    'onPress={() => void stopSeparateTake()}',
    'onPress={() => undefined}',
  );
  assert(
    stopUnwired !== SCREEN && theCameraOffRetakeWaitsForTheUserToStop(stopUnwired) === false,
    'GUARD 1 bites: a window whose Stop is not wired to the stop is rejected',
  );

  // (d) D24 put back: the landing surface prints the export's own message.
  // vc60 moved the sentence behind the one reader, so the mutation removes the
  // ROUTING (the call that picks the verdict's words) and prints the export's
  // message straight into the lane instead — the defect, in today's source.
  // vc61 renders the reader on a SECOND surface too, so the mutation must reach
  // EVERY occurrence — editing the first match anywhere can edit the wrong render
  // and leave the guard's subject untouched (defect class 14).
  const exportSentence = SCREEN.split('takeReadLine(takeReadOutcome(derived), {').join(
    'derived.message ?? VIDEO_TAKE_FAILED_LINE, {',
  );
  assert(
    exportSentence !== SCREEN &&
      theSurfaceSpeaksItsOwnNoMelodySentence(exportSentence) === false,
    'GUARD 2 bites: the MIDI export\'s message put back in the no-take branch is rejected',
  );

  // (e) The export's sentence rendered outright.
  const rendered = SCREEN.replace('{takeLine}', '{MIDI_NO_MELODY_MESSAGE}');
  assert(
    rendered !== SCREEN && theSurfaceSpeaksItsOwnNoMelodySentence(rendered) === false,
    'GUARD 2 bites: the export\'s sentence rendered on the surface is rejected by name',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  testTheRetakeRecords();
  testTheSentence();
  testTheGuardsBite();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

void main();
