/**
 * pitchDetection.ts — monophonic pitch tracking + note segmentation for the
 * practice coach (owner-approved roadmap #3, slice 2: the detection/reference
 * pipeline — pure logic, deliberately NO UI, NO microphone wiring, NO
 * streaming).
 *
 * What this file is: the bridge from "a raw mono recording" to the
 * PlayedNote[] that slice 1 (src/services/practiceCoach.ts) scores. It is a
 * SIMPLER MONOPHONIC tracker on purpose — one note at a time, no polyphony, no
 * onsets/velocity, matching the honest scope of the practice-coach framework
 * (scoring + feedback first, harder real-time detection later).
 *
 * Algorithm: YIN-lite (the square-difference function with cumulative-mean
 * normalisation, and parabolic interpolation for sub-sample period accuracy)
 * evaluated on a sliding window, with an RMS silence gate. YIN was chosen over
 * plain autocorrelation because normalised difference does not lock onto
 * octave-above harmonics the way raw autocorrelation does for voice/whistle
 * input.
 *
 * Kept FREE of any react-native / expo imports so it compiles and runs under
 * plain Node (see scripts/coachPipeline.test.ts) — same convention as tier1.ts
 * and practiceCoach.ts.
 *
 * Units: sample rate in Hz, time in seconds, pitch in MIDI note numbers as
 * FLOATS (69 = A4 = 440 Hz). Frames the tracker is not confident about come
 * back as `midi: null` rather than a guess — an honest no-match beats a wrong
 * note, the same rule the recognition surfaces follow.
 *
 * ── vc64 (D39) — THE PASS REPORTS THE MELODY, NOT THE ROOM ──────────────────
 * This is the ON-DEVICE read: the pass that runs when the network notes read
 * (`/api/coach/pcm`) fails or is unavailable, so it is what an offline hum gets.
 * It carried the same defect the server pass was fixed for on 11-20. The owner:
 * *"that may be an anomaly from the detector — samples are not usually (or ever)
 * that low within the playing range."* He was right, and it reproduced on
 * demand: three clips with an identical 220 Hz hum, only the rumble differing,
 * came back 57 / 33 / 38 — the last two are the 55 Hz and 80 Hz rumble, not the
 * hum. Handling noise and room rumble sit below ~100 Hz, and the unbanded search
 * let them win outright, three octaves below the melody.
 *
 * The rule below is the SERVER'S, ported unchanged (site-fresh
 * `src/services/pitchDetection.ts`) — not a second invention:
 *   1. BAND-LIMIT: a 4th-order Butterworth high-pass at 85 Hz before detection,
 *      so rumble is attenuated (≈-18 dB at 55 Hz) before any period search sees it.
 *   2. SEARCH BAND: 80–1200 Hz — bass to whistle. A period outside it cannot be
 *      returned at all, so a 55 Hz rumble has nowhere to be reported from.
 *   3. HARMONIC PREFERENCE (upward only): among candidates that are as credible
 *      as the primary read, take the one whose harmonics carry the energy in the
 *      200–2000 Hz band — the band a melody actually lives in — instead of
 *      defaulting to the lowest one.
 * The honest failure is unchanged: silence, or a take that is only rumble, still
 * returns `midi: null` rather than a confident low guess. The frame's `rms` is
 * still the take's own level, so the app's level readout does not move.
 */

import type { PlayedNote } from './practiceCoach';

// ─── Constants (documented so the slice-3 UI can be briefed accurately) ──

/**
 * Analysis window, in samples. 2048 samples ≈ 46 ms at 44.1 kHz / 93 ms at
 * 22.05 kHz — long enough for a stable period estimate down to ~80 Hz, short
 * enough to follow a melody. Longer = steadier pitch, blurrier onsets.
 */
