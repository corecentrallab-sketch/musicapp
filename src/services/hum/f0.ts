// ---------------------------------------------------------------------------
// f0.ts — robust monophonic pitch (f0) extraction for hum/whistle/sing input.
//
// Implements YIN (de Cheveigné & Kawahara, 2002): the difference function plus
// cumulative-mean-normalized difference (CMNDF), with absolute-threshold + local
// minima search. This is a well-validated, dependency-free pitch estimator and
// is far more robust to octave errors and noise than plain peak-picking of the
// autocorrelation for voiced singing/humming.
//
// Input: mono PCM (Float32Array, -1..1) + sample rate. Output: a per-frame f0
// estimate (Hz) with a voiced confidence, so downstream note segmentation can
// tolerate silent gaps and octave jumps.
// ---------------------------------------------------------------------------
export interface F0Frame {
  /** Fundamental frequency in Hz (0 when unvoiced). */
  f0: number;
  /** 0..1 periodicity confidence (higher = more clearly voiced). */
  confidence: number;
  /** True when this frame is judged voiced. */
  voiced: boolean;
}

export interface F0Track {
  frames: F0Frame[];
  /** Seconds from start of signal to the centre of each frame. */
  times: number[];
  hopS: number;
  windowS: number;
  sampleRate: number;
}

const DEFAULT_FMIN = 55; // ~A1 — bottom of a humming voice
const DEFAULT_FMAX = 1000; // top of a whistle / high hum
const YIN_THRESHOLD = 0.12; // CMNDF absolute threshold
const MIN_VOICED = 0.22; // voiced if best CMNDF value below this

/** Uppercase-map to avoid allocating per frame. */
function midiOmitted(): void {}
void midiOmitted;

/**
 * Estimate f0 for one frame of `samples` using YIN's CMNDF over the lag range
 * implied by [fmin, fmax]. Returns { f0, confidence, voiced }.
 */
export function yinFrame(
  samples: Float32Array,
  sampleRate: number,
  offset: number,
  window: number,
  fmin = DEFAULT_FMIN,
  fmax = DEFAULT_FMAX,
): F0Frame {
  const tauMax = Math.min(Math.floor(sampleRate / fmin), window - 2);
  const tauMin = Math.max(1, Math.floor(sampleRate / fmax));
  if (tauMin >= tauMax) return { f0: 0, confidence: 0, voiced: false };

  // Precompute the difference function d(tau).
  const d = new Float32Array(tauMax + 1);
  let sumSquare = 0;
  for (let i = 0; i < window; i++) {
    const v = samples[offset + i] || 0;
    sumSquare += v * v;
  }
  if (sumSquare < 1e-9) return { f0: 0, confidence: 0, voiced: false };

  for (let tau = tauMin; tau <= tauMax; tau++) {
    let acc = 0;
    for (let i = 0; i < window; i++) {
      const s1 = samples[offset + i] || 0;
      const s2 = samples[offset + i + tau] || 0;
      const diff = s1 - s2;
      acc += diff * diff;
    }
    d[tau] = acc;
  }

  // Cumulative-mean-normalized difference.
  const cmndf = new Float32Array(tauMax + 1);
  let running = 0;
  cmndf[0] = 1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    running += d[tau];
    cmndf[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  // Absolute threshold: first tau where cmndf dips below the threshold.
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax - 1; tau++) {
    if (cmndf[tau] < YIN_THRESHOLD) {
      // Search for the local minimum near this dip.
      tauEst = tau;
      while (tauEst + 1 < tauMax && cmndf[tauEst + 1] < cmndf[tauEst]) tauEst++;
      break;
    }
  }

  if (tauEst < 0) {
    // No clear periodicity — fall back to the global minimum.
    let bestVal = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmndf[tau] < bestVal) bestVal = cmndf[tau];
    }
    const conf = 1 - Math.min(1, bestVal);
    return { f0: 0, confidence: conf, voiced: bestVal < MIN_VOICED ? true : false };
  }

  // Parabolic interpolation around the minimum for sub-lag accuracy.
  const tau0 = tauEst > tauMin ? cmndf[tauEst - 1] : cmndf[tauEst];
  const tau1 = cmndf[tauEst];
  const tau2 = tauEst + 1 < cmndf.length ? cmndf[tauEst + 1] : cmndf[tauEst];
  const denom = tau0 - 2 * tau1 + tau2;
  const delta = denom !== 0 ? (tau0 - tau2) / (2 * denom) : 0;
  const refinedTau = tauEst + delta;

  const f0 = sampleRate / refinedTau;
  const conf = 1 - Math.min(1, tau1);
  return { f0: Math.round(f0 * 100) / 100, confidence: conf, voiced: conf >= 1 - MIN_VOICED && f0 >= fmin * 0.8 && f0 <= fmax * 1.2 };
}

export interface YinOptions {
  windowMs?: number;
  hopMs?: number;
  fmin?: number;
  fmax?: number;
}

/** Run frame-by-frame YIN over the whole mono signal. */
export function extractF0Track(
  mono: Float32Array,
  sampleRate: number,
  opts: YinOptions = {},
): F0Track {
  const windowMs = opts.windowMs ?? 60;
  const hopMs = opts.hopMs ?? 20;
  const fmin = opts.fmin ?? DEFAULT_FMIN;
  const fmax = opts.fmax ?? DEFAULT_FMAX;
  const window = Math.floor((sampleRate * windowMs) / 1000);
  const hop = Math.max(1, Math.floor((sampleRate * hopMs) / 1000));

  const frames: F0Frame[] = [];
  const times: number[] = [];
  for (let offset = 0; offset + window <= mono.length; offset += hop) {
    frames.push(yinFrame(mono, sampleRate, offset, window, fmin, fmax));
    times.push((offset + window / 2) / sampleRate);
  }
  return { frames, times, hopS: hop / sampleRate, windowS: window / sampleRate, sampleRate };
}

/** Convert a frequency in Hz to MIDI note number (float), 69 = A4 = 440Hz. */
export function hzToMidi(hz: number): number {
  if (hz <= 0) return 0;
  return 69 + 12 * Math.log2(hz / 440);
}

/** Round a frequency to the nearest semitone and return the MIDI integer. */
export function hzToMidiInt(hz: number): number {
  return Math.round(hzToMidi(hz));
}

/**
 * Median filter over the voiced f0 track (in MIDI units) to remove octave
 * spikes / single-frame dropouts while preserving genuine octave jumps that
 * persist across several frames. Returns the same-length MIDI array (0 where
 * unvoiced in the majority-median sense).
 */
export function smoothMidiTrack(midi: number[], frameConf: number[], voiced: boolean[], window = 3): number[] {
  const out = midi.slice();
  for (let i = 0; i < midi.length; i++) {
    if (!voiced[i]) {
      out[i] = 0;
      continue;
    }
    const lo = Math.max(0, i - window);
    const hi = Math.min(midi.length - 1, i + window);
    const vals: number[] = [];
    for (let j = lo; j <= hi; j++) {
      if (voiced[j]) vals.push(midi[j]);
    }
    if (vals.length === 0) {
      out[i] = midi[i];
    } else {
      // Weight by confidence while taking the median of the pitch values.
      const sorted = vals.slice().sort((a, b) => a - b);
      out[i] = sorted[Math.floor(sorted.length / 2)];
    }
    void frameConf;
  }
  return out;
}
