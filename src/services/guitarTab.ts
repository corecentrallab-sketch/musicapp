/**
 * guitarTab.ts — THE TAKE AS GUITAR TABLATURE (v37 item 8, backlog ee3a6e13).
 *
 * WHAT THIS IS. The Correct-Your-Take page draws the take on a PIANO STAFF and
 * that staff stays exactly as it is (owner, 10-09: "The piano notation is correct
 * and needs to remain"). "Tabs" is ADDITIVE: the same corrected take, rendered a
 * second way for a guitarist — one line per string, standard tuning EADGBE, the
 * fret number where each note is played.
 *
 * IT IS DERIVED FROM THE TAKE, NOT FROM AN EDITION. There is no official tab of a
 * hummed melody, so the surface says so in words (TAB_HONEST_LINE). This module
 * never claims to be a published guitar edition of anything.
 *
 * THE THREE DECISIONS, ALL DETERMINISTIC (no randomness, no "best guess" that
 * changes between runs):
 *
 *   1. WHICH STRING AND FRET — every (string, fret) pair that sounds the note
 *      within the 12th fret is a candidate; the winner is the one with the LOWEST
 *      fret (open strings and first position first — what a beginner reaches for),
 *      with the string as the tie-break. A pitch is unique per string at a given
 *      fret, so the ordering is total.
 *   2. ONE HAND POSITION FOR THE WHOLE TAKE — a hummed take is a handful of notes,
 *      and hopping up the neck per note is unplayable. Every position whose hand
 *      span (HAND_SPAN frets, first finger on the position) fits under the 12th
 *      fret is scored by HOW MANY notes it covers; the winner is the position that
 *      covers the most, lowest wins ties. Notes outside it are still written (they
 *      are marked, and TAB_OFFSET_LINE says how many) — the tab is never a dead end.
 *   3. A NOTE THE GUITAR CANNOT PLAY AT ANY FRET — the pitch is folded by OCTAVES
 *      into the instrument's range (every pitch class exists inside the 3-octave
 *      window the six strings span), and the count of folded notes is reported.
 *      Nothing is dropped silently and nothing is transposed by a non-octave
 *      interval, so the tab still plays the tune the user hummed.
 *
 * PURE: no react, no react-native, no fs — so tsconfig.tier1.json compiles it and
 * the tier1 gate pins the mapping, the position choice and the honesty lines
 * (scripts/v37TakeExport.test.ts), with no emulator and no guitar in the room.
 */
import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';

/** Standard tuning, string 1 (high E) → string 6 (low E), as MIDI numbers. */
export const STANDARD_TUNING: readonly number[] = [64, 59, 55, 50, 45, 40];
/** The same tuning, as the labels a tab line carries (thinnest string first). */
export const STANDARD_TUNING_LABELS: readonly string[] = ['e', 'B', 'G', 'D', 'A', 'E'];
/** How many strings a tab has. */
export const TAB_STRING_COUNT = STANDARD_TUNING.length;
/** The highest fret this renderer will ever ask a player to reach. */
export const MAX_TAB_FRET = 12;
/** A hand position covers this many frets (first finger on the position). */
export const HAND_SPAN = 4;
/** The highest position whose span still fits under MAX_TAB_FRET (position 9). */
export const MAX_TAB_POSITION = MAX_TAB_FRET - HAND_SPAN + 1;
/**
 * How wide one note's cell is in the rendered tab text. FIXED at four characters
 * (`--5-`, `-12-`, or `+-5-` for a note outside the hand position) so all six
 * string lines stay in register: a width that varied with the number of digits
 * would slide the lines apart the moment a note past the 9th fret appeared.
 */
export const TAB_CELL_WIDTH = 4;
/** How many cells between two bar marks. */
export const TAB_CELLS_PER_BAR = 4;

