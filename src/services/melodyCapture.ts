/**
 * melodyCapture.ts — the PURE half of the melody-idea capture window (owner
 * 10-02, rank-2 creator's tool; "Melody Idea Capture", spec §10 + §2).
 *
 * WHAT THIS IS. The window where a user with a tune in their head hums,
 * whistles or sings it into NoteSnap and walks away with it written down as
 * notes. The recording itself, the live meter and the UI live in the screen and
 * the window component; everything DECIDED about a finished take is decided
 * here, in pure functions the tier1 gate can pin:
 *
 *   • the note-by-note sequence, with octave letters ("A3 · B3 · C#4 · D4");
 *   • the AUTO-CLEANING (owner 10-02): pitch snapped to the detected key's
 *     SCALE, onsets snapped to a beat grid — always under an honest
 *     "Auto-cleaned" label, never a "studio transcription" claim;
 *   • the detected key, as the existing keyDetection caption ("Key: G major")
 *     or the honest NULL state — a thin take names no key, and nothing is
 *     fabricated to fill the silence;
 *   • the SUGGESTED harmony (I/IV/V/vi and their minor-mode relatives) derived
 *     from that detected key plus the notes actually used — ALWAYS labelled
 *     "Suggested", because a monophonic melody carries no harmony of its own.
 *     No key ⇒ no chords, by construction;
 *   • the History row's identity ("My melody" / "Personal melody") and the
 *     honest state copy for a take we could not put notes to.
 *
 * HONESTY RULES BAKED IN HERE (they are the reason this file exists rather
 * than the copy living in the JSX):
 *   1. `KeyDecision` null ⇒ no key line, no chords, no cleaning. We never guess
 *      a key to make the window look fuller.
 *   2. Cleaning is only ever described as "auto-cleaned", and the label says
 *      WHAT changed ("2 of 7 notes nudged to the scale") so the user can judge
 *      it. The raw, as-hummed sequence is always available beside it.
 *   3. A take with no notes is a real outcome with its own honest state — the
 *      save/export actions are disabled WITH A REASON, never a button that can
 *      only fail.
 *   4. Nothing here is about a matched song. The chords and the note sequence
 *      are the USER'S OWN take; a modern-song match never renders generated
 *      notation (standing rule), and this module has no notion of a match at
 *      all, so it cannot label a hummed tune as a song's transcription.
 *
 * Pure by design — no react / react-native / expo imports — so the tier1 gate
 * compiles and runs it under plain Node (tsconfig.tier1.json), exactly like
 * pitchDetection.ts / keyDetection.ts / midiExport.ts, which it builds on.
 */
import {
  PITCH_CLASS_NAMES,
  keyCaption,
  type KeyDecision,
  type KeyMode,
} from './keyDetection';
import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';

// ─────────────────────── the honest copy ───────────────────────

/** The window's own heading. */
export const CAPTURE_WINDOW_TITLE = 'Hum, whistle or sing';
/** The loud, unmistakable recording badge (owner 10-02: the surface must read
 *  as LIVE at a glance). */
export const LIVE_BADGE_LABEL = 'LIVE';
/** The one-line hint under the meter while the mic is live. */
export const CAPTURE_HINT =
  'Hum, whistle or sing your melody — around 12 seconds is plenty.';
/** The stop action: what it does, not just "stop". */
export const STOP_CTA_LABEL = 'Stop & write it down';
/** Shown while the finished take is decoded and tracked. */
export const ANALYSING_LINE = 'Writing your melody down…';
export const ANALYSING_SUBLINE = 'Reading the take note by note';

/**
 * THE HONEST LABEL FOR A CLEANED SEQUENCE (mandatory, owner 10-02). "Auto-
 * cleaned" is the strongest claim this feature may make: the take is quantized,
 * NOT studio-transcribed.
 */
export const AUTO_CLEANED_LABEL_PREFIX = 'Auto-cleaned';
/** Heading over the raw, exactly-as-hummed sequence. */
export const RAW_SEQUENCE_LABEL = 'As you hummed it';
/** Heading over the cleaned sequence. */
export const CLEANED_SEQUENCE_LABEL = 'Auto-cleaned to your key';
/** The label every chord suggestion carries. */
export const SUGGESTED_CHORDS_LABEL = 'Suggested';
/** The rule the chords obey, in words, on the surface (a monophonic line
 *  carries no harmony). */
export const CHORDS_HONESTY_LINE =
  'A melody on its own carries no harmony — these follow from the key we detected in your take.';
/** Where a take with no detected key lands: no chords, and we say why. */
export const NO_KEY_NO_CHORDS_LINE =
  'No key detected in this take, so there are no suggested chords — a melody on its own carries no harmony, and we will not guess a key.';

export const SAVE_MELODY_CTA = 'Save melody';
export const SAVED_MELODY_CTA = 'Saved to your History';
export const SAVE_MELODY_HINT =
  'Your take is saved automatically — it lives in your History on this device, so you can come back to it.';

/** A take the tracker heard nothing in. */
export const SILENT_TAKE_TITLE = "Couldn't pick up notes in that take";
export const SILENT_TAKE_LINE =
  'We saved nothing to your History because there were no notes to write down — hold the phone closer and hum, whistle or sing a clear phrase.';
