/**
 * vc62ServerNotesRead.test.ts — THE vc62 SUITE (D26, D29, D30, D31, D32).
 *
 * THE OWNER'S THREE RED ROWS ON vc61 (11-17), and the one defect underneath them:
 *
 *   D26  the read is too slow — 15–25 s on the handset, while the SAME route answers
 *        in 1.12 s (11 s take) and 4.07 s (78 s take). The phone's own YIN pass was
 *        the cost, so vc62 moves it to the server and the phone just draws.
 *   D32  the read has NO DEADLINE — a slow read and a hung read were the same state,
 *        which is why nothing ever failed and the retry control never appeared.
 *   D29  the probe crashed on every real take: the whole file was read as one base64
 *        string (1.34–1.70 GB against a 256 MB heap). It now reads a capped prefix.
 *   D30  the owner could not tell which take the clock belonged to.
 *
 * WHAT THIS SUITE PINS, in the order the plan lists them:
 *
 *   1. THE DEADLINE — the request is abortable, the abort is OURS, the timeout is a
 *      real span, and a fired deadline produces a sentence with a way out.
 *   2. THE SERVER'S ANSWER — `notes` and `timings` are parsed WHOLE or not at all,
 *      absent means "not measured" (never zero), and the frames the route computed
 *      are what the read uses, with the device pass left as the offline fallback.
 *   3. THE READ'S OWN RECORD — every finished read carries its take's label, whose
 *      pitch pass it was, the server's spans and the round trip; a vc61-shaped
 *      record still prints the exact line it printed before.
 *   4. THE PROBE — a capped read, and it says how much of the file it read.
 *
 * EVERY source guard is PROVEN TO BITE here: the same guard is re-run over a mutated
 * copy of the real bytes and must go FALSE (skills `musicapp-tier1-live-scan-suite`,
 * `musicapp-guard-mutation-probes`). A mutation that does not change the source fails
 * loudly instead of passing quietly.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import { maskComments } from '../src/services/modalBackContract';
import {
  READ_REQUEST_TIMEOUT_MS,
  READ_TIMEOUT_LINE,
  SERVER_NOTES_MAX,
  formatBytes,
  formatMs,
  parseServerNotes,
  parseServerTimings,
  readNetworkLine,
  serverTimingsLine,
} from '../src/services/readNetwork';
import {
  TAKE_LABEL_PREFIX,
  TAKE_LABEL_UNKNOWN,
  formatTakeClock,
  formatTakeLength,
  takeReadLabel,
  takeReadLabelLine,
} from '../src/services/takeReadLabel';
import {
  finishReadTiming,
  readTimingsLine,
  readTimingsServerLine,
} from '../src/services/takeReadTimings';
import { PROBE_MAX_READ_BYTES, probeReadBoundLine } from '../src/services/takeDecoderProbe';

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

/** A guard must go FALSE on the mutated bytes, and the mutation must really differ. */
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}

const SCREEN = readRepoFile('src/screens/PracticeVideoScreen.tsx');
const PROBE_CARD = readRepoFile('src/components/TakeDecoderProbeCard.tsx');
const SHIPPED_READ = readRepoFile('src/services/captureMidiExport.ts');
const CAPTURE_SEAM = readRepoFile('src/services/coachCapture.ts');
const NETWORK_MODEL = readRepoFile('src/services/readNetwork.ts');
const LABEL_MODEL = readRepoFile('src/services/takeReadLabel.ts');
const TIMINGS_MODEL = readRepoFile('src/services/takeReadTimings.ts');
const PACKAGE_JSON = readRepoFile('package.json');
const TIER1_TSCONFIG = readRepoFile('tsconfig.tier1.json');

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE DEADLINE (D32)
// ─────────────────────────────────────────────────────────────────────────────

