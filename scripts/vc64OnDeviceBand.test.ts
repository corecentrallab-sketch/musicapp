/**
 * vc64OnDeviceBand.test.ts — THE PHONE'S OWN PITCH PASS STOPS FOLLOWING THE ROOM
 * (vc64 / D39).
 *
 * THE DEFECT, as the owner reported it (11-20): *"that may be an anomaly from the
 * detector — samples are not usually (or ever) that low within the playing
 * range."* He was right, and it reproduced on demand. Three clips with an
 * IDENTICAL 220 Hz hum, only the rumble differing, came back 57 / 33 / 38 — the
 * last two are the 55 Hz and 80 Hz rumble, three octaves below the melody. The
 * server pass was fixed for exactly this and measured live on 11-20; the app's
 * own pass — the one that runs when the network read fails, i.e. what an OFFLINE
 * hum gets — still had the old unbanded search, so the same hum still fell to the
 * room whenever the phone had to read it itself.
 *
 * WHAT THIS SUITE PINS, on the owner's own clips (`scripts/fixtures/detector-repro`,
 * copied byte-for-byte from /home/team/shared/detector-repro):
 *
 *   1. THE RULE — the server's three constants, ported: an 85 Hz high-pass, an
 *      80–1200 Hz search band, and the 200–2000 Hz harmonic band.
 *   2. THE CLIPS — a, b and c ALL read A3 (MIDI 57) on every pitched frame, in
 *      both the synchronous read and the sliced read the device actually uses.
 *      This is the assertion that FAILS when the high-pass is removed: b and c
 *      fall to 33 and 38, exactly the numbers the owner saw.
 *   3. THE FILTER ITSELF — it attenuates a 55 Hz rumble hard and leaves a 440 Hz
 *      hum alone, so the band-limit is real and not a constant in a comment.
 *   4. THE HONEST FAILURE — a take that is ONLY rumble gets no pitch at all
 *      rather than a confident low guess, and nothing is ever reported below the
 *      band.
 *   5. THE LEVEL IS STILL THE TAKE'S — each frame's `rms` is the unfiltered
 *      window's level, so the app's level readout does not move.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  DEFAULT_MAX_FREQ_HZ,
  DEFAULT_MIN_FREQ_HZ,
  DEFAULT_WINDOW_SAMPLES,
  HARMONIC_BAND_HIGH_HZ,
  HARMONIC_BAND_LOW_HZ,
  HIGHPASS_CUTOFF_HZ,
  detectPitchFrames,
  detectPitchFramesAsync,
  highPassForDetection,
  type PitchFrame,
} from '../src/services/pitchDetection';

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

const fs = require('fs') as { readFileSync(path: string): Uint8Array };

let passes = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passes++;
    return;
  }
  failures.push(label);
  console.error(`FAIL  ${label}`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} — expected ${String(expected)}, got ${String(actual)}`);
}

/** The melody the clips hum, in MIDI: A3. */
const HUM_MIDI = 57;
/** Lowest MIDI the search band can return: 80 Hz sits just above MIDI 39 (E2). */
const BAND_FLOOR_MIDI = 39;

// ─── WAV decoding (22.05 kHz, mono, 16-bit PCM) ─────────────────────────────

