/**
 * tuner.ts — the NoteSnap TUNER's brain (owner APPROVED 10-10, backlog 2bbbbc8f).
 *
 * A guitar/piano/keyboard tuner: note name + cents deviation, free, offline, and
 * built on the pitch engine the app already runs. It is NOT a second engine —
 * `tunerReadingFromTake()` calls the EXISTING `detectPitchFrames()` (the YIN-lite
 * monophonic tracker from src/services/pitchDetection.ts that the take-correction
 * editor and the practice coach both use) and turns its frames into the one thing
 * a tuner shows: which note is sounding, and how far off it is.
 *
 * Why a reading is a WINDOW and not a frame: a single pitch frame on a plucked
 * string is noisy. The reading is taken from the trailing frames of the take and
 * requires a MINIMUM number of confident frames before it will name a note — so
 * a click, a chair creak or a breath is reported as "no single clear note"
 * instead of being promoted to a note. An honest miss beats a wrong name.
 *
 * PURE LOGIC: no react, no react-native, no microphone, no network, no storage —
 * it compiles and runs under plain Node (scripts/tuner.test.ts drives it with a
 * synthesised sine wave), which is also what makes the offline claim checkable
 * in the gate rather than only on a device.
 *
 * The capture-and-decode machinery lives beside it:
 *   • src/services/tunerDecoder.ts — the on-device decoder page + wire protocol
 *   • src/hooks/useAudioRecorder.ts — the app's existing recorder (reused as-is)
 *   • src/screens/TunerScreen.tsx   — the surface
 */

import {
  detectPitchFrames,
  midiToHz,
  type PitchDetectionOptions,
  type PitchFrame,
} from './pitchDetection';

/** How long one tuner take is (ms). Long enough for a stable monophonic read. */
export const TUNER_TAKE_MS = 700;
/** Pause between takes while "keep listening" is on (ms). */
export const TUNER_AUTO_GAP_MS = 450;
/** If the decoder does not answer in this long, the screen says so (ms). */
export const TUNER_DECODE_TIMEOUT_MS = 6000;

/** |cents| at or under this reads as in tune (the needle's green zone). */
export const TUNER_IN_TUNE_CENTS = 5;
/** The needle's half-width: ±50 cents is a semitone either way. */
export const TUNER_CENTS_FULL_SCALE = 50;
/** Trailing frames of a take the reading is taken from (~200 ms at 25 ms hop). */
export const TUNER_READING_FRAMES = 8;
/** Agreeing (confident) frames required before a note is named. */
export const TUNER_MIN_CONFIDENT_FRAMES = 3;
/**
 * How close the agreeing frames must sit to the window's median pitch, in
 * semitones. A take in which the player moved to another note mid-window has no
 * agreeing cluster, and is reported as "no single clear note" instead of being
 * named after a pitch that was never played.
 */
export const TUNER_PITCH_AGREEMENT_SEMITONES = 0.5;
/** RMS below this is not a note being played at all (≈ −40 dBFS). */
export const TUNER_RMS_GATE = 0.01;

export type TunerVerdict = 'flat' | 'in-tune' | 'sharp';

/** Why a take produced no note name. */
export type TunerNoSignalReason = 'silent' | 'unclear';

export interface TunerNoteReading {
  kind: 'note';
  /** The sounding pitch as a MIDI float — fractional on purpose (see below). */
  midi: number;
  /** Letter name without the octave: "A", "C#". */
  note: string;
  octave: number;
  /** The full name the screen shows: "A4", "C#3". */
  display: string;
  /** How far the take sat from that note, in cents (−50…+50). */
  cents: number;
  /** The measured frequency, in Hz. */
  frequencyHz: number;
  verdict: TunerVerdict;
  inTune: boolean;
  /** 0…100 for the needle; 50 is dead centre. */
  needlePercent: number;
  /** How many confident frames the name came from (for honest diagnostics). */
  confidentFrames: number;
}

export interface TunerNoSignalReading {
  kind: 'no-signal';
  reason: TunerNoSignalReason;
  /** Number of frames in the take at all (0 when the take was unusable). */
  frames: number;
}

export type TunerReading = TunerNoteReading | TunerNoSignalReading;

const NOTE_NAMES: readonly string[] = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

/** Median of a list of numbers (NaN for an empty list) — the engine's own rule. */
function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * THE NEAREST SEMITONE — AND WHICH WAY A TIE GOES (v39 gate fix).
 *
 * WHY THIS IS ONE FUNCTION. The name shown on the screen and the cents under it
 * must be two views of the SAME decision, or the tuner can say "A#4 · +50 cents":
 * a name that rounded one way and a deviation measured from the other. Before
 * this, `noteNameFromMidi` used `Math.round` (ties up) while the cents rule also
 * used `Math.round` — fine everywhere except exactly half a semitone, where the
 * reported deviation flipped sign (−50 instead of +50) for a pitch that is 50
 * cents ABOVE the lower note.
 *
 * THE RULE, stated once: a tie (.5) belongs to the LOWER semitone, so a reading
 * that sits exactly between two notes is reported as 50 cents SHARP OF the lower
 * one (the direction the needle can actually act on). Cents are then always
 * measured from this same semitone, which keeps them inside (−50 … +50].
 */