export const DEFAULT_WINDOW_SAMPLES = 2048;
/** Frame hop. 25 ms = 40 frames/second — finer than any rhythm tolerance. */
export const DEFAULT_HOP_SECONDS = 0.025;
/** Lowest pitch we will report (E2, ≈82 Hz). vc64/D39: was 55 Hz, which let rumble win. */
export const DEFAULT_MIN_FREQ_HZ = 80;
/** Highest pitch we will report (roughly D6 — above a soprano's top). vc64/D39: was 1500. */
export const DEFAULT_MAX_FREQ_HZ = 1200;
/**
 * RMS silence gate. A window quieter than this is reported as `midi: null`
 * instead of being fed to the pitch estimator (breath noise, room tone and
 * pre-roll would otherwise produce confident garbage). 0.01 is ≈ −40 dBFS.
 */
export const SILENCE_RMS_THRESHOLD = 0.01;
/** YIN absolute threshold: the first dip in the normalised difference below
 * this is taken as the period. 0.2 is the usual YIN-lite compromise. */
export const YIN_THRESHOLD = 0.2;
/**
 * When nothing dips below YIN_THRESHOLD we still accept the global minimum if
 * it is below this (a noisy-but-clearly-periodic voice take). Past it the
 * frame is `null` — a guess would be worse than an honest miss.
 */
export const YIN_FALLBACK_THRESHOLD = 0.45;
/**
 * High-pass corner for the detection copy, in Hz (vc64/D39). Handling noise, wind
 * and room rumble live below this; a 220 Hz hum is nowhere near it.
 */
export const HIGHPASS_CUTOFF_HZ = 85;
/** The band a candidate's harmonics must carry energy in to be preferred (vc64/D39). */
export const HARMONIC_BAND_LOW_HZ = 200;
export const HARMONIC_BAND_HIGH_HZ = 2000;
/** How many harmonics of a candidate we score. */
const HARMONIC_COUNT = 8;
/** Weight of the in-band harmonics against the candidate's own fundamental. */
const HARMONIC_WEIGHT = 0.35;

/** MIDI number of A4. */
export const A4_MIDI = 69;
/** Frequency of A4, in Hz. */
export const A4_HZ = 440;

/** Tempo used when the caller has none (same default as abcToReference). */
export const FALLBACK_TEMPO_BPM = 100;

/** Segments shorter than this are not notes (a blip, a click, a smear). */
export const DEFAULT_MIN_NOTE_SEC = 0.12;
/** Frame-to-frame pitch wobble allowed inside one note: ±40 cents. */
export const DEFAULT_JITTER_CENTS = 40;

// ─── Pitch <-> frequency helpers ────────────────────────────────

