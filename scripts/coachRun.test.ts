/**
 * Unit tests for the practice-coach slice 3 pure logic:
 *   - src/services/wavCapture.ts — bytes → mono Float32 samples (RIFF/WAV,
 *     base64 PCM16, resampling, the coach sample-rate funnel)
 *   - src/services/pieceAbc.ts  — which reference melody a piece resolves to
 *   - src/services/coachRun.ts  — the record → score state machine + the
 *     honest outcome copy (accuracy is null unless it was measured)
 *
 * Run with: npm run test:tier1
 * Compiles the pure modules + this test to CommonJS and runs under plain Node
 * (same convention as scripts/tier1.test.ts / practiceCoach.test.ts /
 * coachPipeline.test.ts — no test framework, no app runtime, no microphone).
 *
 * Every audio case here is SYNTHETIC: WAV byte buffers and sine tones built in
 * this file, so expected values are arithmetic rather than opinion.
 */
import {
  bytesFromBase64,
  clampSample,
  decodePcm16Base64,
  decodeWavToFloat32,
  resampleLinear,
  toCoachSamples,
  WavDecodeError,
  COACH_TARGET_SAMPLE_RATE,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_PCM,
} from '../src/services/wavCapture';
import { ABC_SEEDS, normalizePieceKey, resolvePieceAbc } from '../src/services/pieceAbc';
import {
  coachRunReducer,
  coachUnavailableOutcome,
  coachNoReferenceOutcome,
  initialCoachRunState,
  isScorableOutcome,
  scoreCoachRun,
  summarizeHistory,
  CAPTURE_UNAVAILABLE_LINE,
  DEFAULT_RUN_ERROR,
  MIN_COACH_RUN_SECONDS,
  type CoachRunOutcome,
  type CoachRunState,
} from '../src/services/coachRun';
import { midiToHz } from '../src/services/pitchDetection';
import type { PracticeSession } from '../src/services/practiceHistory';
import { DEFAULT_ABC_TEMPO_BPM } from '../src/services/abcToReference';

declare const process: { exit(code: number): never };

let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (expected ${String(expected)}, got ${String(actual)})`);
  }
}
function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (ok) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (expected ${expected} ±${tol}, got ${actual})`);
  }
}
function assertThrows(fn: () => unknown, msg: string): void {
  try {
    fn();
    failures++;
    console.error(`  ✗ FAILED: ${msg} (nothing thrown)`);
  } catch (err) {
    passes++;
    console.log(`  ✓ ${msg} (${err instanceof Error ? err.message : String(err)})`);
  }
}

// ─── Synthetic WAV builders ─────────────────────────────────────

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Build a RIFF/WAVE buffer. `samples` is interleaved: length must be
 * frameCount × channels.
 */
function buildWav(opts: {
  samples: number[];
  channels: number;
  sampleRate: number;
  bitsPerSample: 16 | 24 | 32;
  float?: boolean;
  /** Insert a LIST chunk before `data` (real-world files carry one). */
  withListChunk?: boolean;
  /** Override the declared data size (streamed/truncated files do this). */
  declaredDataSize?: number;
  formatTag?: number;
}): Uint8Array {
  const {
    samples,
    channels,
    sampleRate,
    bitsPerSample,
    float = false,
    withListChunk = false,
    formatTag,
  } = opts;
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = samples.length * bytesPerSample;
  const listBytes = withListChunk ? 12 : 0;
  const total = 12 + 24 + listBytes + 8 + dataBytes;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, total - 8, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, formatTag ?? (float ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM), true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  let offset = 36;
  if (withListChunk) {
    writeAscii(view, offset, 'LIST');
    view.setUint32(offset + 4, 4, true);
    writeAscii(view, offset + 8, 'INFO');
    offset += 12;
  }

  writeAscii(view, offset, 'data');
  view.setUint32(offset + 4, opts.declaredDataSize ?? dataBytes, true);
  offset += 8;

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (float) {
      view.setFloat32(offset + i * bytesPerSample, value, true);
    } else if (bitsPerSample === 16) {
      // Clamp to the INT16 range: +1.0 is 32767, not 32768 (which would wrap).
      const int = Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
      view.setInt16(offset + i * bytesPerSample, int, true);
    } else if (bitsPerSample === 32) {
      view.setInt32(offset + i * bytesPerSample, Math.round(value * 2147483648), true);
    } else {
      const v = Math.max(-1, Math.min(1, value)) * 8388608;
      const int = v < 0 ? Math.round(v) + 0x1000000 : Math.round(v);
      view.setUint8(offset + i * bytesPerSample, int & 0xff);
      view.setUint8(offset + i * bytesPerSample + 1, (int >> 8) & 0xff);
      view.setUint8(offset + i * bytesPerSample + 2, (int >> 16) & 0xff);
    }
  }

  return new Uint8Array(buffer);
}

