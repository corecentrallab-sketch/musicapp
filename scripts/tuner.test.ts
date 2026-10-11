/**
 * tuner.test.ts — the TUNER's gate (owner APPROVED 10-10, backlog 2bbbbc8f).
 *
 * Three layers, all of them on real code:
 *
 *   1. PURE LOGIC — note naming, cents, needle, verdict, and the reading rules
 *      (trailing window, agreement, honest silence) driven by fixtures.
 *   2. THE REAL ENGINE, END TO END — a synthesised 440 Hz sine goes through
 *      `tunerReadingFromTake` → `detectPitchFrames` (the app's EXISTING YIN-lite
 *      tracker) and must come back as A4 within a couple of cents; a detuned sine
 *      must come back sharp/flat; noise must come back as "no single clear note".
 *      That is the offline claim tested with actual signal, not with a mock.
 *   3. LIVE-SOURCE GUARDS — the decoder page constant is self-contained (no URL,
 *      no fetch), the screen reads through the seam and the app's own decoder,
 *      has no dead ends, is reachable from Practice Tools, is free, and carries no
 *      banned claim. Every guard is shown to BITE on a mutated copy of the real
 *      text, and every guard is shown not to pass vacuously on empty input.
 *
 * Plain Node, no react-native, no network, no microphone. Run: npm run test:tier1
 */
import {
  centsFromNearestSemitone,
  describeTunerReading,
  noteNameFromMidi,
  tunerNeedlePercent,
  tunerReadingFromFrames,
  tunerReadingFromTake,
  tunerVerdict,
  tunerVerdictLabel,
  TUNER_CENTS_FULL_SCALE,
  TUNER_IN_TUNE_CENTS,
  TUNER_PITCH_AGREEMENT_SEMITONES,
  TUNER_READING_FRAMES,
  TUNER_TAKE_MS,
  type TunerReading,
} from '../src/services/tuner';
import type { PitchFrame } from '../src/services/pitchDetection';
import {
  buildTunerDecodeMessage,
  parseTunerDecoderReply,
  tunerDecoderPageIsSelfContained,
  TUNER_DECODER_CALL,
  TUNER_DECODER_HTML,
  TUNER_DECODER_MARKERS,
  TUNER_DECODER_FORBIDDEN,
} from '../src/services/tunerDecoder';
import {
  tier1ListsTheV39Features,
  tunerEntryPointsExist,
  tunerHasNoDeadEnd,
  tunerKeepsTheDecoderOnDevice,
  tunerReadsThroughTheExistingEngine,
  tunerSaysWhatItDoes,
  v39CopyAvoidsBannedClaims,
  v39HasNoNetwork,
  v39IsFreeAndUnpaywalled,
  v39ModuleStaysPure,
  V39_APP_PATH,
  V39_EDITOR_ENTRY_PATH,
  V39_PACKAGE_PATH,
  V39_TIER1_CONFIG_PATH,
  V39_TUNER_DECODER_PATH,
  V39_TUNER_METER_PATH,
  V39_TUNER_SCREEN_PATH,
  V39_TUNER_SERVICE_PATH,
  V39_TYPES_PATH,
} from '../src/services/v39UiContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

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
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

const SCREEN = readAppFile(V39_TUNER_SCREEN_PATH);
const METER = readAppFile(V39_TUNER_METER_PATH);
const SERVICE = readAppFile(V39_TUNER_SERVICE_PATH);
const DECODER = readAppFile(V39_TUNER_DECODER_PATH);
const EDITOR_ENTRY = readAppFile(V39_EDITOR_ENTRY_PATH);
const APP = readAppFile(V39_APP_PATH);
const TYPES = readAppFile(V39_TYPES_PATH);
const tsconfigSource = readAppFile(V39_TIER1_CONFIG_PATH);
const packageSource = readAppFile(V39_PACKAGE_PATH);
/** The tuner's user-facing sources, for the copy / network / paywall sweeps. */
const tunerSources = [SCREEN, METER, SERVICE, DECODER];

