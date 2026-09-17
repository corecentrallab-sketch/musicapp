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
 */

import type { PlayedNote } from './practiceCoach';

// ─── Constants (documented so the slice-3 UI can be briefed accurately) ──

/**
 * Analysis window, in samples. 2048 samples ≈ 46 ms at 44.1 kHz / 93 ms at
 * 22.05 kHz — long enough for a stable period estimate down to ~55 Hz, short
 * enough to follow a melody. Longer = steadier pitch, blurrier onsets.
 */
export const DEFAULT_WINDOW_SAMPLES = 2048;
/** Frame hop. 25 ms = 40 frames/second — finer than any rhythm tolerance. */
export const DEFAULT_HOP_SECONDS = 0.025;
/** Lowest pitch we will report (A1). */
export const DEFAULT_MIN_FREQ_HZ = 55;
/** Highest pitch we will report (roughly F#6 — above a soprano's top). */
export const DEFAULT_MAX_FREQ_HZ = 1500;
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
}

/**
 * Track monophonic pitch across a recording, one frame per hop.
 *
 * Frames are placed on an absolute grid starting at sample 0 (tSec = start
 * sample / sampleRate), so a caller can map beats from tSec directly. Only
 * whole windows are analysed: with fewer than `windowSamples` samples the
 * result is an empty array. Frames whose RMS is under the gate, and frames
 * where the period estimate is not confident, get `midi: null`.
 */
export function detectPitchFrames(
  samples: Float32Array,
  sampleRate: number,
  opts: PitchDetectionOptions = {},
): PitchFrame[] {
  const frames: PitchFrame[] = [];
  if (!samples || samples.length === 0) return frames;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return frames;

  const windowSamples = Math.max(64, Math.floor(opts.windowSamples ?? DEFAULT_WINDOW_SAMPLES));
  const hopSeconds = opts.hopSeconds ?? DEFAULT_HOP_SECONDS;
  const hopSamples = Math.max(1, Math.round((Number.isFinite(hopSeconds) ? hopSeconds : DEFAULT_HOP_SECONDS) * sampleRate));
  const minFreqHz = clampFreq(opts.minFreqHz, DEFAULT_MIN_FREQ_HZ);
  const maxFreqHz = clampFreq(opts.maxFreqHz, DEFAULT_MAX_FREQ_HZ);
  const rmsThreshold =
    typeof opts.rmsThreshold === 'number' && Number.isFinite(opts.rmsThreshold)
      ? opts.rmsThreshold
      : SILENCE_RMS_THRESHOLD;

  const total = samples.length;
  if (total < windowSamples) return frames;

  for (let start = 0; start + windowSamples <= total; start += hopSamples) {
    const rms = rmsOf(samples, start, windowSamples);
    const midi = rms < rmsThreshold ? null : yinMidi(samples, start, windowSamples, sampleRate, minFreqHz, maxFreqHz);
    frames.push({ tSec: start / sampleRate, midi, rms });
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