/** The button that opens the tab page — the owner's own word for it (10-09). */
export const TAB_LABEL = 'Tabs';
/** The page's title. */
export const TAB_TITLE = 'Your take, as guitar tab';
/**
 * The honest line. The tab is OURS, generated from the user's own take: it is not
 * an official edition, not a publisher's tab, and not a transcription of a
 * recording. Every surface that shows tab shows this.
 */
export const TAB_HONEST_LINE =
  'Auto-generated from your own take — a NoteSnap rendering in standard tuning (EADGBE), not an official guitar edition.';
/** Said instead of tab when the take held no notes (never an empty grid). */
export const TAB_EMPTY_LINE = 'There is no tab to draw for this take — it held no notes.';
/** What standard tuning is, in one line, under the grid. */
export const TAB_TUNING_LINE = 'Standard tuning: e B G D A E (thinnest string first).';
/** The caption over the string/fret readout. */
export const TAB_NOTES_CAPTION = 'String and fret for each note, in the order you played them:';

/**
 * ONE NOTE AS TAB. `string` is 1 (high E) … 6 (low E), `fret` is 0 (open) … 12.
 * `foldedOctaves` is non-zero when the note had to move by whole octaves to be
 * playable at all, and `outsidePosition` marks a note that is not under the hand
 * position the rest of the take is played in.
 */
export interface TabNote {
  /** Index in the take's note list. */
  index: number;
  /** The pitch as the take carries it. */
  midi: number;
  /** The pitch actually written in the tab (after any octave folding). */
  playedMidi: number;
  /** Scientific pitch name of the written note, e.g. "C4". */
  noteName: string;
  /** 1 = high E … 6 = low E. */
  string: number;
  /** 0 = open string. */
  fret: number;
  /** Whole octaves the note was moved to reach the fretboard (0 = untouched). */
  foldedOctaves: number;
  /** True when this note is outside the take's chosen hand position. */
  outsidePosition: boolean;
}

/** The whole take laid out on the fretboard. */
export interface TabLayout {
  /** The hand position the take is played in (null when there are no notes). */
  position: number | null;
  /** A label for that position, e.g. "3rd position" / "open position". */
  positionLabel: string;
  /** The highest fret the take asks for. */
  highestFret: number;
  /** The lowest fret the take asks for. */
  lowestFret: number;
  /** Every note, in take order. */
  notes: TabNote[];
  /** How many notes needed octave folding. */
  foldedCount: number;
  /** How many notes sit outside the chosen position. */
  outsidePositionCount: number;
}

const LETTER_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The scientific pitch name of a MIDI number (60 = C4, 69 = A4). */
export function midiNoteName(midi: number): string {
  const value = Math.round(Number(midi));
  if (!Number.isFinite(value)) return '?';
  const pc = ((value % 12) + 12) % 12;
  const octave = Math.floor(value / 12) - 1;
  return `${LETTER_NAMES[pc]}${octave}`;
}

/** One playable way to sound a pitch on the guitar. */
export interface TabCandidate {
  string: number;
  fret: number;
}

/**
 * EVERY WAY TO PLAY THIS PITCH under the 12th fret, ordered the way the renderer
 * ranks them: lowest fret first (open and first position are what a player
 * reaches for), then thinnest string. Deterministic by construction.
 */
export function tabCandidates(midi: number, maxFret: number = MAX_TAB_FRET): TabCandidate[] {
  const value = Math.round(Number(midi));
  if (!Number.isFinite(value)) return [];
  const out: TabCandidate[] = [];
  for (let index = 0; index < STANDARD_TUNING.length; index += 1) {
    const fret = value - STANDARD_TUNING[index];
    if (fret >= 0 && fret <= maxFret) {
      out.push({ string: index + 1, fret });
    }
  }
  out.sort((a, b) => (a.fret - b.fret) || (a.string - b.string));
  return out;
}

/**
 * The note as tab, folded into the instrument's range when the pitch itself is
 * off the fretboard. Folding is ALWAYS by whole octaves and never gives up: the
 * six strings span three octaves, so every pitch class is reachable somewhere
 * inside 0…12 frets, and the caller is told how far it had to move.
 */