function testTheDeadline(): void {
  console.log('\nPART 1 — THE READ HAS A DEADLINE');

  assertEq(READ_REQUEST_TIMEOUT_MS, 40000, 'the deadline is 40 s');
  // The measured answers are 1.1–4.1 s, so 40 s only ever fires on a stalled wire…
  assert(READ_REQUEST_TIMEOUT_MS > 4100, 'the deadline is far above the measured 4.1 s answer');
  // …and it sits INSIDE the screen's own 45 s bound, so the user gets a failure
  // with a retry rather than a "still reading" line that outlives the deadline.
  assert(READ_REQUEST_TIMEOUT_MS < 45000, 'the deadline fires before the screen’s own bound');
  assert(
    READ_TIMEOUT_LINE.indexOf('try the read again') >= 0,
    'the timeout sentence tells the user what to do',
  );
  assert(
    READ_TIMEOUT_LINE.indexOf('saved') >= 0,
    'the timeout sentence says the video and audio are saved',
  );

  // A fired deadline is a MEASUREMENT, not a blank failure.
  assertEq(
    readNetworkLine({
      httpStatus: null,
      errorName: 'AbortError',
      timedOut: true,
      bytesSent: 3200000,
      bytesReceived: null,
      serverTimings: null,
    }),
    'net: stopped after 40s (AbortError) · sent 3.2MB',
    'a deadline that fired prints the stop, the error name and the bytes sent',
  );
  assertEq(
    readNetworkLine({
      httpStatus: null,
      errorName: null,
      timedOut: false,
      bytesSent: null,
      bytesReceived: null,
      serverTimings: null,
    }),
    'net: no answer · sent ?',
    'an unreachable host is not called a timeout, and an unmeasured size is ?',
  );
  assertEq(
    readNetworkLine({
      httpStatus: 200,
      errorName: null,
      timedOut: false,
      bytesSent: 3200000,
      bytesReceived: 3400000,
      serverTimings: null,
    }),
    'net: HTTP 200 · sent 3.2MB · got 3.4MB',
    'an answer prints its status and both directions',
  );
  assertEq(
    readNetworkLine({
      httpStatus: 500,
      errorName: null,
      timedOut: false,
      bytesSent: 3200000,
      bytesReceived: 120,
      serverTimings: null,
    }),
    'net: HTTP 500 · sent 3.2MB · got 120B',
    'a rejected take prints the status the server chose',
  );
  assertEq(readNetworkLine(null), null, 'no round trip prints nothing at all');
  assertEq(formatBytes(null), '?', 'an unmeasured size is ?, never 0');
  assertEq(formatMs(undefined), '?', 'an unmeasured span is ?, never 0');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SERVER'S ANSWER (D26)
// ─────────────────────────────────────────────────────────────────────────────

function testTheServersAnswer(): void {
  console.log('\nPART 2 — THE SERVER’S FRAMES AND ITS OWN SPANS');

  // The frames.
  assertEq(parseServerNotes({ notes: [] }), null, 'an empty frame list is not trusted');
  assertEq(parseServerNotes({}), null, 'a payload with no notes falls back to the device pass');
  assertEq(parseServerNotes(null), null, 'a null payload falls back to the device pass');
  const good = [
    { tSec: 0, midi: 69, rms: 0.02 },
    { tSec: 0.025, midi: null, rms: 0 },
  ];
  const frames = parseServerNotes({ notes: good });
  assertEq(frames === null ? -1 : frames.length, 2, 'a fully usable frame list is handed on');
  assertEq(frames === null ? -2 : frames[1]!.midi, null, 'a silent frame keeps its null midi');
  assertEq(parseServerNotes({ notes: [{ tSec: -1, midi: 69, rms: 0.1 }] }), null, 'a negative time rejects the whole list');
  assertEq(parseServerNotes({ notes: [{ tSec: 0, midi: 69 }] }), null, 'a frame with no rms rejects the whole list');
  assertEq(parseServerNotes({ notes: [{ tSec: 0, midi: 'high', rms: 0.1 }] }), null, 'an unparseable midi rejects the whole list');
  assertEq(parseServerNotes({ notes: [null] }), null, 'a non-object frame rejects the whole list');
  const tooMany: Array<{ tSec: number; midi: number; rms: number }> = [];
  for (let i = 0; i <= SERVER_NOTES_MAX; i += 1) tooMany.push({ tSec: i, midi: 60, rms: 0.1 });
  assertEq(parseServerNotes({ notes: tooMany }), null, 'a list over the cap is rejected, not truncated');
  assertEq(SERVER_NOTES_MAX, 20000, 'the frame cap is 20,000 (~8 minutes at a 25 ms hop)');

  // The server's own spans.
  assertEq(parseServerTimings({}), null, 'an older deployment sends no timings, so nothing is invented');
  assertEq(parseServerTimings({ timings: {} }), null, 'an all-absent timings object is null, not zeros');
  const spans = parseServerTimings({ timings: { decodeMs: 44, pitchMs: 2929, totalMs: 3003 } });
  assertEq(spans === null ? -1 : spans.pitchMs, 2929, 'the route’s own pitch span is carried through');
  assertEq(
    serverTimingsLine(spans),
    'server: decode=44ms pitch=2929ms total=3003ms',
    'the server line prints the three spans it measured',
  );
  assertEq(
    serverTimingsLine(parseServerTimings({ timings: { decodeMs: 44, pitchMs: -5, totalMs: null } })),
    'server: decode=44ms pitch=? total=?',
    'a negative or absent span prints ?, never a number',
  );
  assertEq(serverTimingsLine(null), null, 'no server spans print nothing');

  // The frames the read uses, and the fallback that keeps offline working.
  assertEq(theReadUsesTheServersFrames(SHIPPED_READ), true, 'the shipped read uses the server’s frames');
  assertEq(theReadKeepsTheDeviceFallback(SHIPPED_READ), true, 'the device pass is still there for an offline phone');
}

/** The route's frames are used WHEN THEY CAME, and the pitch span is credited to them. */
function theReadUsesTheServersFrames(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 3000) return false;
  if (src.indexOf('const serverFrames = captured?.frames ?? null;') < 0) return false;
  if (src.indexOf('Array.isArray(serverFrames) && serverFrames.length > 0') < 0) return false;
  if (src.indexOf("? 'server' : 'device'") < 0) return false;
  if (src.indexOf('pitchSource,') < 0) return false;
  if (src.indexOf('serverTimings: captured?.serverTimings ?? null,') < 0) return false;
  return src.indexOf('network: captured?.network ?? null,') >= 0;
}

