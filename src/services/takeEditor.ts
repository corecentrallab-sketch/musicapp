/**
 * takeEditor.ts — THE TAKE-CORRECTION EDITOR's model (v33 slice D, owner
 * green-light 10-03; brief /home/team/shared/take-correction-editor-brief.md).
 *
 * THE OPEN CONTRACT (§1 of the brief): the take stays a generic
 * `MidiNoteEvent[]` list. Nothing here wraps it in a new notation type, so the
 * corrected take feeds History, the MIDI export and the preview IDENTICALLY to
 * the detected one — one source of truth, three consumers.
 *
 * WHAT THE EDITOR IS FOR. "NoteSnap got it wrong" must become a kept, accurate
 * take instead of a discarded one. So every edit is a real note operation
 * (pitch, timing boundary, add, remove, rest, batch transpose, per-note
 * re-detect, chord override), every edit re-derives the key and the suggested
 * chords INSTANTLY, and the surface can always tell the user which notes are
 * auto-detected and which are theirs (tags), undo it, or go back to the take
 * exactly as detected.
 *
 * PURE (no react / react-native / fs / path): every operation above, the
 * undo/redo stack, the re-derivation and the tags are asserted by
 * scripts/v33TakeEditor.test.ts without an emulator.
 */
import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';
import {
  detectKeyFromNotes,
  keyLabel,
  type KeyDecision,
  type KeyMode,
} from './keyDetection';
import {
  chordCandidates,
  chordName,
  noteName,
  scalePitchClasses,
  suggestedChords,
  type ChordSuggestion,
  type SuggestedChord,
} from './melodyCapture';

// ───────────────────────────── tags & copy ─────────────────────────────

/** Where a note on the staff came from — the tag the editor shows. */
export type NoteSource = 'detected' | 'corrected' | 'added';

export const NOTE_TAG_DETECTED = 'Auto-detected';
export const NOTE_TAG_CORRECTED = 'Corrected by you';
export const NOTE_TAG_ADDED = 'Added by you';
/** The chord row's own tags (brief §4: a chord the user typed is marked "yours"). */
export const CHORD_TAG_SUGGESTED = 'suggested';
export const CHORD_TAG_YOURS = 'yours';

export const EDITOR_TITLE = 'Correct your take';
export const EDITOR_INTRO =
  'Every note here is yours: tap a note to change its pitch (you will hear it), drag its edges to move the timing, or add and remove notes. Your corrections are the take from now on — History, MIDI and playback all use them.';
export const EDITOR_NO_KEY_LINE =
  'No key detected in this take, so there are no suggested chords — a melody on its own carries no harmony, and we will not guess a key.';
export const EDITOR_LAST_NOTE_REASON =
  'A take needs at least one note — add a note before removing this one.';
export const EDITOR_NO_REDETECT_REASON =
  'Re-detect needs the audio analysis of this take, which this device could not read. Your pitch edits still work.';
export const EDITOR_PREVIEW_ONLY_CAPTION =
  'Preview only — this plays your own corrected take, synthesized on the device. It is not a recording, and not the original song.';

/** The editor never lets a note leave this range (a piano's own compass). */
export const PITCH_MIN_MIDI = 36;
export const PITCH_MAX_MIDI = 96;
/** The shortest note an edit may leave behind, in seconds. */
export const MIN_NOTE_DURATION_SEC = 0.08;
/** Batch transpose limits (the same spirit as the notation editor's ±11). */
export const MAX_TRANSPOSE_SEMITONES = 11;

// ───────────────────────────── state ─────────────────────────────

export interface EditableNote extends MidiNoteEvent {
  /** Stable id: the note survives a re-render and an undo by this id. */
  id: string;
  /** Who last touched it — drives the tag and the honesty of the surface. */
  source: NoteSource;
}

/** A chord slot the user replaced with their own. */
export interface ChordOverride {
  /** Which slot in the suggestion order it replaces. */
  index: number;
  /** The roman numeral shown beside the name ('' for a free-typed chord). */
  degree: string;
  /** The chord as the user typed or picked it. */
  name: string;
}