function nearestSemitone(midi: number): number {
  const lower = Math.floor(midi);
  const offset = midi - lower;
  return offset <= 0.5 ? lower : lower + 1;
}

/** "A4" from MIDI 69, "C#3" from MIDI 49. Null for anything not finite. */
export function noteNameFromMidi(
  midi: number,
): { name: string; octave: number; display: string } | null {
  if (typeof midi !== 'number' || !Number.isFinite(midi)) return null;
  const nearest = nearestSemitone(midi);
  const index = ((nearest % 12) + 12) % 12;
  const name = NOTE_NAMES[index]!;
  // Scientific pitch notation: MIDI 60 = C4, so octave = floor(n/12) − 1.
  const octave = Math.floor(nearest / 12) - 1;
  return { name, octave, display: `${name}${octave}` };
}

/**
 * Cents from the nearest semitone, in −50…+50. The sub-semitone part is kept
 * (it is the intonation the tuner exists to show) — rounding to the semitone here
 * would throw away exactly the number the needle draws.
 *
 * The semitone it measures from is `nearestSemitone` — the SAME one the name comes
 * from, so the two can never disagree, and a pitch exactly between two notes reads
 * as +50 (sharp of the lower note) rather than −50.
 */
export function centsFromNearestSemitone(midi: number): number {
  if (typeof midi !== 'number' || !Number.isFinite(midi)) return Number.NaN;
  const value = (midi - nearestSemitone(midi)) * 100;
  return Math.round(value * 10) / 10;
}

/** Flat / in tune / sharp, from the cents deviation. */
export function tunerVerdict(cents: number): TunerVerdict {
  if (!Number.isFinite(cents)) return 'in-tune';
  if (cents < -TUNER_IN_TUNE_CENTS) return 'flat';
  if (cents > TUNER_IN_TUNE_CENTS) return 'sharp';
  return 'in-tune';
}

/** Needle position 0…100 for a cents value (50 = in tune, clamped at ±50¢). */
export function tunerNeedlePercent(cents: number): number {
  if (!Number.isFinite(cents)) return 50;
  const clamped = Math.min(
    TUNER_CENTS_FULL_SCALE,
    Math.max(-TUNER_CENTS_FULL_SCALE, cents),
  );
  return clamped + TUNER_CENTS_FULL_SCALE;
}

/**
 * Turn a take's pitch frames into a tuner reading.
 *
 * Only the TRAILING `readingFrames` frames are considered (a tuner answers "what
 * is sounding now", and the start of a pluck is the noisiest part), and the name
 * is the MEDIAN of the confident frames that AGREE with that median (within
 * `agreementSemitones`) — the same median estimator the note segmentation uses,
 * plus the agreement rule that stops a take spanning two notes from being named
 * after a pitch in between. Fewer than `minConfidentFrames` agreeing frames is
 * not a note: the take is reported as silent (nothing above the gate at all) or
 * unclear (something was heard, but never settled into one pitch).
 */
export function tunerReadingFromFrames(
  frames: readonly PitchFrame[] | null | undefined,
  options: {
    readingFrames?: number;
    minConfidentFrames?: number;
    rmsGate?: number;
    agreementSemitones?: number;
  } = {},
): TunerReading {
  const all = Array.isArray(frames) ? frames : [];
  const total = all.length;
  const readingFrames = Math.max(
    1,
    Math.floor(options.readingFrames ?? TUNER_READING_FRAMES),
  );
  const minConfidentFrames = Math.max(
    1,
    Math.floor(options.minConfidentFrames ?? TUNER_MIN_CONFIDENT_FRAMES),
  );
  const rmsGate =
    typeof options.rmsGate === 'number' && Number.isFinite(options.rmsGate)
      ? options.rmsGate
      : TUNER_RMS_GATE;
  const agreement =
    typeof options.agreementSemitones === 'number' &&
    Number.isFinite(options.agreementSemitones) &&
    options.agreementSemitones > 0
      ? options.agreementSemitones
      : TUNER_PITCH_AGREEMENT_SEMITONES;

  const window = all.slice(Math.max(0, total - readingFrames));
  const confident: number[] = [];
  for (const frame of window) {
    if (!frame || typeof frame.midi !== 'number' || !Number.isFinite(frame.midi)) continue;
    if (typeof frame.rms === 'number' && frame.rms < rmsGate) continue;
    confident.push(frame.midi);
  }

  if (confident.length < minConfidentFrames) {
    return {
      kind: 'no-signal',
      // "silent" = no confident frame above the gate; "unclear" = sound, but no
      // single pitch. Two different sentences for the user, never one vague one.
      reason: confident.length > 0 ? 'unclear' : 'silent',
      frames: total,
    };
  }

  const centre = median(confident);
  const agreeing = confident.filter((value) => Math.abs(value - centre) <= agreement);
  if (agreeing.length < minConfidentFrames) {
    return { kind: 'no-signal', reason: 'unclear', frames: total };
  }

  const midi = median(agreeing);
  const named = noteNameFromMidi(midi);
  if (!named) return { kind: 'no-signal', reason: 'unclear', frames: total };
  const cents = centsFromNearestSemitone(midi);
  const verdict = tunerVerdict(cents);
  return {
    kind: 'note',
    midi,
    note: named.name,
    octave: named.octave,
    display: named.display,
    cents,
    frequencyHz: Math.round(midiToHz(midi) * 10) / 10,
    verdict,
    inTune: verdict === 'in-tune',
    needlePercent: tunerNeedlePercent(cents),
    confidentFrames: agreeing.length,
  };
}

