// ---------------------------------------------------------------------------
// hum-quality.ts — CAPTURE-QUALITY GUARD for /api/hum
//
// Distinguishes a BAD TAKE from a clean-but-simply-weak one. A degraded
// capture (on-device mic overdrive, room noise, a continuous pitch-glide
// instead of discrete notes, mains-hum bleed) doesn't carry a clean stepped
// melody, so no matcher threshold can recover it — the honest response to the
// user is "your input wasn't clear, retry," not a bare "no confident match".
//
// This guard is evaluated AFTER f0TrackToContour and BEFORE the melody
// matcher, using ONLY data that is already extracted (the note/delta contour
// and the per-frame f0 track) — no extra compute, no second pass, no FFT.
//
// Signals (chosen and thresholded against the owner's real degraded capture
// from DIAGNOSIS.md vs. clean synthetic whistles — see hum.test.ts):
//
//   (a) UNSTABLE PITCH  — the extracted contour contains an adjacent-step
//       move of > 1 octave (maxAbsDelta > 12 semitones) WHILE the note count
//       is far beyond any plausible hummed phrase (>= 16). Fragmentation of a
//       held note produces small ±1–2 semitone jitter; a >octave jump on top
//       of an implausible note count is the signature of an unstable f0
//       (over-driven mic → harmonic distortion → octave errors), NOT a melody.
//       The owner's bad file: maxAbsDelta=14, notes=36 (trips). Clean whistle:
//       maxAbsDelta<=5, notes 9–25 (never trips because maxAbsDelta<=12).
//
//   (b) WIDE VOICED-f0 RANGE — the instantaneous voiced f0 (min..max over the
//       whole clip) wanders wider than ~2 octaves. A clean hum/whistle of any
//       normal phrase holds within ~1–1.5 octaves; a >2-octave sweep means YIN
//       is octave-jumping on a noisy/over-driven signal. The owner's bad file:
//       voiced f0 spans 101.7→845.7 Hz = 3.06 octaves (trips). Clean whistle:
//       ~1.03 octaves. Requiring >= 30 voiced frames keeps tiny clips (which
//       can legitimately hop) from tripping.
//
//   (c) LOW-FREQUENCY / MAINS-HUM — a supporting diagnostic only. A 50/60 Hz
//       mains hum lives below the melody band, so the f0 track voices very
//       few sub-150 Hz frames even when hum is present (owner's file shows
//       only ~0.4%), and a user legitimately humming a low note could sit
//       mostly below 150 Hz. Because the cheap f0-derived probe cannot
//       reliably separate "mains hum" from "deliberately low note", it is
//       measured and reported but never trips the gate on its own.
//
// The guard NEVER names a piece. When it trips, the handler returns an
// `input_unclear: true` response with actionable guidance instead of the
// normal match/no-confident-match payload. Clean-but-simply-weak captures
// (stable pitch, bounded range, just not confident) pass through untouched to
// the existing matcher gate, so that behaviour is fully preserved.
// ---------------------------------------------------------------------------

import type { F0Track } from "./f0";
import type { Note } from "./contour";

export interface CaptureQuality {
  /** True when the capture is judged too degraded to trust matching. */
  inputUnclear: boolean;
  /** Which signals fired (subset of the three below). */
  reasons: string[];
  /** (a)–(c) diagnostics, exposed for tests and operator visibility. */
  maxAbsDelta: number;
  notes: number;
  voicedFrames: number;
  voicedF0SpanOctaves: number;
  lowF0Ratio: number;
}

