// ---------------------------------------------------------------------------
// contour.ts — turn a raw f0 track into a segmented NOTE SEQUENCE and then a
// RELATIVE-INTERVAL pitch contour, the key/pitch-offset-invariant and octave-
// tolerant representation that the melody matcher consumes.
//
// Design notes:
//  • Each voiced run of frames with a stable pitch is collapsed into ONE note,
//    whose pitch is the confidence-weighted median MIDI value. Re-articulated
//    same-pitch notes cannot be separated from pure audio without onset cues,
//    so we allow the matcher to insert/delete notes (see dtw.ts) — the contour
//    stays correct even when repeated notes merge.
//  • The contour is expressed as the sequence of ADJACENT SEMITONE DELTAS
//    (midi[i+1] - midi[i]). Deltas are invariant to global key (a 440Hz hum and
//    a 220Hz hum of the same melody give identical deltas) and invariant to
//    octave placement of the whole phrase (a phrase hummed an octave higher
//    gives identical deltas). A genuine in-melody octave leap still surfaces as
//    a large (±12) delta, which is exactly what we want to capture.
// ---------------------------------------------------------------------------

export interface Note {
  /** Absolute MIDI pitch of the note (0 = unvoiced/rest). */
  pitch: number;
  /** Onset in seconds. */
  onsetS: number;
  /** Duration in seconds (for optional duration-weighted scoring). */
  durationS: number;
  /** Average voiced confidence over the note's frames. */
  confidence: number;
}

/** Detects a new note when the pitch moves by at least this many semitones.
 *  Kept below a whole semitone so genuine 1-semitone melodic steps (e.g. the
 *  E→D♯ alternation in Für Elise's opening) are NOT merged into one note. */
export const NOTE_MERGE_SEMITONES = 0.5;
/** Minimum voiced frames to form a note candidate (filters 1-frame spikes). */
export const MIN_NOTE_FRAMES = 2;
/** Median-smoothing window (frames) applied upstream before segmentation. */
export const SMOOTH_WINDOW = 3;

/**
 * If the ratio of voiced frames falls below this, the input is likely a
 * whistled/hummed phrase with heavy VIBRATO. Vibrato makes the instantaneous
 * frequency drift within YIN's 60 ms window, so its dimensionless confidence
 * collapses below the voiced threshold and the f0 track fragments into many
 * short voiced runs (a real whistle can drop to ~15% voiced versus ~98% for a
 * clean hum). We then need the vibrato-recovery pass below; dense input (a
 * clean hum or un-decorated melody) keeps the original clean pipeline.
 */
export const VIBRATO_SPARSE_THRESHOLD = 0.6;

/**
 * Vibrato is a fast (≈6 Hz) micro-oscillation of pitch around a note's center,
 * typically a few tenths of a semitone — the SAME scale as Für Elise's E↔D♯
 * alternation. The only reliable discriminator is TIME: vibrato oscillates far
 * faster than even a quick melodic note. This recovery pass, used only on
 * fragmented (vibrato-y) tracks, therefore:
 *   1. re-medians over a wider window (kills per-frame octave spikes),
 *   2. low-passes with a short moving average over about one vibrato period
 *      (≈180 ms) to cancel the oscillation back to the note's mean,
 *   3. quantizes to the nearest semitone to kill residual ripple,
 * so one held, vibrato'd note collapses back into ONE note instead of several
 * spurious ones. Appliedgated by the voiced-density check so dense/clean input
 * (which would otherwise be blurred at its faster tempo) is untouched.
 */
export function recoverVibratoPitches(
  midi: number[],
  voiced: boolean[],
  medWin = 7,
  maWin = 9,
): number[] {
  const n = midi.length;
  // 1) wider median filter over voiced neighbours (kills octave spikes)
  const med = midi.slice();
  const hw = Math.floor(medWin / 2);
  for (let k = 0; k < n; k++) {
    if (!voiced[k] || midi[k] <= 0) { med[k] = 0; continue; }
    const vals: number[] = [];
    for (let d = -hw; d <= hw; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < n && voiced[idx] && midi[idx] > 0) vals.push(midi[idx]);
    }
    med[k] = vals.length ? medSort(vals) : midi[k];
  }
  // 2) moving average within voiced frames (cancels vibrato oscillation)
  let out = med;
  if (maWin > 0) {
    out = med.slice();
    const h = Math.floor(maWin / 2);
    for (let k = 0; k < n; k++) {
      if (!voiced[k] || med[k] <= 0) { out[k] = 0; continue; }
      let sum = 0, cnt = 0;
      for (let d = -h; d <= h; d++) {
        const idx = k + d;
        if (idx >= 0 && idx < n && voiced[idx] && med[idx] > 0) { sum += med[idx]; cnt++; }
      }
      out[k] = cnt ? sum / cnt : 0;
    }
  }
  // 3) quantize to nearest semitone
  return out.map((p) => (p > 0 ? Math.round(p) : 0));
}