function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function i16le(bytes: Uint8Array, at: number): number {
  const raw = (bytes[at] | (bytes[at + 1] << 8)) & 0xffff;
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

/** A RIFF/WAVE file → { sampleRate, samples in −1..1 }. */
function decodeWav(path: string): { sampleRate: number; samples: Float32Array } {
  const bytes = fs.readFileSync(path);
  if (fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }
  let at = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  while (at + 8 <= bytes.length) {
    const id = fourCC(bytes, at);
    const size = u32le(bytes, at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      channels = bytes[body + 2] | (bytes[body + 3] << 8);
      sampleRate = u32le(bytes, body + 4);
      bits = bytes[body + 14] | (bytes[body + 15] << 8);
    } else if (id === 'data') {
      if (bits !== 16 || channels < 1) {
        throw new Error(`${path}: only 16-bit PCM is expected (got ${bits}-bit, ${channels} ch)`);
      }
      const frames = Math.floor(size / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        samples[i] = i16le(bytes, body + i * 2 * channels) / 32768;
      }
      return { sampleRate, samples };
    }
    at = body + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk`);
}

const FIXTURE_DIR = `${process.cwd()}/scripts/fixtures/detector-repro`;

function clip(name: string): { sampleRate: number; samples: Float32Array } {
  return decodeWav(`${FIXTURE_DIR}/${name}.wav`);
}

// ─── 1. The rule ────────────────────────────────────────────────────────────

function testTheRule(): void {
  console.log('\n— the server rule, ported unchanged —');
  assertEq(HIGHPASS_CUTOFF_HZ, 85, 'the high-pass corner is 85 Hz');
  assertEq(DEFAULT_MIN_FREQ_HZ, 80, 'the search band starts at 80 Hz');
  assertEq(DEFAULT_MAX_FREQ_HZ, 1200, 'the search band ends at 1200 Hz');
  assertEq(HARMONIC_BAND_LOW_HZ, 200, 'the harmonic band starts at 200 Hz');
  assertEq(HARMONIC_BAND_HIGH_HZ, 2000, 'the harmonic band ends at 2000 Hz');
  assertEq(DEFAULT_WINDOW_SAMPLES, 2048, 'the analysis window is unchanged');
}

// ─── 2. The owner's clips ───────────────────────────────────────────────────

/** The pitch every pitched frame agrees on, or NaN when they disagree / none. */
function agreedMidi(frames: PitchFrame[]): number {
  const pitched = frames
    .map((frame) => frame.midi)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (pitched.length === 0) return Number.NaN;
  const rounded = pitched.map((value) => Math.round(value));
  return rounded.every((value) => value === rounded[0]) ? rounded[0] : Number.NaN;
}

/**
 * THE NOTE THE APP DRAWS: the median of the pitched frames, rounded — the same
 * statistic `segmentsToPlayedNotes` takes for a note's pitch. A handful of frames
 * can sit an octave under the hum on a two-tone clip (110 Hz is the strongest
 * periodicity in a 220 Hz hum over an 80 Hz rumble, and the server's pass does the
 * same); the NOTE is still the hum.
 */
function noteMidi(frames: PitchFrame[]): number {
  const pitched = frames
    .map((frame) => frame.midi)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (pitched.length === 0) return Number.NaN;
  const mid = Math.floor(pitched.length / 2);
  return Math.round(pitched[mid]);
}

/** What share of the frames read `midi`. */
function shareAt(frames: PitchFrame[], midi: number): number {
  if (frames.length === 0) return 0;
  const hits = frames.filter((frame) => typeof frame.midi === 'number' && Math.round(frame.midi) === midi);
  return hits.length / frames.length;
}

async function testTheClips(): Promise<void> {
  console.log('\n— the owner’s three clips: hum alone, hum + 55 Hz, hum + 80 Hz —');

  const names = ['a-hum-only', 'b-hum-rumble55', 'c-hum-rumble80'];
  for (const name of names) {
    const { sampleRate, samples } = clip(name);
    assertEq(sampleRate, 22050, `${name}: fixture is 22.05 kHz`);
    const frames = detectPitchFrames(samples, sampleRate);
    assert(frames.length > 0, `${name}: the read produces frames`);
    assertEq(noteMidi(frames), HUM_MIDI, `${name}: the take reads A3 (MIDI 57)`);
    const share = shareAt(frames, HUM_MIDI);
    assert(
      share >= 0.95,
      `${name}: nearly every frame reads A3 (${(share * 100).toFixed(1)}%, want ≥ 95%)`,
    );
    assert(
      frames.every((frame) => typeof frame.midi !== 'number' || frame.midi >= BAND_FLOOR_MIDI),
      `${name}: no frame is reported below the 80 Hz band floor`,
    );
  }

  // The hum-only clip is the control: it must read A3 on EVERY frame, so a
  // change that moves a clean hum is caught as well as one that leaves the
  // rumble in.
  const a = detectPitchFrames(clip('a-hum-only').samples, 22050);
  assertEq(agreedMidi(a), HUM_MIDI, 'the hum-only control reads A3 on every frame, unchanged');

  // The rumble clips are the whole point: the OLD pass read them as the rumble
  // (33 and 38) and the fixed one must not. Spelled out so a regression names
  // the number the owner actually saw instead of just "not 57".
  const b = noteMidi(detectPitchFrames(clip('b-hum-rumble55').samples, 22050));
  const c = noteMidi(detectPitchFrames(clip('c-hum-rumble80').samples, 22050));
  assert(b !== 33 && c !== 38, 'the rumble is never reported as the melody (33 / 38 are gone)');
  assertEq(b, HUM_MIDI, 'the 55 Hz rumble clip reads the hum, not the rumble');
  assertEq(c, HUM_MIDI, 'the 80 Hz rumble clip reads the hum, not the rumble');

  // THE DEVICE'S PATH IS THE SLICED ONE: when the network read fails the app
  // runs `detectPitchFramesAsync`, so it must give the identical reading.
  await testTheSlicedReadAgrees(names);
}

async function testTheSlicedReadAgrees(names: string[]): Promise<void> {
  for (const name of names) {
    const { sampleRate, samples } = clip(name);
    const sliced = await detectPitchFramesAsync(samples, sampleRate);
    assertEq(noteMidi(sliced), HUM_MIDI, `${name}: the sliced on-device read also reads A3`);
    const sync = detectPitchFrames(samples, sampleRate);
    assertEq(
      sliced.length,
      sync.length,
      `${name}: the sliced read returns the same frame count as the sync read`,
    );
    assert(
      sliced.every((frame, i) => frame.midi === sync[i].midi && frame.rms === sync[i].rms),
      `${name}: the sliced read is frame-for-frame identical to the sync read`,
    );
  }
}

// ─── 3. The filter itself ───────────────────────────────────────────────────

function sine(hz: number, seconds: number, sampleRate: number, amplitude = 0.3): Float32Array {
  const total = Math.round(seconds * sampleRate);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function testTheFilter(): void {
  console.log('\n— the band-limit is a filter, not a comment —');
  const rate = 22050;
  // Skip the filter's own start-up transient so the measurement is the steady state.
  const skip = 2205;
  const steady = (samples: Float32Array): number => rmsOf(samples.subarray(skip));

  const rumble = sine(55, 1, rate);
  const rumbleDb = 20 * Math.log10(steady(highPassForDetection(rumble, rate)) / steady(rumble));
  assert(rumbleDb < -12, `a 55 Hz rumble is attenuated (measured ${rumbleDb.toFixed(1)} dB, want < -12)`);

  const hum = sine(220, 1, rate);
  const humDb = 20 * Math.log10(steady(highPassForDetection(hum, rate)) / steady(hum));
  assert(Math.abs(humDb) < 1, `a 220 Hz hum passes untouched (measured ${humDb.toFixed(2)} dB)`);

  const high = sine(440, 1, rate);
  const highDb = 20 * Math.log10(steady(highPassForDetection(high, rate)) / steady(high));
  assert(Math.abs(highDb) < 1, `a 440 Hz note passes untouched (measured ${highDb.toFixed(2)} dB)`);
}

// ─── 4. The honest failure ──────────────────────────────────────────────────

function testTheHonestFailure(): void {
  console.log('\n— a take that is only rumble gets no note —');
  const rate = 22050;
  const rumbleOnly = new Float32Array(rate);
  for (let i = 0; i < rumbleOnly.length; i++) {
    rumbleOnly[i] =
      0.25 * Math.sin((2 * Math.PI * 55 * i) / rate) + 0.25 * Math.sin((2 * Math.PI * 80 * i) / rate);
  }
  const frames = detectPitchFrames(rumbleOnly, rate);
  assert(frames.length > 0, 'the rumble-only take is long enough to read');
  assert(
    frames.every((frame) => frame.midi === null || frame.midi >= BAND_FLOOR_MIDI),
    'no frame of a rumble-only take is reported below the band',
  );
  const below = frames.filter((frame) => typeof frame.midi === 'number' && frame.midi < BAND_FLOOR_MIDI);
  assertEq(below.length, 0, 'the room is never reported as a pitch');

  const silence = detectPitchFrames(new Float32Array(rate), rate);
  assert(silence.every((frame) => frame.midi === null), 'silence is still an honest null');
}

// ─── 5. The level readout is the take's own ─────────────────────────────────

function testTheLevelIsTheTakes(): void {
  console.log('\n— the level readout is still the take’s —');
  const { sampleRate, samples } = clip('b-hum-rumble55');
  const frames = detectPitchFrames(samples, sampleRate);
  const window = DEFAULT_WINDOW_SAMPLES;
  for (const index of [0, Math.floor(frames.length / 2), frames.length - 1]) {
    const start = Math.round(frames[index].tSec * sampleRate);
    const raw = rmsOf(samples.subarray(start, start + window));
    assert(
      Math.abs(frames[index].rms - raw) < 1e-6,
      `frame ${index}: the reported level is the unfiltered window's (${frames[index].rms.toFixed(5)} vs ${raw.toFixed(5)})`,
    );
  }
}

// ─── RUN ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  testTheRule();
  await testTheClips();
  testTheFilter();
  testTheHonestFailure();
  testTheLevelIsTheTakes();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

void main();
