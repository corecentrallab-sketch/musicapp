/**
 * takeStaff.ts — the user's OWN take drawn as a staff (v33 slice C, brief §C).
 *
 * WHY. The v32 capture window showed a take as a text sequence ("A3 · B3 · C#4")
 * plus a key/chord line. The v33 page draws the SAME take as notation: the raw
 * trace the tracker heard (rendered dimmed by the window), an "auto-clean ✦"
 * divider, then the crisp auto-cleaned line — with the suggested chord row above
 * the staff (design reference /home/team/shared/design-capture-page-v33).
 *
 * NOTHING HERE IS A TRANSCRIPTION OF A RECORDING. Every note on this staff
 * belongs to the user's own hummed take; the labels say exactly that. A
 * modern-song match never renders generated notation for the song (standing
 * rule), so this module is only ever fed a take the user made.
 *
 * PURE (no react / react-native / fs / path): the tier1 gate asserts the note
 * spelling, the key-signature accidentals, the bar lines, the rests for real
 * timing gaps and the honest labels without an emulator —
 * scripts/v33TakeEditor.test.ts.
 */
import { scalePitchClasses } from './melodyCapture';
import type { MidiNoteEvent } from './midiExport';
import type { KeyMode } from './keyDetection';

/** ABC's note letters, in pitch order (also the order the accidental map uses). */
export const STAFF_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type StaffLetter = (typeof STAFF_LETTERS)[number];

/** The natural pitch class of each letter. */
export const LETTER_PITCH_CLASS: Record<StaffLetter, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** The order accidentals are added in (the circle of fifths), sharp then flat. */
export const SHARP_ORDER: readonly StaffLetter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER: readonly StaffLetter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** The divider between the raw trace and the cleaned line (design §C). */
export const AUTO_CLEAN_DIVIDER_LABEL = 'auto-clean ✦';
/** Said instead of a staff when a take held no notes at all. */
export const STAFF_EMPTY_LINE =
  'There is no notation for this take — no notes were heard in it.';
/** The honest line under the raw staff: it is what the tracker heard, unedited. */
export const STAFF_RAW_HONESTY =
  'This is your take exactly as NoteSnap heard it — nothing has been cleaned up yet.';
/** The honest line under the cleaned staff (never a studio-transcription claim). */
export const STAFF_CLEANED_HONESTY =
  'Auto-cleaned: pitches moved onto the detected key and onsets onto the beat — a hummed take, not a transcription.';
/** What the staff is, in one line, for the window's caption. */
export const STAFF_CAPTION = 'Your melody, as notation — your own take, not a recording.';

/**
 * ── vc64 ── THE WRITTEN PITCH A TAKE'S NOTATION IS CENTRED ON (A4).
 *
 * A take is a VOICE. Whatever octave it was hummed in, notation for a voice is
 * written in the octave that reads on the staff — the whole-octave move a vocal
 * score makes — and A4 is the middle of the treble staff. See
 * `staffOctaveShift`.
 */
export const STAFF_WRITTEN_CENTRE_MIDI = 69;

/**
 * ── vc64 ── THE WHOLE-OCTAVE SHIFT THAT PUTS A TAKE'S MELODY ON THE STAFF.
 *
 * WHAT WAS WRONG (owner, vc63 probe): the noteheads sat four to twelve ledger
 * lines BELOW the treble staff while the take's own chords read Dm/F/Am/Em. The
 * ABC spelling was standard (`C` is C4, `A,` is A3 — measured in a real abcjs
 * render, and the pitch pass itself returns A3 for a 220 Hz tone), so nothing in
 * the spelling was wrong: the take was simply written at the pitch it was
 * detected at, which for a hummed or low-voiced take is far under the staff and
 * unreadable on a phone.
 *
 * THE RULE. Write the take in the octave whose centre is `STAFF_WRITTEN_CENTRE_MIDI`
 * (A4): the shift is the nearest WHOLE number of octaves to that centre, so the
 * take's median note lands on or beside the staff instead of twelve ledger lines
 * under it.
 *
 * WHOLE OCTAVES ONLY, which is what makes this safe: every pitch class, every
 * interval, the key signature and every chord stay exactly as detected. Only the
 * ledger-line distance changes, and `staffOctaveLine` says so on the card. A take
 * that already reads on the staff is shifted by 0 and nothing changes.
 */