export const SILENT_SAVE_REASON =
  'No notes were heard, so there is nothing to save yet.';
export const SILENT_MIDI_REASON =
  'No notes were heard, so there is no melody to write as MIDI.';
/** Shown when the take exists but could not be analysed (no decoder / offline). */
export const ANALYSIS_UNAVAILABLE_TITLE = "We couldn't read that take";
export const ANALYSIS_UNAVAILABLE_LINE =
  'Your recording is saved on this device, but reading it note by note needs the melody decoder — check your connection and try again.';
export const ANALYSIS_UNAVAILABLE_REASON =
  'The melody decoder is unavailable right now, so there is nothing to read yet.';

/** Records → the History row. Owner naming: "personal melody" / "My Melodies". */
export const MELODY_ROW_TITLE = 'My melody';
export const MELODY_ROW_COMPOSER = 'Personal melody';
/** Prefix of every personal-melody row id (ids are never a catalog piece id). */
export const MELODY_ID_PREFIX = 'melody-';

/**
 * The copy the capture window renders, OWNED BY THE FLOW THAT HOSTS IT
 * (src/screens/HumSearchScreen.tsx defines it and passes it in). It is a prop
 * rather than a constant here because the three mode-naming lines are the
 * capture surface's own words — the front-door contract reads them off the
 * screen file, and the flow is what knows which entries open the capture.
 *
 * `headline` / `intro` / `hint` / `recordingLine` must keep naming ALL THREE
 * accepted input modes (hum, whistle AND sing — RC v28 Test 4b: the same button
 * takes a sung melody).
 */
export interface MelodyWindowCopy {
  /** The big line over the meter while recording. */
  headline: string;
  /** The sentence under it. */
  intro: string;
  /** The live line while the mic is open. */
  recordingLine: string;
  /** The quiet instruction under it. */
  hint: string;
  /** Shown while the finished take is being read. */
  analysingLine: string;
  analysingSubline: string;
}

// ─────────────────────── note naming ───────────────────────

/** MIDI number of C4 (scientific pitch notation: 60 = C4, 69 = A4). */
export const MIDI_C4 = 60;
/** The separator the sequence strings use (spec §2.5: "A3 · B · C# · D"). */
export const NOTE_SEQUENCE_SEPARATOR = ' · ';
/** How many notes a sequence string shows before it is truncated. */
export const NOTE_SEQUENCE_MAX = 32;
/** Rendered in place of the tail of a very long take. */
export const NOTE_SEQUENCE_ELLIPSIS = '…';

/**
 * The letter + octave of a MIDI note ("A3", "C#4", "Bb" is never produced: the
 * app reports sharp-spelled pitch classes everywhere — keyDetection's
 * PITCH_CLASS_NAMES — so the note names and the key names can never disagree).
 * Returns null for a non-finite value: an honest gap, never a phantom note.
 */