/** A deterministic frame series at one pitch (or silence) — no randomness. */
function frames(midi: number | null, count: number, rms = 0.25, t0 = 0): PitchFrame[] {
  const out: PitchFrame[] = [];
  for (let i = 0; i < count; i++) out.push({ tSec: t0 + i * 0.025, midi, rms });
  return out;
}
/** A pure sine take, 0.7 s, at the tuner's take length. */
function sine(hz: number, sampleRate = 44100, amplitude = 0.6): Float32Array {
  const length = Math.round((TUNER_TAKE_MS / 1000) * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}
/** Deterministic pseudo-noise (an LCG), so the "unclear" case is reproducible. */
function noise(sampleRate = 44100, amplitude = 0.4): Float32Array {
  const length = Math.round((TUNER_TAKE_MS / 1000) * sampleRate);
  const out = new Float32Array(length);
  let seed = 1234567;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = ((seed / 2147483648) * 2 - 1) * amplitude;
  }
  return out;
}

console.log('\ntuner — the pure readout (note naming, cents, needle, verdict)');

assertEq(noteNameFromMidi(69)?.display, 'A4', 'MIDI 69 is A4');
assertEq(noteNameFromMidi(60)?.display, 'C4', 'MIDI 60 is C4');
assertEq(noteNameFromMidi(49)?.display, 'C#3', 'MIDI 49 is C#3');
assertEq(noteNameFromMidi(40)?.display, 'E2', 'MIDI 40 is E2 (a guitar low E string)');
assertEq(noteNameFromMidi(64)?.display, 'E4', 'MIDI 64 is E4');
assertEq(noteNameFromMidi(Number.NaN), null, 'a non-finite pitch has no name');
assertEq(noteNameFromMidi(69)?.name, 'A', 'the letter name is separate from the octave');

assertEq(centsFromNearestSemitone(69), 0, 'a note exactly in tune is 0 cents');
assertEq(centsFromNearestSemitone(69.1), 10, '+0.1 semitone is +10 cents');
assertEq(centsFromNearestSemitone(68.97), -3, '−0.03 semitone is −3 cents');
assertEq(centsFromNearestSemitone(69.5), 50, 'half a semitone is +50 cents');
// THE NAME AND THE CENTS COME FROM THE SAME SEMITONE (v39 gate fix): a tie goes
// to the LOWER note, so the pair reads "A4 · +50 cents" and never "A#4 · +50".
assertEq(noteNameFromMidi(69.5)?.display, 'A4', 'a tie at half a semitone names the LOWER note');
assert(noteNameFromMidi(69.5)?.display !== noteNameFromMidi(70)?.display, 'and it is not the upper note');
assertEq(noteNameFromMidi(69.6)?.display, 'A#4', 'past the tie the upper note wins');
assertEq(centsFromNearestSemitone(69.6), -40, 'and the cents flip to the lower half of the band');
// THE INVARIANT: subtracting the reported cents from a pitch lands EXACTLY on the
// note that pitch was named after, for every pitch — so the screen can never show
// a name and a deviation that disagree about which semitone is sounding.
for (const midi of [69, 69.1, 68.97, 69.5, 69.6, 70, 60, 40, 82.41, 45.49]) {
  const named = noteNameFromMidi(midi)?.display;
  const back = noteNameFromMidi(midi - (centsFromNearestSemitone(midi) ?? 0) / 100)?.display;
  assertEq(named, back, `the name and the cents agree about the semitone (MIDI ${midi})`);
}
assert(Number.isNaN(centsFromNearestSemitone(Number.NaN)), 'a non-finite pitch has no cents');