/** Frequency (Hz) → MIDI note number as a float (440 Hz → 69). */
export function hzToMidi(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return Number.NaN;
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

/** MIDI note number (may be fractional) → frequency in Hz (69 → 440 Hz). */
export function midiToHz(midi: number): number {
  if (!Number.isFinite(midi)) return Number.NaN;
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Median of a list of numbers (NaN for an empty list). */
export function median(values: number[]): number {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ─── Framing ────────────────────────────────────────────────────

/** One analysis frame: where it starts, what pitch it heard, how loud it was. */
export interface PitchFrame {
  /** Frame START time in seconds (not the window centre). */
  tSec: number;
  /** Detected MIDI note number (float, unrounded) or null when silent/unpitched. */
  midi: number | null;
  /** RMS level of the window. */
  rms: number;
}

export interface PitchDetectionOptions {
  /** Analysis window length in samples (default DEFAULT_WINDOW_SAMPLES). */
  windowSamples?: number;
  /** Frame hop in seconds (default DEFAULT_HOP_SECONDS). */
  hopSeconds?: number;
  minFreqHz?: number;
  maxFreqHz?: number;
  /** RMS below which a frame is silence (default SILENCE_RMS_THRESHOLD). */
  rmsThreshold?: number;
  /** High-pass corner applied to the detection copy only (default HIGHPASS_CUTOFF_HZ). */
  highPassHz?: number;
}

/**
 * The analysis settings ONE pass of the frame loop uses. Both loops below read
 * them from here, so the sync read and the yielding read can never disagree
 * about a window, a hop or a frequency bound.
 */
interface FrameGrid {
  windowSamples: number;
  hopSamples: number;
  minFreqHz: number;
  maxFreqHz: number;
  rmsThreshold: number;
  highPassHz: number;
}

function frameGrid(sampleRate: number, opts: PitchDetectionOptions): FrameGrid {
  const windowSamples = Math.max(64, Math.floor(opts.windowSamples ?? DEFAULT_WINDOW_SAMPLES));
  const hopSeconds = opts.hopSeconds ?? DEFAULT_HOP_SECONDS;
  return {
    windowSamples,
    hopSamples: Math.max(1, Math.round((Number.isFinite(hopSeconds) ? hopSeconds : DEFAULT_HOP_SECONDS) * sampleRate)),
    minFreqHz: clampFreq(opts.minFreqHz, DEFAULT_MIN_FREQ_HZ),
    maxFreqHz: clampFreq(opts.maxFreqHz, DEFAULT_MAX_FREQ_HZ),
    rmsThreshold:
      typeof opts.rmsThreshold === 'number' && Number.isFinite(opts.rmsThreshold)
        ? opts.rmsThreshold
        : SILENCE_RMS_THRESHOLD,
    highPassHz: clampFreq(opts.highPassHz, HIGHPASS_CUTOFF_HZ),
  };
}

/** One frame of the grid — the same arithmetic the sync and async loops run. */
function frameAt(
  samples: Float32Array,
  analysis: Float32Array,
  start: number,
  grid: FrameGrid,
  sampleRate: number,
): PitchFrame {
  // The level is the take's own: the high-pass is for the pitch search only, so
  // the app's level readout still says how loud the recording was.
  const rms = rmsOf(samples, start, grid.windowSamples);
  // …but a window whose energy is (almost) all below the band is room, not melody:
  // it must not get a pitch, even though the take was loud.
  const analysisRms = rmsOf(analysis, start, grid.windowSamples);
  const midi =
    rms < grid.rmsThreshold || analysisRms < grid.rmsThreshold * 0.25
      ? null
      : yinMidi(analysis, start, grid.windowSamples, sampleRate, grid.minFreqHz, grid.maxFreqHz);
  return { tSec: start / sampleRate, midi, rms };
}

/**
 * Track monophonic pitch across a recording, one frame per hop.
 *
 * Frames are placed on an absolute grid starting at sample 0 (tSec = start
 * sample / sampleRate), so a caller can map beats from tSec directly. Only
 * whole windows are analysed: with fewer than `windowSamples` samples the
 * result is an empty array. Frames whose RMS is under the gate, and frames
 * where the period estimate is not confident, get `midi: null`.
 *
 * Since vc64 (D39) the pitch search runs on a high-passed copy of the take
 * (`highPassForDetection`) inside an 80–1200 Hz band, so room rumble and
 * handling noise cannot be reported as the melody. The returned `rms` is still
 * the take's own.
 */
export function detectPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  opts: PitchDetectionOptions = {},
): PitchFrame[] {
  const frames: PitchFrame[] = [];
  if (!samples || samples.length === 0) return frames;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return frames;

  const grid = frameGrid(sampleRate, opts);
  const total = samples.length;
  if (total < grid.windowSamples) return frames;

  const analysis = highPassForDetection(samples, sampleRate, grid.highPassHz);

  for (let start = 0; start + grid.windowSamples <= total; start += grid.hopSamples) {
    frames.push(frameAt(samples, analysis, start, grid, sampleRate));
  }
  return frames;
}

/**
 * ── vc56 ── THE SAME READING, WITHOUT FREEZING THE APP (owner 11-11) ─────────
 *
 * THE OWNER: *"it should be ideally immediate from when the video is taken to
 * going to another window to watch it on full screen — not a very paused delay.
 * It looks like the app did nothing from the take to the user."*
 *
 * THE CAUSE, MEASURED. This loop is the notes read that runs right after a take
 * lands on the review surface. It is pure JavaScript and it is SYNCHRONOUS: one
 * frame per 25 ms of audio, each frame a YIN period search over 388 lags of a
 * 2048-sample window. A 60-second take (the server's cap, `MAX_RETURN_SECONDS`)
 * is 2,398 frames — measured at **4,178 ms of solid CPU on a server-class Node
 * process**, and Hermes on a handset is several times slower than that. While it
 * runs, the JS thread cannot dispatch a touch or paint a frame, so the owner's
 * tap on the full-screen icon is not even looked at until the whole read is done:
 * the window appears 15–20 s late, on black, looking like the app ignored him.
 *
 * WHAT THIS DOES. The identical arithmetic, one time slice at a time: after
 * `PITCH_ASYNC_TIME_SLICE_MS` of work the loop hands the thread back for one
 * macrotask, so a touch and a paint get through between slices. Same frames, same
 * order, same numbers — `detectPitchFrames` stays exactly as it was for every
 * caller that wants the whole read in one go.
 */
export const PITCH_ASYNC_TIME_SLICE_MS = 8;

export interface PitchAsyncDeps {
  /** Clock for the time slice. Overridable so the gate can prove the yield. */
  now?: () => number;
  /** How the loop hands the thread back. Defaults to a macrotask. */
  yieldToUi?: () => Promise<void>;
}

/** A `setTimeout` looked up off the global, so this compiles with no DOM lib. */
function defaultYieldToUi(): Promise<void> {
  const host = globalThis as unknown as { setTimeout?: (fn: () => void, ms: number) => unknown };
  const schedule = host.setTimeout;
  if (typeof schedule !== 'function') return Promise.resolve();
  return new Promise<void>((resolve) => {
    schedule(() => resolve(), 0);
  });
}

/**
 * `detectPitchFrames`, sliced so the UI thread keeps breathing. The result is
 * frame-for-frame identical to the synchronous read (the gate asserts that on
 * real samples); the only difference is that the loop yields between slices.
 */
export async function detectPitchFramesAsync(
  samples: Float32Array,
  sampleRate: number,
  opts: PitchDetectionOptions = {},
  deps: PitchAsyncDeps = {},
): Promise<PitchFrame[]> {
  const frames: PitchFrame[] = [];
  if (!samples || samples.length === 0) return frames;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return frames;

  const grid = frameGrid(sampleRate, opts);
  const total = samples.length;
  if (total < grid.windowSamples) return frames;

  const now = deps.now ?? (() => Date.now());
  const yieldToUi = deps.yieldToUi ?? defaultYieldToUi;
  const analysis = highPassForDetection(samples, sampleRate, grid.highPassHz);
  let sliceStartedAt = now();
  for (let start = 0; start + grid.windowSamples <= total; start += grid.hopSamples) {
    frames.push(frameAt(samples, analysis, start, grid, sampleRate));
    if (now() - sliceStartedAt >= PITCH_ASYNC_TIME_SLICE_MS) {
      await yieldToUi();
      sliceStartedAt = now();
    }
  }
  return frames;
}

function clampFreq(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/** Root-mean-square of one window of float samples. */
function rmsOf(samples: Float32Array, start: number, windowSamples: number): number {
  let sum = 0;
  for (let i = 0; i < windowSamples; i++) {
    const s = samples[start + i];
    if (Number.isFinite(s)) sum += s * s;
  }
  return Math.sqrt(sum / windowSamples);
}

/** One biquad section, transposed direct form II coefficients. */
interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * RBJ cookbook 2nd-order high-pass at `cutoffHz` with the given Q. Two of these in
 * cascade make the 4th-order (24 dB/oct) slope the band-limit wants.
 */
function highPassSection(sampleRate: number, cutoffHz: number, q: number): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * A COPY OF THE TAKE WITH THE ROOM REMOVED (vc64/D39): 4th-order Butterworth
 * high-pass at `cutoffHz`, run over the whole signal so the filter state carries
 * across frames. Only the pitch search sees this; the samples we were given, and
 * the RMS level of each frame, are the untouched take.
 */
export function highPassForDetection(
  samples: Float32Array,
  sampleRate: number,
  cutoffHz: number = HIGHPASS_CUTOFF_HZ,
): Float32Array {
  const out = new Float32Array(samples.length);
  out.set(samples);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length === 0) {
    return out;
  }
  // Butterworth 4th-order = two sections at these Qs.
  const sections = [
    highPassSection(sampleRate, cutoffHz, 0.5411961),
    highPassSection(sampleRate, cutoffHz, 1.306563),
  ];
  for (const { b0, b1, b2, a1, a2 } of sections) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x0 = Number.isFinite(out[i]) ? (out[i] as number) : 0;
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      out[i] = y0;
    }
  }
  return out;
}

