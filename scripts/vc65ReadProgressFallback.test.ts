/**
 * vc65ReadProgressFallback.test.ts — THE vc65 SUITE (owner 11-17).
 *
 * THE OWNER, verbatim: *"The user also needs to be made aware that the sample is being
 * processed… like some sort of countdown."*
 *
 * vc61 gave the read a clock. vc65 answers the two things the clock alone could not:
 *
 *   1. THE STEP — the read names what it is doing, from its OWN stage callbacks
 *      (`onStage`: upload → clientDecode → pitch → build), drawn under the elapsed clock
 *      while the read is in flight. No percentage and no bar: the app cannot measure the
 *      fraction of a read that is done, so it never draws a number it cannot measure.
 *
 *   2. THE FALLBACK, SAID OUT LOUD — when the route answers without notes the phone runs
 *      its own pitch pass (15–25 s of real work). Until vc65 that happened in silence,
 *      which is the defect class that hid a server returning nothing for two builds. The
 *      seam now reports it BEFORE the pass runs (`onPitchFallback`) and the surface prints
 *      the reason.
 *
 * ONE GUARD PER BEHAVIOUR, and each is PROVEN TO BITE here: the same guard is re-run over a
 * mutated copy of the real bytes and must go FALSE (skills `musicapp-tier1-live-scan-suite`,
 * `musicapp-guard-mutation-probes`). A mutation that does not change the source fails loudly
 * instead of passing quietly.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import { maskComments } from '../src/services/modalBackContract';
import {
  READ_FALLBACK_DEVICE_LINE,
  READ_FALLBACK_SERVER_LINE,
  READ_STEP_NOTES_LINE,
  READ_STEP_SENDING_LINE,
  READ_STEP_UNPACKING_LINE,
  READ_STEP_WRITING_LINE,
  readFallbackNotice,
  readStepLine,
} from '../src/services/takeReadProgress';

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
const SHIPPED_READ = readRepoFile('src/services/captureMidiExport.ts');
const PROGRESS_MODEL = readRepoFile('src/services/takeReadProgress.ts');

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

/** A mutation probe: the source really changed, and the guard really went false. */
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 1 — THE STEP: honest progress while the notes are read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The progress the surface shows is the READ'S OWN, and it is drawn while the read runs:
 *
 *   • the step line comes from the pure model, fed the stage the read itself reported;
 *   • the read's stage callback is what sets it — in BOTH read paths (the read after a
 *     take is kept, and "Try the read again"), so neither can drift back to a still screen;
 *   • it is drawn only while `takeBusy` — the flag that is true exactly while the read is
 *     in flight — never a permanent label;
 *   • the elapsed clock it sits under is still stamped from the read's own start;
 *   • a fresh read clears the step, so a previous read's step is never shown for a new one;
 *   • and nothing in the model fabricates a percentage.
 */