assertEq(tunerVerdict(0), 'in-tune', '0 cents is in tune');
assertEq(tunerVerdict(-TUNER_IN_TUNE_CENTS), 'in-tune', 'the in-tune band is inclusive at −5¢');
assertEq(tunerVerdict(TUNER_IN_TUNE_CENTS), 'in-tune', 'the in-tune band is inclusive at +5¢');
assertEq(tunerVerdict(-6), 'flat', '−6 cents is flat');
assertEq(tunerVerdict(6), 'sharp', '+6 cents is sharp');

assertEq(tunerNeedlePercent(0), 50, 'in tune is the centre of the needle');
assertEq(tunerNeedlePercent(-TUNER_CENTS_FULL_SCALE), 0, '−50 cents is the far left');
assertEq(tunerNeedlePercent(TUNER_CENTS_FULL_SCALE), 100, '+50 cents is the far right');
assertEq(tunerNeedlePercent(-900), 0, 'a wild flat reading is clamped to the left edge');
assertEq(tunerNeedlePercent(900), 100, 'a wild sharp reading is clamped to the right edge');
assertEq(tunerNeedlePercent(-10), 40, '−10 cents sits left of centre');
assertEq(tunerNeedlePercent(Number.NaN), 50, 'a non-finite reading shows the needle at rest');

console.log('\ntuner — the reading rules (trailing window, agreement, honest silence)');

const steady = tunerReadingFromFrames(frames(69, 12));
assertEq(steady.kind, 'note', 'a steady A4 take names a note');
assertEq(steady.kind === 'note' ? steady.display : '', 'A4', 'and the name is A4');
assertEq(steady.kind === 'note' ? steady.cents : 1, 0, 'and it is exactly in tune');
assertEq(steady.kind === 'note' ? steady.inTune : false, true, 'and it reports in tune');

const sharpTake = tunerReadingFromFrames(frames(69 + 0.3, 12));
assertEq(sharpTake.kind === 'note' ? sharpTake.verdict : '', 'sharp', '+30 cents reads sharp');
const flatTake = tunerReadingFromFrames(frames(69 - 0.3, 12));
assertEq(flatTake.kind === 'note' ? flatTake.verdict : '', 'flat', '−30 cents reads flat');

const silent = tunerReadingFromFrames(frames(null, 12));
assertEq(silent.kind, 'no-signal', 'a silent take names nothing');
assertEq(silent.kind === 'no-signal' ? silent.reason : '', 'silent', 'and says it is silent');
const quiet = tunerReadingFromFrames(frames(69, 12, 0.0005));
assertEq(quiet.kind === 'no-signal' ? quiet.reason : '', 'silent', 'a frame under the RMS gate is not a note');
const oneFrame = tunerReadingFromFrames(frames(69, 1));
assertEq(oneFrame.kind === 'no-signal' ? oneFrame.reason : '', 'unclear', 'one confident frame is not enough to name a note');

// THE TRAILING WINDOW: the last frames win, not the whole take.
const moved = [...frames(45, 20), ...frames(69, TUNER_READING_FRAMES)];
const movedReading = tunerReadingFromFrames(moved);
assertEq(movedReading.kind === 'note' ? movedReading.display : '', 'A4', 'the reading comes from the END of the take');
// THE AGREEMENT RULE: a take that spans two notes is not named after the midpoint.
const split = [...frames(45, TUNER_READING_FRAMES / 2), ...frames(69, TUNER_READING_FRAMES / 2)];
const splitReading = tunerReadingFromFrames(split);
assertEq(splitReading.kind, 'no-signal', 'a take spanning two notes names neither');
assertEq(splitReading.kind === 'no-signal' ? splitReading.reason : '', 'unclear', 'and says the take was unclear, not silent');
assert(TUNER_PITCH_AGREEMENT_SEMITONES > 0 && TUNER_PITCH_AGREEMENT_SEMITONES < 1, 'the agreement band is under a semitone');
assertEq(tunerReadingFromFrames([]).kind, 'no-signal', 'no frames at all is no signal');
assertEq(tunerReadingFromFrames(null).kind, 'no-signal', 'a null frame list is no signal');
assertEq(tunerReadingFromFrames(undefined).kind, 'no-signal', 'an undefined frame list is no signal');
const counted = tunerReadingFromFrames(frames(69, 12));
assertEq(counted.kind === 'note' ? counted.confidentFrames : 0, TUNER_READING_FRAMES, 'the reading reports how many frames agreed');
assertEq(describeTunerReading(counted), 'A4 · 0 cents (in tune) · 440 Hz', 'the accessibility line reads the reading');
assertEq(tunerVerdictLabel(counted), 'In tune', 'the needle label says in tune');
assertEq(tunerVerdictLabel(sharpTake), 'Sharp — tune down', 'the needle label says which way to turn');
assertEq(tunerVerdictLabel(flatTake), 'Flat — tune up', 'the flat direction is the other way');
assertEq(tunerVerdictLabel(silent), '—', 'no reading means no verdict word');