/**
 * Magnitude of `freq` in one Hann-windowed analysis window (Goertzel), normalised by
 * the window's coherent gain so a score is comparable across candidates.
 */
function bandMagnitude(
  samples: Float32Array,
  start: number,
  windowSamples: number,
  sampleRate: number,
  freq: number,
): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  let windowSum = 0;
  for (let i = 0; i < windowSamples; i++) {
    const w = windowSamples > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowSamples - 1)) : 1;
    windowSum += w;
    const x = samples[start + i];
    const s0 = (Number.isFinite(x) ? (x as number) : 0) * w + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return windowSum > 0 ? Math.sqrt(Math.max(0, power)) / (windowSum / 2) : 0;
}

/**
 * HOW MUCH OF A CANDIDATE'S HARMONIC SERIES IS ACTUALLY IN THE MELODY BAND
 * (vc64/D39): the candidate's own fundamental, plus the magnitudes of harmonics
 * 2..8 that fall inside 200–2000 Hz, weighted below the fundamental.
 *
 * The fundamental is the anchor on purpose. A note's harmonics are shared with its
 * subharmonics — 110 Hz and 220 Hz have the *same* in-band series (220, 440, …) — so
 * a score built only from in-band harmonics cannot tell a hum from its own
 * subharmonic, and the tie then goes to whichever is lower, which is the defect
 * itself. Weighting the fundamental means a candidate with no energy where it claims
 * to be cannot out-score one that is really there.
 */
