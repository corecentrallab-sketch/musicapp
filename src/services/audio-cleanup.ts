// ---------------------------------------------------------------------------
// audio-cleanup.ts — deterministic pre-filter for QUERY audio only.
//
// WHY (owner's live venue test, 2026-10-10, backlog d9b051ee): at a real venue
// with background noise + intensity BOTH engines returned no match — the
// classical landmark matcher (/api/recognize, the "hero" button) AND the
// hum/melody engine (/api/hum) — so the owner got an honest no-match twice and
// nothing to play. The 81-piece library has zero false positives and that
// record is a hard requirement, so the fix may NOT be "loosen the gate": the
// query audio itself has to arrive at the extractors cleaner.
//
// Three mechanical defects a noisy capture has, none of which a clean library
// render has (library fingerprints are built from clean sources — that is the
// point of cleaning the query only: it makes the noisy query MORE like the
// clean reference):
//   1. Sub-80 Hz rumble (HVAC, crowd, footsteps, handheld handling) dominates
//      the signal. It is not musically relevant, but it is energy the pitch
//      tracker (YIN) and the fingerprint frame floor both have to fight.
//   2. Broadband hiss above the musical band (codec noise, PA hiss, aliasing).
//      Hiss adds uniformly to YIN's difference function, raising every CMNDF
//      value and so lowering voiced confidence for a genuine melody.
//   3. Wildly inconsistent capture level: a quiet far-field take gives YIN an
//      almost-silent frame (its `sumSquare < 1e-9` gate rejects it outright),
//      while a loud near-field take over-drives the 16-bit WAV encoder used by
//      the fpcalc query path (samples are hard-clamped to [-1, 1], which
//      distorts exactly the spectral peaks a fingerprint is built from).
//
// The stage is deliberately pure and deterministic: no Math.random, no mutable
// module state, fixed biquad coefficients per call, fresh output arrays. Same
// input bytes → same output samples, so it is unit-testable and a probe run
// reproduces a device capture exactly.
//
// Applied on the QUERY side only, in fpcalc.ts `decodeQueryMono()` (landmark
// path), `fingerprintFromBuffer()` (fpcalc/WAV query path) and in the hum
// handler before f0 extraction — see those call sites. Ingest/reference
// rendering is untouched, so the reference landmarks are byte-for-byte the same
// as before this change. Nothing here loosens a match threshold.
// ---------------------------------------------------------------------------

/** Rumble/room-noise high-pass corner. Below ~80 Hz is not musical content for
 *  any instrument we recognise (a piano's A0 is 27.5 Hz, but the fundamental is
 *  far weaker than the room noise that shares that band; the extractors' own
 *  analysis band starts at ~110 Hz anyway).
 *  Kept low on purpose: the hum path's f0 search floor is 55 Hz (A1), so a
 *  higher corner would start eating the lowest hummed notes. */
export const QUERY_HIGHPASS_HZ = 80;
/** Hiss/aliasing low-pass corner, applied only where the sample rate allows it
 *  (see `lowpassForSampleRate`). Deliberately ABOVE the musical band so a
 *  whistle's upper harmonics survive. */
export const QUERY_LOWPASS_HZ = 15000;
/** Lower corner for the hum/whistle path: YIN only searches 55-1000 Hz, so
 *  everything above ~4 kHz is noise that can only hurt the periodicity estimate
 *  (a whistle's fundamental tops out near 3 kHz). */
export const HUM_QUERY_LOWPASS_HZ = 4000;
/** Target RMS after normalisation (0.1 ≈ -20 dBFS) — a fixed analysis level so
 *  a quiet far-field capture and a loud near-field capture compile to the same
 *  amplitudes. */
export const QUERY_TARGET_RMS = 0.1;
/** Never amplify more than this: a near-silent capture must not be blown up
 *  into shaped noise and then presented to the matcher as if it were audio. */
export const QUERY_MAX_GAIN = 20;
/** Peak ceiling after normalisation, so the 16-bit WAV query path never clips. */
export const QUERY_PEAK_CEILING = 0.99;
/** Below this input RMS the capture is treated as silence: no gain applied. */
const SILENCE_RMS = 1e-6;

export interface QueryCleanupOptions {
  highpassHz?: number;
  lowpassHz?: number;
  targetRms?: number;
  maxGain?: number;
  peakCeiling?: number;
}

/** What the filter actually did — logged per request so a real venue capture
 *  can be diagnosed from the server log ("we got 3 ms of -60 dBFS audio" vs
 *  "we got a healthy take that still did not match"). Never sent to clients. */
export interface QueryCleanupReport {
  highpassHz: number;
  lowpassHz: number;
  inputRms: number;
  inputPeak: number;
  filteredRms: number;
  appliedGain: number;
  outputRms: number;
  outputPeak: number;
  /** True when the input was at/below the silence floor — gain left at 1. */
  silent: boolean;
}