console.log('\ntuner — THE REAL ENGINE, end to end (synthesised takes)');

const a440 = tunerReadingFromTake(sine(440), 44100);
assertEq(a440.kind, 'note', 'a 440 Hz sine produces a reading through the app’s existing tracker');
assertEq(a440.kind === 'note' ? a440.display : '', 'A4', '440 Hz is read as A4');
assert(a440.kind === 'note' && Math.abs(a440.cents) <= 5, '440 Hz is read within the in-tune band');
assert(a440.kind === 'note' && Math.abs(a440.frequencyHz - 440) <= 1.5, 'the reported frequency is 440 Hz');

const a3 = tunerReadingFromTake(sine(220), 44100);
assertEq(a3.kind === 'note' ? a3.display : '', 'A3', '220 Hz is read as A3 (an octave down)');
assert(a3.kind === 'note' ? Math.abs(a3.cents) <= 5 : false, '220 Hz is read in tune');

const sharpSine = tunerReadingFromTake(sine(444.5), 44100);
assertEq(sharpSine.kind === 'note' ? sharpSine.display : '', 'A4', '444.5 Hz is still A4');
assertEq(sharpSine.kind === 'note' ? sharpSine.verdict : '', 'sharp', 'and it is read as sharp');
assert(
  sharpSine.kind === 'note' && sharpSine.cents > 10 && sharpSine.cents < 26,
  'and its cents land where the maths says (+17.6)',
);

const flatSine = tunerReadingFromTake(sine(436), 44100);
assertEq(flatSine.kind === 'note' ? flatSine.verdict : '', 'flat', '436 Hz is read as flat');
assert(
  flatSine.kind === 'note' && flatSine.cents < -8 && flatSine.cents > -24,
  'and its cents land where the maths says (−15.9)',
);

const guitarLowE = tunerReadingFromTake(sine(82.41), 44100);
assertEq(guitarLowE.kind === 'note' ? guitarLowE.display : '', 'E2', 'a guitar’s low E (82.41 Hz) is read as E2');

const noiseTake = tunerReadingFromTake(noise(), 44100);
assertEq(noiseTake.kind, 'no-signal', 'noise is never named as a note');
const emptyTake = tunerReadingFromTake(new Float32Array(0), 44100);
assertEq(emptyTake.kind, 'no-signal', 'an empty take is no signal');

console.log('\ntuner — the on-device decoder page (self-contained, never a URL)');