function harmonicScore(
  samples: Float32Array,
  start: number,
  windowSamples: number,
  sampleRate: number,
  hz: number,
): number {
  const nyquist = sampleRate / 2;
  let harmonics = 0;
  for (let k = 2; k <= HARMONIC_COUNT; k++) {
    const f = hz * k;
    if (f > nyquist) break;
    if (f < HARMONIC_BAND_LOW_HZ || f > HARMONIC_BAND_HIGH_HZ) continue;
    harmonics += bandMagnitude(samples, start, windowSamples, sampleRate, f);
  }
  const fundamental = bandMagnitude(samples, start, windowSamples, sampleRate, hz);
  return fundamental + HARMONIC_WEIGHT * harmonics;
}

/**
 * YIN-lite pitch estimate for one window, as a MIDI number (float) or null.
 *
 * Steps: (1) square-difference function d(τ); (2) cumulative-mean normalised
 * difference d'(τ) = τ·d(τ) / Σ_{j≤τ} d(j); (3) first dip below YIN_THRESHOLD
 * (global minimum under YIN_FALLBACK_THRESHOLD as a fallback), walked forward
 * to its local minimum; (4) parabolic interpolation for a sub-sample period;
 * (5) f = sampleRate / τ → MIDI.
 */
function yinMidi(
  samples: Float32Array,
  start: number,
  windowSamples: number,
  sampleRate: number,
  minFreqHz: number,
  maxFreqHz: number,
): number | null {
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreqHz));
  const maxLag = Math.min(Math.floor(windowSamples / 2), Math.ceil(sampleRate / minFreqHz));
  if (maxLag <= minLag + 1) return null;

  const diff = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    const count = windowSamples - tau;
    for (let i = 0; i < count; i++) {
      const a = samples[start + i];
      const b = samples[start + i + tau];
      const d = (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
      sum += d * d;
    }
    diff[tau] = sum;
  }

  const norm = new Float64Array(maxLag + 1);
  norm[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += diff[tau];
    norm[tau] = running <= 0 ? 1 : (diff[tau] * tau) / running;
  }

  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (norm[t] < YIN_THRESHOLD) {
      let localMin = t;
      while (localMin + 1 <= maxLag && norm[localMin + 1] < norm[localMin]) localMin++;
      tau = localMin;
      break;
    }
  }
  if (tau < 0) {
    let best = Number.POSITIVE_INFINITY;
    for (let t = minLag; t <= maxLag; t++) {
      if (norm[t] < best) {
        best = norm[t];
        tau = t;
      }
    }
    if (tau < 0 || best > YIN_FALLBACK_THRESHOLD) return null;
  }

  // ── vc64/D39: THE APP'S OWN CHOICE FIRST, THEN AN UPWARD-ONLY CORRECTION ────
  // Primary read: the first (highest-pitched) dip below YIN_THRESHOLD, else the
  // strongest dip. Keeping this as the primary is what stops a genuine
  // recording's notes from moving.
  //
  // Correction: when nothing is confidently periodic the primary read is whichever
  // periodicity was STRONGEST, which on a real take is the room — D39 exactly. Among
  // candidates that are as credible as it is, take the one whose harmonics carry
  // energy in 200–2000 Hz. The correction is one-directional (higher pitch only):
  // a lower reading is never the melody, and allowing one is how the old pass ended
  // up three octaves down.
  const candidates: number[] = [];
  for (let t = minLag; t < tau; t++) {
    const value = norm[t];
    if (value > YIN_FALLBACK_THRESHOLD) continue;
    const prev = t - 1 >= minLag ? norm[t - 1] : Number.POSITIVE_INFINITY;
    const next = norm[t + 1];
    if (value <= prev && value <= next) candidates.push(t);
  }
  if (candidates.length > 0) {
    const primaryScore = harmonicScore(samples, start, windowSamples, sampleRate, sampleRate / tau);
    let chosen = tau;
    let chosenScore = primaryScore;
    for (const t of candidates) {
      const hz = sampleRate / t;
      if (hz < minFreqHz * 0.9 || hz > maxFreqHz * 1.1) continue;
      const score = harmonicScore(samples, start, windowSamples, sampleRate, hz);
      // A strictly better harmonic series wins. Equality does not: a ratio-based
      // near-tie let noise-level differences between two clean candidates move a
      // note, which is not a correction worth making.
      if (score > chosenScore) {
        chosen = t;
        chosenScore = score;
      }
    }
    tau = chosen;
  }

  let period = tau;
  if (tau > 1 && tau < maxLag) {
    const a = norm[tau - 1];
    const b = norm[tau];
    const c = norm[tau + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom !== 0) {
      const delta = (c - a) / denom;
      if (Number.isFinite(delta) && Math.abs(delta) < 1) period = tau + delta;
    }
  }
  if (!Number.isFinite(period) || period <= 0) return null;

  const hz = sampleRate / period;
  if (!Number.isFinite(hz) || hz < minFreqHz * 0.9 || hz > maxFreqHz * 1.1) return null;
  return hzToMidi(hz);
}

