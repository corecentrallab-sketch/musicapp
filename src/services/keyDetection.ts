/**
 * keyDetection.ts — key finding on (a) a captured take's pitch-class vector and
 * (b) a library score whose pitch data is available (the piece's ABC melody).
 *
 * MIDI export Batch A (owner backlog b1b8f380 / 33e1e7d4). The MIDI file we hand
 * the user must carry an HONEST key: the Standard MIDI File key-signature meta
 * event (FF 59 02 sf mi) tells a DAW — and the musician opening the file — what
 * key the take is in. Guessing wrong is worse than saying nothing, so this
 * module always reports the correlation it based its decision on, and a
 * too-thin pitch vector comes back as `null` rather than a confident wrong key.
 *
 * Algorithm: Krumhansl–Schmuckler (Krumhansl & Kessler 1982), the standard
 * key-profile correlation method:
 *
 *   1. reduce the music to a 12-bin pitch-class vector (how much of the music
 *      sits on each of the 12 semitones);
 *   2. for each of the 24 keys, correlate the vector against that key's
 *      PROFILE (the major/minor tonal-hierarchy rating of each scale degree)
 *      using Pearson's r;
 *   3. the best-correlating rotation is the key.
 *
 * Everything is pure arithmetic — no react / react-native / expo imports — so
 * the tier1 gate compiles and runs it under plain Node (tsconfig.tier1.json),
 * exactly like pitchDetection.ts and tier1.ts.
 *
 * Units: MIDI note numbers as floats (69 = A4). Pitch classes are 0..11 with
 * 0 = C (the SMF key-signature convention: sf counts sharps/flats from C).
 */
import { parseAbcMelody } from './abcToReference';
import type { PitchFrame } from './pitchDetection';

// ─── The Krumhansl–Kessler key profiles ─────────────────────────

/**
 * Krumhansl & Kessler's experimentally-derived major-key profile: the tonal
 * hierarchy rating of each scale degree, starting at the tonic (index 0 = the
 * tonic's own pitch class, index 1 = one semitone above it, …).
 */
export const MAJOR_PROFILE: readonly number[] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

/** The minor-key profile, same convention (index 0 = the tonic). */
export const MINOR_PROFILE: readonly number[] = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export type KeyMode = 'major' | 'minor';

/** A key verdict, with the evidence it rested on. */
export interface KeyDecision {
  /** Tonic pitch class, 0..11 (0 = C). */
  tonic: number;
  mode: KeyMode;
  /** Pearson correlation of the winning key profile with the vector (−1..1). */
  correlation: number;
  /**
   * How decisively the winner beat the runner-up, 0..1. A relative margin: 0
   * when two keys fit equally well (never claim a key then), 1 when the winning
   * profile is far ahead. Deliberately NOT the raw correlation — a strong
   * correlation with a near-tie means we do not actually know the key.
   */
  confidence: number;
  /** Human label, e.g. "C major" / "A minor". */
  label: string;
}