function rmsOf(x: Float32Array): number {
  if (x.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

function peakOf(x: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/**
 * Effective low-pass corner for a given sample rate: the requested corner, but
 * never above 45% of the sample rate (blowing past Nyquist would ring/alias
 * instead of filtering). At the 16 kHz analysis rate used by the landmark
 * extractors this lands on ~7.2 kHz — which is also the top of their analysis
 * band, so hiss cannot survive into the peak-picking stage.
 */
export function lowpassForSampleRate(sampleRate: number, requested = QUERY_LOWPASS_HZ): number {
  return Math.min(requested, 0.45 * sampleRate);
}

/**
 * RBJ-cookbook biquad (Q = 1/√2, i.e. Butterworth), forward-only and
 * deterministic. `zeroDelay=false` (one sample of state per section) is what
 * makes it reproducible; there is no look-ahead and no allocation beyond the
 * output array.
 */
function biquad(
  x: Float32Array,
  sampleRate: number,
  cutoff: number,
  kind: "lowpass" | "highpass",
): Float32Array {
  const out = new Float32Array(x.length);
  if (x.length === 0 || sampleRate <= 0 || cutoff <= 0 || cutoff >= sampleRate / 2) {
    out.set(x);
    return out;
  }
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / Math.SQRT2; // Q = 1/sqrt(2)
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  let b0: number, b1: number, b2: number;
  if (kind === "lowpass") {
    b0 = (1 - cosw) / 2;
    b1 = 1 - cosw;
    b2 = (1 - cosw) / 2;
  } else {
    b0 = (1 + cosw) / 2;
    b1 = -(1 + cosw);
    b2 = (1 + cosw) / 2;
  }
  const invA0 = 1 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y = invA0 * (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2);
    x2 = x1; x1 = x0; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/**
 * Band-limit the query: ~80 Hz high-pass (rumble) then the low-pass above.
 * Pure: returns a new array, never mutates the input.
 */
export function bandLimitQueryAudio(
  mono: Float32Array,
  sampleRate: number,
  opts: Pick<QueryCleanupOptions, "highpassHz" | "lowpassHz"> = {},
): Float32Array {
  if (mono.length === 0) return new Float32Array(0);
  const hp = opts.highpassHz ?? QUERY_HIGHPASS_HZ;
  const lp = lowpassForSampleRate(sampleRate, opts.lowpassHz ?? QUERY_LOWPASS_HZ);
  const highpassed = biquad(mono, sampleRate, hp, "highpass");
  return biquad(highpassed, sampleRate, lp, "lowpass");
}

export interface NormalizeResult {
  samples: Float32Array;
  inputRms: number;
  inputPeak: number;
  appliedGain: number;
  outputRms: number;
  outputPeak: number;
  silent: boolean;
}

/**
 * Loudness-normalise to a fixed target RMS (gain capped), then peak-limit so
 * nothing exceeds the ceiling. Deterministic and non-mutating.
 */
export function normalizeQueryAudio(
  mono: Float32Array,
  opts: Pick<QueryCleanupOptions, "targetRms" | "maxGain" | "peakCeiling"> = {},
): NormalizeResult {
  const targetRms = opts.targetRms ?? QUERY_TARGET_RMS;
  const maxGain = opts.maxGain ?? QUERY_MAX_GAIN;
  const peakCeiling = opts.peakCeiling ?? QUERY_PEAK_CEILING;
  const out = new Float32Array(mono.length);
  const inputRms = rmsOf(mono);
  const inputPeak = peakOf(mono);
  if (mono.length === 0 || inputRms <= SILENCE_RMS) {
    out.set(mono);
    return {
      samples: out,
      inputRms,
      inputPeak,
      appliedGain: 1,
      outputRms: inputRms,
      outputPeak: inputPeak,
      silent: true,
    };
  }
  let gain = Math.min(maxGain, targetRms / inputRms);
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const v = mono[i] * gain;
    out[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak > peakCeiling && peak > 0) {
    const limit = peakCeiling / peak;
    gain *= limit;
    for (let i = 0; i < out.length; i++) out[i] *= limit;
    peak = peakCeiling;
  }
  return {
    samples: out,
    inputRms,
    inputPeak,
    appliedGain: gain,
    outputRms: rmsOf(out),
    outputPeak: peak,
    silent: false,
  };
}

/**
 * The full query pre-filter: band-limit (rumble + hiss) then normalise
 * (level). Applied to a decoded QUERY capture before any fingerprint /
 * pitch extraction. Pure and deterministic — see the module header.
 */
export function cleanQueryAudio(
  mono: Float32Array,
  sampleRate: number,
  opts: QueryCleanupOptions = {},
): { samples: Float32Array; report: QueryCleanupReport } {
  const inputRms = rmsOf(mono);
  const inputPeak = peakOf(mono);
  const filtered = bandLimitQueryAudio(mono, sampleRate, opts);
  const filteredRms = rmsOf(filtered);
  const normalized = normalizeQueryAudio(filtered, opts);
  return {
    samples: normalized.samples,
    report: {
      highpassHz: opts.highpassHz ?? QUERY_HIGHPASS_HZ,
      lowpassHz: lowpassForSampleRate(sampleRate, opts.lowpassHz ?? QUERY_LOWPASS_HZ),
      inputRms,
      inputPeak,
      filteredRms,
      appliedGain: normalized.appliedGain,
      outputRms: normalized.outputRms,
      outputPeak: normalized.outputPeak,
      silent: normalized.silent,
    },
  };
}

/** One-line, log-safe rendering of a cleanup report (no audio bytes). */
export function describeCleanup(report: QueryCleanupReport): string {
  const db = (v: number) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : "-inf");
  return (
    `hp=${report.highpassHz}Hz lp=${report.lowpassHz}Hz ` +
    `in=${db(report.inputRms)}dBFS peak=${db(report.inputPeak)}dBFS ` +
    `gain=${report.appliedGain.toFixed(2)}x out=${db(report.outputRms)}dBFS` +
    (report.silent ? " (silent: no gain applied)" : "")
  );
}
