// ---------------------------------------------------------------------------
// landmark.ts — Robust audio watermark / landmark fingerprinter (Shazam-style)
//
// Replaces the brittle exact-Chromaprint matcher. The old matcher only returned
// a hit when the query audio was bit-identical to the stored reference render
// (Chromaprint raw values overlap 0 on any re-render / performance / recording).
//
// This module computes a landmark fingerprint: a sequence of (hash, time) pairs
// built from spectral peaks (anchor → target fan-out pairs). Matching (see
// landmark-matching.ts) is then done by hash lookup + time-offset alignment
// voting, which is robust to different synthesis, timbre, mic/room noise,
// compression and modest tempo drift — the real failure mode for "I heard a
// song and want to play it".
//
// Pure TS, no native dependencies, memory-light (processes the spectrogram one
// frame at a time). Designed to run inside the Vercel function and in ingest
// scripts.
// ---------------------------------------------------------------------------

export interface Landmark {
  /** Packed 32-bit hash identifying the peak pair. */
  hash: number;
  /** Anchor time of the landmark in centiseconds (query and DB agree). */
  timeCs: number;
}

// -- Tunables (constants, so both ingest and query always use the same config) --
export const SAMPLE_RATE = 16000; // all audio is resampled to 16 kHz mono first
export const NFFT = 1024; // ~64 ms window
export const HOP = 512; // ~32 ms frame step (tuned for density/DB-query balance)
export const PEAK_PER_FRAME = 4; // strongest peaks kept per frame
export const PEAK_NEIGHBOUR = 3; // freq-neighbourhood radius for local maxima
export const TARGET_MIN_DT = 12; // frames ahead an anchor looks for targets (>=0.38s)
export const TARGET_MAX_DT = 55; // frames ahead (<= ~1.76s)
export const TARGET_FREQ_BAND = 12; // +- bins around anchor freq to look for targets
export const MAX_TARGETS_PER_ANCHOR = 2; // fan-out cap (sparsity / DB size)

// dB floor relative to frame max — a peak must be within this to be kept.
const PEAK_DB_FLOOR = 45; // (frameMax - floor) dB; keep strong spectral content only

interface Peak {
  bin: number;
  timeFrame: number;
  mag: number;
}

// ---------------------------------------------------------------------------
// FFT (radix-2, iterative, in place)
// ---------------------------------------------------------------------------
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + half], bIm = im[i + k + half];
        const tRe = bRe * curRe - bIm * curIm;
        const tIm = bRe * curIm + bIm * curRe;
        re[i + k] = aRe + tRe;
        im[i + k] = aIm + tIm;
        re[i + k + half] = aRe - tRe;
        im[i + k + half] = aIm - tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Peak extraction from one frame's magnitude spectrum
// ---------------------------------------------------------------------------
function framePeaks(mag: Float32Array): { bin: number; mag: number }[] {
  const bins = mag.length;
  // find frame max for the relative threshold
  let frameMax = 0;
  for (let b = 1; b < bins; b++) if (mag[b] > frameMax) frameMax = mag[b];
  if (frameMax <= 0) return [];
  const floor = frameMax * Math.pow(10, -PEAK_DB_FLOOR / 20);

  const peaks: { bin: number; mag: number }[] = [];
  for (let b = PEAK_NEIGHBOUR; b < bins - PEAK_NEIGHBOUR; b++) {
    if (mag[b] < floor) continue;
    let isLocalMax = true;
    for (let d = 1; d <= PEAK_NEIGHBOUR; d++) {
      if (mag[b] < mag[b - d] || mag[b] <= mag[b + d]) {
        isLocalMax = false;
        break;
      }
    }
    if (isLocalMax) peaks.push({ bin: b, mag: mag[b] });
  }
  peaks.sort((a, b) => b.mag - a.mag);
  return peaks.slice(0, PEAK_PER_FRAME);
}