/** The device pass is UNCHANGED and still runs whenever the route sent no frames. */
function theReadKeepsTheDeviceFallback(source: string): boolean {
  const src = maskComments(source);
  if (src.indexOf('await detectPitchFramesAsync(captured.samples, captured.sampleRate)') < 0) return false;
  // The fallback is on the OTHER side of the same conditional, not a separate path.
  const at = src.indexOf('const serverFrames = captured?.frames ?? null;');
  if (at < 0) return false;
  const window = src.slice(at, at + 400);
  if (window.indexOf('detectPitchFramesAsync(') < 0) return false;
  return window.indexOf("? 'server' : 'device'") >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE READ'S OWN RECORD (D30) — labels, sources, fixtures
// ─────────────────────────────────────────────────────────────────────────────

function testTheReadsRecord(): void {
  console.log('\nPART 3 — EVERY READ SAYS WHICH TAKE IT TIMED');

  assertEq(formatTakeClock('not a date'), null, 'an unparseable stamp is null, never a made-up time');
  assertEq(formatTakeClock(null), null, 'a missing stamp is null');
  assertEq(formatTakeLength(0), null, 'a zero-length take has no length to print');
  assertEq(formatTakeLength(48), '0:48', 'a measured length prints m:ss');
  assertEq(formatTakeLength(180), '3:00', 'a 3-minute take prints 3:00');
  assertEq(formatTakeLength(null), null, 'an unmeasured length is null');
  assertEq(takeReadLabel(null), TAKE_LABEL_UNKNOWN, 'a take with no facts at all is "This take"');
  const iso = '2026-11-17T03:32:00.000Z';
  const clock = formatTakeClock(iso);
  assertEq(
    takeReadLabel({ filmedAt: iso, durationSec: 48 }),
    `${TAKE_LABEL_PREFIX} filmed at ${String(clock)} · 0:48 long`,
    'a labelled take says when it was filmed and how long it is',
  );
  assertEq(
    takeReadLabel({ filmedAt: null, durationSec: 12 }),
    `${TAKE_LABEL_UNKNOWN} · 0:12 long`,
    'a take with only its length still says the length',
  );
  assertEq(takeReadLabelLine(null), null, 'no label prints no row');
  assertEq(takeReadLabelLine('   '), null, 'a blank label prints no row');
  assertEq(takeReadLabelLine('This take'), 'This take', 'a real label is printed');

  // ── THE FIXTURES: what finishReadTiming now carries, and what an older record says ──
  const oldShape = finishReadTiming({
    stages: { upload: 6100, clientDecode: 180, pitch: 1900, build: 220 },
    totalMs: 8400,
  });
  assertEq(
    readTimingsLine(oldShape),
    'read: total=8400ms upload=6100ms unpack=180ms pitch=1900ms build=220ms draw=?',
    'a vc61-shaped read still prints exactly the line it printed before',
  );
  assertEq(oldShape.label ?? null, null, 'a read with no label carries null, not an empty string');
  assertEq(oldShape.pitchSource ?? null, null, 'a read with no source carries null');
  assertEq(readTimingsServerLine(oldShape), null, 'an older record prints no server or net line');

  const serverRead = finishReadTiming({
    stages: { upload: 1400, clientDecode: 180, pitch: 1, build: 220 },
    totalMs: 1500,
    audioSec: 48,
    label: takeReadLabel({ filmedAt: iso, durationSec: 48 }),
    pitchSource: 'server',
    server: { decodeMs: 44, pitchMs: 2929, totalMs: 3003 },
    network: {
      httpStatus: 200,
      errorName: null,
      timedOut: false,
      bytesSent: 3200000,
      bytesReceived: 3400000,
      serverTimings: null,
    },
  });
  assertEq(
    readTimingsLine(serverRead),
    'read: total=1500ms upload=1400ms unpack=180ms pitch=1ms@server build=220ms draw=?',
    'a server-read take credits the pitch span to the server',
  );
  assertEq(
    readTimingsServerLine(serverRead),
    'server: decode=44ms pitch=2929ms total=3003ms · net: HTTP 200 · sent 3.2MB · got 3.4MB',
    'the server’s own spans and the wire result sit beside the read',
  );
  assertEq(
    typeof serverRead.label === 'string' && serverRead.label.length > 0,
    true,
    'the read carries its take’s label',
  );

  const deviceRead = finishReadTiming({
    stages: { pitch: 1900 },
    totalMs: 4000,
    pitchSource: 'device',
  });
  assertEq(
    readTimingsLine(deviceRead),
    'read: total=4000ms upload=? unpack=? pitch=1900ms@device build=? draw=?',
    'an offline read credits the pitch span to the phone',
  );

  // A source we do not recognise is NOT invented onto the line.
  const bogus = finishReadTiming({
    stages: { pitch: 10 },
    totalMs: 20,
    pitchSource: 'guess' as unknown as 'server',
  });
  assertEq(bogus.pitchSource ?? null, null, 'an unrecognised pitch source is dropped, not printed');
  assertEq(
    readTimingsLine(bogus),
    'read: total=20ms upload=? unpack=? pitch=10ms build=? draw=?',
    'a dropped source leaves the pitch span bare',
  );

  // The deadline's own failure is a sentence, and it reaches the surface.
  assertEq(theReadFailsWithASentence(CAPTURE_SEAM), true, 'a failed read carries a sentence and a round trip');
  assertEq(theScreenShowsTheFailureAndItsRetry(SCREEN), true, 'the screen shows the failure and the retry');
}

/** The provider aborts on its own deadline and throws a failure that CARRIES the round trip. */
function theReadFailsWithASentence(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 4000) return false;
  if (src.indexOf('new AbortController()') < 0) return false;
  if (src.indexOf('controller.abort();') < 0) return false;
  if (src.indexOf('signal: controller?.signal,') < 0) return false;
  if (src.indexOf('}, timeoutMs)') < 0) return false;
  if (src.indexOf('timedOut = true;') < 0) return false;
  if (src.indexOf('READ_TIMEOUT_LINE') < 0) return false;
  if (src.indexOf('clearTimeout(timer);') < 0) return false;
  if (src.indexOf('class CoachReadFailedError') < 0) return false;
  if (src.indexOf('network: NetworkReadResult | null') < 0) return false;
  // A payload we cannot parse is a FAILURE with the round trip, not a silent fallback.
  return src.indexOf('throw new CoachReadFailedError(') >= 0;
}