/** Pitch-class names, sharp-spelled (the SMF/DAW convention for reporting). */
export const PITCH_CLASS_NAMES: readonly string[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

/** Pitch-class name for a MIDI number or pitch class (mod 12). */
export function pitchClassName(value: number): string {
  if (!Number.isFinite(value)) return '?';
  const pc = ((Math.round(value) % 12) + 12) % 12;
  return PITCH_CLASS_NAMES[pc];
}

/** "C major" / "F# minor" for a tonic + mode pair. */
export function keyLabel(tonic: number, mode: KeyMode): string {
  return `${pitchClassName(tonic)} ${mode}`;
}

/**
 * The key caption the Batch-A surfaces render for a DETECTED key — "Key: G
 * major" — or `null` when there was no verdict at all (a take too thin to name
 * a key) or the verdict is unusable.
 *
 * `null` means the screen prints NOTHING: never a placeholder, never a guessed
 * key. That is the whole point of detectKeyFromHistogram returning null instead
 * of a confident wrong answer, and it is why this helper takes the decision (or
 * its absence) rather than a default.
 *
 * MIDI export Batch A: this is the ONE place the key the SMF key-signature
 * (FF 59 02 sf mi) carries is turned into text for the user — the hum result
 * card renders it from the export outcome, the History row from the take it
 * carries.
 */
export function keyCaption(key: KeyDecision | null | undefined): string | null {
  if (!key || typeof key !== 'object') return null;
  const label = typeof key.label === 'string' ? key.label.trim() : '';
  if (label.length > 0) return `Key: ${label}`;
  // A verdict without a label is still a real verdict: name it from the same
  // tonic + mode pair the label is built from (never a different key).
  const modeIsKnown = key.mode === 'major' || key.mode === 'minor';
  const tonicIsKnown = typeof key.tonic === 'number' && Number.isFinite(key.tonic);
  if (!modeIsKnown || !tonicIsKnown) return null;
  return `Key: ${keyLabel(key.tonic, key.mode)}`;
}

// ─── Pitch-class vectors ────────────────────────────────────────

/**
 * A 12-bin pitch-class vector. Values are non-negative weights (counts,
 * durations, frame counts): the correlation is scale-invariant, so only the
 * RELATIVE distribution matters.
 */
export function emptyHistogram(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * Build a pitch-class vector from MIDI note numbers. Non-finite values are
 * ignored (an honest gap beats a phantom C). `weights[i]` (when given) scales
 * `values[i]` — that is how a duration-weighted vector is built.
 */
export function pitchClassHistogram(
  values: ReadonlyArray<number>,
  weights?: ReadonlyArray<number>,
): number[] {
  const histogram = emptyHistogram();
  if (!Array.isArray(values)) return histogram;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    const raw = Array.isArray(weights) ? weights[i] : 1;
    const weight = Number.isFinite(raw) && raw > 0 ? raw : Array.isArray(weights) ? 0 : 1;
    const pc = ((Math.round(value) % 12) + 12) % 12;
    histogram[pc] += weight;
  }
  return histogram;
}

/**
 * Vector from the captured pitch frames. Every VOICED frame counts once: the
 * tracker already emits one frame per hop, so counting frames is a duration
 * weighting in disguise (a note held twice as long contributes twice as many
 * frames). Unvoiced frames are skipped — silence is not a pitch class.
 */
export function histogramFromPitchFrames(
  frames: ReadonlyArray<PitchFrame> | null | undefined,
): number[] {
  const histogram = emptyHistogram();
  if (!Array.isArray(frames)) return histogram;
  for (const frame of frames) {
    const midi = frame?.midi;
    if (typeof midi !== 'number' || !Number.isFinite(midi)) continue;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    histogram[pc] += 1;
  }
  return histogram;
}

/** Anything carrying a pitch and a duration (PlayedNote, ReferenceNote, …). */
export interface WeightedMidiNote {
  midi: number;
  /** Duration in beats or seconds; any positive weight works. Defaults to 1. */
  durationBeats?: number;
  durationSec?: number;
}

/**
 * Vector from note events, weighted by how long each note sounds (falling back
 * to one unit when a note carries no duration). A whole note in the melody must
 * count more than a passing 16th, which is what makes this the right vector for
 * a library score.
 */
export function histogramFromNotes(
  notes: ReadonlyArray<WeightedMidiNote> | null | undefined,
): number[] {
  const histogram = emptyHistogram();
  if (!Array.isArray(notes)) return histogram;
  for (const note of notes) {
    const midi = note?.midi;
    if (typeof midi !== 'number' || !Number.isFinite(midi)) continue;
    const raw = note?.durationSec ?? note?.durationBeats ?? 1;
    const weight = Number.isFinite(raw) && raw > 0 ? raw : 1;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    histogram[pc] += weight;
  }
  return histogram;
}

/**
 * Vector from an ABC score — the library-score path: the pieces the catalog
 * gives the app (`DailyChallengePiece.abc`, the coach's bundled seeds) are ABC,
 * and their melody IS pitch data. Never throws: unusable ABC → an empty vector,
 * which then reports "no key" rather than a guess.
 */
export function histogramFromAbc(abc: string): number[] {
  if (typeof abc !== 'string' || abc.trim().length === 0) return emptyHistogram();
  try {
    return histogramFromNotes(parseAbcMelody(abc).notes);
  } catch {
    return emptyHistogram();
  }
}

// ─── The key-finding decision ───────────────────────────────────

/** Minimum total weight before a key is even considered: below this the
 *  "vector" is one or two notes and any key would be a fabrication. */
export const MIN_TOTAL_WEIGHT = 4;

/** Correlation margin (winner − runner-up) treated as fully decisive. */
export const DECISIVE_MARGIN = 0.25;

/** Pearson correlation of two equal-length vectors (0 for a flat vector). */
export function pearsonCorrelation(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 0 || varB <= 0) return 0;
  const r = cov / Math.sqrt(varA * varB);
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : 0;
}

/** The key profile for `tonic`/`mode`, as a length-12 vector indexed by pitch class. */
export function keyProfile(tonic: number, mode: KeyMode): number[] {
  const base = mode === 'minor' ? MINOR_PROFILE : MAJOR_PROFILE;
  const t = ((Math.round(tonic) % 12) + 12) % 12;
  const profile: number[] = new Array(12);
  for (let i = 0; i < 12; i++) profile[(t + i) % 12] = base[i];
  return profile;
}