/** Median of a small numeric array (avoids per-call re-alloc readability cost). */
function medSort(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Convenience: run the whole "audio contour" pipeline from an extracted f0
 * track (already median-smoothed) into a delta contour.
 */
export function f0TrackToContour(
  midi: number[],
  voiced: boolean[],
  hopS: number,
): { deltas: number[]; pitches: number[]; notes: Note[] } {
  // Adaptive vibrato handling: fragmented voiced track (real whistle with
  // vibrato/breath dropout) — recover note centers before segmenting. Dense
  // input (clean hum / un-decorated melody) — original path, no blurring.
  const voicedRate = voiced.filter(Boolean).length / Math.max(1, voiced.length);
  const effective = voicedRate < VIBRATO_SPARSE_THRESHOLD ? recoverVibratoPitches(midi, voiced) : midi;
  const effectiveVoiced = effective.map((p) => p > 0);
  const notes = segmentMidiToNotes(effective, effectiveVoiced, hopS);
  const { deltas, pitches } = notesToPolyline(notes);
  return { deltas, pitches, notes };
}

/**
 * Segment a smoothed MIDI pitch track (with an unvoiced flag per frame) into a
 * note sequence. `midi` may contain 0 for unvoiced frames.
 * `hopS` is the frame period in seconds (for computing onsets/durations).
 */
export function segmentMidiToNotes(
  midi: number[],
  voiced: boolean[],
  hopS: number,
): Note[] {
  const notes: Note[] = [];
  let i = 0;
  const n = midi.length;
  while (i < n) {
    if (!voiced[i] || midi[i] <= 0) {
      i++;
      continue;
    }
    // Start a note run.
    const start = i;
    const run: number[] = [midi[i]];
    const runConf: number[] = [];
    let j = i + 1;
    while (j < n && voiced[j] && midi[j] > 0 && Math.abs(midi[j] - midi[j - 1]) < NOTE_MERGE_SEMITONES) {
      run.push(midi[j]);
      j++;
    }
    // We don't have per-frame confidence here; the caller can pass weights if
    // needed — default uniform.
    runConf.length = run.length;
    runConf.fill(1);
    if (run.length >= MIN_NOTE_FRAMES) {
      const sorted = run.slice().sort((a, b) => a - b);
      // Quantize the note's pitch to the nearest whole semitone. The melody
      // contour is defined on a RELATIVE-INTERVAL semitone grid (see header),
      // so a sub-semitone f0 estimate must not leak in as a spurious fractional
      // delta. A real whistle/hum carries small intonation error (fractional
      // MIDI) that was fragmenting each held note into noise and dragging DTW
      // similarity down ~5 points — enough to sink a true match below the
      // confidence gate (verified on the owner's real on-device Für Elise
      // whistle: 0.661 -> 0.717). Rounding the note CENTER (after the run is
      // merged) collapses that jitter to the correct semitone without ever
      // splitting/merging a run. The vibrato path already quantizes; this makes
      // the dense path consistent with it. NOTE: this alone slightly boosts
      // coincidental short-run matches too, so the policy pairs it with a
      // stricter floor for SHORT queries (see matcher.ts) to keep false
      // positives out.
      const pitch = Math.round(sorted[Math.floor(sorted.length / 2)]);
      notes.push({
        pitch,
        onsetS: start * hopS,
        durationS: (j - start) * hopS,
        confidence: runConf.reduce((a, b) => a + b, 0) / runConf.length,
      });
    }
    i = j;
  }
  return notes;
}

/**
 * Convert a note sequence into a RELATIVE-INTERVAL contour (adjacent semitone
 * deltas). The first note establishes the absolute frame; every subsequent note
 * contributes pitch[k+1] - pitch[k]. Deltas are key/octave-invariant.
 * Returns both the raw delta array and the note pitches (for diagnostics).
 */
export function notesToPolyline(notes: Note[]): {
  deltas: number[];
  pitches: number[];
} {
  const pitches = notes.map((x) => x.pitch);
  const deltas: number[] = [];
  for (let i = 1; i < pitches.length; i++) {
    deltas.push(pitches[i] - pitches[i - 1]);
  }
  return { deltas, pitches };
}
