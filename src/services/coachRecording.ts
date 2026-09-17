/**
 * coachRecording.ts — the slice-2 pipeline entry point: one recording + the
 * piece's ABC → exactly the inputs slice 1 scores (PlayedNote[] and
 * ReferenceNote[]), plus the score and the banded feedback.
 *
 *   detectPitchFrames()  → PitchFrame[]
 *   segmentsToPlayedNotes() → PlayedNote[]      (what the player performed)
 *   parseAbcMelody()/abcToReference() → ReferenceNote[] + tempo
 *   scoreAndCoach()      → PlaybackScore + CoachingFeedback   (slice 1)
 *
 * Tempo resolution, in order: the caller's `tempoBpm`, then the ABC's `Q:`,
 * then DEFAULT_ABC_TEMPO_BPM (100). The tempo is decided BEFORE segmentation
 * because PlayedNote.startBeat/durationBeats are derived from it — reference
 * notes are already in beats and do not depend on tempo.
 *
 * Pure logic only: no microphone, no permissions, no streaming, no UI. The
 * caller owns capture and hands us a Float32Array of mono samples.
 *
 * Kept FREE of any react-native / expo imports so it compiles and runs under
 * plain Node (see scripts/coachPipeline.test.ts).
 */

import {
  detectPitchFrames,
  segmentsToPlayedNotes,
  type PitchDetectionOptions,
  type PitchFrame,
  type SegmentationOptions,
} from './pitchDetection';
import { DEFAULT_ABC_TEMPO_BPM, parseAbcMelody } from './abcToReference';
import {
  scoreAndCoach,
  type CoachingFeedback,
  type PlaybackScore,
  type PlayedNote,
  type ReferenceNote,
} from './practiceCoach';

export interface CoachRecordingInput {
  /** Mono samples, −1…1. Anything non-finite is treated as silence. */
  samples: Float32Array;
  sampleRate: number;
  /** Optional: overrides the ABC's `Q:`. */
  tempoBpm?: number;
  /** The piece's melody in ABC notation (empty/unusable → an empty reference). */
  abc: string;
  /** Optional piece title, woven into the top-band feedback copy (slice 1). */
  pieceTitle?: string;
  /** Optional overrides for the pitch tracker (window/hop/range/silence gate). */
  detection?: PitchDetectionOptions;
  /** Optional overrides for note segmentation (minNoteSec/jitterCents). */
  segmentation?: SegmentationOptions;
}

export interface CoachRecordingResult {
  /** What the player performed, in beats. */
  played: PlayedNote[];
  /** What the score asks for, in beats. */
  reference: ReferenceNote[];
  score: PlaybackScore;
  feedback: CoachingFeedback;
  /**
   * ADDITIVE (beyond the slice-2 brief's shape): the tempo actually used, so
   * slice 3 can show it / send it back to the practice history without
   * re-parsing the ABC.
   */
  tempoBpm: number;
  /**
   * ADDITIVE: the raw pitch frames behind `played`. Slice 3 can draw a pitch
   * contour or a "where you drifted" trace from these; safe to ignore.
   */
  frames: PitchFrame[];
}

/**
 * Run the whole practice-coach pipeline on one recording. Never throws: a
 * silent, empty or unusable input yields empty note lists and the honest
 * "Nothing to score yet." feedback from slice 1.
 */
export function coachFromRecording(input: CoachRecordingInput): CoachRecordingResult {
  const abc = typeof input?.abc === 'string' ? input.abc : '';
  const requestedTempo = input?.tempoBpm;

  // The parser resolves tempo for us (caller override → Q: → 100).
  const parsed = parseAbcMelody(abc, {
    ...(typeof requestedTempo === 'number' ? { tempoBpm: requestedTempo } : {}),
  });
  const tempoBpm = Number.isFinite(parsed.tempoBpm) && parsed.tempoBpm > 0
    ? parsed.tempoBpm
    : DEFAULT_ABC_TEMPO_BPM;

  const frames = detectPitchFrames(input?.samples, input?.sampleRate, input?.detection);
  const played = segmentsToPlayedNotes(frames, tempoBpm, input?.segmentation);
  const { score, feedback } = scoreAndCoach(parsed.notes, played, input?.pieceTitle);

  return { played, reference: parsed.notes, score, feedback, tempoBpm, frames };
}