/** Gate constants — calibrated by hum.test.ts (see header for reasoning). */
export const QUALITY_GATE = {
  /** An adjacent contour step larger than this semitones is > a full octave. */
  MAX_STEP_SEMITONES: 12,
  /** Note count considered "unrecognizably too many" for a hummed phrase. */
  MIN_UNSTABLE_NOTES: 16,
  /** Instantaneous voiced-f0 span (min..max) beyond this octaves = unstable. */
  MAX_VOICED_F0_SPAN_OCTAVES: 2.2,
  /** Minimum voiced frames before the span signal is considered informative. */
  MIN_VOICED_FRAMES_FOR_SPAN: 30,
  /** "Sub-150 Hz" hum band cut (mains hum region). */
  LOW_F0_HZ: 150,
  /** Share of voiced frames in the hum band that would indicate strong hum. */
  LOW_F0_HUM_RATIO: 0.15,
} as const;

export const QUALITY_REASONS = {
  UNSTABLE_PITCH: "unstable-pitch",
  WIDE_PITCH_RANGE: "wide-pitch-range",
  LOW_FREQUENCY_HUM: "low-frequency-hum",
} as const;

/**
 * Evaluate the capture-quality gate for a hum/whistle take.
 * Pure, synchronous, no I/O and no extra compute over already-extracted data.
 */
export function evaluateCaptureQuality(
  contour: { notes: Note[]; deltas: number[] },
  track: F0Track,
): CaptureQuality {
  // (a) contour statistics
  const notes = contour.notes.length;
  let maxAbsDelta = 0;
  for (const d of contour.deltas) {
    const a = Math.abs(d);
    if (a > maxAbsDelta) maxAbsDelta = a;
  }

  // (b) voiced f0 range + (c) low-frequency share, from the already-extracted
  //     per-frame YIN track (instantaneous voiced f0 frequencies in Hz).
  let voicedFrames = 0;
  let minF0 = Infinity;
  let maxF0 = -Infinity;
  let lowFrames = 0;
  for (const f of track.frames) {
    if (!f.voiced || f.f0 <= 0) continue;
    voicedFrames++;
    if (f.f0 < minF0) minF0 = f.f0;
    if (f.f0 > maxF0) maxF0 = f.f0;
    if (f.f0 < QUALITY_GATE.LOW_F0_HZ) lowFrames++;
  }
  const voicedF0SpanOctaves = maxF0 > minF0 && minF0 > 0 ? Math.log2(maxF0 / minF0) : 0;
  const lowF0Ratio = voicedFrames > 0 ? lowFrames / voicedFrames : 0;

  const unstablePitch =
    maxAbsDelta > QUALITY_GATE.MAX_STEP_SEMITONES &&
    notes >= QUALITY_GATE.MIN_UNSTABLE_NOTES;
  const wideRange =
    voicedFrames >= QUALITY_GATE.MIN_VOICED_FRAMES_FOR_SPAN &&
    voicedF0SpanOctaves > QUALITY_GATE.MAX_VOICED_F0_SPAN_OCTAVES;

  const reasons: string[] = [];
  if (unstablePitch) reasons.push(QUALITY_REASONS.UNSTABLE_PITCH);
  if (wideRange) reasons.push(QUALITY_REASONS.WIDE_PITCH_RANGE);
  // (c) is a supporting signal only: report it, but never let it hard-trip the
  // guard on its own (see header — the cheap f0 probe can't separate mains hum
  // from a genuinely low note). It trips only as an additional flag alongside
  // an already-failing pitch signal.
  if (lowF0Ratio >= QUALITY_GATE.LOW_F0_HUM_RATIO) {
    reasons.push(QUALITY_REASONS.LOW_FREQUENCY_HUM);
  }

  // The gate trips on the two robust pitch-instability signals. A clean-but-
  // simply-weak take (stable pitch, bounded range) leaves inputUnclear=false
  // and flows through to the existing no-confident-match behaviour.
  const inputUnclear = unstablePitch || wideRange;

  return {
    inputUnclear,
    reasons,
    maxAbsDelta,
    notes,
    voicedFrames,
    voicedF0SpanOctaves: Math.round(voicedF0SpanOctaves * 100) / 100,
    lowF0Ratio: Math.round(lowF0Ratio * 1000) / 1000,
  };
}