/** With a deadline there is a failure, and a failure is what the retry renders on. */
function theScreenShowsTheFailureAndItsRetry(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 6000) return false;
  if (src.indexOf('setReadFailed(') < 0) return false;
  if (src.indexOf('retryTakeRead') < 0) return false;
  if (src.indexOf('onPress={retryTakeRead}') < 0) return false;
  // Every finished read is labelled and says whose pitch pass it was.
  if (countOf(src, 'finishReadTiming({') !== 2) return false;
  if (countOf(src, 'label: takeReadLabel({') !== 2) return false;
  if (countOf(src, 'pitchSource: derived') !== 2) return false;
  if (countOf(src, 'server: derived') !== 2) return false;
  return countOf(src, 'network: derived') === 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE PROBE (D29)
// ─────────────────────────────────────────────────────────────────────────────

function testTheProbe(): void {
  console.log('\nPART 4 — THE PROBE READS A CAPPED PREFIX');

  assertEq(PROBE_MAX_READ_BYTES, 12 * 1024 * 1024, 'the probe reads at most 12 MB');
  assertEq(
    probeReadBoundLine({ fileBytes: 2900000, readBytes: 2900000 }),
    'read: the whole 2.9MB file',
    'a whole-file read says it read the whole file',
  );
  const capped = probeReadBoundLine({ fileBytes: 1340000000, readBytes: PROBE_MAX_READ_BYTES });
  assert(capped.indexOf('capped read') >= 0, 'a capped read says so');
  assert(capped.indexOf('the first 12.6MB') >= 0, 'a capped read says how much it read');
  assert(capped.indexOf('1340.0MB') >= 0, 'a capped read says how big the file is');
  assertEq(
    probeReadBoundLine({ fileBytes: null, readBytes: 12582912 }),
    "read: the first 12.6MB (the file's own size could not be measured)",
    'an unmeasurable file size is said, not guessed',
  );
  assertEq(
    probeReadBoundLine({ fileBytes: null, readBytes: null }),
    'read: nothing was loaded from the file.',
    'a read that loaded nothing says exactly that',
  );
  assertEq(theProbeReadsACappedPrefix(PROBE_CARD), true, 'the shipped probe reads through a window');
}