export function tabForMidi(
  midi: number,
  maxFret: number = MAX_TAB_FRET,
): { string: number; fret: number; playedMidi: number; foldedOctaves: number } | null {
  const value = Math.round(Number(midi));
  if (!Number.isFinite(value)) return null;
  for (let folded = 0; folded <= 8; folded += 1) {
    for (const direction of folded === 0 ? [0] : [-1, 1]) {
      const played = value + direction * 12 * folded;
      const candidates = tabCandidates(played, maxFret);
      if (candidates.length > 0) {
        return {
          string: candidates[0].string,
          fret: candidates[0].fret,
          playedMidi: played,
          foldedOctaves: direction * folded,
        };
      }
    }
  }
  return null;
}

/** A note of the take, reduced to what this module needs. */
export function tabNotesOf(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
): MidiNoteEvent[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note) => !!note && Number.isFinite(note?.midi))
    .slice()
    .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
}

/**
 * THE HAND POSITION THE WHOLE TAKE IS PLAYED IN (decision 2 above): the position
 * whose `HAND_SPAN` frets cover the most notes, lowest position winning ties. A
 * take with no notes has no position (null) — the caller renders TAB_EMPTY_LINE.
 */
export function bestTakePosition(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
  maxFret: number = MAX_TAB_FRET,
): number | null {
  const list = tabNotesOf(notes);
  if (list.length === 0) return null;
  const frets: number[] = [];
  for (const note of list) {
    const placed = tabForMidi(Number(note.midi), maxFret);
    if (placed) frets.push(placed.fret);
  }
  if (frets.length === 0) return null;
  let best = 0;
  let bestCovered = -1;
  const lastPosition = Math.max(0, maxFret - HAND_SPAN + 1);
  for (let position = 0; position <= lastPosition; position += 1) {
    let covered = 0;
    for (const fret of frets) {
      if (fret >= position && fret < position + HAND_SPAN) covered += 1;
    }
    if (covered > bestCovered) {
      bestCovered = covered;
      best = position;
    }
  }
  return best;
}

/** "open position", "3rd position", "11th position" — always the same words. */
export function positionLabel(position: number | null): string {
  if (position === null || !Number.isFinite(position)) return 'no position';
  if (position <= 0) return 'open position';
  const suffix =
    position % 10 === 1 && position % 100 !== 11
      ? 'st'
      : position % 10 === 2 && position % 100 !== 12
        ? 'nd'
        : position % 10 === 3 && position % 100 !== 13
          ? 'rd'
          : 'th';
  return `${position}${suffix} position`;
}

/**
 * LAY THE TAKE OUT ON THE FRETBOARD. Never throws and never returns nothing for a
 * take that has notes: each note gets a string and a fret (folded into range if
 * it must be), the take gets one hand position, and the out-of-position notes are
 * counted so the surface can say so out loud.
 */
export function buildGuitarTab(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
  opts: { maxFret?: number } = {},
): TabLayout {
  const maxFret =
    typeof opts.maxFret === 'number' && Number.isFinite(opts.maxFret) && opts.maxFret > 0
      ? Math.min(MAX_TAB_FRET, Math.floor(opts.maxFret))
      : MAX_TAB_FRET;
  const list = tabNotesOf(notes);
  const position = bestTakePosition(list, maxFret);
  const placed: TabNote[] = [];
  let foldedCount = 0;
  let outsidePositionCount = 0;
  let lowestFret = Number.POSITIVE_INFINITY;
  let highestFret = 0;

  list.forEach((note, index) => {
    const mapped = tabForMidi(Number(note.midi), maxFret);
    if (!mapped) return;
    const outside =
      position === null ||
      mapped.fret < position ||
      mapped.fret >= position + HAND_SPAN;
    if (outside) outsidePositionCount += 1;
    if (mapped.foldedOctaves !== 0) foldedCount += 1;
    lowestFret = Math.min(lowestFret, mapped.fret);
    highestFret = Math.max(highestFret, mapped.fret);
    placed.push({
      index,
      midi: Math.round(Number(note.midi)),
      playedMidi: mapped.playedMidi,
      noteName: midiNoteName(mapped.playedMidi),
      string: mapped.string,
      fret: mapped.fret,
      foldedOctaves: mapped.foldedOctaves,
      outsidePosition: outside,
    });
  });

  return {
    position,
    positionLabel: positionLabel(position),
    lowestFret: Number.isFinite(lowestFret) ? lowestFret : 0,
    highestFret,
    notes: placed,
    foldedCount,
    outsidePositionCount,
  };
}