/**
 * THE SEAM THE SCREEN USES: a take's samples → one tuner reading, through the
 * app's existing pitch engine. `detection` is passed straight through, so the
 * tuner inherits the engine's own window/hop/range/silence behaviour instead of
 * carrying a second set of constants.
 */
export function tunerReadingFromTake(
  samples: Float32Array,
  sampleRate: number,
  detection: PitchDetectionOptions = {},
  reading: { readingFrames?: number; minConfidentFrames?: number; rmsGate?: number } = {},
): TunerReading {
  const frames = detectPitchFrames(samples, sampleRate, detection);
  return tunerReadingFromFrames(frames, reading);
}

// ───────────────────────── the honest one-liners ─────────────────────────

/** "A4 · +3.2 cents (sharp) · 441.2 Hz" — for the accessibility label. */
export function describeTunerReading(reading: TunerReading | null | undefined): string {
  if (!reading || reading.kind !== 'note') return TUNER_NO_SIGNAL_LINE;
  const sign = reading.cents > 0 ? '+' : '';
  const verdictWord =
    reading.verdict === 'in-tune' ? 'in tune' : reading.verdict === 'flat' ? 'flat' : 'sharp';
  return `${reading.display} · ${sign}${reading.cents} cents (${verdictWord}) · ${reading.frequencyHz} Hz`;
}

/** The word under the needle. */
export function tunerVerdictLabel(reading: TunerReading | null | undefined): string {
  if (!reading || reading.kind !== 'note') return TUNER_NO_SIGNAL_SHORT;
  if (reading.inTune) return 'In tune';
  return reading.verdict === 'flat' ? 'Flat — tune up' : 'Sharp — tune down';
}

// ───────────────────────────── user-facing copy ─────────────────────────────
// Every string a tuner surface shows is named here, so the screen and the gate
// read the same words (the repo's convention — see services/humBridge.ts).

export const TUNER_SCREEN_TITLE = 'Tuner';
export const TUNER_CARD_TITLE = 'Tuner';
export const TUNER_CARD_SUBTITLE =
  'Tune a guitar, piano or keyboard by ear and by needle — free, and it runs on your device.';
/** The headline under the title on the tuner screen. */
export const TUNER_HEADLINE = 'Play one note and see exactly where it sits.';
/** The honesty line: where the audio goes. */
export const TUNER_DEVICE_LINE =
  'Reads the sound on your device — no internet needed, and nothing is uploaded.';
/** Before the first take. */
export const TUNER_IDLE_LINE = 'Tap Listen, then play a single note and hold it.';
/** While the mic is open. */
export const TUNER_LISTENING_LINE = 'Listening…';
/** No sound above the gate in that take. */
export const TUNER_SILENT_LINE = 'Heard nothing — play one note and hold it.';
/** Sound, but no single pitch. */
export const TUNER_UNCLEAR_LINE =
  'No single clear note in that take — one note at a time, held.';
/** The take could not be read on this device. */
export const TUNER_DECODE_FAIL_LINE =
  'This device could not read that take. Tap Listen to try again.';
/** Encoder/decoder never answered. */
export const TUNER_DECODE_TIMEOUT_LINE =
  'The note reader did not answer in time. Tap Listen to try again.';
/** The decoder page has not finished loading yet. */
export const TUNER_DECODER_NOT_READY_LINE =
  'The note reader is still starting up — tap Listen again in a moment.';
/** Short version of the no-signal state, for the big label. */
export const TUNER_NO_SIGNAL_SHORT = '—';
export const TUNER_NO_SIGNAL_LINE = 'No note yet.';
export const TUNER_LISTEN_CTA = 'Listen';
export const TUNER_LISTEN_AGAIN_CTA = 'Listen again';
export const TUNER_AUTO_CTA = 'Keep listening';
export const TUNER_AUTO_STOP_CTA = 'Stop listening';
/** Free, always — the owner's verdict on paywalling a commodity tuner. */
export const TUNER_FREE_LINE = 'Free — the tuner is not a paid feature.';
/** The instrument hint, honest about monophonic reads. */
export const TUNER_INSTRUMENT_LINE =
  'Works for guitar, bass, piano, keyboard, strings and voice — one note at a time.';
export const TUNER_CENTS_SUFFIX = 'cents';
export const TUNER_HZ_SUFFIX = 'Hz';
/** The row labels on the scale under the needle. */
export const TUNER_FLAT_LABEL = 'flat';
export const TUNER_SHARP_LABEL = 'sharp';