/** The probe bounds the read BEFORE a byte reaches the heap, and says how much it read. */
function theProbeReadsACappedPrefix(cardSource: string): boolean {
  const card = maskComments(cardSource);
  if (card.length < 2000) return false;
  if (card.indexOf('FileSystem.readAsStringAsync(uri, {') < 0) return false;
  if (card.indexOf('position: 0,') < 0) return false;
  if (card.indexOf('length: PROBE_MAX_READ_BYTES,') < 0) return false;
  if (card.indexOf('probeReadBoundLine({ fileBytes: bytes, readBytes })') < 0) return false;
  if (card.indexOf('base64Bytes(base64)') < 0) return false;
  if (card.indexOf('takeReadLabelLine(timing.label ?? null)') < 0) return false;
  return card.indexOf('readTimingsServerLine(timing)') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. NO NEW SURFACE
// ─────────────────────────────────────────────────────────────────────────────

function testNoNewSurface(): void {
  console.log('\nPART 5 — THE NEW MODULES ADD NO NETWORK AND NO STORAGE');

  for (const [name, source] of [
    ['readNetwork.ts', NETWORK_MODEL],
    ['takeReadLabel.ts', LABEL_MODEL],
  ] as Array<[string, string]>) {
    const src = maskComments(source);
    assert(src.length > 500, `${name} is a real module`);
    assert(
      !/\bimport\b[^;]*?\bfrom\s+['"](react|react-native|expo[-a-z]*)['"]/.test(src),
      `${name} imports no react, react-native or expo module`,
    );
    assert(src.indexOf('fetch(') < 0, `${name} makes no request of its own`);
    assert(src.indexOf('AsyncStorage') < 0, `${name} stores nothing`);
    assert(src.indexOf('require(') < 0, `${name} requires nothing at runtime`);
  }
  assert(
    maskComments(TIMINGS_MODEL).indexOf('fetch(') < 0,
    'takeReadTimings.ts still makes no request of its own',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE GATE LISTS
// ─────────────────────────────────────────────────────────────────────────────

function testTheLists(): void {
  console.log('\nTHE GATE LISTS');

  const suiteName = 'vc62ServerNotesRead.test';
  assertEq(PACKAGE_JSON.indexOf(suiteName) >= 0, true, 'this suite is in the test:tier1 chain');
  assertEq(TIER1_TSCONFIG.indexOf(`scripts/${suiteName}.ts`) >= 0, true, 'this suite is in tsconfig.tier1.json');
  for (const module of [
    'src/services/readNetwork.ts',
    'src/services/takeReadLabel.ts',
    'src/services/takeDecoderProbe.ts',
    'src/services/takeReadTimings.ts',
  ]) {
    assertEq(TIER1_TSCONFIG.indexOf(`"${module}"`) >= 0, true, `${module} is in the tier1 type-check`);
  }
  assertEq(countOf(PACKAGE_JSON, `scripts/${suiteName}.js`) === 1, true, 'this suite runs exactly once');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. MUTATION PROBES — every guard must bite
// ─────────────────────────────────────────────────────────────────────────────

function testTheProbes(): void {
  console.log('\nMUTATION PROBES — every vc62 guard must bite');

  // 1 — the deadline is gone: no abort, so a hung read waits for ever again (D32).
  const noAbort = CAPTURE_SEAM.replace('controller.abort();', '');
  probe('part 1: the deadline never aborts the request', noAbort, CAPTURE_SEAM, () =>
    theReadFailsWithASentence(noAbort),
  );
  // 2 — the controller exists but is never attached, so nothing can be aborted.
  const unsignalled = CAPTURE_SEAM.replace('signal: controller?.signal,', '');
  probe('part 1: the request carries no abort signal', unsignalled, CAPTURE_SEAM, () =>
    theReadFailsWithASentence(unsignalled),
  );
  // 3 — a timeout that says "something went wrong" instead of what to do.
  const vagueTimeout = CAPTURE_SEAM.split('READ_TIMEOUT_LINE').join("'That take could not be read.'");
  probe('part 1: the timeout loses its sentence', vagueTimeout, CAPTURE_SEAM, () =>
    theReadFailsWithASentence(vagueTimeout),
  );
  // 4 — the failure stops carrying the measurement.
  const anonymousFailure = CAPTURE_SEAM.split('class CoachReadFailedError').join('class CoachCaptureUnavailableError');
  probe('part 1: the failure no longer carries the round trip', anonymousFailure, CAPTURE_SEAM, () =>
    theReadFailsWithASentence(anonymousFailure),
  );

  // 5 — the server's frames are ignored and the phone does the 15–25 s pass again (D26).
  const framesIgnored = SHIPPED_READ.replace('captured?.frames ?? null', 'null');
  probe('part 2: the server’s frames are ignored', framesIgnored, SHIPPED_READ, () =>
    theReadUsesTheServersFrames(framesIgnored),
  );
  // 6 — the frames are used but the line still blames the phone for them.
  const miscredited = SHIPPED_READ.replace("? 'server' : 'device'", "? 'device' : 'device'");
  probe('part 2: the pitch span is credited to the wrong device', miscredited, SHIPPED_READ, () =>
    theReadUsesTheServersFrames(miscredited),
  );
  // 7 — offline stops working: the device pass is removed from the fallback.
  const noFallback = SHIPPED_READ.replace(
    'await detectPitchFramesAsync(captured.samples, captured.sampleRate)',
    '[]',
  );
  probe('part 2: an offline phone can no longer read a take', noFallback, SHIPPED_READ, () =>
    theReadKeepsTheDeviceFallback(noFallback),
  );

  // 8 — one of the two reads is left unlabelled (D30).
  const unlabelled = SCREEN.replace('label: takeReadLabel({', 'label: null,');
  probe('part 3: a read is no longer labelled with its take', unlabelled, SCREEN, () =>
    theScreenShowsTheFailureAndItsRetry(unlabelled),
  );
  // 9 — a read stops recording whose pitch pass it was.
  const unsourced = SCREEN.split('pitchSource: derived').join('pitchSource: null');
  probe('part 3: a read no longer records whose pitch pass it was', unsourced, SCREEN, () =>
    theScreenShowsTheFailureAndItsRetry(unsourced),
  );
  // 10 — the failure is swallowed: no failed state, so the retry never renders (D31).
  const swallowed = SCREEN.split('setReadFailed(').join('void (');
  probe('part 3: the screen never enters its failed state', swallowed, SCREEN, () =>
    theScreenShowsTheFailureAndItsRetry(swallowed),
  );

  // 11 — the probe reads the whole file again (D29, the crash).
  const wholeFile = PROBE_CARD.replace('length: PROBE_MAX_READ_BYTES,', '');
  probe('part 4: the probe reads the whole file in one call', wholeFile, PROBE_CARD, () =>
    theProbeReadsACappedPrefix(wholeFile),
  );
  // 12 — the probe stops saying how much it read.
  const silentBound = PROBE_CARD.split('probeReadBoundLine({ fileBytes: bytes, readBytes })').join('null');
  probe('part 4: the probe stops saying how much it read', silentBound, PROBE_CARD, () =>
    theProbeReadsACappedPrefix(silentBound),
  );
  // 13 — the read's server/network lines are dropped from the card.
  const silentServer = PROBE_CARD.split('readTimingsServerLine(timing)').join('null');
  probe('part 4: the card stops printing the server and the wire', silentServer, PROBE_CARD, () =>
    theProbeReadsACappedPrefix(silentServer),
  );

  // 14 — the pure module grows a request of its own.
  const networked = `${NETWORK_MODEL}\nfetch('https://example.test');`;
  probe('part 5: readNetwork.ts starts making its own request', networked, NETWORK_MODEL, () =>
    theNetworkModelIsPure(networked),
  );

  // The guards are not vacuous: they PASS on the shipped bytes.
  assertEq(theReadFailsWithASentence(CAPTURE_SEAM), true, 'the deadline guard passes on the shipped provider');
  assertEq(theReadUsesTheServersFrames(SHIPPED_READ), true, 'the server-frames guard passes on the shipped read');
  assertEq(theReadKeepsTheDeviceFallback(SHIPPED_READ), true, 'the offline guard passes on the shipped read');
  assertEq(theScreenShowsTheFailureAndItsRetry(SCREEN), true, 'the label guard passes on the shipped screen');
  assertEq(theProbeReadsACappedPrefix(PROBE_CARD), true, 'the cap guard passes on the shipped probe');
  assertEq(theNetworkModelIsPure(NETWORK_MODEL), true, 'the purity guard passes on the shipped module');
}

/** The same purity rule the surface test applies, as a named guard so it can be mutated. */
function theNetworkModelIsPure(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 500) return false;
  if (/\bimport\b[^;]*?\bfrom\s+['"](react|react-native|expo[-a-z]*)['"]/.test(src)) return false;
  if (src.indexOf('fetch(') >= 0) return false;
  if (src.indexOf('AsyncStorage') >= 0) return false;
  return src.indexOf('require(') < 0;
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testTheDeadline();
  testTheServersAnswer();
  testTheReadsRecord();
  testTheProbe();
  testNoNewSurface();
  testTheLists();
  testTheProbes();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