export interface ChordSlot {
  index: number;
  degree: string;
  name: string;
  /** `suggested` = derived from the take's key; `yours` = the user's own. */
  tag: typeof CHORD_TAG_SUGGESTED | typeof CHORD_TAG_YOURS;
}

interface Snapshot {
  notes: EditableNote[];
  chordOverrides: ChordOverride[];
}

export interface TakeEditorState {
  /** The take as it stands now (the single source of truth). */
  notes: EditableNote[];
  /** The take exactly as detected — what "Reset to detected" restores. */
  detected: EditableNote[];
  tempoBpm: number;
  /** The take's own length, extended by edits that run past the original end. */
  durationSec: number;
  capturedAt: string;
  /** The user's chord overrides, kept across re-derivations. */
  chordOverrides: ChordOverride[];
  past: Snapshot[];
  future: Snapshot[];
}

export interface DerivedTake {
  /** The corrected take, as the generic note list every consumer expects. */
  take: SavedCaptureTake;
  /** The key re-derived from the CURRENT notes (null when too thin). */
  key: KeyDecision | null;
  /** "G major", or null — never a guessed key. */
  keyLabel: string | null;
  /** The suggested harmonisation of the current notes, with overrides applied. */
  chords: ChordSlot[];
  /** The raw suggestion (for the honest line when there are no chords). */
  suggestion: ChordSuggestion;
  /** How many notes are the user's own work. */
  correctedCount: number;
  addedCount: number;
  /** How many chords the user replaced. */
  yourChordCount: number;
  /** True when anything at all was changed from the detected take. */
  hasCorrections: boolean;
  /** One honest sentence for the surface. */
  summaryLine: string;
}

let noteIdSeed = 0;

/** Ids are only meaningful inside one editor session. */
export function nextNoteId(): string {
  noteIdSeed += 1;
  return `n${noteIdSeed}`;
}

function toEditable(notes: ReadonlyArray<MidiNoteEvent>, source: NoteSource): EditableNote[] {
  return notes.map((note) => ({
    id: nextNoteId(),
    source,
    midi: clampPitch(note.midi),
    startSec: Math.max(0, Number(note.startSec) || 0),
    durationSec: Math.max(MIN_NOTE_DURATION_SEC, Number(note.durationSec) || MIN_NOTE_DURATION_SEC),
    ...(typeof note.velocity === 'number' ? { velocity: note.velocity } : {}),
  }));
}

/** Open the editor on a take. The detected take is kept for "Reset to detected". */
export function createEditorState(take: SavedCaptureTake | null | undefined): TakeEditorState {
  const notes = toEditable(Array.isArray(take?.notes) ? take!.notes : [], 'detected');
  return {
    notes,
    detected: toEditable(Array.isArray(take?.notes) ? take!.notes : [], 'detected'),
    tempoBpm:
      typeof take?.tempoBpm === 'number' && Number.isFinite(take.tempoBpm) && take.tempoBpm > 0
        ? take.tempoBpm
        : 100,
    durationSec:
      typeof take?.durationSec === 'number' && Number.isFinite(take.durationSec)
        ? take.durationSec
        : endOf(notes),
    capturedAt:
      typeof take?.capturedAt === 'string' && take.capturedAt.length > 0
        ? take.capturedAt
        : new Date(0).toISOString(),
    chordOverrides: [],
    past: [],
    future: [],
  };
}

export function clampPitch(midi: number): number {
  const value = Math.round(Number(midi));
  if (!Number.isFinite(value)) return 60;
  return Math.min(PITCH_MAX_MIDI, Math.max(PITCH_MIN_MIDI, value));
}

function endOf(notes: ReadonlyArray<MidiNoteEvent>): number {
  let end = 0;
  for (const note of notes) {
    const stop = (Number(note.startSec) || 0) + (Number(note.durationSec) || 0);
    if (stop > end) end = stop;
  }
  return end;
}

function snapshot(state: TakeEditorState): Snapshot {
  return {
    notes: state.notes.map((note) => ({ ...note })),
    chordOverrides: state.chordOverrides.map((override) => ({ ...override })),
  };
}