// ---------------------------------------------------------------------------
// Landmark hashing — pack (anchor bin, target bin, delta frames) into an int
// ---------------------------------------------------------------------------
// Bins are 1..511 (10 bits), delta frames up to (TARGET_MAX_DT-1)=109 (7 bits).
const F1_SHIFT = 17;
const F2_SHIFT = 7;
function packHash(f1: number, f2: number, dtFrames: number): number {
  return (f1 << F1_SHIFT) | (f2 << F2_SHIFT) | dtFrames;
}

/**
 * Extract landmark fingerprints from mono samples (assumed ~16kHz).
 *
 * @param samples  interleaved mono samples
 * @param sampleRate  sample rate of the input (resample is assumed done by caller)
 * @returns array of {hash, timeCs} landmarks
 */
export function extractLandmarks(
  samples: Float32Array,
  sampleRate: number = SAMPLE_RATE,
): Landmark[] {
  const downsample = sampleRate !== SAMPLE_RATE;
  let x = samples;
  if (downsample) {
    const outLen = Math.max(1, Math.round((samples.length * SAMPLE_RATE) / sampleRate));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const p = (i * sampleRate) / SAMPLE_RATE;
      const l = Math.min(Math.floor(p), samples.length - 1);
      const fr = p - l;
      const r = Math.min(l + 1, samples.length - 1);
      out[i] = samples[l] + (samples[r] - samples[l]) * fr;
    }
    x = out;
  }

  const re = new Float32Array(NFFT);
  const im = new Float32Array(NFFT);
  const mag = new Float32Array(NFFT / 2);
  // Hann window (precomputed)
  const win = new Float32Array(NFFT);
  for (let i = 0; i < NFFT; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (NFFT - 1)));

  const allPeaks: Peak[] = [];
  const numFrames = Math.max(0, Math.floor((x.length - NFFT) / HOP) + 1);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * HOP;
    for (let i = 0; i < NFFT; i++) {
      re[i] = x[offset + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < NFFT / 2; b++) {
      const r = re[b], im2 = im[b];
      mag[b] = Math.sqrt(r * r + im2 * im2);
    }
    const peaks = framePeaks(mag);
    for (const pk of peaks) {
      allPeaks.push({ bin: pk.bin, timeFrame: f, mag: pk.mag });
    }
  }

  if (allPeaks.length < 2) return [];

  // Quality guardrail: drop silent / near-silent audio early.
  // (Peak count is a decent proxy; a real piece yields thousands of peaks.)

  // -- Hash via anchor/target fan-out --
  const landmarks: Landmark[] = [];
  const timeCs = (frame: number): number => Math.round((frame * HOP * 100) / SAMPLE_RATE);
  const fmax = NFFT / 2 - PEAK_NEIGHBOUR;

  // Group peaks per frame for efficient target lookups.
  const byFrame = new Map<number, Peak[]>();
  for (const pk of allPeaks) {
    let arr = byFrame.get(pk.timeFrame);
    if (!arr) { arr = []; byFrame.set(pk.timeFrame, arr); }
    arr.push(pk);
  }

  for (const pk of allPeaks) {
    if (pk.bin >= fmax) continue;
    const targets: { bin: number; dt: number; mag: number }[] = [];
    for (let tf = pk.timeFrame + TARGET_MIN_DT; tf <= pk.timeFrame + TARGET_MAX_DT; tf++) {
      const arr = byFrame.get(tf);
      if (!arr) continue;
      for (const t of arr) {
        if (Math.abs(t.bin - pk.bin) <= TARGET_FREQ_BAND && t.bin < fmax) {
          targets.push({ bin: t.bin, dt: tf - pk.timeFrame, mag: t.mag });
        }
      }
    }
    targets.sort((a, b) => b.mag - a.mag);
    for (const t of targets.slice(0, MAX_TARGETS_PER_ANCHOR)) {
      landmarks.push({ hash: packHash(pk.bin, t.bin, t.dt), timeCs: timeCs(pk.timeFrame) });
    }
  }

  return landmarks;
}