function progressIsTheReadsOwnAndShownWhileItRuns(screenSource: string, modelSource: string): boolean {
  const src = maskComments(screenSource);
  const model = maskComments(modelSource);
  if (src.length < 6000 || model.length < 500) return false;

  // (a) The surface prints the model's step line, gated on the read being in flight. The gate
  //     and the render are ONE JSX expression (`{takeBusy ? <Text …>{readStepLine(readStep)}`),
  //     so a label that was never drawn — or one that stayed up after the read finished —
  //     fails here.
  const stepAt = src.indexOf('readStepLine(readStep)');
  if (stepAt < 0) return false;
  const gateAt = src.lastIndexOf('{takeBusy ? <Text', stepAt);
  if (gateAt < 0 || stepAt - gateAt > 120) return false;

  // (b) The step is the READ's own stage callback, in every read path.
  if (countOf(src, 'onStage: (stage, ms) => {') !== 2) return false;
  if (countOf(src, 'setReadStep(stage);') !== 2) return false;
  if (countOf(src, 'setReadStep(null);') !== 2) return false;

  // (c) It sits under the elapsed clock, which is still stamped from the read's own start.
  if (src.indexOf('readClockLine(') < 0) return false;
  if (src.indexOf('readClockStartRef.current = Date.now();') < 0) return false;

  // (d) No fabricated progress: the model carries no percentage and no bar.
  if (model.indexOf('%') >= 0) return false;
  if (model.indexOf('progressBar') >= 0) return false;
  return model.indexOf('export function readStepLine(') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 2 — THE FALLBACK: said on screen, not silent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When the route comes up short and the phone reads the take, the app SAYS SO:
 *
 *   • the seam builds the notice from the device pitch source and the read's own round trip
 *     (`captured.network`), so "the server answered without notes" and "no server round trip
 *     at all" are different sentences;
 *   • it reports it through `onPitchFallback` BEFORE the device pass starts — a notice after
 *     the wait would explain a wait that is already over;
 *   • the surface hands the seam that callback in BOTH read paths and renders the line.
 */
function theFallbackIsAnnouncedNotSilent(exportSource: string, screenSource: string): boolean {
  const src = maskComments(exportSource);
  const scr = maskComments(screenSource);
  if (src.length < 3000 || scr.length < 6000) return false;

  // (a) The notice is the model's, built from the real facts of this read — the round trip is
  //     read INSIDE the `readFallbackNotice({ … })` call. Anchored to the call on purpose: the
  //     returned object carries a `network:` of its own, and a file-wide search would let that
  //     one stand in for the notice's and hide the notice losing its reason.
  const noticeAt = src.indexOf('readFallbackNotice({');
  if (noticeAt < 0) return false;
  const noticeEnd = src.indexOf('});', noticeAt);
  if (noticeEnd < 0) return false;
  const noticeCall = src.slice(noticeAt, noticeEnd);
  if (noticeCall.indexOf("pitchSource: 'device',") < 0) return false;
  if (noticeCall.indexOf('network: captured?.network ?? null,') < 0) return false;

  // (b) It goes out through the seam's callback, BEFORE the device pass runs.
  const callAt = src.indexOf('deps.onPitchFallback?.(notice);');
  if (callAt < 0) return false;
  const passAt = src.indexOf('detectPitchFramesAsync(captured.samples');
  if (passAt < 0 || callAt > passAt) return false;

  // (c) The surface subscribes in both read paths, and renders the line.
  if (countOf(scr, 'onPitchFallback: (notice) => setReadFallbackLine(notice.line),') !== 2) return false;
  if (countOf(scr, 'setReadFallbackLine(null);') !== 2) return false;
  return scr.indexOf('readFallbackLine ? <Text') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MODEL — every branch of the pure half
// ─────────────────────────────────────────────────────────────────────────────

function testTheStepLine(): void {
  console.log('\n1. THE STEP — what the read is doing, from its own stages');

  assertEq(readStepLine(null), READ_STEP_SENDING_LINE, 'nothing reported yet: the take is being sent');
  assertEq(readStepLine(undefined), READ_STEP_SENDING_LINE, 'an absent stage reads as "nothing reported yet"');
  assertEq(readStepLine('upload'), READ_STEP_UNPACKING_LINE, 'upload finished: the audio is being unpacked');
  assertEq(readStepLine('clientDecode'), READ_STEP_NOTES_LINE, 'the samples exist: the notes are being found');
  assertEq(readStepLine('pitch'), READ_STEP_WRITING_LINE, 'the notes exist: the score is being written');
  assertEq(readStepLine('build'), READ_STEP_WRITING_LINE, 'the build stage shares the writing line');

  const lines = [READ_STEP_SENDING_LINE, READ_STEP_UNPACKING_LINE, READ_STEP_NOTES_LINE, READ_STEP_WRITING_LINE];
  assertEq(new Set(lines).size, 4, 'the four steps are four different sentences');
  assert(lines.every((line) => line.length > 10), 'every step line is a full sentence');
  assert(lines.every((line) => line.indexOf('%') < 0), 'no step line carries a percentage');
  assert(lines.every((line) => !/[0-9]/.test(line)), 'no step line carries a number it cannot measure');

  const walked = ['upload', 'clientDecode', 'pitch', 'build'] as const;
  const seen = walked.map((stage) => readStepLine(stage));
  assertEq(new Set(seen).size, 3, 'the four stages resolve to three visible steps');
}

function testTheFallbackNotice(): void {
  console.log('\n2. THE FALLBACK — who read the take, and why it changed');

  const serverShort = readFallbackNotice({ pitchSource: 'device', network: { httpStatus: 200 } });
  assert(!!serverShort, 'the device pass after a server answer produces a notice');
  assertEq(serverShort?.reason, 'server-sent-no-notes', 'the reason is "the server answered without notes"');
  assertEq(serverShort?.line, READ_FALLBACK_SERVER_LINE, 'and it carries the sentence that says so');
  assert(
    READ_FALLBACK_SERVER_LINE.indexOf('phone') >= 0 &&
      READ_FALLBACK_SERVER_LINE.indexOf('slower') >= 0,
    'the sentence names the phone and says it is slower',
  );

  const noTrip = readFallbackNotice({ pitchSource: 'device', network: null });
  assertEq(noTrip?.reason, 'read-on-device', 'no round trip at all is its own reason');
  assertEq(noTrip?.line, READ_FALLBACK_DEVICE_LINE, 'and its own sentence');
  assert(String(READ_FALLBACK_DEVICE_LINE) !== String(READ_FALLBACK_SERVER_LINE), 'the two reasons read differently');

  assertEq(readFallbackNotice({ pitchSource: 'server', network: { httpStatus: 200 } }), null,
    'the server read the take: nothing to announce');
  assertEq(readFallbackNotice({ pitchSource: null, network: null }), null,
    'no read produced frames: no fallback to announce');
  assertEq(readFallbackNotice({}), null, 'an empty input announces nothing');
  assert(
    !/[0-9]/.test(READ_FALLBACK_SERVER_LINE) && !/[0-9]/.test(READ_FALLBACK_DEVICE_LINE),
    'neither fallback sentence promises a time it cannot know',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GUARDS, ON THE REAL SOURCES
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuards(): void {
  console.log('\n3. THE GUARDS ON THE REAL SOURCES');

  assert(
    progressIsTheReadsOwnAndShownWhileItRuns(SCREEN, PROGRESS_MODEL),
    'GUARD 1 — the step is the read\'s own, and it is drawn while the read runs',
  );
  assert(
    theFallbackIsAnnouncedNotSilent(SHIPPED_READ, SCREEN),
    'GUARD 2 — the on-device fallback is announced before it runs, and shown on the surface',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PROBES — every guard must bite
// ─────────────────────────────────────────────────────────────────────────────

function testTheProbes(): void {
  console.log('\n4. MUTATION PROBES — every vc65 guard must bite');

  // GUARD 1 — the progress readout.
  probe(
    'part 1: the step is no longer drawn',
    SCREEN.replace('readStepLine(readStep)', 'null'),
    SCREEN,
    () => progressIsTheReadsOwnAndShownWhileItRuns(SCREEN.replace('readStepLine(readStep)', 'null'), PROGRESS_MODEL),
  );
  probe(
    'part 1: the step is no longer fed by the read\'s own stages',
    SCREEN.replace(/setReadStep\(stage\);/g, ''),
    SCREEN,
    () => progressIsTheReadsOwnAndShownWhileItRuns(SCREEN.replace(/setReadStep\(stage\);/g, ''), PROGRESS_MODEL),
  );
  probe(
    'part 1: a fresh read no longer clears the previous step',
    SCREEN.replace(/setReadStep\(null\);/g, ''),
    SCREEN,
    () => progressIsTheReadsOwnAndShownWhileItRuns(SCREEN.replace(/setReadStep\(null\);/g, ''), PROGRESS_MODEL),
  );
  probe(
    'part 1: the model fabricates a percentage',
    PROGRESS_MODEL.replace(READ_STEP_SENDING_LINE, 'Sending your take to be read… 0%'),
    PROGRESS_MODEL,
    () => progressIsTheReadsOwnAndShownWhileItRuns(SCREEN, PROGRESS_MODEL.replace(READ_STEP_SENDING_LINE, 'Sending your take to be read… 0%')),
  );

  // GUARD 2 — the fallback announcement.
  probe(
    'part 2: the fallback is no longer reported to the surface',
    SHIPPED_READ.replace('deps.onPitchFallback?.(notice);', ''),
    SHIPPED_READ,
    () => theFallbackIsAnnouncedNotSilent(SHIPPED_READ.replace('deps.onPitchFallback?.(notice);', ''), SCREEN),
  );
  probe(
    'part 2: the notice is built without the read\'s own round trip',
    SHIPPED_READ.replace('network: captured?.network ?? null,', 'network: null,'),
    SHIPPED_READ,
    () => theFallbackIsAnnouncedNotSilent(SHIPPED_READ.replace('network: captured?.network ?? null,', 'network: null,'), SCREEN),
  );
  probe(
    'part 2: the surface stops subscribing to the fallback',
    SCREEN.replace(/onPitchFallback: \(notice\) => setReadFallbackLine\(notice\.line\),/g, ''),
    SCREEN,
    () => theFallbackIsAnnouncedNotSilent(SHIPPED_READ, SCREEN.replace(/onPitchFallback: \(notice\) => setReadFallbackLine\(notice\.line\),/g, '')),
  );
  probe(
    'part 2: the surface stops printing the fallback line',
    SCREEN.replace('readFallbackLine ? <Text', 'false ? <Text'),
    SCREEN,
    () => theFallbackIsAnnouncedNotSilent(SHIPPED_READ, SCREEN.replace('readFallbackLine ? <Text', 'false ? <Text')),
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testTheStepLine();
  testTheFallbackNotice();
  testTheGuards();
  testTheProbes();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