function withEdit(state: TakeEditorState, next: Partial<TakeEditorState>): TakeEditorState {
  const merged: TakeEditorState = {
    ...state,
    ...next,
    past: [...state.past, snapshot(state)],
    future: [],
  };
  return merged;
}

/** The grid step the editor snaps to: one eighth note at the take's tempo. */
export function gridStepSec(tempoBpm: number): number {
  const tempo =
    typeof tempoBpm === 'number' && Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 100;
  return Math.max(0.05, 30 / tempo);
}

function snapToGrid(sec: number, step: number): number {
  return Math.round(sec / step) * step;
}

/** The note with this id, or null. */
export function findNote(
  state: TakeEditorState,
  id: string,
): EditableNote | null {
  return state.notes.find((note) => note.id === id) ?? null;
}

// ───────────────────────────── operations ─────────────────────────────

/** A pitch change (tap a semitone, or the end of a drag): always audible next. */
export function setNotePitch(
  state: TakeEditorState,
  id: string,
  midi: number,
): TakeEditorState {
  const target = findNote(state, id);
  if (!target) return state;
  const next = clampPitch(midi);
  if (next === target.midi) return state;
  return withEdit(state, {
    notes: state.notes.map((note) =>
      note.id === id
        ? { ...note, midi: next, source: note.source === 'added' ? 'added' : 'corrected' }
        : note,
    ),
  });
}

/** One semitone (or more) up/down — the semitone rail's step. */
export function nudgeNotePitch(
  state: TakeEditorState,
  id: string,
  semitones: number,
): TakeEditorState {
  const target = findNote(state, id);
  if (!target) return state;
  return setNotePitch(state, id, target.midi + Math.round(semitones));
}

/**
 * Move a note's timing boundary. The drag snaps to the take's grid, can never
 * cross a neighbour, and never leaves a note shorter than MIN_NOTE_DURATION_SEC.
 */
export function setNoteBoundary(
  state: TakeEditorState,
  id: string,
  edge: 'start' | 'end',
  sec: number,
): TakeEditorState {
  const index = state.notes.findIndex((note) => note.id === id);
  if (index < 0) return state;
  const step = gridStepSec(state.tempoBpm);
  const notes = state.notes.map((note) => ({ ...note }));
  const target = notes[index];
  const previous = index > 0 ? notes[index - 1] : null;
  const next = index < notes.length - 1 ? notes[index + 1] : null;

  if (edge === 'start') {
    // The floor is the PREVIOUS NOTE'S END — a drag can never make two notes
    // overlap (that would be a chord the user did not ask for).
    const floor = previous ? previous.startSec + previous.durationSec : 0;
    const ceiling = target.startSec + target.durationSec - MIN_NOTE_DURATION_SEC;
    if (floor > ceiling) return state;
    const wanted = Math.min(ceiling, Math.max(floor, snapToGrid(sec, step)));
    const end = target.startSec + target.durationSec;
    target.startSec = Math.max(0, wanted);
    target.durationSec = Math.max(MIN_NOTE_DURATION_SEC, end - target.startSec);
  } else {
    const ceiling = next ? next.startSec - MIN_NOTE_DURATION_SEC : Number.POSITIVE_INFINITY;
    const wanted = Math.max(
      target.startSec + MIN_NOTE_DURATION_SEC,
      Math.min(ceiling, snapToGrid(sec, step)),
    );
    target.durationSec = Math.max(MIN_NOTE_DURATION_SEC, wanted - target.startSec);
  }
  if (target.source !== 'added') target.source = 'corrected';
  return withEdit(state, { notes, durationSec: Math.max(state.durationSec, endOf(notes)) });
}