export function staffOctaveShift(
  notes: ReadonlyArray<{ midi?: number | null }> | null | undefined,
): number {
  const values = (Array.isArray(notes) ? notes : [])
    .map((note) => Number(note?.midi))
    .filter((midi) => Number.isFinite(midi));
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  const octaves = Math.round((STAFF_WRITTEN_CENTRE_MIDI - median) / 12);
  return Number.isFinite(octaves) ? octaves * 12 : 0;
}

/**
 * The honest sentence for a shift, or null when the take already reads on the
 * staff. Never a silent octave change: the card prints this beside the staff.
 */
export function staffOctaveLine(shift: number | null | undefined): string | null {
  const value = Number(shift);
  if (!Number.isFinite(value) || value === 0) return null;
  const octaves = Math.abs(value) / 12;
  const count = octaves === 1 ? 'an octave' : `${octaves} octaves`;
  return value > 0
    ? `Written ${count} higher than it sounded, so the melody sits on the staff.`
    : `Written ${count} lower than it sounded, so the melody sits on the staff.`;
}

const LETTERS_BY_PITCH_CLASS: Record<number, StaffLetter> = {
  0: 'C',
  1: 'C',
  2: 'D',
  3: 'D',
  4: 'E',
  5: 'F',
  6: 'F',
  7: 'G',
  8: 'G',
  9: 'A',
  10: 'A',
  11: 'B',
};

function mod12(value: number): number {
  return ((Math.round(value) % 12) + 12) % 12;
}

/** A key as the staff needs it: a tonic pitch class and a mode. */
export interface StaffKey {
  tonic: number;
  mode: KeyMode;
}

/**
 * The staff's key, from the app's own key decision. Null stays null: a take too
 * thin to name a key is drawn with no signature rather than a guessed one.
 */
export function staffKeyFromKey(
  key: { tonic?: number; mode?: string } | null | undefined,
): StaffKey | null {
  if (!key || !Number.isFinite(key.tonic)) return null;
  return { tonic: mod12(Number(key.tonic)), mode: key.mode === 'minor' ? 'minor' : 'major' };
}

/** How a key signature alters each letter: 0 natural, 1 sharp, −1 flat. */
export type KeyAccidentals = Record<StaffLetter, number>;

export interface StaffKeySignature {
  /** Sharps in the signature (0 when the key is flat-side). */
  sharps: number;
  /** Flats in the signature (0 when the key is sharp-side). */
  flats: number;
  /** The per-letter alteration the signature implies. */
  accidentals: KeyAccidentals;
  /** The tonic's letter ("B" for Bb major). */
  tonicLetter: StaffLetter;
  /** The tonic's own accidental: '^' sharp, '_' flat, '' natural. */
  tonicAccidental: '' | '^' | '_';
  /** The ABC `K:` token, e.g. "C", "^F", "_B", "Am". */
  abcToken: string;
  /** The human key name, e.g. "Bb major" / "F# minor". */
  label: string;
}

const NEUTRAL_ACCIDENTALS: KeyAccidentals = {
  C: 0,
  D: 0,
  E: 0,
  F: 0,
  G: 0,
  A: 0,
  B: 0,
};

/**
 * The key signature of a key, from the tonic's pitch class and mode.
 *
 * Major keys: the number of sharps is `(tonicPc × 7) mod 12`; anything past six
 * is read as the flat side (12 − n flats), which is the standard circle-of-fifths
 * spelling. Minor keys take their RELATIVE MAJOR's signature (tonic + 3). Nothing
 * is guessed: the letters are spelled from the signature, so a take in Bb major
 * is written with the two flats a player expects.
 */