assert(TUNER_DECODER_HTML.length > 1200, `the decoder page is a real page (${TUNER_DECODER_HTML.length} chars)`);
assertEq(tunerDecoderPageIsSelfContained(TUNER_DECODER_HTML), true, 'the page is self-contained');
assertEq(tunerDecoderPageIsSelfContained(''), false, 'an empty page is not a decoder page');
for (const marker of TUNER_DECODER_MARKERS) {
  assert(TUNER_DECODER_HTML.indexOf(marker) >= 0, `the page carries ${marker}`);
}
// The CALL, not only the name (v39 gate fix): the page must invoke the decoder it
// names — `decodeAudioDataLater(…)` would satisfy the marker and decode nothing.
assert(
  TUNER_DECODER_HTML.indexOf(TUNER_DECODER_CALL) >= 0,
  `the page CALLS the decoder (${TUNER_DECODER_CALL}…)`,
);
for (const banned of TUNER_DECODER_FORBIDDEN) {
  assert(TUNER_DECODER_HTML.indexOf(banned) < 0, `the page contains no ${banned}`);
}
assertEq(
  tunerDecoderPageIsSelfContained(TUNER_DECODER_HTML.replace('decodeAudioData', 'decodeAudioDataLater')),
  false,
  'MUTATION: a page that cannot decode fails the guard',
);
assertEq(
  tunerDecoderPageIsSelfContained(TUNER_DECODER_HTML.replace(/decodeAudioData\(/g, 'decodeAudioLater(')),
  false,
  'MUTATION: a page whose decoder call was renamed fails the guard',
);
assertEq(
  tunerDecoderPageIsSelfContained(`${TUNER_DECODER_HTML}\nfetch('/api/coach/pcm');`),
  false,
  'MUTATION: a page that fetches fails the guard',
);
// The audit list itself must not read as network access in the sweep that reads
// THIS file (it is built from pieces for exactly that reason). Split here too, so
// this suite is not itself a source of the tokens it audits.
assertEq(
  TUNER_DECODER_FORBIDDEN.indexOf('http' + ':' + '//') >= 0 &&
    TUNER_DECODER_FORBIDDEN.indexOf('fetch' + '(') >= 0,
  true,
  'the forbidden-token list still holds the real tokens, just built from pieces',
);

const request = buildTunerDecodeMessage('take-1', 'AAAA', 'audio/mp4');
const parsedRequest = JSON.parse(request) as { type: string; id: string; audioBase64: string };
assertEq(parsedRequest.type, 'decode', 'the request names the decode action');
assertEq(parsedRequest.id, 'take-1', 'the request carries the take id');
assertEq(parsedRequest.audioBase64, 'AAAA', 'the request carries the take bytes');
assertEq(buildTunerDecodeMessage('x', undefined as unknown as string).indexOf('"audioBase64":""') > 0, true, 'a missing payload is sent as empty, never undefined');

assertEq(parseTunerDecoderReply('{"type":"ready"}').kind, 'ready', 'the ready reply is understood');
const decodedReply = parseTunerDecoderReply(
  '{"type":"decoded","id":"t1","sampleRate":44100,"channels":2,"pcm16Base64":"AAAB"}',
);
assertEq(decodedReply.kind, 'decoded', 'a decoded reply is understood');
assertEq(decodedReply.kind === 'decoded' ? decodedReply.sampleRate : 0, 44100, 'with its sample rate');
assertEq(decodedReply.kind === 'decoded' ? decodedReply.channels : 0, 2, 'with its channel count');
assertEq(parseTunerDecoderReply('{"type":"error","id":null,"message":"no"}').kind, 'error', 'an error reply is understood');
assertEq(parseTunerDecoderReply('not json').kind, 'unknown', 'garbage is unknown, never a guess');
assertEq(parseTunerDecoderReply('').kind, 'unknown', 'an empty reply is unknown');
assertEq(parseTunerDecoderReply('{"type":"decoded","id":"t1"}').kind, 'unknown', 'a decoded reply with no samples is unknown');
assertEq(parseTunerDecoderReply('{"type":"decoded","id":"t1","sampleRate":0,"pcm16Base64":"AA"}').kind, 'unknown', 'a zero sample rate is unknown');
assertEq(parseTunerDecoderReply('{"type":"something-else"}').kind, 'unknown', 'an unknown action is unknown');

console.log('\ntuner — the live-source walk (floors first)');
assert(SCREEN.length > 6000, `read ${V39_TUNER_SCREEN_PATH} (${SCREEN.length} chars)`);
assert(METER.length > 2000, `read ${V39_TUNER_METER_PATH} (${METER.length} chars)`);
assert(SERVICE.length > 6000, `read ${V39_TUNER_SERVICE_PATH} (${SERVICE.length} chars)`);
assert(DECODER.length > 4000, `read ${V39_TUNER_DECODER_PATH} (${DECODER.length} chars)`);
assert(EDITOR_ENTRY.length > 2000, `read ${V39_EDITOR_ENTRY_PATH} (${EDITOR_ENTRY.length} chars)`);
assert(APP.length > 8000, `read ${V39_APP_PATH} (${APP.length} chars)`);
assertEq(tunerSources.length, 4, 'the tuner sweep covers its four user-facing sources');

console.log('\ntuner guards');
assertEq(tunerReadsThroughTheExistingEngine(SCREEN), true, 'the screen reads through the app’s own engine and decoder');
assertEq(tunerKeepsTheDecoderOnDevice(SCREEN), true, 'the decoder is an inline page, and the page is self-contained');
assertEq(tunerHasNoDeadEnd(SCREEN), true, 'both recorder failures are read and every decode failure has a line');
assertEq(tunerSaysWhatItDoes(SCREEN, SERVICE), true, 'the surface says one note at a time, on your device, free');
assertEq(tunerEntryPointsExist({ editor: EDITOR_ENTRY, app: APP, types: TYPES }), true, 'Practice Tools, the root stack and the route type all carry it');
assertEq(v39HasNoNetwork(tunerSources), true, 'nothing in the tuner path can reach the network');
assertEq(v39IsFreeAndUnpaywalled(tunerSources), true, 'no Pro/paywall/subscription token anywhere in the path');
assertEq(v39CopyAvoidsBannedClaims(tunerSources), true, 'no banned claim on the tuner’s surface');
assertEq(v39ModuleStaysPure(SERVICE), true, 'services/tuner.ts stays pure');
assertEq(v39ModuleStaysPure(DECODER), true, 'services/tunerDecoder.ts stays pure');
assertEq(tier1ListsTheV39Features(tsconfigSource, packageSource), true, 'every v39 module and suite is in BOTH gate lists');

console.log('\ntuner — the guards are not vacuous (empty input)');
assertEq(v39ModuleStaysPure(''), false, 'an empty module is not pure-by-omission');
assertEq(tunerReadsThroughTheExistingEngine(''), false, 'an empty screen reads nothing through the engine');
assertEq(tunerKeepsTheDecoderOnDevice(''), false, 'an empty screen hosts no decoder');
assertEq(tunerHasNoDeadEnd(''), false, 'an empty screen has no failure paths');
assertEq(tunerSaysWhatItDoes('', ''), false, 'an empty pair says nothing');
assertEq(tunerEntryPointsExist({ editor: '', app: '', types: '' }), false, 'empty entry points mean no way in');
assertEq(v39HasNoNetwork([]), false, 'an empty source list proves no network block');
assertEq(v39IsFreeAndUnpaywalled([]), false, 'an empty set is not free-by-omission');
assertEq(v39CopyAvoidsBannedClaims([]), false, 'an empty copy set passes nothing');
assertEq(tier1ListsTheV39Features('', ''), false, 'empty lists do not gate the feature');

console.log('\ntuner — MUTATION PROBES (each guard must bite)');
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}
const directDetector = SCREEN.replace(
  'decodePcm16Base64(reply.pcm16Base64, reply.channels)',
  'detectPitchFrames(new Float32Array(0), 44100)',
);
probe('a second engine is called in the screen', directDetector, SCREEN, () =>
  tunerReadsThroughTheExistingEngine(directDetector),
);
const ownDecoder = SCREEN.replace('decodePcm16Base64(', 'atob(');
probe('the screen stops using the app’s decoder', ownDecoder, SCREEN, () =>
  tunerReadsThroughTheExistingEngine(ownDecoder),
);
const urlSource = SCREEN.replace('source={{ html: TUNER_DECODER_HTML }}', 'source={{ uri: TUNER_DECODER_URL }}');
probe('the decoder page becomes a URL', urlSource, SCREEN, () =>
  tunerKeepsTheDecoderOnDevice(urlSource),
);
const silentStart = SCREEN.replace('takeStartFailure()', 'null');
probe('the mic start failure is never read', silentStart, SCREEN, () =>
  tunerHasNoDeadEnd(silentStart),
);
/**
 * The timeout probe replaces the constant EVERYWHERE in the screen (the /g is the
 * point): the FIRST occurrence in the file is the import, so a single replace left
 * the screen still reading the timeout line and the guard could not bite — a dead
 * probe, not a passing guard (v39 gate fix).
 */