/** Base64 of a byte array, built here so the test does not depend on btoa. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

/** A pure sine tone at a MIDI pitch, `seconds` long — the test's "performance". */
function tone(midi: number, seconds: number, sampleRate: number, amp = 0.6): Float32Array {
  const hz = midiToHz(midi);
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const SILENCE = (seconds: number, sampleRate: number) => new Float32Array(Math.round(seconds * sampleRate));

// ─────────────────────────────────────────────────────────────────
console.log('\n── wavCapture: RIFF/WAVE → mono Float32 ──');
{
  // PCM16 mono, four known samples.
  const wav = buildWav({
    samples: [0, 0.5, -0.5, 1],
    channels: 1,
    sampleRate: 8000,
    bitsPerSample: 16,
  });
  const decoded = decodeWavToFloat32(wav);
  assertEq(decoded.samples.length, 4, 'PCM16 mono: one Float32 sample per frame');
  assertEq(decoded.sampleRate, 8000, 'PCM16 mono: sample rate read from the fmt chunk');
  assertEq(decoded.sourceChannels, 1, 'PCM16 mono: channel count reported');
  assertClose(decoded.samples[0] as number, 0, 1 / 32768, 'PCM16 mono: silence decodes to 0');
  assertClose(decoded.samples[1] as number, 0.5, 1 / 32768, 'PCM16 mono: +0.5 round-trips');
  assertClose(decoded.samples[2] as number, -0.5, 1 / 32768, 'PCM16 mono: −0.5 round-trips');
  assertClose(decoded.samples[3] as number, 1, 1 / 32768, 'PCM16 mono: full scale round-trips');

  // PCM16 stereo: channels are averaged into ONE mono stream.
  const stereo = decodeWavToFloat32(
    buildWav({
      samples: [1, 0, 0.5, -0.5],
      channels: 2,
      sampleRate: 44100,
      bitsPerSample: 16,
    }),
  );
  assertEq(stereo.samples.length, 2, 'PCM16 stereo: two frames → two mono samples');
  assertEq(stereo.sourceChannels, 2, 'PCM16 stereo: channel count reported');
  assertClose(stereo.samples[0] as number, 0.5, 1 / 32768, 'PCM16 stereo: L/R averaged (1 and 0 → 0.5)');
  assertClose(stereo.samples[1] as number, 0, 1 / 32768, 'PCM16 stereo: L/R averaged (0.5 and −0.5 → 0)');

  // PCM24.
  const p24 = decodeWavToFloat32(
    buildWav({ samples: [0.25, -0.75], channels: 1, sampleRate: 16000, bitsPerSample: 24 }),
  );
  assertEq(p24.bitsPerSample, 24, 'PCM24: bit depth reported');
  assertClose(p24.samples[0] as number, 0.25, 1 / 8388608, 'PCM24: +0.25 round-trips');
  assertClose(p24.samples[1] as number, -0.75, 1 / 8388608, 'PCM24: negative values sign-extend correctly');

  // PCM32 int + float32.
  const p32 = decodeWavToFloat32(
    buildWav({ samples: [0.125], channels: 1, sampleRate: 16000, bitsPerSample: 32 }),
  );
  assertClose(p32.samples[0] as number, 0.125, 1e-6, 'PCM32 int: decodes to the same scale');
  const f32 = decodeWavToFloat32(
    buildWav({ samples: [0.3, -0.9], channels: 1, sampleRate: 16000, bitsPerSample: 32, float: true }),
  );
  assertClose(f32.samples[0] as number, 0.3, 1e-5, 'float32 WAV: decodes exactly (no rescale)');
  assertClose(f32.samples[1] as number, -0.9, 1e-5, 'float32 WAV: negatives decode exactly');

  // Real-world tolerances: an extra LIST chunk, and a streamed bogus data size.
  const withList = decodeWavToFloat32(
    buildWav({ samples: [0.5, 0.25], channels: 1, sampleRate: 8000, bitsPerSample: 16, withListChunk: true }),
  );
  assertEq(withList.samples.length, 2, 'extra chunks (LIST) are skipped, not misread as audio');
  const streamed = decodeWavToFloat32(
    buildWav({
      samples: [0.5, 0.25],
      channels: 1,
      sampleRate: 8000,
      bitsPerSample: 16,
      declaredDataSize: 0xfffffff0,
    }),
  );
  assertEq(streamed.samples.length, 2, 'an oversized declared data size is clamped to the real bytes');

  // Rejections — each with a human-readable reason, never silent noise.
  assertThrows(
    () => decodeWavToFloat32(Uint8Array.from([1, 2, 3, 4])),
    'a too-short buffer is rejected',
  );
  assertThrows(
    () => decodeWavToFloat32(Uint8Array.from(new Array(64).fill(7))),
    'non-RIFF bytes (e.g. m4a/MP3) are rejected, not decoded as noise',
  );
  assertThrows(
    () =>
      decodeWavToFloat32(
        buildWav({ samples: [0], channels: 1, sampleRate: 8000, bitsPerSample: 16, formatTag: 0x0055 }),
      ),
    'compressed WAV (format tag 0x55) is rejected rather than scored',
  );
  const truncated = buildWav({ samples: [0.5], channels: 1, sampleRate: 8000, bitsPerSample: 16 }).slice(0, 40);
  assertThrows(() => decodeWavToFloat32(truncated), 'a truncated header is rejected');
  assertThrows(
    () => decodeWavToFloat32(buildWav({ samples: [], channels: 1, sampleRate: 8000, bitsPerSample: 16 })),
    'an empty data chunk is rejected',
  );
}

console.log('\n── wavCapture: base64 PCM16 + resampling ──');
{
  const bytes = Uint8Array.from([0x00, 0x00, 0x00, 0x40, 0x00, 0xc0]); // 0, 0.5, -0.5
  const base64 = toBase64(bytes);
  assertEq(base64, 'AAAAQADA', 'test base64 helper matches the expected encoding');
  assertEq(Array.from(bytesFromBase64(base64)).join(','), Array.from(bytes).join(','), 'base64 → bytes round-trips');
  assertEq(
    Array.from(bytesFromBase64(`${base64.slice(0, 4)}\n${base64.slice(4)}`)).length,
    bytes.length,
    'wrapped (newline-separated) base64 is accepted',
  );
  assertThrows(() => bytesFromBase64('!!!!'), 'invalid base64 is rejected');

  const pcm = decodePcm16Base64(base64);
  assertEq(pcm.length, 3, 'base64 PCM16 mono: one sample per 2 bytes');
  assertClose(pcm[1] as number, 0.5, 1 / 32768, 'base64 PCM16: +0.5 decodes');
  assertClose(pcm[2] as number, -0.5, 1 / 32768, 'base64 PCM16: −0.5 decodes');

  // Stereo PCM16 base64 is downmixed (this is the shape a decode route returns).
  const stereoBytes = Uint8Array.from([0x00, 0x00, 0x00, 0x40]); // L=0, R=0.5 → mono 0.25
  const stereoSamples = decodePcm16Base64(toBase64(stereoBytes), 2);
  assertEq(stereoSamples.length, 1, 'base64 PCM16 stereo: two channels fold into one frame');
  assertClose(stereoSamples[0] as number, 0.25, 1 / 32768, 'base64 PCM16 stereo: channels are averaged');

  assertEq(clampSample(2), 1, 'clampSample clamps above +1');
  assertEq(clampSample(-3), -1, 'clampSample clamps below −1');
  assertEq(clampSample(Number.NaN), 0, 'clampSample maps NaN to silence');

  // Resampling.
  const ramp = Float32Array.from([0, 1, 2, 3, 4, 5]);
  assertEq(resampleLinear(ramp, 8000, 8000).length, 6, 'same-rate resample is an identity (length)');
  assertEq(resampleLinear(ramp, 8000, 8000)[3], 3, 'same-rate resample is an identity (values)');
  const halved = resampleLinear(ramp, 48000, 24000);
  assertEq(halved.length, 3, '48k → 24k halves the sample count');
  assertClose(halved[0] as number, 0, 1e-6, '48k → 24k keeps the first sample');
  const doubled = resampleLinear(ramp, 24000, 48000);
  assertEq(doubled.length, 12, '24k → 48k doubles the sample count');
  assertClose(doubled[1] as number, 0.5, 1e-6, '24k → 48k interpolates between samples');
  assertEq(resampleLinear(new Float32Array(0), 44100, 22050).length, 0, 'resampling silence is safe');

  // The funnel everything goes through: mono at the coach rate.
  const coach = toCoachSamples({ samples: ramp, sampleRate: 44100 });
  assertEq(coach.sampleRate, COACH_TARGET_SAMPLE_RATE, 'toCoachSamples targets the coach sample rate');
  assertClose(
    coach.samples.length,
    Math.floor(6 / (44100 / COACH_TARGET_SAMPLE_RATE)),
    1,
    'toCoachSamples resamples to the target rate',
  );
  assertThrows(() => toCoachSamples({ samples: ramp, sampleRate: 0 }), 'a missing sample rate is rejected');
}

console.log('\n── pieceAbc: which reference melody? ──');
{
  assertEq(normalizePieceKey('Für Elise'), 'fur elise', 'diacritics fold away (Für → Fur)');
  assertEq(normalizePieceKey('  Twinkle,  Twinkle, Little Star '), 'twinkle twinkle little star', 'punctuation and spacing fold away');
  assertEq(normalizePieceKey(null), '', 'a missing title folds to an empty key');
  assertEq(ABC_SEEDS.length >= 8, true, 'the bundled public-domain seed list is present');

  const exact = resolvePieceAbc({ title: 'Für Elise', composer: 'Ludwig van Beethoven' });
  assertEq(exact.source, 'seed', 'a known piece resolves to a bundled seed');
  assertEq(exact.seed?.pieceId, 'fur-elise', 'the seed is the right piece');
  assert(exact.abc.includes('K:Am'), 'the resolved abc is real ABC notation (has a key header)');

  const asciiTitle = resolvePieceAbc({ title: 'Fur Elise', pieceId: 'fur-elise' });
  assertEq(asciiTitle.source, 'seed', 'an unaccented title + slug still resolves');

  const catalog = resolvePieceAbc({
    abc: 'X:1\nT:From the catalog\nK:C\nC D E F |',
    title: 'Anything At All',
  });
  assertEq(catalog.source, 'piece', 'a catalog-supplied abc always wins');
  assert(catalog.abc.startsWith('X:1'), 'the catalog abc is passed through untouched');

  const emptyCatalogAbc = resolvePieceAbc({ abc: '   ', title: 'Ode to Joy' });
  assertEq(emptyCatalogAbc.source, 'seed', 'a blank catalog abc falls back to the seed');

  const missing = resolvePieceAbc({ title: 'Some Piece We Do Not Have', composer: 'Nobody' });
  assertEq(missing.source, 'none', 'an unknown piece resolves to nothing (never a wrong melody)');
  assertEq(missing.abc, '', 'an unknown piece yields an empty abc');

  const noTitle = resolvePieceAbc({});
  assertEq(noTitle.source, 'none', 'no title and no abc resolves to nothing');

  const composerMismatch = resolvePieceAbc({ title: 'Canon in D', composer: 'Someone Else' });
  assertEq(composerMismatch.source, 'seed', 'an exact title match does not need the composer');
}

console.log('\n── coachRun: honest outcomes ──');
{
  const abc = ABC_SEEDS.find((s) => s.pieceId === 'fur-elise')?.abc as string;

  const tooShort = scoreCoachRun({
    samples: tone(76, 0.4, 22050),
    sampleRate: 22050,
    abc,
    durationSec: 0.4,
  });
  assertEq(tooShort.kind, 'too-short', 'a sub-second take is too short, not a 0% score');
  assertEq(tooShort.accuracyPct, null, 'a too-short take has no accuracy number');
  assertEq(isScorableOutcome(tooShort), false, 'a too-short take is never saved to history');
  assertEq(tooShort.tempoBpm, DEFAULT_ABC_TEMPO_BPM, 'the tempo shown comes from the ABC (default 100)');

  const silent = scoreCoachRun({
    samples: SILENCE(3, 22050),
    sampleRate: 22050,
    abc,
    durationSec: 3,
  });
  assertEq(silent.kind, 'empty', 'a silent but long take is "nothing heard", not a score of 0');
  assertEq(silent.accuracyPct, null, 'a silent take has no accuracy number');
  assertEq(silent.hasReference, true, 'a silent take still knows the reference existed');

  const nonsense = scoreCoachRun({
    samples: null,
    sampleRate: 22050,
    abc,
    durationSec: 2,
  });
  assertEq(nonsense.kind, 'empty', 'a null sample buffer never throws');
  assertEq(nonsense.accuracyPct, null, 'a null sample buffer produced no number');

  const noReference = scoreCoachRun({
    samples: tone(69, 2, 22050),
    sampleRate: 22050,
    abc: '',
    durationSec: 2,
  });
  assertEq(noReference.hasReference, false, 'a piece with no abc has no reference');
  assertEq(noReference.accuracyPct, null, 'no reference → nothing to score against');

  // A real (synthetic) performance against the Für Elise phrase: E5 ^D5 E5 ^D5
  // E5 B4 D5 C5 A4, in 3/8 at the ABC's default tempo. The first four notes are
  // played at the written pitches with audible notes, so the coach must score it.
  const beatsPerNote = 0.25; // 3/8 at L:1/8 → eighth notes; slow deliberate take
  const mordent = [76, 75, 76, 75, 76, 71, 74, 72, 69];
  const performance = concat(
    mordent.map((midi) => concat([tone(midi, beatsPerNote, 22050), SILENCE(0.06, 22050)])),
  );
  const scored = scoreCoachRun({
    samples: performance,
    sampleRate: 22050,
    abc,
    pieceTitle: 'Für Elise',
    durationSec: performance.length / 22050,
  });
  assertEq(scored.kind, 'scored', 'a played phrase is scored');
  assertEq(isScorableOutcome(scored), true, 'a scored take is saved to history');
  assert(typeof scored.accuracyPct === 'number', 'a scored take carries a measured accuracy');
  assert(
    (scored.accuracyPct as number) > 0,
    `the synthetic performance scores above 0 (got ${String(scored.accuracyPct)}%)`,
  );
  assertEq(scored.notesWritten > 0, true, 'the reference melody contributed written notes');
  assertEq(scored.notesHeard > 0, true, 'we heard notes in the take');
  assertEq(scored.lines.length <= 3, true, 'feedback never exceeds three specific lines');
  assertEq(scored.headline.length > 0, true, 'feedback always has a headline');
  assertEq(scored.tempoBpm, DEFAULT_ABC_TEMPO_BPM, 'the ABC tempo is reported back for the UI');

  const slowTempo = scoreCoachRun({
    samples: performance,
    sampleRate: 22050,
    abc,
    durationSec: performance.length / 22050,
    tempoBpm: 60,
  });
  assertEq(slowTempo.tempoBpm, 60, 'a caller tempo override wins over the ABC');

  const unavailable = coachUnavailableOutcome({ abc, durationSec: 4 });
  assertEq(unavailable.kind, 'unavailable', 'a missing decoder produces the unavailable outcome');
  assertEq(unavailable.accuracyPct, null, 'the unavailable state has no accuracy');
  assert(unavailable.lines[0] === CAPTURE_UNAVAILABLE_LINE, 'the unavailable copy explains itself honestly');
  assertEq(isScorableOutcome(unavailable), false, 'an unavailable take is never saved to history');

  const noRefCopy = coachNoReferenceOutcome({ abc: '' });
  assertEq(noRefCopy.kind, 'empty', 'no reference melody is an honest empty state');
  assertEq(noRefCopy.accuracyPct, null, 'no reference melody has no accuracy');
  assert(
    noRefCopy.headline.toLowerCase().includes('coming soon'),
    'the no-reference headline says "coming soon" rather than pretending',
  );
  assertEq(MIN_COACH_RUN_SECONDS, 1, 'the minimum scorable take is one second');
}

console.log('\n── coachRun: state machine ──');
{
  const scoredOutcome: CoachRunOutcome = {
    kind: 'scored',
    accuracyPct: 82,
    headline: 'Really close.',
    lines: ['bar 3: the A was flat'],
    tempoBpm: 100,
    durationSec: 8,
    notesWritten: 9,
    notesHeard: 9,
    hasReference: true,
  };

  let state: CoachRunState = initialCoachRunState;
  assertEq(state.phase, 'idle', 'the coach starts idle');
  assertEq(state.history.runCount, 0, 'history starts empty');

  state = coachRunReducer(state, { type: 'record-started', at: 1000 });
  assertEq(state.phase, 'recording', 'tapping record moves idle → recording');
  assertEq(state.startedAtMs, 1000, 'the take start time is kept');

  state = coachRunReducer(state, { type: 'record-started', at: 2000 });
  assertEq(state.phase, 'recording', 'a second record tap while recording is ignored');
  assertEq(state.startedAtMs, 1000, 'an ignored tap cannot restart the take clock');

  state = coachRunReducer(state, { type: 'captured' });
  assertEq(state.phase, 'processing', 'a finalised clip moves recording → processing');

  state = coachRunReducer(state, { type: 'record-started', at: 3000 });
  assertEq(state.phase, 'processing', 'record cannot be re-entered while processing');

  state = coachRunReducer(state, { type: 'finished', outcome: scoredOutcome });
  assertEq(state.phase, 'result', 'a scored outcome moves processing → result');
  assertEq(state.outcome?.accuracyPct, 82, 'the measured accuracy is shown');
  assertEq(state.history.lastAccuracyPct, 82, 'the run updates last accuracy immediately');
  assertEq(state.history.bestAccuracyPct, 82, 'the first run sets best accuracy');
  assertEq(state.history.runCount, 1, 'the optimistic run count increments');
  assertEq(state.startedAtMs, null, 'the clock stops when a result lands');

  state = coachRunReducer(state, {
    type: 'finished',
    outcome: { ...scoredOutcome, accuracyPct: 55 },
  });
  assertEq(state.outcome?.accuracyPct, 82, 'a second result cannot overwrite one already shown');

  state = coachRunReducer(state, { type: 'record-started', at: 4000 });
  assertEq(state.phase, 'recording', 'record again works from the result phase');
  assertEq(state.outcome, null, 'starting a new take clears the previous result');

  state = coachRunReducer(state, { type: 'failed' });
  assertEq(state.phase, 'error', 'a failure moves recording → error');
  assertEq(state.error, DEFAULT_RUN_ERROR, 'a failure always carries human-readable copy');
  assertEq(state.outcome, null, 'a failed take shows no result at all');

  state = coachRunReducer(state, { type: 'finished', outcome: scoredOutcome });
  assertEq(state.phase, 'error', 'a late result cannot move the card out of error');

  state = coachRunReducer(state, { type: 'reset' });
  assertEq(state.phase, 'idle', 'reset returns the card to idle');
  assertEq(state.error, null, 'reset clears the error');

  // A failure with a specific message keeps it.
  let errState = coachRunReducer(initialCoachRunState, { type: 'record-started', at: 1 });
  errState = coachRunReducer(errState, { type: 'failed', message: 'Microphone access is required.' });
  assertEq(errState.error, 'Microphone access is required.', 'a specific failure message is preserved');

  // A non-scorable outcome must not touch the history numbers.
  let histState = initialCoachRunState;
  histState = coachRunReducer(histState, { type: 'history', history: { lastAccuracyPct: 70, bestAccuracyPct: 88, runCount: 4 } });
  histState = coachRunReducer(histState, { type: 'record-started', at: 1 });
  histState = coachRunReducer(histState, { type: 'captured' });
  histState = coachRunReducer(histState, {
    type: 'finished',
    outcome: { ...scoredOutcome, kind: 'unavailable', accuracyPct: null },
  });
  assertEq(histState.phase, 'result', 'an unavailable take still lands in the result phase');
  assertEq(histState.history.bestAccuracyPct, 88, 'an unavailable take cannot change best accuracy');
  assertEq(histState.history.runCount, 4, 'an unavailable take cannot inflate the run count');
  assertEq(histState.history.lastAccuracyPct, 70, 'an unavailable take cannot change last accuracy');

  // The store is the source of truth when it speaks.
  const fromStore = coachRunReducer(histState, {
    type: 'history',
    history: { lastAccuracyPct: 61, bestAccuracyPct: 91, runCount: 9 },
  });
  assertEq(fromStore.history.runCount, 9, 'a history read replaces the optimistic run count');
  assertEq(fromStore.history.bestAccuracyPct, 91, 'a history read replaces the optimistic best');
}

console.log('\n── coachRun: history summary ──');
{
  const sessions: PracticeSession[] = [
    { pieceId: 'fur-elise', accuracyPct: 64, durationSec: 12, playedAt: '2026-09-01T10:00:00.000Z' },
    { pieceId: 'other-piece', accuracyPct: 99, durationSec: 20, playedAt: '2026-09-02T10:00:00.000Z' },
    { pieceId: 'fur-elise', accuracyPct: 88, durationSec: 15, playedAt: '2026-09-03T10:00:00.000Z' },
  ];
  const sum = summarizeHistory(sessions, 'fur-elise');
  assertEq(sum.lastAccuracyPct, 64, 'last accuracy is the newest stored run for the piece');
  assertEq(sum.bestAccuracyPct, 88, 'best accuracy is the highest stored run for the piece');
  assertEq(sum.runCount, 2, 'only this piece\'s runs are counted');

  const none = summarizeHistory([], 'fur-elise');
  assertEq(none.runCount, 0, 'no history at all counts zero runs');
  assertEq(none.bestAccuracyPct, null, 'no history has no best accuracy');
  const undef = summarizeHistory(null, 'fur-elise');
  assertEq(undef.runCount, 0, 'a null history list is handled');
}

// ─────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} FAILED\n`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed\n`);