export interface KeyCandidate {
  tonic: number;
  mode: KeyMode;
  correlation: number;
}

/**
 * Correlate a pitch-class vector against all 24 keys, best first. Exported for
 * tests and for any caller that wants the full ranking (the UI uses the single
 * decision below).
 */
export function rankKeys(histogram: ReadonlyArray<number>): KeyCandidate[] {
  const vector = normaliseVector(histogram) ?? emptyHistogram();
  const candidates: KeyCandidate[] = [];
  for (const mode of ['major', 'minor'] as KeyMode[]) {
    for (let tonic = 0; tonic < 12; tonic++) {
      candidates.push({
        tonic,
        mode,
        correlation: pearsonCorrelation(vector, keyProfile(tonic, mode)),
      });
    }
  }
  return candidates.sort((a, b) => b.correlation - a.correlation);
}

/**
 * The Krumhansl–Schmuckler decision for a pitch-class vector.
 *
 * Returns `null` — never a guess — when the vector is too thin (total weight
 * below MIN_TOTAL_WEIGHT, e.g. one hummed note) or when the correlation is
 * negative (the profile fit is worse than no relationship at all).
 */
export function detectKeyFromHistogram(
  histogram: ReadonlyArray<number> | null | undefined,
): KeyDecision | null {
  const vector = normaliseVector(histogram);
  if (!vector) return null;
  let total = 0;
  let distinct = 0;
  for (const v of vector) {
    total += v;
    if (v > 0) distinct++;
  }
  if (total < MIN_TOTAL_WEIGHT || distinct < 2) return null;

  const ranked = rankKeys(vector);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.correlation <= 0) return null;

  const margin = runnerUp ? best.correlation - runnerUp.correlation : best.correlation;
  return {
    tonic: best.tonic,
    mode: best.mode,
    correlation: round4(best.correlation),
    confidence: round4(clamp01(margin / DECISIVE_MARGIN)),
    label: keyLabel(best.tonic, best.mode),
  };
}

/** The key of a captured take, from its pitch frames (null when too thin). */
export function detectKeyFromPitchFrames(
  frames: ReadonlyArray<PitchFrame> | null | undefined,
): KeyDecision | null {
  return detectKeyFromHistogram(histogramFromPitchFrames(frames));
}

/** The key of a played/reference note list, duration-weighted. */
export function detectKeyFromNotes(
  notes: ReadonlyArray<WeightedMidiNote> | null | undefined,
): KeyDecision | null {
  return detectKeyFromHistogram(histogramFromNotes(notes));
}

/**
 * The key of a library score in ABC (the only form in which the catalog hands
 * the app note-level pitch data today). Null when the score has too little
 * pitch data or cannot be parsed.
 */
export function detectKeyFromAbc(abc: string): KeyDecision | null {
  return detectKeyFromHistogram(histogramFromAbc(abc));
}

// ─── The SMF key signature ──────────────────────────────────────

export interface KeySignature {
  /** −7 (7 flats) … +7 (7 sharps): the SMF sf byte. */
  sf: number;
  /** 0 = major, 1 = minor: the SMF mi byte. */
  mi: number;
}

/** Major keys by tonic pitch class → how many sharps (+) / flats (−). */
const MAJOR_SIGNATURE: readonly number[] = [0, 7, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
/** Minor keys by tonic pitch class → how many sharps (+) / flats (−). */
const MINOR_SIGNATURE: readonly number[] = [-3, 4, -1, 6, 1, -4, 3, -2, 5, 0, 7, 2];

/**
 * The key-signature meta-event bytes for a key (SMF: FF 59 02 sf mi). The
 * counts are the conventional circle-of-fifths values, never invented: they are
 * what every DAW will print as the key.
 */
export function keySignatureFor(tonic: number, mode: KeyMode): KeySignature {
  const t = ((Math.round(tonic) % 12) + 12) % 12;
  return {
    sf: (mode === 'minor' ? MINOR_SIGNATURE : MAJOR_SIGNATURE)[t],
    mi: mode === 'minor' ? 1 : 0,
  };
}

/** The key of an ABC score's own `K:` field is NOT consulted: the decision is
 *  always taken from the melody's pitches, so a mislabelled score cannot hand
 *  the user a wrong key. (Exported so the rule is visible in one place.) */

function normaliseVector(
  histogram: ReadonlyArray<number> | null | undefined,
): number[] | null {
  if (!Array.isArray(histogram) || histogram.length === 0) return null;
  const vector = emptyHistogram();
  for (let i = 0; i < 12; i++) {
    const value = histogram[i];
    vector[i] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }
  return vector;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