export function noteName(midi: number | null | undefined): string | null {
  if (typeof midi !== 'number' || !Number.isFinite(midi)) return null;
  const rounded = Math.max(0, Math.min(127, Math.round(midi)));
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${PITCH_CLASS_NAMES[pc]}${octave}`;
}

/** Pitch class (0..11, 0 = C) of a MIDI number; NaN for a non-number. */
export function pitchClassOf(midi: number | null | undefined): number {
  if (typeof midi !== 'number' || !Number.isFinite(midi)) return Number.NaN;
  const rounded = Math.round(midi);
  return ((rounded % 12) + 12) % 12;
}

/** Anything carrying a pitch — MidiNoteEvent, PlayedNote, a raw frame. */
export interface PitchedNote {
  midi: number;
}

export interface NoteSequence {
  /** "A3 · B3 · C#4 · D4", or '' when there is nothing to show. */
  text: string;
  /** How many notes the string shows. */
  shown: number;
  /** How many were left out (0 unless the take was longer than `max`). */
  hidden: number;
}

/**
 * The note-by-note sequence string (spec §2.5). Every note carries its octave
 * letter, so the sequence is unambiguous without any staff-notation literacy.
 *
 * A long take is TRUNCATED rather than printed forever: `hidden` reports how
 * many notes did not fit, so the surface can say "and 12 more" honestly instead
 * of silently dropping them.
 */
export function noteSequence(
  notes: ReadonlyArray<PitchedNote> | null | undefined,
  opts: { max?: number } = {},
): NoteSequence {
  const list = Array.isArray(notes) ? notes : [];
  const max =
    typeof opts.max === 'number' && Number.isFinite(opts.max) && opts.max > 0
      ? Math.floor(opts.max)
      : NOTE_SEQUENCE_MAX;
  const names: string[] = [];
  for (const note of list) {
    const name = noteName(note?.midi);
    if (name) names.push(name);
  }
  const shown = Math.min(names.length, max);
  const parts = names.slice(0, shown);
  const hidden = names.length - shown;
  const text =
    parts.length === 0
      ? ''
      : parts.join(NOTE_SEQUENCE_SEPARATOR) + (hidden > 0 ? `${NOTE_SEQUENCE_SEPARATOR}${NOTE_SEQUENCE_ELLIPSIS}` : '');
  return { text, shown, hidden };
}

// ─────────────────────── the key's scale ───────────────────────

/** Scale degrees (semitones from the tonic) of the major scale. */
export const MAJOR_SCALE_STEPS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
/**
 * Scale degrees of the NATURAL minor scale. Deliberately natural, not
 * harmonic: the raised 7th (the leading tone) is a chromatic alteration a
 * performer adds, and snapping a hummed note UP to it would be an edit the user
 * did not make — the honest grid is the plain scale.
 */
export const MINOR_SCALE_STEPS: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

/** The twelve pitch classes of a key, as a set for membership tests. */
export function scalePitchClasses(tonic: number, mode: KeyMode): number[] {
  const t = ((Math.round(tonic) % 12) + 12) % 12;
  const steps = mode === 'minor' ? MINOR_SCALE_STEPS : MAJOR_SCALE_STEPS;
  return steps.map((step) => (t + step) % 12);
}

/** True when a pitch class is part of the key's scale. */
export function pitchClassInScale(pc: number, tonic: number, mode: KeyMode): boolean {
  if (!Number.isFinite(pc)) return false;
  return scalePitchClasses(tonic, mode).indexOf(((Math.round(pc) % 12) + 12) % 12) >= 0;
}

/**
 * The nearest scale pitch class to `pc`, as a SIGNED semitone shift
 * (−6..+6). Ties (a note exactly between two scale notes, e.g. the raised 4th
 * in a major key) resolve DOWNWARD: pulling a note down keeps the melodic
 * contour below the line, and — more importantly — the rule is deterministic,
 * so the same take always cleans the same way and the tests can pin it.
 */
export function nearestScaleShift(
  pc: number,
  tonic: number,
  mode: KeyMode,
  opts: { prefer?: 'down' | 'up' } = {},
): number {
  const value = ((Math.round(pc) % 12) + 12) % 12;
  if (pitchClassInScale(value, tonic, mode)) return 0;
  const prefer = opts.prefer ?? 'down';
  for (let distance = 1; distance <= 6; distance++) {
    // The candidate shifts are signed, so the returned shift is directly the
    // semitone move to apply — and the tie at a tritone (distance 6) still
    // resolves per `prefer` instead of depending on a wrapping trick.
    const shifts = prefer === 'down' ? [-distance, distance] : [distance, -distance];
    for (const shift of shifts) {
      const target = (((value + shift) % 12) + 12) % 12;
      if (pitchClassInScale(target, tonic, mode)) return shift;
    }
  }
  return 0;
}

// ─────────────────────── auto-cleaning (quantization) ───────────────────────

export interface CleanedNotes {
  /** The cleaned take — same timings, cleaned pitches (+ moved onsets). */
  notes: MidiNoteEvent[];
  /** How many notes were nudged onto the key's scale. */
  notesAdjusted: number;
  /** How many onsets were snapped to the beat grid. */
  onsetsMoved: number;
  /** True when the key known was good enough to clean at all. */
  pitchCleaned: boolean;
  /** True when a beat grid was found and used. */
  gridCleaned: boolean;
}

/**
 * Snap every note's pitch onto the detected key's scale, keeping each note's
 * register (the shift is at most a few semitones and never crosses octaves) and
 * keeping the TAKE'S REAL TIMINGS untouched — this is a notation clean-up, not
 * a re-performance.
 *
 * With no detected key (`key` null) NOTHING is changed: we do not have a scale
 * to clean against, and inventing one is exactly the fabrication this feature
 * refuses.
 */
export function quantizeNotesToKey(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
  key: KeyDecision | null | undefined,
): CleanedNotes {
  const list = Array.isArray(notes) ? notes : [];
  if (!key || typeof key.tonic !== 'number' || !Number.isFinite(key.tonic)) {
    return {
      notes: list.map((note) => ({ ...note })),
      notesAdjusted: 0,
      onsetsMoved: 0,
      pitchCleaned: false,
      gridCleaned: false,
    };
  }
  let adjusted = 0;
  const cleaned = list.map((note) => {
    const rounded = Math.round(note.midi);
    const shift = nearestScaleShift(rounded, key.tonic, key.mode);
    if (shift !== 0) adjusted++;
    const midi = Math.max(0, Math.min(127, rounded + shift));
    return { ...note, midi };
  });
  return {
    notes: cleaned,
    notesAdjusted: adjusted,
    onsetsMoved: 0,
    pitchCleaned: true,
    gridCleaned: false,
  };
}

/** Shortest / longest onset spacing (seconds) we accept as a musical tempo. */
export const MIN_GRID_INTERVAL_SEC = 0.15;
export const MAX_GRID_INTERVAL_SEC = 1.5;
/** Tempo range we will report (below/above this the "beat" is not a beat). */
export const MIN_GRID_BPM = 50;
export const MAX_GRID_BPM = 200;
/** How many notes a take needs before we will claim to have found a pulse. */
export const MIN_GRID_NOTES = 5;
/** Relative spread of the inter-onset intervals we tolerate (0..1). */
export const MAX_GRID_SPREAD = 0.35;

/**
 * The take's own pulse, from its inter-onset intervals — or null.
 *
 * Deliberately conservative: the MEDIAN gap between consecutive note onsets is
 * treated as one beat (the most common reading of a hummed phrase), and the
 * verdict is refused unless the gaps are consistent (relative spread under
 * MAX_GRID_SPREAD) and the implied tempo is inside MIN/MAX_GRID_BPM. A null here
 * means the take is cleaned to the key only — the label says so, and no beat
 * grid is claimed.
 */
export function detectGridTempoBpm(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
): number | null {
  const list = Array.isArray(notes) ? notes : [];
  if (list.length < MIN_GRID_NOTES) return null;
  const onsets = list
    .map((note) => note?.startSec)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (onsets.length < MIN_GRID_NOTES) return null;

  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const gap = onsets[i] - onsets[i - 1];
    if (gap >= MIN_GRID_INTERVAL_SEC && gap <= MAX_GRID_INTERVAL_SEC) intervals.push(gap);
  }
  if (intervals.length < MIN_GRID_NOTES - 1) return null;

  const median = medianOf(intervals);
  if (!Number.isFinite(median) || median <= 0) return null;
  const spread =
    intervals.reduce((sum, gap) => sum + Math.abs(gap - median), 0) /
    (intervals.length * median);
  if (spread > MAX_GRID_SPREAD) return null;

  const bpm = 60 / median;
  if (bpm < MIN_GRID_BPM || bpm > MAX_GRID_BPM) return null;
  return Math.round(bpm * 10) / 10;
}

/** Subdivisions of the beat the onset grid uses (2 = eighth notes). */
export const DEFAULT_GRID_DIVISION = 2;

/**
 * Snap every onset to the nearest grid line of `bpm`, keeping each note's own
 * duration and its order. Onsets never become negative and never move more than
 * half a grid step. Returns the take unchanged when there is no usable tempo.
 */
export function snapOnsetsToGrid(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
  bpm: number | null | undefined,
  opts: { division?: number } = {},
): { notes: MidiNoteEvent[]; moved: number; applied: boolean } {
  const list = Array.isArray(notes) ? notes : [];
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < MIN_GRID_BPM || bpm > MAX_GRID_BPM) {
    return { notes: list.map((note) => ({ ...note })), moved: 0, applied: false };
  }
  const division =
    typeof opts.division === 'number' && Number.isFinite(opts.division) && opts.division >= 1
      ? Math.round(opts.division)
      : DEFAULT_GRID_DIVISION;
  const stepSeconds = 60 / bpm / division;
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    return { notes: list.map((note) => ({ ...note })), moved: 0, applied: false };
  }

  let moved = 0;
  const snapped = list.map((note) => {
    const start = note.startSec;
    if (typeof start !== 'number' || !Number.isFinite(start)) return { ...note };
    const grid = Math.round(start / stepSeconds) * stepSeconds;
    const next = Math.max(0, Math.round(grid * 1000) / 1000);
    if (Math.abs(next - start) > 1e-6) moved++;
    return { ...note, startSec: next };
  });
  return { notes: snapped, moved, applied: true };
}

/**
 * The whole cleaning pass: key scale first (pitch), then the beat grid
 * (onsets). Both halves are optional and both are reported, because the label
 * on the surface has to say exactly what was done to the user's take.
 */
export function autoCleanTake(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
  key: KeyDecision | null | undefined,
): CleanedNotes {
  const byKey = quantizeNotesToKey(notes, key);
  if (!byKey.pitchCleaned) return byKey;
  const tempoBpm = detectGridTempoBpm(byKey.notes);
  const byGrid = snapOnsetsToGrid(byKey.notes, tempoBpm);
  return {
    notes: byGrid.notes,
    notesAdjusted: byKey.notesAdjusted,
    onsetsMoved: byGrid.moved,
    pitchCleaned: true,
    gridCleaned: byGrid.applied,
  };
}

/**
 * THE MANDATORY LABEL (owner 10-02). It names the key, how many notes were
 * nudged and whether a beat grid was applied — and it never claims more than
 * quantization ("auto-cleaned"), never a studio transcription.
 *
 * With no detected key there is nothing to clean, and the honest answer is not
 * a label about cleaning at all — it is that the sequence is exactly as hummed.
 */
export function cleaningLabel(
  cleaned: CleanedNotes,
  key: KeyDecision | null | undefined,
  noteCount: number,
): string {
  if (!cleaned.pitchCleaned || !key) {
    return `${RAW_SEQUENCE_LABEL} — no key was detected in this take, so nothing was changed.`;
  }
  const keyName = keyNameOf(key);
  const parts: string[] = [];
  parts.push(
    cleaned.notesAdjusted === 1
      ? '1 note nudged onto the scale'
      : `${cleaned.notesAdjusted} of ${noteCount} notes nudged onto the scale`,
  );
  if (cleaned.gridCleaned) {
    parts.push(
      cleaned.onsetsMoved === 1
        ? '1 onset snapped to the beat'
        : `${cleaned.onsetsMoved} onsets snapped to the beat`,
    );
  }
  return `${AUTO_CLEANED_LABEL_PREFIX} to your key (${keyName}) — ${parts.join(', ')}.`;
}

// ─────────────────────── suggested chords ───────────────────────

export interface ChordCandidate {
  /** Roman numeral ("I", "vi", "V"). */
  degree: string;
  /** Root pitch class (0..11). */
  rootPc: number;
  /** The triad's quality — and so the suffix on its name. */
  quality: 'major' | 'minor';
  /** Set when this chord IS a relative key of the detected key. */
  relative?: 'relative minor' | 'relative major';
}

/**
 * The chord family of a key (spec §2.4 + owner 10-02: "I/IV/V/vi + relative
 * minor where sensible"). Major keys get I, IV, V and vi (vi IS the relative
 * minor of the major key). Minor keys get the natural-minor set i, iv, v, VI
 * (VI IS the relative major) and VII. Nothing chromatic is invented.
 */
export function chordCandidates(tonic: number, mode: KeyMode): ChordCandidate[] {
  const t = ((Math.round(tonic) % 12) + 12) % 12;
  if (mode === 'minor') {
    return [
      { degree: 'i', rootPc: t, quality: 'minor' },
      { degree: 'iv', rootPc: (t + 5) % 12, quality: 'minor' },
      { degree: 'v', rootPc: (t + 7) % 12, quality: 'minor' },
      { degree: 'VI', rootPc: (t + 8) % 12, quality: 'major', relative: 'relative major' },
      { degree: 'VII', rootPc: (t + 10) % 12, quality: 'major' },
    ];
  }
  return [
    { degree: 'I', rootPc: t, quality: 'major' },
    { degree: 'IV', rootPc: (t + 5) % 12, quality: 'major' },
    { degree: 'V', rootPc: (t + 7) % 12, quality: 'major' },
    { degree: 'vi', rootPc: (t + 9) % 12, quality: 'minor', relative: 'relative minor' },
  ];
}

export interface SuggestedChord {
  degree: string;
  /** "G", "C", "D", "Em" — the chord as the user would say it. */
  name: string;
  /** The triad's pitch classes, spelled ("G · B · D"). */
  notes: string;
  /** How many of its notes actually appear in the take. */
  shared: number;
  relative?: 'relative minor' | 'relative major';
}

export interface ChordSuggestion {
  /** ALWAYS the honest label — the surface renders this and nothing else. */
  label: string;
  chords: SuggestedChord[];
  /** The one-line summary ("Suggested: G · C · D · Em"), or null when empty. */
  line: string | null;
  /** Why there are none (only when `chords` is empty). Never null then. */
  honestLine: string | null;
}

/** The triad of a chord candidate, as pitch classes. */
export function chordPitchClasses(candidate: ChordCandidate): number[] {
  const third = candidate.quality === 'minor' ? 3 : 4;
  const root = ((Math.round(candidate.rootPc) % 12) + 12) % 12;
  return [root, (root + third) % 12, (root + 7) % 12];
}

/** Max chords the window shows (the family is 4–5; keep the line readable). */
export const MAX_SUGGESTED_CHORDS = 4;

/**
 * The SUGGESTED harmonisation of a take: the detected key's chord family,
 * filtered to the chords the notes actually touch, most-supported first.
 *
 * Hard rules, all structural:
 *   • no detected key ⇒ NO chords, ever. A fabricated key is worse than an
 *     empty section, so the honest line is returned instead.
 *   • no usable chord (nothing overlaps the taken notes) ⇒ no chords, with the
 *     honest line.
 *   • the label is always `Suggested` — a monophonic melody carries no harmony.
 */
export function suggestedChords(
  notes: ReadonlyArray<PitchedNote> | null | undefined,
  key: KeyDecision | null | undefined,
): ChordSuggestion {
  const empty: ChordSuggestion = {
    label: SUGGESTED_CHORDS_LABEL,
    chords: [],
    line: null,
    honestLine: NO_KEY_NO_CHORDS_LINE,
  };
  if (!key || typeof key.tonic !== 'number' || !Number.isFinite(key.tonic)) return empty;

  const list = Array.isArray(notes) ? notes : [];
  const used = new Set<number>();
  for (const note of list) {
    const pc = pitchClassOf(note?.midi);
    if (Number.isFinite(pc)) used.add(pc);
  }
  if (used.size === 0) return empty;

  const scored = chordCandidates(key.tonic, key.mode)
    .map((candidate, order) => {
      const pcs = chordPitchClasses(candidate);
      const shared = pcs.filter((pc) => used.has(pc)).length;
      return { candidate, order, shared, pcs };
    })
    .filter((entry) => entry.shared > 0)
    // Most-supported first; ties keep the family's own order (tonic first), so
    // the same take always suggests the same chords in the same order.
    .sort((a, b) => (b.shared === a.shared ? a.order - b.order : b.shared - a.shared))
    .slice(0, MAX_SUGGESTED_CHORDS);

  if (scored.length === 0) return empty;

  const chords: SuggestedChord[] = scored.map((entry) => ({
    degree: entry.candidate.degree,
    name: chordName(entry.candidate),
    notes: entry.pcs.map((pc) => pitchClassNameOf(pc)).join(NOTE_SEQUENCE_SEPARATOR),
    shared: entry.shared,
    relative: entry.candidate.relative,
  }));

  return {
    label: SUGGESTED_CHORDS_LABEL,
    chords,
    line: `${SUGGESTED_CHORDS_LABEL}: ${chords.map((chord) => chord.name).join(NOTE_SEQUENCE_SEPARATOR)}`,
    honestLine: null,
  };
}

/** "G" / "Em" — a chord as the user would name it. */
export function chordName(candidate: ChordCandidate): string {
  const root = pitchClassNameOf(candidate.rootPc);
  return candidate.quality === 'minor' ? `${root}m` : root;
}

function pitchClassNameOf(pc: number): string {
  const value = ((Math.round(pc) % 12) + 12) % 12;
  return PITCH_CLASS_NAMES[value] ?? '?';
}

// ─────────────────────── the whole analysis ───────────────────────

export type MelodyTakeState = 'ready' | 'silent' | 'unavailable';

export interface MelodyAnalysis {
  state: MelodyTakeState;
  /** How many notes the pipeline really heard (0 for silent/unavailable). */
  noteCount: number;
  /** The take exactly as hummed, "A3 · B3 · C#4". */
  rawSequence: string;
  /** How many notes the raw string left out (>0 only for a very long take). */
  rawHidden: number;
  /** The auto-cleaned take, pitch on the key's scale and onsets on the grid. */
  cleanedSequence: string;
  cleanedHidden: number;
  /** True when the cleaning actually changed something (pitch or onsets). */
  cleanedApplied: boolean;
  notesAdjusted: number;
  onsetsMoved: number;
  /** The mandatory honest label over the cleaned sequence. */
  cleanedLabel: string;
  /** "Key: G major", or null — the existing keyDetection caption. */
  keyLine: string | null;
  /** "G major", or null. */
  keyLabel: string | null;
  /** The suggested harmonisation, always labelled "Suggested". */
  chords: ChordSuggestion;
  /** The honest state line for a non-ready take ('' when ready). */
  stateLine: string;
  /** Heading for a non-ready take ('' when ready). */
  stateTitle: string;
  /** Can this take be written into History? */
  canSave: boolean;
  /** Can this take be exported as MIDI? */
  canExportMidi: boolean;
  /** Why the actions are off (null when they are on) — never a silent dead button. */
  disabledReason: string | null;
  /** The History row's identity for this take. */
  rowTitle: string;
  rowComposer: string;
  rowId: string;
  /** Take duration in seconds (0 when unknown). */
  durationSec: number;
}

/**
 * Build everything the result state of the capture window shows, from the take
 * the pitch pipeline produced. `unavailable` is the honest third state: the
 * take exists on the device but could not be read (no decoder / offline), so
 * there is no analysis to show and the surface says exactly that.
 *
 * Never throws, never fabricates: a null take is the silent case, a null key is
 * the "no key" case, and each has its own honest copy and its own action state.
 */
export function buildMelodyAnalysis(
  take: SavedCaptureTake | null | undefined,
  opts: { unavailable?: boolean } = {},
): MelodyAnalysis {
  const capturedAt =
    typeof take?.capturedAt === 'string' && take.capturedAt.length > 0
      ? take.capturedAt
      : new Date(0).toISOString();

  if (opts.unavailable) {
    return {
      state: 'unavailable',
      noteCount: 0,
      rawSequence: '',
      rawHidden: 0,
      cleanedSequence: '',
      cleanedHidden: 0,
      cleanedApplied: false,
      notesAdjusted: 0,
      onsetsMoved: 0,
      cleanedLabel: '',
      keyLine: null,
      keyLabel: null,
      chords: { label: SUGGESTED_CHORDS_LABEL, chords: [], line: null, honestLine: NO_KEY_NO_CHORDS_LINE },
      stateTitle: ANALYSIS_UNAVAILABLE_TITLE,
      stateLine: ANALYSIS_UNAVAILABLE_LINE,
      // The recording itself is on the device, but with nothing read from it
      // there is no melody to save or write: the action is off, WITH the reason.
      canSave: false,
      canExportMidi: false,
      disabledReason: ANALYSIS_UNAVAILABLE_REASON,
      rowTitle: MELODY_ROW_TITLE,
      rowComposer: MELODY_ROW_COMPOSER,
      rowId: melodyRowId(capturedAt),
      durationSec: 0,
    };
  }

  const notes = Array.isArray(take?.notes) ? take!.notes : [];
  if (notes.length === 0) {
    return {
      state: 'silent',
      noteCount: 0,
      rawSequence: '',
      rawHidden: 0,
      cleanedSequence: '',
      cleanedHidden: 0,
      cleanedApplied: false,
      notesAdjusted: 0,
      onsetsMoved: 0,
      cleanedLabel: '',
      keyLine: null,
      keyLabel: null,
      chords: { label: SUGGESTED_CHORDS_LABEL, chords: [], line: null, honestLine: NO_KEY_NO_CHORDS_LINE },
      stateTitle: SILENT_TAKE_TITLE,
      stateLine: SILENT_TAKE_LINE,
      canSave: false,
      canExportMidi: false,
      disabledReason: SILENT_SAVE_REASON,
      rowTitle: MELODY_ROW_TITLE,
      rowComposer: MELODY_ROW_COMPOSER,
      rowId: melodyRowId(capturedAt),
      durationSec: 0,
    };
  }

  const key = take?.key ?? null;
  const cleaned = autoCleanTake(notes, key);
  const raw = noteSequence(notes);
  const cleanedSequence = noteSequence(cleaned.notes);

  return {
    state: 'ready',
    noteCount: notes.length,
    rawSequence: raw.text,
    rawHidden: raw.hidden,
    cleanedSequence: cleanedSequence.text,
    cleanedHidden: cleanedSequence.hidden,
    cleanedApplied: cleaned.notesAdjusted > 0 || cleaned.onsetsMoved > 0,
    notesAdjusted: cleaned.notesAdjusted,
    onsetsMoved: cleaned.onsetsMoved,
    cleanedLabel: cleaningLabel(cleaned, key, notes.length),
    keyLine: keyCaption(key),
    keyLabel: key ? keyNameOf(key) : null,
    chords: suggestedChords(cleaned.notes, key),
    stateTitle: '',
    stateLine: '',
    canSave: true,
    canExportMidi: true,
    disabledReason: null,
    rowTitle: MELODY_ROW_TITLE,
    rowComposer: MELODY_ROW_COMPOSER,
    rowId: melodyRowId(capturedAt),
    durationSec: typeof take?.durationSec === 'number' && Number.isFinite(take.durationSec) ? take.durationSec : 0,
  };
}

/** The key's own name ("G major") from a decision, without the "Key:" prefix. */
export function keyNameOf(key: KeyDecision | null | undefined): string {
  if (!key) return '';
  const label = typeof key.label === 'string' ? key.label.trim() : '';
  if (label.length > 0) return label;
  if (typeof key.tonic === 'number' && Number.isFinite(key.tonic)) {
    return `${pitchClassNameOf(key.tonic)} ${key.mode === 'minor' ? 'minor' : 'major'}`;
  }
  return '';
}

/**
 * The History row id for a take. Prefix + the capture time, slugged — a personal
 * melody is NEVER a catalog piece id, so a saved melody can never collide with a
 * recognized piece (and `saveRecognition`'s dedupe-by-id can never merge them).
 * Deterministic, so the same take always maps to the same row.
 */
export function melodyRowId(capturedAt: string | null | undefined, suffix = ''): string {
  const base = typeof capturedAt === 'string' ? capturedAt : '';
  const slug = base.replace(/[^0-9A-Za-z]/g, '').slice(0, 24);
  const tail = typeof suffix === 'string' ? suffix.replace(/[^0-9A-Za-z]/g, '').slice(0, 12) : '';
  return `${MELODY_ID_PREFIX}${slug || 'take'}${tail ? `-${tail}` : ''}`;
}

/** True when a saved row is a personal melody (never a recognized piece). */
export function isMelodyRowId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.indexOf(MELODY_ID_PREFIX) === 0;
}

/** What a re-opened personal-melody row hands the capture window. */
export interface PersonalMelodyRow {
  rowId: string;
  /** The take the row carries, or null when only the sound was stored. */
  take: SavedCaptureTake | null;
  /** The saved recording on this device (null when it could not be kept). */
  audioUri: string | null;
  capturedAt: string;
  title: string;
  composer: string;
}

/**
 * A History row → the capture window's re-open payload, or null when the row is
 * an ordinary recognition (which the piece page owns).
 *
 * A row counts as a personal melody when it CARRIES the `personalMelody` block
 * (what this feature writes) or when its id bears the melody prefix (so a row
 * whose block was lost is still re-openable, and a saved melody can never be
 * routed to the piece page — where a melody id resolves to nothing at all).
 */
export function personalMelodyFromRow(
  piece: { id?: string; title?: string; composer?: string; savedAt?: string; personalMelody?: { audioUri?: string | null; capturedAt?: string } | null; capture?: SavedCaptureTake | null } | null | undefined,
): PersonalMelodyRow | null {
  if (!piece) return null;
  const flagged = !!piece.personalMelody;
  if (!flagged && !isMelodyRowId(piece.id)) return null;
  const savedAt = typeof piece.savedAt === 'string' ? piece.savedAt : '';
  const capturedAt =
    typeof piece.personalMelody?.capturedAt === 'string' && piece.personalMelody.capturedAt.length > 0
      ? piece.personalMelody.capturedAt
      : typeof piece.capture?.capturedAt === 'string' && piece.capture.capturedAt.length > 0
        ? piece.capture.capturedAt
        : savedAt;
  return {
    rowId: typeof piece.id === 'string' ? piece.id : melodyRowId(capturedAt),
    take: piece.capture ?? null,
    audioUri:
      typeof piece.personalMelody?.audioUri === 'string' && piece.personalMelody.audioUri.length > 0
        ? piece.personalMelody.audioUri
        : null,
    capturedAt,
    title: typeof piece.title === 'string' && piece.title.length > 0 ? piece.title : MELODY_ROW_TITLE,
    composer:
      typeof piece.composer === 'string' && piece.composer.length > 0
        ? piece.composer
        : MELODY_ROW_COMPOSER,
  };
}

// ─────────────────────── the live trace (during recording) ───────────────────────

/** Bars in the VU meter. */
export const VU_BAR_COUNT = 24;
/** dBFS the meter treats as silence (expo-av metering is negative dBFS). */
export const VU_FLOOR_DB = -60;

/**
 * One metering sample mapped to a 0..1 bar height. expo-av reports dBFS as a
 * negative number (≈ −160 … 0); anything at or above 0 dBFS is clipped to a full
 * bar. A non-finite sample is silence, never a peak.
 */
export function meterFraction(db: number | null | undefined): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  if (db >= 0) return 1;
  if (db <= VU_FLOOR_DB) return 0;
  return (db - VU_FLOOR_DB) / -VU_FLOOR_DB;
}

/** The dBFS above which we treat the mic as hearing something (≈ −45 dBFS). */
export const HEARING_THRESHOLD_DB = -45;

export interface MelodyLiveTrace {
  /** 0..1 bar heights, oldest → newest (always VU_BAR_COUNT long). */
  bars: number[];
  /** 0..1 height of the newest bar. */
  level: number;
  /** True when the newest sample is above the hearing threshold. */
  hearing: boolean;
  /** Notes the LIVE source has supplied so far (empty when it supplies none). */
  liveNotes: string[];
  /**
   * True when this build has NO live pitch source, so the strip cannot show
   * notes during the take. The surface must say so honestly instead of implying
   * notes are on the way — see NO_LIVE_NOTES_LINE.
   */
  liveNotesUnavailable: boolean;
  /** The honest one-line status under the meter. */
  statusLine: string;
  /** How long the take has been running, in seconds (1 decimal). */
  elapsedSec: number;
}

/** The honest line when the strip cannot show notes as they are sung. */
export const NO_LIVE_NOTES_LINE =
  'Notes are written when you stop — the finished take is read note by note.';
/** The line when a live source exists but has not resolved a note yet. */
export const LISTENING_LINE = 'Listening for your notes…';
/** The line when the mic is hearing nothing usable yet. */
export const QUIET_TAKE_LINE =
  'We are not hearing anything yet — hold the phone closer and hum, whistle or sing.';

/**
 * The live state of the capture window, from the real metering samples the
 * recorder collects. Pure, so the meter's response curve, the silence line and
 * the honest "no live notes in this build" state are all testable.
 */
export function buildLiveTrace(input: {
  /** dBFS samples, oldest → newest (the recorder's metering ref, surfaced). */
  levels?: ReadonlyArray<number> | null;
  /** Take length so far, in milliseconds. */
  elapsedMs?: number;
  /** Note names a live pitch source has produced (native builds: none yet). */
  liveNotes?: ReadonlyArray<string> | null;
  /** Does this build have a live pitch source at all? */
  liveSourceReady?: boolean;
}): MelodyLiveTrace {
  const levels = Array.isArray(input.levels) ? input.levels : [];
  const window = levels.slice(Math.max(0, levels.length - VU_BAR_COUNT));
  const bars: number[] = [];
  for (let i = 0; i < VU_BAR_COUNT; i++) {
    // Oldest samples sit on the left; a short history is padded with silence
    // (null, i.e. NO sample — not 0 dBFS, which would draw a full bar) rather
    // than stretched, because a stretched meter lies about the level.
    const offset = VU_BAR_COUNT - window.length;
    const value = i < offset ? null : window[i - offset];
    bars.push(meterFraction(value));
  }
  const newest = window.length > 0 ? window[window.length - 1] : null;
  const level = meterFraction(newest);
  const hearing = typeof newest === 'number' && Number.isFinite(newest) && newest >= HEARING_THRESHOLD_DB;

  const liveNotes = (Array.isArray(input.liveNotes) ? input.liveNotes : []).filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  );
  const liveSourceReady = input.liveSourceReady === true;
  const liveNotesUnavailable = !liveSourceReady;

  let statusLine: string;
  if (liveSourceReady && liveNotes.length > 0) {
    statusLine = liveNotes.join(NOTE_SEQUENCE_SEPARATOR);
  } else if (!hearing) {
    statusLine = QUIET_TAKE_LINE;
  } else if (liveSourceReady) {
    statusLine = LISTENING_LINE;
  } else {
    statusLine = NO_LIVE_NOTES_LINE;
  }

  const elapsedMs =
    typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs) && input.elapsedMs > 0
      ? input.elapsedMs
      : 0;

  return {
    bars,
    level,
    hearing,
    liveNotes,
    liveNotesUnavailable,
    statusLine,
    elapsedSec: Math.round((elapsedMs / 1000) * 10) / 10,
  };
}

// ─────────────────────── internals ───────────────────────

function medianOf(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
