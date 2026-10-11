/**
 * Unit tests for the query-audio pre-filter (backlog d9b051ee, owner 10-10).
 *
 * The filter is a pure function of (samples, sampleRate, options) — that is the
 * whole reason it could be debugged at all: a real venue capture cannot be
 * replayed on this box, but its *defects* can. These tests pin the four
 * properties the fix depends on:
 *   - rumble (well below the musical band) is attenuated, not passed;
 *   - musical content (4 kHz, and the hum/whistle band) passes essentially
 *     unchanged, so cleaning cannot cost us a genuine match;
 *   - the output lands on the fixed target loudness, with the gain capped and
 *     the peak limited (so the 16-bit fpcalc WAV path never clips);
 *   - same input bytes → byte-identical output (deterministic, no randomness /
 *     no mutable module state), so a probe run reproduces a device capture.
 *
 * Run with: bun test src/services/audio-cleanup.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  HUM_QUERY_LOWPASS_HZ,
  QUERY_HIGHPASS_HZ,
  QUERY_MAX_GAIN,
  QUERY_PEAK_CEILING,
  QUERY_TARGET_RMS,
  bandLimitQueryAudio,
  cleanQueryAudio,
  describeCleanup,
  lowpassForSampleRate,
  normalizeQueryAudio,
} from "./audio-cleanup";

/** Deterministic sine generator (no PRNG, no state). */
function sine(freq: number, sampleRate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** RMS of the tail (skips the filter's start-up transient). */
function tailRms(x: Float32Array, skipFraction = 0.25): number {
  const start = Math.floor(x.length * skipFraction);
  let sum = 0;
  for (let i = start; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, x.length - start));
}

/**
 * Amplitude of one frequency component, phase-independent: the biquads shift
 * phase, so a single in-phase correlation would under-report. Uses both
 * quadrature correlations.
 */
function toneAmp(x: Float32Array, freq: number, sampleRate: number): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) {
    const w = (2 * Math.PI * freq * i) / sampleRate;
    s += x[i] * Math.sin(w);
    c += x[i] * Math.cos(w);
  }
  return (2 * Math.hypot(s, c)) / x.length;
}

describe("bandLimitQueryAudio — rumble out, music through", () => {
  test("a 40 Hz rumble tone is attenuated by the ~80 Hz high-pass (2nd-order Butterworth)", () => {
    const sr = 16000;
    const tone40 = sine(40, sr, 1.0, 0.5);
    const tone400 = sine(400, sr, 1.0, 0.5);
    const hp40 = tailRms(bandLimitQueryAudio(tone40, sr, { highpassHz: 80 }));
    const hp400 = tailRms(bandLimitQueryAudio(tone400, sr, { highpassHz: 80 }));
    const ratio = hp40 / hp400;
    // |H(f)| = 1/sqrt(1 + (fc/f)^4) at f = 40, fc = 80 → 0.2425.
    const expected = 1 / Math.sqrt(1 + Math.pow(80 / 40, 4));
    expect(ratio).toBeGreaterThan(expected - 0.05);
    expect(ratio).toBeLessThan(expected + 0.05);
    expect(ratio).toBeLessThan(0.3); // it really is removed, not merely touched
  });

  test("a 20 Hz (sub-audible rumble) tone is attenuated harder than 40 Hz", () => {
    const sr = 16000;
    const r20 = tailRms(bandLimitQueryAudio(sine(20, sr, 1.5, 0.5), sr, { highpassHz: 80 }));
    const r40 = tailRms(bandLimitQueryAudio(sine(40, sr, 1.5, 0.5), sr, { highpassHz: 80 }));
    expect(r20).toBeLessThan(r40 * 0.5);
  });

  test("a 4 kHz tone passes the full clean-up band essentially unchanged", () => {
    for (const sr of [16000, 44100]) {
      const tone = sine(4000, sr, 0.5, 0.5);
      const out = bandLimitQueryAudio(tone, sr);
      const before = tailRms(tone);
      const after = tailRms(out);
      expect(Math.abs(after / before - 1)).toBeLessThan(0.05);
    }
  });

  test("the low-pass corner never exceeds 45% of the sample rate (Nyquist guard)", () => {
    expect(lowpassForSampleRate(16000)).toBeCloseTo(7200, 6);
    expect(lowpassForSampleRate(44100)).toBe(15000);
    expect(lowpassForSampleRate(8000)).toBeCloseTo(3600, 6);
    // An explicit hum-path corner is also clamped, never raised.
    expect(lowpassForSampleRate(16000, HUM_QUERY_LOWPASS_HZ)).toBe(HUM_QUERY_LOWPASS_HZ);
  });

  test("band-limiting does not mutate its input", () => {
    const tone = sine(300, 16000, 0.2, 0.4);
    const copy = Float32Array.from(tone);
    bandLimitQueryAudio(tone, 16000);
    expect(Array.from(tone)).toEqual(Array.from(copy));
  });
});