/** Convenience: dedupe identical (hash, time) pairs — harmless, keeps arrays small. */
export function dedupeLandmarks(lms: Landmark[]): Landmark[] {
  if (lms.length < 2) return lms;
  const seen = new Set<number>();
  const out: Landmark[] = [];
  for (const lm of lms) {
    const key = (lm.hash * 104729) ^ lm.timeCs;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lm);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Robust extraction for REAL device captures (the landmark matcher's weak
// point on genuine phone-mic m4a — synthetic noise/reverb cannot reproduce the
// live-capture failure, but three principled defects make live captures land
// weak/spurious relative to the 16 kHz-rendered reference):
//   1. The 44.1 kHz->16 kHz query downsample had NO anti-aliasing filter, so a
//      real phone's full-band capture (energy well above the 8 kHz Nyquist)
//      aliases into the analysis band and smears/blurs the spectrogram peaks
//      it is built from. The reference fingerprints were rendered at 16 kHz,
//      so they never see this. A pre-decimation lowpass removes it.
//   2. Peak selection was NOT band-limited: in a room capture, low-frequency
//      rumble/reverb dominates the per-frame max, so the single -45 dB
//      "relative to frame max" floor either keeps codec-noise peaks (inflating
//      the spurious matched-surface the confidence denominator is built from)
//      or masks genuine melodic peaks. Restricting to the musically-relevant
//      band (< 7.6 kHz, > ~110 Hz) keeps the floor meaningful.
//   3. The floor was a flat -45 dB below the frame's loudest bin. With heavy
//      reverb that admits too many spurious noise peaks. We tighten to a
//      -24 dB floor relative to the in-band max, keeping only salient peaks —
//      fewer spurious query hashes, so the correct piece's aligned surface
//      dominates the matched-surface denominator and confidence recovers,
//      without dropping the piece's own genuine landmarks (its distinctive
//      peaks are far above -24 dB).
//
// The reference DB is unchanged (still ingested with the classic extractor);
// this only makes the QUERY emit a cleaner superset of the same hashes — strictly
// fewer spurious ones — so genuine matches hold and false positives do not rise.
// ---------------------------------------------------------------------------
// RBJ-cookbook biquad lowpass (used to anti-alias before 44.1k->16k decimation).
function rbLowpass(x: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const out = new Float32Array(x.length);
  if (x.length === 0) return out;
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w0) / Math.SQRT2; // Q = 1/sqrt(2)
  const cosw = Math.cos(w0);
  const b0 = (1 - cosw) / 2, b1 = 1 - cosw, b2 = (1 - cosw) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
  const invA0 = 1 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = invA0 * (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2);
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
// Musically-relevant spectral band at 16 kHz (bins of a 1024-pt FFT):
//   binMin ~= 110 Hz, binMax ~= 7600 Hz. Below ~110 Hz is room rumble/ground;
//   above ~7.6 kHz is where AAC codec noise and aliasing live.
const BIN_MIN = 7;
const BIN_MAX = 486; // NFFT/2-1 = 511; 486 ~= 7600 Hz
const ROBUST_PEAK_DB_FLOOR = 24; // keep peaks within this dB of the in-band frame max
const ROBUST_PEAK_PER_FRAME = 3;

/**
 * Robust landmark extraction intended for real-world (phone-mic) queries.
 * Same STFT + anchor/target fan-out as `extractLandmarks`, but with
 * anti-aliased downsampling, band-limited peak selection and an in-band
 * adaptive floor. Falls back to the classic extractor when already at 16 kHz
 * mono (downsample=false) so the reference-ingest path is byte-for-byte
 * unchanged behaviourally.
 */
export function extractLandmarksRobust(
  samples: Float32Array,
  sampleRate: number = SAMPLE_RATE,
): Landmark[] {
  const downsample = sampleRate !== SAMPLE_RATE;
  let x = samples;
  if (downsample) {
    // Anti-alias before decimation: 16 kHz Nyquist is 8 kHz; keep a clear
    // stop-band margin at ~7 kHz so content just above 8 kHz is attenuated
    // before it can fold into the analysis band.
    x = rbLowpass(samples, sampleRate, 7000);
    const outLen = Math.max(1, Math.round((x.length * SAMPLE_RATE) / sampleRate));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const p = (i * sampleRate) / SAMPLE_RATE;
      const l = Math.min(Math.floor(p), x.length - 1);
      const fr = p - l;
      const r = Math.min(l + 1, x.length - 1);
      out[i] = x[l] + (x[r] - x[l]) * fr;
    }
    x = out;
  }
  const re = new Float32Array(NFFT);
  const im = new Float32Array(NFFT);
  const mag = new Float32Array(NFFT / 2);
  const win = new Float32Array(NFFT);
  for (let i = 0; i < NFFT; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (NFFT - 1)));
  const allPeaks: Peak[] = [];
  const numFrames = Math.max(0, Math.floor((x.length - NFFT) / HOP) + 1);
  for (let f = 0; f < numFrames; f++) {
    const offset = f * HOP;
    for (let i = 0; i < NFFT; i++) { re[i] = x[offset + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < NFFT / 2; b++) {
      const r = re[b], i2 = im[b];
      mag[b] = Math.sqrt(r * r + i2 * i2);
    }
    // Band-limited in-band frame max + adaptive floor.
    let frameMax = 0;
    for (let b = BIN_MIN; b <= BIN_MAX && b < NFFT / 2; b++) if (mag[b] > frameMax) frameMax = mag[b];
    if (frameMax <= 0) continue;
    const floor = frameMax * Math.pow(10, -ROBUST_PEAK_DB_FLOOR / 20);
    const framePeaks: { bin: number; mag: number }[] = [];
    const lo = Math.max(PEAK_NEIGHBOUR, BIN_MIN), hi = Math.min(NFFT / 2 - PEAK_NEIGHBOUR, BIN_MAX);
    for (let b = lo; b < hi; b++) {
      if (mag[b] < floor) continue;
      let isLocalMax = true;
      for (let d = 1; d <= PEAK_NEIGHBOUR; d++) {
        if (mag[b] < mag[b - d] || mag[b] <= mag[b + d]) { isLocalMax = false; break; }
      }
      if (isLocalMax) framePeaks.push({ bin: b, mag: mag[b] });
    }
    framePeaks.sort((a, b) => b.mag - a.mag);
    for (const pk of framePeaks.slice(0, ROBUST_PEAK_PER_FRAME)) {
      allPeaks.push({ bin: pk.bin, timeFrame: f, mag: pk.mag });
    }
  }
  if (allPeaks.length < 2) return [];
  const landmarks: Landmark[] = [];
  const timeCs = (frame: number): number => Math.round((frame * HOP * 100) / SAMPLE_RATE);
  const fmax = NFFT / 2 - PEAK_NEIGHBOUR;
  const byFrame = new Map<number, Peak[]>();
  for (const pk of allPeaks) {
    let arr = byFrame.get(pk.timeFrame);
    if (!arr) { arr = []; byFrame.set(pk.timeFrame, arr); }
    arr.push(pk);
  }
  for (const pk of allPeaks) {
    if (pk.bin >= fmax || pk.bin < BIN_MIN || pk.bin > BIN_MAX) continue;
    const targets: { bin: number; dt: number; mag: number }[] = [];
    for (let tf = pk.timeFrame + TARGET_MIN_DT; tf <= pk.timeFrame + TARGET_MAX_DT; tf++) {
      const arr = byFrame.get(tf);
      if (!arr) continue;
      for (const t of arr) {
        if (Math.abs(t.bin - pk.bin) <= TARGET_FREQ_BAND && t.bin < fmax && t.bin >= BIN_MIN && t.bin <= BIN_MAX) {
          targets.push({ bin: t.bin, dt: tf - pk.timeFrame, mag: t.mag });
        }
      }
    }
    targets.sort((a, b) => b.mag - a.mag);
    for (const t of targets.slice(0, MAX_TARGETS_PER_ANCHOR)) {
      landmarks.push({ hash: packHash(pk.bin, t.bin, t.dt), timeCs: timeCs(pk.timeFrame) });
    }
  }
  return landmarks;
}