export function staffKeySignature(
  key: StaffKey | null | undefined,
): StaffKeySignature {
  if (!key || !Number.isFinite(key?.tonic)) {
    return {
      sharps: 0,
      flats: 0,
      accidentals: { ...NEUTRAL_ACCIDENTALS },
      tonicLetter: 'C',
      tonicAccidental: '',
      abcToken: 'C',
      label: 'C major',
    };
  }
  const mode: KeyMode = key.mode === 'minor' ? 'minor' : 'major';
  const tonicPc = mod12(key.tonic);
  const majorPc = mode === 'minor' ? mod12(tonicPc + 3) : tonicPc;
  const rawSharps = (majorPc * 7) % 12;
  const sharps = rawSharps > 6 ? 0 : rawSharps;
  const flats = rawSharps > 6 ? 12 - rawSharps : 0;

  const accidentals: KeyAccidentals = { ...NEUTRAL_ACCIDENTALS };
  for (let i = 0; i < sharps; i++) accidentals[SHARP_ORDER[i]] = 1;
  for (let i = 0; i < flats; i++) accidentals[FLAT_ORDER[i]] = -1;

  // The tonic is spelled to agree with its own signature: flat-side keys spell
  // their tonic with a flat (Bb, Eb, Ab …), sharp-side keys with a sharp (F#, C#).
  const preferFlats = flats > 0;
  const spelled = spellPitchClass(tonicPc, preferFlats);
  const abcToken = `${spelled.accidental}${spelled.letter}${mode === 'minor' ? 'm' : ''}`;
  return {
    sharps,
    flats,
    accidentals,
    tonicLetter: spelled.letter,
    tonicAccidental: spelled.accidental,
    abcToken,
    label: `${spelled.letter}${spelled.accidental === '^' ? '#' : spelled.accidental === '_' ? 'b' : ''} ${mode}`,
  };
}

/**
 * The conventional spelling of a pitch class: sharp-side keys spell a black key
 * as the letter BELOW it sharpened (F#), flat-side keys as the letter ABOVE it
 * flattened (Gb, Bb, Eb) — which is what a player reading the signature expects.
 */
export function spellPitchClass(
  pc: number,
  preferFlats = false,
): { letter: StaffLetter; accidental: '' | '^' | '_' } {
  const value = mod12(pc);
  if (preferFlats) {
    const abovePc = mod12(value + 1);
    const above = STAFF_LETTERS.find((candidate) => LETTER_PITCH_CLASS[candidate] === abovePc);
    if (above) return { letter: above, accidental: '_' };
  }
  const letter = LETTERS_BY_PITCH_CLASS[value];
  const natural = LETTER_PITCH_CLASS[letter];
  const delta = value - natural;
  if (delta === 0) return { letter, accidental: '' };
  return { letter, accidental: delta > 0 ? '^' : '_' };
}

/** The octave an ABC letter needs: ABC's `c` is C5, its `C` is C4 (middle C). */
function abcOctaveLetter(letter: StaffLetter, octave: number): string {
  if (octave >= 5) {
    const marks = "'".repeat(Math.min(4, octave - 5));
    return `${letter.toLowerCase()}${marks}`;
  }
  if (octave <= 3) {
    // ABC's `C` is C4, so C3 needs ONE comma, C2 two — 4 − octave.
    const marks = ','.repeat(Math.min(4, Math.max(1, 4 - octave)));
    return `${letter}${marks}`;
  }
  return letter;
}

/**
 * The bar's accidental state, seeded from the key signature: "nothing explicit
 * has been written in this bar yet" is the SIGNATURE's own value for each letter,
 * not a natural — that is what stops a note the signature already covers from
 * being written with a redundant mark.
 */
export function barStateFor(signature: StaffKeySignature): Record<StaffLetter, number> {
  return { ...signature.accidentals };
}

/** The MIDI octave number of a pitch (MIDI 60 = C4). */
export function midiOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/**
 * One note as an ABC token, WITH the accidental marks the staff needs.
 *
 * `barState` carries the accidentals already written in the current bar: ABC's
 * accidentals last to the end of the bar, so a second note of the same letter
 * that the key signature does not already cover is written explicitly again
 * rather than silently re-using the previous mark.
 */
export function abcNoteToken(
  midi: number,
  signature: StaffKeySignature,
  barState: Record<StaffLetter, number>,
): string {
  const value = mod12(midi);
  const octave = midiOctave(midi);
  // Prefer the letter the key signature already spells for this pitch class —
  // that is what makes a take in Bb major read with the signature's own notes.
  let letter: StaffLetter | null = null;
  let needed = 0;
  for (const candidate of STAFF_LETTERS) {
    const altered = mod12(LETTER_PITCH_CLASS[candidate] + signature.accidentals[candidate]);
    if (altered === value) {
      letter = candidate;
      needed = signature.accidentals[candidate];
      break;
    }
  }
  if (letter === null) {
    // A note outside the key: spell it the conventional (sharp-side) way.
    const spelled = spellPitchClass(value, signature.flats > 0);
    letter = spelled.letter;
    needed = spelled.accidental === '^' ? 1 : spelled.accidental === '_' ? -1 : 0;
  }
  const keyAlter = signature.accidentals[letter];
  const alreadyWritten = barState[letter];
  let mark = '';
  if (needed !== keyAlter) {
    mark = needed === 1 ? '^' : needed === -1 ? '_' : '=';
  } else if (alreadyWritten !== undefined && alreadyWritten !== keyAlter) {
    // The bar already carried an explicit mark for this letter: restate it.
    mark = needed === 1 ? '^' : needed === -1 ? '_' : '=';
  }
  barState[letter] = needed;
  return `${mark}${abcOctaveLetter(letter, octave)}`;
}