describe("normalizeQueryAudio — fixed analysis level", () => {
  test("a quiet capture is lifted to the target RMS (±2%)", () => {
    const sr = 16000;
    const quiet = sine(1000, sr, 0.5, 0.03); // RMS ≈ 0.0212 → gain ≈ 4.7x
    const res = normalizeQueryAudio(quiet);
    expect(res.silent).toBe(false);
    expect(res.outputRms).toBeGreaterThan(QUERY_TARGET_RMS * 0.98);
    expect(res.outputRms).toBeLessThan(QUERY_TARGET_RMS * 1.02);
    expect(res.appliedGain).toBeCloseTo(QUERY_TARGET_RMS / res.inputRms, 3);
  });

  test("a loud capture is attenuated to the same target RMS (±2%)", () => {
    const loud = sine(1000, 16000, 0.5, 0.9); // RMS ≈ 0.636, gain < 1
    const res = normalizeQueryAudio(loud);
    expect(res.appliedGain).toBeLessThan(1);
    expect(res.outputRms).toBeGreaterThan(QUERY_TARGET_RMS * 0.98);
    expect(res.outputRms).toBeLessThan(QUERY_TARGET_RMS * 1.02);
    // Loud and quiet end up at the SAME level — the point of normalising.
    const quiet = normalizeQueryAudio(sine(1000, 16000, 0.5, 0.03));
    expect(Math.abs(res.outputRms - quiet.outputRms)).toBeLessThan(0.002);
  });

  test("gain is capped for a near-silent capture instead of amplifying noise", () => {
    const nearSilent = sine(1000, 16000, 0.2, 1e-4);
    const res = normalizeQueryAudio(nearSilent);
    expect(res.appliedGain).toBe(QUERY_MAX_GAIN);
    expect(res.outputRms).toBeLessThan(QUERY_TARGET_RMS);
  });

  test("true digital silence / empty input is left alone (no NaN, gain 1)", () => {
    const silent = new Float32Array(1600);
    const res = normalizeQueryAudio(silent);
    expect(res.silent).toBe(true);
    expect(res.appliedGain).toBe(1);
    expect(res.outputRms).toBe(0);
    expect(res.samples.every((v) => Number.isFinite(v))).toBe(true);

    const empty = normalizeQueryAudio(new Float32Array(0));
    expect(empty.samples.length).toBe(0);
    expect(empty.appliedGain).toBe(1);
  });

  test("the peak limit keeps a spiky (high crest-factor) capture inside [-0.99, 0.99]", () => {
    // One loud click on top of a quiet tone: RMS-based gain alone would clip it.
    const sr = 16000;
    const spiky = sine(1000, sr, 0.3, 0.02);
    for (let i = 400; i < 410; i++) spiky[i] = 1.0;
    const res = normalizeQueryAudio(spiky);
    expect(res.outputPeak).toBeLessThanOrEqual(QUERY_PEAK_CEILING + 1e-6);
    expect(res.samples.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
  });
});

describe("cleanQueryAudio — the shipped stage", () => {
  test("is deterministic: identical input bytes → identical output bytes", () => {
    const sr = 44100;
    const raw = sine(220, sr, 0.4, 0.35);
    for (let i = 0; i < raw.length; i++) raw[i] += 0.05 * Math.sin(i / 7); // deterministic texture
    const a = cleanQueryAudio(raw, sr);
    const b = cleanQueryAudio(raw, sr);
    expect(a.samples.length).toBe(b.samples.length);
    expect(Array.from(a.samples)).toEqual(Array.from(b.samples));
    expect(a.report).toEqual(b.report);
  });

  test("reports the corner frequencies actually applied, and folds in the silence guard", () => {
    const sr = 16000;
    const { report } = cleanQueryAudio(sine(440, sr, 0.3, 0.2), sr);
    expect(report.highpassHz).toBe(QUERY_HIGHPASS_HZ);
    expect(report.lowpassHz).toBeCloseTo(7200, 6);
    expect(report.silent).toBe(false);
    expect(report.outputPeak).toBeLessThanOrEqual(QUERY_PEAK_CEILING + 1e-6);
    expect(describeCleanup(report)).toContain("hp=80Hz");
    expect(describeCleanup(report)).toContain("lp=7200Hz");

    const silent = cleanQueryAudio(new Float32Array(800), sr);
    expect(silent.report.silent).toBe(true);
    expect(silent.samples.every((v) => v === 0)).toBe(true);
  });

  test("a noisy far-field capture (quiet hum + rumble + hiss) comes out at a usable level with the rumble gone", () => {
    const sr = 16000;
    const n = sr; // 1 s
    const noisy = new Float32Array(n);
    // Hummed A3 (220 Hz) at conversational-to-far-field level …
    for (let i = 0; i < n; i++) noisy[i] = 0.03 * Math.sin((2 * Math.PI * 220 * i) / sr);
    // … plus venue rumble (35 Hz) and codec hiss (deterministic pseudo-noise).
    for (let i = 0; i < n; i++) {
      noisy[i] += 0.25 * Math.sin((2 * Math.PI * 35 * i) / sr);
      noisy[i] += 0.05 * Math.sin(i * 12.9898) * Math.sin(i * 78.233);
    }
    // Before: rumble dominates the melody ~8:1 — that is the venue capture that
    // made both engines return no match.
    const rumbleBefore = toneAmp(noisy, 35, sr);
    const melodyBefore = toneAmp(noisy, 220, sr);
    const ratioBefore = rumbleBefore / melodyBefore;
    expect(ratioBefore).toBeGreaterThan(5);

    // After band-limiting the rumble is cut by ~5x (|H(35 Hz)| = 1/√(1+(80/35)^4)
    // ≈ 0.19 for the 2nd-order high-pass), while the melody is untouched.
    const bandLimited = bandLimitQueryAudio(noisy, sr);
    const rumbleAfter = toneAmp(bandLimited, 35, sr);
    const melodyAfter = toneAmp(bandLimited, 220, sr);
    expect(rumbleAfter).toBeLessThan(rumbleBefore * 0.3);
    expect(melodyAfter).toBeGreaterThan(melodyBefore * 0.9);
    // The rumble-to-melody dominance is broken by at least 4x. (It is not
    // reduced to zero: a 35 Hz tone is 1.2 octaves below the corner, so a
    // 2nd-order high-pass can only attenuate it ~14 dB. Steepening the corner
    // was deliberately NOT done — it would start eating the lowest hummed notes
    // that the hum engine's f0 search (55 Hz floor) is meant to hear.)
    expect(rumbleAfter / melodyAfter).toBeLessThan(ratioBefore / 4);

    // And the full stage puts the capture at the fixed analysis level.
    const cleaned = cleanQueryAudio(noisy, sr);
    expect(cleaned.report.silent).toBe(false);
    expect(cleaned.report.appliedGain).toBeGreaterThan(1);
    expect(cleaned.report.outputRms).toBeGreaterThan(QUERY_TARGET_RMS * 0.9);
    expect(cleaned.report.outputPeak).toBeLessThanOrEqual(QUERY_PEAK_CEILING + 1e-6);
  });
});