const noTimeout = SCREEN.replace(/TUNER_DECODE_TIMEOUT_LINE/g, 'TUNER_DECODE_FAIL_LINE');
probe('the decoder timeout loses its own line', noTimeout, SCREEN, () =>
  tunerHasNoDeadEnd(noTimeout),
);
const noCard = EDITOR_ENTRY.replace("navigation.navigate('Tuner')", "navigation.navigate('Editor')");
probe('Practice Tools loses the tuner door', noCard, EDITOR_ENTRY, () =>
  tunerEntryPointsExist({ editor: noCard, app: APP, types: TYPES }),
);
const noRoute = APP.replace('name="Tuner"', 'name="TunerGone"');
probe('the root stack stops registering the tuner', noRoute, APP, () =>
  tunerEntryPointsExist({ editor: EDITOR_ENTRY, app: noRoute, types: TYPES }),
);
const noType = TYPES.replace('Tuner: undefined;', '');
probe('the route leaves the param list', noType, TYPES, () =>
  tunerEntryPointsExist({ editor: EDITOR_ENTRY, app: APP, types: noType }),
);
const networkedScreen = SCREEN.replace(
  'const recorder = useAudioRecorder();',
  "const recorder = useAudioRecorder();\nasync function send() {\n  await fetch('https://notesnap.app/api/tuner');\n}",
);
probe('the screen grows a network call', networkedScreen, SCREEN, () =>
  v39HasNoNetwork([networkedScreen]),
);
const paywalledScreen = SCREEN.replace(
  'const recorder = useAudioRecorder();',
  'const isPro = false;\n  const recorder = useAudioRecorder();',
);
probe('the screen grows a Pro gate', paywalledScreen, SCREEN, () =>
  v39IsFreeAndUnpaywalled([paywalledScreen]),
);
/**
 * The copy probe targets a line the tuner service REALLY has (v39 gate fix): it
 * previously replaced 'Runs on your device', which no longer exists in
 * services/tuner.ts, so the mutation changed nothing and the probe was dead. The
 * replacement claims exactly what the tuner must never claim.
 */
const dishonestCopy = SERVICE.replace(
  'Reads the sound on your device',
  'Transcribed in real time, studio quality',
);
probe('the copy claims transcription and a studio', dishonestCopy, SERVICE, () =>
  v39CopyAvoidsBannedClaims([dishonestCopy]),
);
const impureService = SERVICE.replace(
  "import {\n  detectPitchFrames,",
  "import { Platform } from 'react-native';\nimport {\n  detectPitchFrames,",
);
probe('the pure service grows a native import', impureService, SERVICE, () =>
  v39ModuleStaysPure(impureService),
);
const unlistedSuite = packageSource.replace(' && node /tmp/tier1-test/scripts/tuner.test.js', '');
probe('the tuner suite leaves the test:tier1 chain', unlistedSuite, packageSource, () =>
  tier1ListsTheV39Features(tsconfigSource, unlistedSuite),
);
const unlistedModule = tsconfigSource.replace('    "src/services/tuner.ts",\n', '');
probe('the tuner service leaves tsconfig.tier1.json', unlistedModule, tsconfigSource, () =>
  tier1ListsTheV39Features(unlistedModule, packageSource),
);

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