/** Add a note right after this one (a note the tracker missed). */
export function addNoteAfter(
  state: TakeEditorState,
  id: string,
  opts: { midi?: number; durationSec?: number } = {},
): TakeEditorState {
  const index = state.notes.findIndex((note) => note.id === id);
  if (index < 0) return state;
  const anchor = state.notes[index];
  const step = gridStepSec(state.tempoBpm);
  const duration = Math.max(
    MIN_NOTE_DURATION_SEC,
    typeof opts.durationSec === 'number' && Number.isFinite(opts.durationSec)
      ? opts.durationSec
      : anchor.durationSec,
  );
  const note: EditableNote = {
    id: nextNoteId(),
    source: 'added',
    midi: clampPitch(typeof opts.midi === 'number' ? opts.midi : anchor.midi),
    startSec: anchor.startSec + anchor.durationSec,
    durationSec: Math.max(duration, step),
  };
  const notes = [...state.notes];
  notes.splice(index + 1, 0, note);
  return withEdit(state, { notes, durationSec: Math.max(state.durationSec, endOf(notes)) });
}

/** Can this note be removed (a take keeps at least one note)? */
export function canRemoveNote(state: TakeEditorState, id: string): boolean {
  return state.notes.length > 1 && state.notes.some((note) => note.id === id);
}

/** Remove a note the tracker invented. */
export function removeNote(state: TakeEditorState, id: string): TakeEditorState {
  if (!canRemoveNote(state, id)) return state;
  return withEdit(state, { notes: state.notes.filter((note) => note.id !== id) });
}

/**
 * A REST: a real gap. The take is a note list, so a rest is made by pushing
 * everything after this note later by one grid step — which is exactly what the
 * user hears (silence where there was a note).
 */
export function insertRestAfter(state: TakeEditorState, id: string): TakeEditorState {
  const index = state.notes.findIndex((note) => note.id === id);
  if (index < 0 || index === state.notes.length - 1) return state;
  const step = gridStepSec(state.tempoBpm);
  const notes = state.notes.map((note, position) => {
    if (position <= index) return note;
    return {
      ...note,
      startSec: note.startSec + step,
      source: note.source === 'added' ? ('added' as NoteSource) : ('corrected' as NoteSource),
    };
  });
  return withEdit(state, { notes, durationSec: Math.max(state.durationSec, endOf(notes)) });
}

/** Batch transpose — every note moves together, so the shape is preserved. */
export function transposeTake(state: TakeEditorState, semitones: number): TakeEditorState {
  const delta = Math.max(
    -MAX_TRANSPOSE_SEMITONES,
    Math.min(MAX_TRANSPOSE_SEMITONES, Math.round(semitones)),
  );
  if (delta === 0) return state;
  const notes = state.notes.map((note) => ({
    ...note,
    midi: clampPitch(note.midi + delta),
    source: note.source === 'added' ? ('added' as NoteSource) : ('corrected' as NoteSource),
  }));
  return withEdit(state, { notes });
}

/** A frame of the take's own audio analysis, for a per-note re-detect. */
export interface AnalysisFrame {
  /** Seconds from the start of the recording. */
  atSec: number;
  /** The pitch the tracker read there, or null for silence. */
  midi: number | null;
}

/**
 * PER-NOTE RE-DETECT: re-read this note's own window from the take's audio
 * analysis and take the median of the frames inside it. Returns the SAME state
 * when the take has no analysis to read (the surface disables the control with
 * EDITOR_NO_REDETECT_REASON rather than pretending).
 */
export function redetectNote(
  state: TakeEditorState,
  id: string,
  frames: ReadonlyArray<AnalysisFrame> | null | undefined,
): TakeEditorState {
  const target = findNote(state, id);
  if (!target || !Array.isArray(frames)) return state;
  const inside = frames.filter(
    (frame) =>
      frame &&
      Number.isFinite(frame.atSec) &&
      frame.atSec >= target.startSec &&
      frame.atSec < target.startSec + target.durationSec &&
      typeof frame.midi === 'number' &&
      Number.isFinite(frame.midi),
  );
  if (inside.length === 0) return state;
  const values = inside.map((frame) => Number(frame.midi)).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
  return setNotePitch(state, id, median);
}