// ─── Segmentation ───────────────────────────────────────────────

export interface SegmentationOptions {
  /** Shortest segment that still counts as a note, in seconds (default 0.12). */
  minNoteSec?: number;
  /**
   * How far a frame's pitch may sit from the running median of the segment it
   * is joining, in cents (default 40). Beyond this the frame starts a NEW note
   * — so a legato slide into a note reads as two short blips (the first is
   * dropped by minNoteSec) rather than one wide note.
   */
  jitterCents?: number;
  /**
   * RESERVED. Accepted (and validated) for API symmetry with slice 1's
   * BEATS_PER_BAR/barOf(), but the played timeline here is tempo-only: bars
   * live in the scoring/feedback layer, and PlayedNote carries no bar field.
   */
  beatsPerBar?: number;
}

/**
 * Group consecutive pitched frames into played notes.
 *
 * Rules: a null frame ends the current note; a frame within `jitterCents` of
 * the segment's running median joins it; anything else starts a new note.
 * Segments shorter than `minNoteSec` are dropped entirely (they are smears,
 * clicks or the tail of a previous note — never promoted to a note just to
 * keep the count up). Times are relative to the frame grid, so tSec → beats is
 * simply tSec × bpm / 60.
 *
 * The note's pitch is the MEDIAN of its frames. The caller decides how to
 * store it: this returns MIDI as a FLOAT on purpose. Rounding to the nearest
 * semitone here would push a 40-cent-flat note onto the note below and a
 * 40-cent-sharp note onto the note above, flipping the DIRECTION slice 1
 * reports ('flat' vs 'sharp') and eating into its ±35-cent hit tolerance —
 * so the sub-semitone value (i.e. the actual intonation) is preserved and
 * only slice 1 decides what a cent means. Pass it through unchanged.
 */
