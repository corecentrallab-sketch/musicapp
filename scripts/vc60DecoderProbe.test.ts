/**
 * vc60DecoderProbe.test.ts — THE OPT-IN DECODER PROBE (spec §4).
 *
 * WHAT IT PINS:
 *   • the probe prints ONE line, in one fixed key order, with `?` for anything that
 *     was not measured — never an invented figure;
 *   • `float32` is COMPUTED from the PCM16 payload and the channel count;
 *   • `peak_heap` is a number only when Hermes really reports one, else `?`;
 *   • `survived` is `yes` only when the decode returned and the screen printed it;
 *   • GUARD 4 — the probe is OPT-IN: it mounts nothing until it is pressed, it writes
 *     nothing, the shipped notes read never calls it, and NOTES_COVERAGE_SECONDS is
 *     still 60. Every one of those is re-run over MUTATED REAL BYTES and required to
 *     fail there, including the case the guard exists for: the probe wired into the
 *     default read path.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import { theProbeIsOptIn } from '../src/services/vc60Contract';
import {
  PROBE_CTA,
  PROBE_FAILED_LINE,
  hermesHeapBytes,
  probeFloat32Bytes,
  probeLine,
  probeSampleCount,
} from '../src/services/takeDecoderProbe';
import { NOTES_COVERAGE_SECONDS } from '../src/services/notesCoverage';

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

const CARD = readRepoFile('src/components/TakeDecoderProbeCard.tsx');
const SCREEN = readRepoFile('src/screens/PracticeVideoScreen.tsx');
const SHIPPED_READ = readRepoFile('src/services/captureMidiExport.ts');
const CAPTURE_SEAM = readRepoFile('src/services/coachCapture.ts');

const INPUT = {
  probeCard: CARD,
  screen: SCREEN,
  shippedRead: SHIPPED_READ,
  captureSeam: CAPTURE_SEAM,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE LINE
// ─────────────────────────────────────────────────────────────────────────────

function testTheLine(): void {
  console.log('\nTHE PROBE\u2019S ONE LINE');

  // 22.05 kHz mono for 180 s = 3,969,000 frames = 7,938,000 PCM16 bytes.
  const pcm16Bytes = 7938000;
  assertEq(probeSampleCount(pcm16Bytes), 3969000, 'the samples come from the PCM16 payload we received');
  assertEq(
    probeFloat32Bytes({ pcm16Bytes, channels: 2 }),
    pcm16Bytes * 4,
    'float32 = samples \u00d7 channels \u00d7 4 bytes, computed',
  );
  assertEq(
    probeFloat32Bytes({ pcm16Bytes, channels: 1 }),
    pcm16Bytes * 2,
    'a mono decode is samples \u00d7 1 \u00d7 4',
  );

  const full = probeLine({
    fileBytes: 2900000,
    decodedSec: 180,
    sampleRate: 22050,
    channels: 1,
    pcm16Bytes,
    decodeMs: 8400,
    peakHeapBytes: 63500000,
    survived: true,
  });
  assertEq(
    full,
    'probe: file=2.9MB decoded=180.0s float32=15.9MB pcm16=7.9MB decode=8400ms peak_heap=63.5MB survived=yes',
    'the line reads exactly as the probe document specifies, in one fixed key order',
  );

  // NOTHING INVENTED: everything unmeasured is `?`.
  const unknown = probeLine({ fileBytes: null, decodedSec: null, pcm16Bytes: null, decodeMs: null, peakHeapBytes: null, survived: false });
  assertEq(
    unknown,
    'probe: file=? decoded=? float32=? pcm16=? decode=? peak_heap=? survived=no',
    'an attempt with no measurements prints ? for every figure and survived=no',
  );
  assert(
    PROBE_FAILED_LINE.indexOf('probe:') === 0 && PROBE_FAILED_LINE.indexOf('survived') < 0,
    'the failed line is still one probe line, and does not claim a survival figure',
  );
  assert(PROBE_CTA.indexOf('decoder test') > 0, 'the control is labelled as the decoder test');

  // THE HEAP, ONLY WHEN IT IS REALLY THERE.
  assertEq(hermesHeapBytes({}), null, 'no Hermes runtime \u2192 no heap figure');
  assertEq(
    hermesHeapBytes({ HermesInternal: { getInstrumentedStats: () => ({ heapSize: 12345678 }) } }),
    12345678,
    'a real Hermes stat is reported as bytes',
  );
  assertEq(
    hermesHeapBytes({
      HermesInternal: {
        getInstrumentedStats: () => {
          throw new Error('no stats');
        },
      },
    }),
    null,
    'a stats call that throws is `?`, never a guess',
  );
  assertEq(
    hermesHeapBytes({ HermesInternal: { getInstrumentedStats: () => ({}) } }),
    null,
    'stats with no heapSize are `?`',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GUARD 4 — OPT-IN, AND THE DEFAULT PATH UNCHANGED
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuard(): void {
  console.log('\nTHE PROBE IS OPT-IN AND THE SHIPPED READ IS UNTOUCHED');

  assert(theProbeIsOptIn(INPUT), 'GUARD 4: opt-in, unreachable from the shipped read, coverage still 60');
  assertEq(NOTES_COVERAGE_SECONDS, 60, 'GUARD 4: NOTES_COVERAGE_SECONDS is still 60 in this build');
  // Controls: the files the guard reads are the real ones.
  assert(CARD.indexOf('<WebView') >= 0, 'control: the probe really mounts the app\u2019s decoder page');
  assert(
    SHIPPED_READ.indexOf('deriveCaptureTakeFromRecording') >= 0,
    'control: the shipped read is the file the guard is reading',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE GUARD BITES
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardBites(): void {
  console.log('\nGUARD 4 BITES (mutated real source)');

  // (a) THE DEFECT THE GUARD EXISTS FOR: the probe wired into the shipped read path.
  const wiredIn = SHIPPED_READ.replace(
    "import { detectPitchFramesAsync } from './pitchDetection';",
    "import { detectPitchFramesAsync } from './pitchDetection';\nimport { TUNER_DECODER_HTML } from './tunerDecoder';",
  );
  assert(
    wiredIn !== SHIPPED_READ &&
      theProbeIsOptIn({ ...INPUT, shippedRead: wiredIn }) === false,
    'GUARD 4 bites: the shipped read importing the on-device decoder is rejected',
  );

  // (b) The seam itself calling the decoder.
  const seamWired = CAPTURE_SEAM.replace(
    "export const COACH_PCM_PATH = '/api/coach/pcm';",
    "export const COACH_PCM_PATH = '/api/coach/pcm';\nimport { TUNER_DECODER_HTML } from './tunerDecoder';",
  );
  assert(
    seamWired !== CAPTURE_SEAM &&
      theProbeIsOptIn({ ...INPUT, captureSeam: seamWired }) === false,
    'GUARD 4 bites: the capture seam importing the on-device decoder is rejected',
  );

  // (c) The probe decoding BEFORE the press: the WebView mounted unconditionally.
  const alwaysOn = CARD.replace('{armed ? (', '{true ? (');
  assert(
    alwaysOn !== CARD && theProbeIsOptIn({ ...INPUT, probeCard: alwaysOn }) === false,
    'GUARD 4 bites: a probe that mounts its decoder without the press is rejected',
  );

  // (d) A second WebView — a decoder that is not behind the one gate.
  const secondWeb = CARD.replace(
    '      {armed ? (',
    '      <WebView source={{ html: TUNER_DECODER_HTML }} />\n      {armed ? (',
  );
  assert(
    secondWeb !== CARD && theProbeIsOptIn({ ...INPUT, probeCard: secondWeb }) === false,
    'GUARD 4 bites: a second, ungated decoder WebView is rejected',
  );

  // (e) The probe writing to the user's History (it must measure, not record).
  const writer = CARD.replace(
    '    setArmed(true);',
    '    setArmed(true);\n    void savePracticeVideo();',
  );
  assert(
    writer !== CARD && theProbeIsOptIn({ ...INPUT, probeCard: writer }) === false,
    'GUARD 4 bites: a probe that writes to History is rejected',
  );

  // (f) The control unwired — a probe nobody can start, or one that starts itself.
  const noControl = CARD.replace('onPress={() => void run()}', 'onPress={() => undefined}');
  assert(
    noControl !== CARD && theProbeIsOptIn({ ...INPUT, probeCard: noControl }) === false,
    'GUARD 4 bites: a probe with no working control is rejected',
  );

  // (g) THE COVERAGE NUMBER RAISED WITHOUT THE NUMBERS TO BACK IT.
  assert(
    theProbeIsOptIn({ ...INPUT, coverage: 61 }) === false,
    'GUARD 4 bites: a raised coverage number is rejected until the probe\u2019s numbers say so',
  );

  // (h) The review page stops mounting the probe at all (a probe that cannot be run
  //     measures nothing). The mount is a multi-line JSX tag, so the mutation removes
  //     the tag itself rather than one exact single-line spelling of it.
  const notMounted = SCREEN.split('<TakeDecoderProbeCard').join('');
  assert(
    notMounted !== SCREEN &&
      theProbeIsOptIn({ ...INPUT, screen: notMounted }) === false,
    'GUARD 4 bites: a review page that does not mount the probe is rejected',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testTheLine();
  testTheGuard();
  testTheGuardBites();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