/** Re-quantize every onset and length onto the take's grid (an explicit action). */
export function requantizeTake(state: TakeEditorState): TakeEditorState {
  const step = gridStepSec(state.tempoBpm);
  let changed = false;
  const notes = state.notes.map((note) => {
    const startSec = Math.max(0, snapToGrid(note.startSec, step));
    const durationSec = Math.max(step, snapToGrid(note.durationSec, step));
    if (startSec !== note.startSec || durationSec !== note.durationSec) changed = true;
    return {
      ...note,
      startSec,
      durationSec,
      source: note.source === 'added' ? ('added' as NoteSource) : ('corrected' as NoteSource),
    };
  });
  if (!changed) return state;
  return withEdit(state, { notes, durationSec: Math.max(state.durationSec, endOf(notes)) });
}

/** Move every note whose pitch is off the key's scale onto the nearest scale tone. */
export function snapTakeToScale(
  state: TakeEditorState,
  key: KeyDecision | null,
): TakeEditorState {
  const scale = key ? scalePitchClasses(key.tonic, key.mode as KeyMode) : [];
  if (scale.length === 0) return state;
  let changed = false;
  const notes = state.notes.map((note) => {
    const snapped = nearestScaleMidi(note.midi, scale);
    if (snapped !== note.midi) changed = true;
    return { ...note, midi: snapped, source: note.source === 'added' ? ('added' as NoteSource) : ('corrected' as NoteSource) };
  });
  if (!changed) return state;
  return withEdit(state, { notes });
}

/** The nearest MIDI note whose pitch class is in `scale` (ties resolve down). */
export function nearestScaleMidi(midi: number, scale: ReadonlyArray<number>): number {
  const value = Math.round(midi);
  const pc = ((value % 12) + 12) % 12;
  if (scale.includes(pc)) return value;
  for (let distance = 1; distance <= 6; distance++) {
    const down = ((pc - distance) % 12 + 12) % 12;
    if (scale.includes(down)) return value - distance;
    const up = (pc + distance) % 12;
    if (scale.includes(up)) return value + distance;
  }
  return value;
}

// ───────────────────────────── chord overrides ─────────────────────────────

/** The chord family of the take's key — what the override palette offers. */
export function chordPalette(key: KeyDecision | null): { degree: string; name: string }[] {
  if (!key) return [];
  return chordCandidates(key.tonic, key.mode as KeyMode).map((candidate) => ({
    degree: candidate.degree,
    name: chordName(candidate),
  }));
}

/** Replace a suggested chord with the user's own (palette pick or free input). */
export function overrideChord(
  state: TakeEditorState,
  index: number,
  name: string,
  degree = '',
): TakeEditorState {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return state;
  const others = state.chordOverrides.filter((override) => override.index !== index);
  return withEdit(state, {
    chordOverrides: [...others, { index, name: trimmed, degree }],
  });
}

/** Put one chord back to the suggestion. */
export function resetChord(state: TakeEditorState, index: number): TakeEditorState {
  if (!state.chordOverrides.some((override) => override.index === index)) return state;
  return withEdit(state, {
    chordOverrides: state.chordOverrides.filter((override) => override.index !== index),
  });
}

/** All chords back to the suggestion. */
export function clearChordOverrides(state: TakeEditorState): TakeEditorState {
  if (state.chordOverrides.length === 0) return state;
  return withEdit(state, { chordOverrides: [] });
}

// ───────────────────────────── undo / redo / reset ─────────────────────────────

export function canUndo(state: TakeEditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: TakeEditorState): boolean {
  return state.future.length > 0;
}

export function undo(state: TakeEditorState): TakeEditorState {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    ...state,
    notes: previous.notes,
    chordOverrides: previous.chordOverrides,
    past: state.past.slice(0, -1),
    future: [snapshot(state), ...state.future],
  };
}

export function redo(state: TakeEditorState): TakeEditorState {
  if (state.future.length === 0) return state;
  const [next, ...rest] = state.future;
  return {
    ...state,
    notes: next.notes,
    chordOverrides: next.chordOverrides,
    past: [...state.past, snapshot(state)],
    future: rest,
  };
}

/** Back to the take exactly as detected (the honest escape hatch). */
export function resetToDetected(state: TakeEditorState): TakeEditorState {
  if (state.past.length === 0 && state.chordOverrides.length === 0) return state;
  return {
    ...state,
    notes: state.detected.map((note) => ({ ...note })),
    chordOverrides: [],
    past: [...state.past, snapshot(state)],
    future: [],
  };
}

