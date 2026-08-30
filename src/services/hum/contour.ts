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
      const pitch = sorted[Math.floor(sorted.length / 2)];
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

/**
 * Convenience: run the whole "audio contour" pipeline from an extracted f0
 * track (already median-smoothed) into a delta contour.
 */
export function f0TrackToContour(
  midi: number[],
  voiced: boolean[],
  hopS: number,
): { deltas: number[]; pitches: number[]; notes: Note[] } {
  const notes = segmentMidiToNotes(midi, voiced, hopS);
  const { deltas, pitches } = notesToPolyline(notes);
  return { deltas, pitches, notes };
}