export function segmentsToPlayedNotes(
  frames: PitchFrame[],
  tempoBpm: number,
  opts: SegmentationOptions = {},
): PlayedNote[] {
  const list = Array.isArray(frames) ? frames : [];
  const notes: PlayedNote[] = [];
  if (list.length === 0) return notes;

  const bpm = Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : FALLBACK_TEMPO_BPM;
  const minNoteSec =
    typeof opts.minNoteSec === 'number' && Number.isFinite(opts.minNoteSec) && opts.minNoteSec > 0
      ? opts.minNoteSec
      : DEFAULT_MIN_NOTE_SEC;
  const jitterSemitones =
    (typeof opts.jitterCents === 'number' && Number.isFinite(opts.jitterCents) && opts.jitterCents > 0
      ? opts.jitterCents
      : DEFAULT_JITTER_CENTS) / 100;

  const hopSec = inferHopSec(list);
  const secondsToBeats = bpm / 60;

  let startIndex = -1;
  let endIndex = -1;
  let values: number[] = [];

  const close = (): void => {
    if (startIndex < 0) return;
    const durationSec =
      Math.abs((list[endIndex]?.tSec ?? 0) - (list[startIndex]?.tSec ?? 0)) + hopSec;
    const midi = median(values);
    if (durationSec >= minNoteSec && Number.isFinite(midi)) {
      notes.push({
        midi,
        startBeat: (list[startIndex]?.tSec ?? 0) * secondsToBeats,
        durationBeats: durationSec * secondsToBeats,
      });
    }
    startIndex = -1;
    endIndex = -1;
    values = [];
  };

  for (let i = 0; i < list.length; i++) {
    const frame = list[i];
    const value = frame?.midi;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      close();
      continue;
    }
    if (startIndex >= 0 && Math.abs(value - median(values)) <= jitterSemitones) {
      values.push(value);
      endIndex = i;
      continue;
    }
    close();
    startIndex = i;
    endIndex = i;
    values = [value];
  }
  close();

  return notes;
}

/** Hop between frames, taken from the frames themselves (0 when unknown). */
function inferHopSec(frames: PitchFrame[]): number {
  if (frames.length < 2) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const delta = frames[i].tSec - frames[i - 1].tSec;
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return 0;
  const hop = median(deltas);
  return Number.isFinite(hop) && hop > 0 ? hop : 0;
}