/** One note's cell in the tab text: fret, dashes around it, `+` when off-position. */
export function tabCell(note: TabNote): string {
  const lead = note.outsidePosition ? '+' : '-';
  const fret = String(Math.max(0, Math.round(note.fret)));
  return `${lead}${fret.padStart(TAB_CELL_WIDTH - 2, '-')}-`;
}

/** The empty cell a string carries where the note is on a different string. */
export function tabEmptyCell(): string {
  return '-'.repeat(TAB_CELL_WIDTH);
}

/**
 * THE TAB GRID, as six text lines (string 1 first — the way tab is printed).
 * Cells are a fixed width, bar marks every TAB_CELLS_PER_BAR cells, and an
 * off-position note is flagged in its own cell so the grid stays honest without
 * a second legend.
 */
export function tabLines(layout: TabLayout): string[] {
  const lines: string[] = [];
  for (let string = 1; string <= TAB_STRING_COUNT; string += 1) {
    const cells: string[] = [];
    layout.notes.forEach((note, index) => {
      if (index > 0 && index % TAB_CELLS_PER_BAR === 0) cells.push('|');
      cells.push(note.string === string ? tabCell(note) : tabEmptyCell());
    });
    const label = STANDARD_TUNING_LABELS[string - 1];
    lines.push(`${label}|${cells.join('')}${layout.notes.length > 0 ? '|' : ''}`);
  }
  return lines;
}

/** The pitches the tab actually asks for, in order — the readout under the grid. */
export function tabNoteReadout(layout: TabLayout): string {
  if (layout.notes.length === 0) return '';
  return layout.notes
    .map((note) => `${note.noteName} → string ${note.string}, fret ${note.fret}`)
    .join(' · ');
}

/** The named notes alone, e.g. "C4 · E4 · G4" — what the owner checks by eye. */
export function tabPitchSummary(layout: TabLayout): string {
  return layout.notes.map((note) => note.noteName).join(' · ');
}

/**
 * WHAT THE TAB DID TO THE NOTES, in words, always. Nothing is silent: a take that
 * needed no folding and no position change says so, and a take that needed either
 * says how many notes and which position it landed in.
 */
export function tabHonestyLine(layout: TabLayout): string {
  if (layout.notes.length === 0) return TAB_EMPTY_LINE;
  const parts = [`Played in the ${layout.positionLabel}.`];
  if (layout.outsidePositionCount > 0) {
    parts.push(
      `${layout.outsidePositionCount} note${layout.outsidePositionCount === 1 ? '' : 's'} sit outside that position (marked + in the grid) — move your hand for those and come back.`,
    );
  }
  if (layout.foldedCount > 0) {
    const count = layout.foldedCount;
    parts.push(
      `${count} note${count === 1 ? ' was' : 's were'} moved by whole octaves to fit the guitar's range.`,
    );
  }
  if (layout.outsidePositionCount === 0 && layout.foldedCount === 0) {
    parts.push('Every note sits under one hand position, exactly as you played it.');
  }
  return parts.join(' ');
}

/** True when the take has anything to draw as tab at all. */
export function tabHasNotes(layout: TabLayout | null | undefined): boolean {
  return !!layout && layout.notes.length > 0;
}