// ───────────────────────────── derivation ─────────────────────────────

/**
 * Everything the surface, History, the MIDI export and the preview read. Called
 * after EVERY edit, so the key and the chords always describe the notes the user
 * is looking at.
 */
export function deriveTake(state: TakeEditorState): DerivedTake {
  const notes = state.notes.map((note) => ({
    midi: clampPitch(note.midi),
    startSec: note.startSec,
    durationSec: note.durationSec,
    ...(typeof note.velocity === 'number' ? { velocity: note.velocity } : {}),
  }));
  const key = notes.length > 0 ? detectKeyFromNotes(notes) : null;
  const suggestion = suggestedChords(notes, key);
  const chords: ChordSlot[] = suggestion.chords.map((chord, index) => {
    const override = state.chordOverrides.find((entry) => entry.index === index);
    if (override) {
      return {
        index,
        degree: override.degree,
        name: override.name,
        tag: CHORD_TAG_YOURS,
      };
    }
    return { index, degree: chord.degree, name: chord.name, tag: CHORD_TAG_SUGGESTED };
  });
  // A chord the user typed into a slot the suggestion did not fill still counts.
  for (const override of state.chordOverrides) {
    if (!chords.some((slot) => slot.index === override.index)) {
      chords.push({
        index: override.index,
        degree: override.degree,
        name: override.name,
        tag: CHORD_TAG_YOURS,
      });
    }
  }
  chords.sort((a, b) => a.index - b.index);

  const correctedCount = state.notes.filter((note) => note.source === 'corrected').length;
  const addedCount = state.notes.filter((note) => note.source === 'added').length;
  const removedCount = Math.max(0, state.detected.length - state.notes.length + addedCount);
  const yourChordCount = chords.filter((slot) => slot.tag === CHORD_TAG_YOURS).length;
  const hasCorrections =
    correctedCount > 0 || addedCount > 0 || removedCount > 0 || yourChordCount > 0;

  return {
    take: {
      notes,
      tempoBpm: state.tempoBpm,
      durationSec: Math.max(state.durationSec, endOf(notes)),
      key,
      capturedAt: state.capturedAt,
    },
    key,
    keyLabel: key ? keyLabel(key.tonic, key.mode as KeyMode) : null,
    chords,
    suggestion,
    correctedCount,
    addedCount,
    yourChordCount,
    hasCorrections,
    summaryLine: correctionSummaryLine({
      correctedCount,
      addedCount,
      removedCount,
      yourChordCount,
    }),
  };
}

/** The one honest sentence about what the user changed ('' when nothing). */
export function correctionSummaryLine(counts: {
  correctedCount: number;
  addedCount: number;
  removedCount: number;
  yourChordCount: number;
}): string {
  const parts: string[] = [];
  if (counts.correctedCount > 0) {
    parts.push(`${counts.correctedCount} note${counts.correctedCount === 1 ? '' : 's'} corrected`);
  }
  if (counts.addedCount > 0) {
    parts.push(`${counts.addedCount} added`);
  }
  if (counts.removedCount > 0) {
    parts.push(`${counts.removedCount} removed`);
  }
  if (counts.yourChordCount > 0) {
    parts.push(`${counts.yourChordCount} chord${counts.yourChordCount === 1 ? '' : 's'} of your own`);
  }
  if (parts.length === 0) return '';
  return `Your take: ${parts.join(' · ')}.`;
}

/** The tag a note carries on the surface. */
export function noteTag(note: EditableNote | null | undefined): string {
  if (!note) return NOTE_TAG_DETECTED;
  if (note.source === 'added') return NOTE_TAG_ADDED;
  if (note.source === 'corrected') return NOTE_TAG_CORRECTED;
  return NOTE_TAG_DETECTED;
}

/** The note's label ("C#4"), for the editor's readout. */
export function noteLabel(midi: number): string {
  return noteName(midi) ?? '—';
}

/** The take's notes as the sequence string the rest of the app shows. */
export function editedSequence(state: TakeEditorState): string {
  return state.notes.map((note) => noteLabel(note.midi)).join(' · ');
}