/** The default grid: L:1/8, so a bar of 4/4 holds eight eighths. */
export const STAFF_UNIT_DIVISION = 8;
export const STAFF_BAR_UNITS = 8;

/** How many eighths a duration is, clamped to something a reader can count. */
export function durationUnits(durationSec: number, eighthSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(eighthSec) || eighthSec <= 0) {
    return 1;
  }
  return Math.min(STAFF_BAR_UNITS, Math.max(1, Math.round(durationSec / eighthSec)));
}

export interface TakeStaffInput {
  /** The take exactly as tracked (the dimmed raw trace). */
  rawNotes?: ReadonlyArray<MidiNoteEvent> | null;
  /** The auto-cleaned take (the crisp line). */
  cleanedNotes?: ReadonlyArray<MidiNoteEvent> | null;
  key?: StaffKey | null;
  tempoBpm?: number | null;
  /** The take's suggested chord names, for the row above the staff. */
  chordNames?: ReadonlyArray<string> | null;
  /** Why there are no chords (from the analysis), or null when there are. */
  chordHonestLine?: string | null;
  title?: string | null;
}

export interface TakeStaffRows {
  /** ABC for the raw trace, or null when the take held no notes. */
  rawAbc: string | null;
  /** ABC for the cleaned line, or null when the take held no notes. */
  cleanedAbc: string | null;
  rawLabel: string;
  cleanedLabel: string;
  dividerLabel: string;
  /** The chord symbols above the staff (may be empty). */
  chordRow: string[];
  chordHonestLine: string | null;
  noteCount: number;
  /** The key token the staff was written in (the ABC `K:` value). */
  keyToken: string;
  keyLabel: string;
  /**
   * ── vc64 ── The whole-octave shift BOTH staves were written with (0 = the take
   * already read on the staff). `octaveLine` is the honest sentence for it, or
   * null when there is nothing to say.
   */
  octaveShift: number;
  octaveLine: string | null;
}

/**
 * Build both staff rows (and the chord row) for one take. Never throws: a take
 * with no notes returns null ABCs and the caller renders STAFF_EMPTY_LINE.
 */
export function takeStaffRows(input: TakeStaffInput): TakeStaffRows {
  const raw = Array.isArray(input.rawNotes) ? input.rawNotes : [];
  const cleaned = Array.isArray(input.cleanedNotes) ? input.cleanedNotes : [];
  const signature = staffKeySignature(input.key ?? null);
  const tempo =
    typeof input.tempoBpm === 'number' && Number.isFinite(input.tempoBpm) && input.tempoBpm > 0
      ? input.tempoBpm
      : 100;
  const eighthSec = 30 / tempo;
  const notes = cleaned.length > 0 ? cleaned : raw;
  const title =
    typeof input.title === 'string' && input.title.trim().length > 0
      ? input.title.trim()
      : 'Your melody';
  const chordRow = (Array.isArray(input.chordNames) ? input.chordNames : []).filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  );
  // vc64: ONE shift for BOTH staves, taken from the line the card draws crisp —
  // two staves of the same take must never sit in different octaves.
  const octaveShift = staffOctaveShift(notes);
  return {
    rawAbc:
      raw.length > 0
        ? takeToAbc(raw, { signature, eighthSec, title, suffix: 'as hummed', octaveShiftMidi: octaveShift })
        : null,
    cleanedAbc:
      cleaned.length > 0
        ? takeToAbc(cleaned, {
            signature,
            eighthSec,
            title,
            suffix: 'auto-cleaned',
            octaveShiftMidi: octaveShift,
          })
        : null,
    rawLabel: 'As you hummed it',
    cleanedLabel: 'Auto-cleaned',
    dividerLabel: AUTO_CLEAN_DIVIDER_LABEL,
    chordRow,
    chordHonestLine: input.chordHonestLine ?? null,
    noteCount: notes.length,
    keyToken: signature.abcToken,
    keyLabel: signature.label,
    octaveShift,
    octaveLine: staffOctaveLine(octaveShift),
  };
}

/**
 * The ABC document for one monophonic line: header, key, the notes with the
 * timing the take really has (a gap becomes a rest) and bar lines every 4/4.
 *
 * ── vc64 ── NO TITLE IN THE DOCUMENT, AND THE NOTES IN A READABLE OCTAVE.
 *
 * 1. The header carries NO `T:` line. It used to carry one — `T:<take label>
 *    (as hummed)` — and abcjs draws a `T:` line as a big centred title inside
 *    the staff box, which is what the owner saw clipped across the card as
 *    "video (as humn". The card already prints its own heading above the staff
 *    ("As you hummed it" / "Auto-cleaned"), so the title belongs there and
 *    nowhere else. `title`/`suffix` are still ACCEPTED (every caller passes them,
 *    the PDF prints the ABC source) and are deliberately NOT written out.
 * 2. The notes are written through `staffOctaveShift`, so a hummed take lands on
 *    the staff instead of twelve ledger lines under it. Pass `octaveShiftMidi`
 *    when two staves of the same take must share one shift (the card does).
 */
export function takeToAbc(
  notes: ReadonlyArray<MidiNoteEvent>,
  opts: {
    signature: StaffKeySignature;
    eighthSec: number;
    /** Accepted for the callers that still pass it; never written (see above). */
    title?: string;
    /** Accepted for the callers that still pass it; never written (see above). */
    suffix?: string;
    /** Whole-octave shift to write with (default: `staffOctaveShift(notes)`). */
    octaveShiftMidi?: number;
  },
): string {
  const list = notes
    .filter((note) => note && Number.isFinite(note.midi))
    .slice()
    .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
  const octaveShift =
    typeof opts.octaveShiftMidi === 'number' && Number.isFinite(opts.octaveShiftMidi)
      ? opts.octaveShiftMidi
      : staffOctaveShift(list);
  const barState: Record<StaffLetter, number> = barStateFor(opts.signature);
  const body: string[] = [];
  let barUnits = 0;
  let cursorSec: number | null = null;
  let firstStart = true;

  const pushToken = (token: string, units: number) => {
    let left = units;
    while (left > 0) {
      const room = STAFF_BAR_UNITS - barUnits;
      const take = Math.min(room, left);
      body.push(`${token}${take > 1 ? take : ''}`);
      barUnits += take;
      left -= take;
      if (barUnits >= STAFF_BAR_UNITS) {
        body.push('|');
        barUnits = 0;
        for (const letter of STAFF_LETTERS) barState[letter] = opts.signature.accidentals[letter];
      }
    }
  };

  for (const note of list) {
    const start = Number.isFinite(note.startSec) ? Number(note.startSec) : 0;
    if (firstStart) {
      firstStart = false;
    } else if (cursorSec !== null) {
      const gap = start - cursorSec;
      const restUnits = Math.round(gap / opts.eighthSec);
      if (restUnits >= 1) pushToken('z', Math.min(STAFF_BAR_UNITS, restUnits));
    }
    const units = durationUnits(Number(note.durationSec), opts.eighthSec);
    pushToken(
      abcNoteToken(Number(note.midi) + octaveShift, opts.signature, barState),
      units,
    );
    cursorSec = start + (Number.isFinite(note.durationSec) ? Number(note.durationSec) : 0);
  }
  if (barUnits > 0) body.push('|');

  // vc64: NO `T:` LINE. The take's name is the card's own heading; a title inside
  // the ABC is drawn by abcjs as a giant centred title that the staff box clips.
  const header = [
    'X:1',
    'M:4/4',
    `L:1/${STAFF_UNIT_DIVISION}`,
    'K:' + opts.signature.abcToken,
  ];
  return `${header.join('\n')}\n${body.join(' ')}\n`;
}

/** True when a take has notes to draw at all. */
export function staffHasNotes(rows: TakeStaffRows | null | undefined): boolean {
  return !!rows && rows.noteCount > 0 && !!rows.cleanedAbc;
}

/** The pitch classes a key's scale holds — the editor's "on the scale" check. */
export function keyScalePitchClasses(key: StaffKey | null | undefined): number[] {
  if (!key || !Number.isFinite(key?.tonic)) return [];
  return scalePitchClasses(mod12(key.tonic), key.mode === 'minor' ? 'minor' : 'major');
}
