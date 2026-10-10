/**
 * takeNotationPdf.ts — THE TAKE AS A PDF (v37 item 7a, backlog baa39e66).
 *
 * WHAT THIS IS. "Your take, as PDF": NoteSnap draws the user's OWN corrected take
 * on a staff and writes a real PDF file the user can print, keep or send. It is
 * the user's own data (they hummed it and corrected it), so it carries no
 * paywall and no publisher: the labels say plainly what it is.
 *
 * WHERE THE NOTATION COMES FROM — the EXISTING notation engine, not a second one.
 * The page on screen draws the take through `takeStaff.ts` (`takeToAbc` + the
 * key-signature spelling + `durationUnits` + `STAFF_BAR_UNITS`), and this module
 * is driven by exactly those same pure helpers: the same `staffKeySignature`, the
 * same letter-for-pitch spelling rule the on-screen ABC uses, the same eighth
 * grid for durations and barring, and the measured staff (a treble staff, whole
 * steps of 4pt, ledger lines) that the notation is drawn on. The last block of
 * the PDF prints the ABC source the app draws on screen, so the owner can hold
 * the two side by side — if they ever disagree, that block shows it.
 *
 * WHY IT IS HAND-WRITTEN. The app has no PDF writer (react-native-pdf only READS),
 * and a take is monophonic: a small, deterministic vector writer is honest,
 * offline, dependency-free and — crucially — TESTABLE in the tier1 gate, exactly
 * like `midiStructure.ts` is for the .mid export. The bytes this module produces
 * are then parsed back by `parseTakePdfStructure` before anything is shared (the
 * same "never hand over a file we have not parsed ourselves" rule as v37 item 6).
 *
 * PURE: no react, no react-native, no fs. Runs under plain Node.
 */
import {
  STAFF_BAR_UNITS,
  STAFF_LETTERS,
  LETTER_PITCH_CLASS,
  type StaffKeySignature,
  type StaffLetter,
  durationUnits,
  midiOctave,
  spellPitchClass,
  staffKeySignature,
} from './takeStaff';
import { takeToAbc } from './takeStaff';
import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';

// ─── The words the surfaces render ──────────────────────────────

/** The action, in the user's terms. */
export const TAKE_PDF_LABEL = 'Your take, as PDF';
/** What the file is, and the honest framing (the user's own data). */
export const TAKE_PDF_HINT =
  'A PDF of your own take in NoteSnap’s notation — your data, ready to print or keep.';
/** Shown over the built file before it is handed to the share sheet. */
export const TAKE_PDF_DIALOG_TITLE = 'Save your take as a PDF';
/** The line printed at the top of the page. */
export const TAKE_PDF_CAPTION =
  'Rendered by NoteSnap from your own take — this is not a published edition of any piece.';
/** How the page is drawn, said out loud. */
export const TAKE_PDF_LEGEND =
  'Treble clef, 4/4, one note at a time — the same notation this take shows on screen.';
export const TAKE_PDF_SOURCE_LABEL = 'The same notation source the app draws on screen (ABC):';
/** The one page-furniture line, at the foot of every page. */
export const TAKE_PDF_FOOTER = 'NoteSnap · rendered from your own take';
/** Said when the PDF we built does not parse — we never hand over a broken file. */
export const TAKE_PDF_STRUCTURE_INVALID_MESSAGE =
  'The PDF we built did not pass its own structure check, so we did not hand it over. Please try again.';
/** Said when the file could not be written or the share sheet could not open. */
export const TAKE_PDF_FAILED_MESSAGE =
  'We could not save the PDF just now. Please try again.';
/** Said when this device has no share sheet to hand a file to. */
export const TAKE_PDF_UNAVAILABLE_MESSAGE =
  'PDF export needs the system share sheet, which is not available on this device right now.';
/** Said when the take held no notes (an empty staff would be a lie). */
export const TAKE_PDF_EMPTY_MESSAGE =
  'There is no PDF to write for this take — it held no notes.';

// ─── The page ───────────────────────────────────────────────────

export const PDF_VERSION = '1.4';
export const PDF_PAGE_WIDTH = 595;
export const PDF_PAGE_HEIGHT = 842;
export const PDF_MARGIN = 48;
/** The gap between two staff lines (and the height of one diatonic step). */
export const STAFF_LINE_GAP = 8;
export const STAFF_STEP = STAFF_LINE_GAP / 2;
export const STAFF_LINE_COUNT = 5;
/** The staff's bottom line is E4 — treble clef's own reference. */
export const STAFF_BOTTOM_STEP = 30;
/** Horizontal room reserved for the clef, key signature and time signature. */
export const STAFF_HEADER_WIDTH = 80;
/** How much horizontal room one note takes. */
export const NOTE_SPACING = 26;
/** How many notes fit on one system (derived from the page geometry). */
export const NOTES_PER_SYSTEM = Math.floor(
  (PDF_PAGE_WIDTH - 2 * PDF_MARGIN - STAFF_HEADER_WIDTH) / NOTE_SPACING,
);
export const SYSTEMS_PER_PAGE = 6;
/** The first system's bottom-line Y (the header sits above it). */
export const FIRST_SYSTEM_Y = 640;
export const SYSTEM_DROP = 100;

/** A chord symbol to print above the note it belongs to (take order). */
export interface TakePdfChord {
  index: number;
  name: string;
}

export interface TakePdfOptions {
  title?: string | null;
  /** The suggested chords, by note index, drawn above the staff. */
  chords?: ReadonlyArray<TakePdfChord> | null;
  /** Print the ABC source block (default true — it is the verification aid). */
  includeAbcSource?: boolean;
}

/** One note as the page lays it out. */
interface PlacedNote {
  index: number;
  /** The letter the staff spells for this pitch (the on-screen rule). */
  letter: StaffLetter;
  /** −1 flat, 0 natural, +1 sharp — what the note needs to sound. */
  alter: number;
  /** The key signature's own value for that letter. */
  keyAlter: number;
  /** True when the note is drawn with an explicit accidental mark. */
  marked: boolean;
  step: number;
  units: number;
  midi: number;
}

/** "1 2 3.5" — the shortest exact decimal PDF will accept. */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * EVERY STRING PUT IN THE PDF IS SANITISED. The standard-14 fonts are single-byte
 * and the content stream is written as bytes, so a curly quote or an em dash from
 * a label would corrupt the file's byte count. Mapped characters keep the text
 * readable; anything else becomes '?' — never a byte we cannot account for.
 */
export function pdfText(value: string): string {
  const map: Record<string, string> = {
    '·': '-',
    '—': '-',
    '–': '-',
    '’': "'",
    '‘': "'",
    '“': '"',
    '”': '"',
    '…': '...',
    '→': '->',
    '≥': '>=',
    '≤': '<=',
    '✦': '*',
    '✎': '+',
    '↶': 'undo',
    '↷': 'redo',
  };
  let out = '';
  for (const char of String(value ?? '')) {
    const code = char.charCodeAt(0);
    if (map[char] !== undefined) out += map[char];
    else if (code >= 32 && code <= 126) out += char;
    else out += '?';
  }
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** The diatonic step of a letter+octave (C4 = 28, E4 = 30, G4 = 32, …). */
export function diatonicStep(letter: StaffLetter, octave: number): number {
  return octave * 7 + STAFF_LETTERS.indexOf(letter);
}

/**
 * THE SPELLING RULE, THE SAME ONE THE SCREEN USES. `abcNoteToken` in takeStaff.ts
 * prefers the letter the key signature already spells for the pitch class and
 * falls back to the conventional sharp-side (or flat-side) spelling; this returns
 * the same letter and the same needed alteration so the PDF and the on-screen
 * staff can never spell one take two ways.
 */
export function staffSpellingFor(
  midi: number,
  signature: StaffKeySignature,
): { letter: StaffLetter; alter: number } {
  const value = ((Math.round(midi) % 12) + 12) % 12;
  for (const candidate of STAFF_LETTERS) {
    const altered =
      ((LETTER_PITCH_CLASS[candidate] + signature.accidentals[candidate]) % 12 + 12) % 12;
    if (altered === value) {
      return { letter: candidate, alter: signature.accidentals[candidate] };
    }
  }
  const spelled = spellPitchClass(value, signature.flats > 0);
  return {
    letter: spelled.letter,
    alter: spelled.accidental === '^' ? 1 : spelled.accidental === '_' ? -1 : 0,
  };
}

/** Every note of the take, spelled and timed the way the staff draws it. */
export function placedNotesFor(
  notes: ReadonlyArray<MidiNoteEvent>,
  signature: StaffKeySignature,
  eighthSec: number,
): PlacedNote[] {
  const ordered = (Array.isArray(notes) ? notes : [])
    .filter((note) => !!note && Number.isFinite(note?.midi))
    .slice()
    .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
  return ordered.map((note, index) => {
    const midi = Math.round(Number(note.midi));
    const spelling = staffSpellingFor(midi, signature);
    const keyAlter = signature.accidentals[spelling.letter];
    return {
      index,
      letter: spelling.letter,
      alter: spelling.alter,
      keyAlter,
      // A note the signature does not already cover is written with its mark —
      // the same rule the screen's ABC follows (one mark per note, no carried-over
      // bar state, so a printed page can never depend on a bar that came before).
      marked: spelling.alter !== keyAlter,
      step: diatonicStep(spelling.letter, midiOctave(midi)),
      units: durationUnits(Number(note.durationSec), eighthSec),
      midi,
    };
  });
}

// ─── Vector drawing ─────────────────────────────────────────────

/** A straight stroke. */
function stroke(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): string {
  return `${num(width)} w\n${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`;
}

/**
 * A filled or stroked ellipse from four cubic béziers, rotated — the notehead.
 * (0.5523 is the standard circle-to-bézier constant.)
 */
function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotationDegrees: number,
  mode: 'fill' | 'stroke',
): string {
  const k = 0.5523;
  const rot = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const point = (x: number, y: number): [number, number] => [
    cx + x * cos - y * sin,
    cy + x * sin + y * cos,
  ];
  const curve = (
    c1: [number, number],
    c2: [number, number],
    end: [number, number],
  ): string => {
    const [c1x, c1y] = point(c1[0], c1[1]);
    const [c2x, c2y] = point(c2[0], c2[1]);
    const [ex, ey] = point(end[0], end[1]);
    return `${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(ex)} ${num(ey)} c`;
  };
  const start = point(rx, 0);
  const parts = [
    `${num(start[0])} ${num(start[1])} m`,
    curve([rx, ry * k], [rx * k, ry], [0, ry]),
    curve([-rx * k, ry], [-rx, ry * k], [-rx, 0]),
    curve([-rx, -ry * k], [-rx * k, -ry], [0, -ry]),
    curve([rx * k, -ry], [rx, -ry * k], [rx, 0]),
    mode === 'fill' ? 'f' : 'S',
  ];
  return parts.join('\n');
}

/** A sharp, drawn as the four strokes a sharp really is. */
function sharp(x: number, y: number, height: number): string {
  const half = height / 2;
  const lean = height * 0.18;
  return [
    stroke(x - 1.8, y - half + lean, x - 1.8, y + half + lean, 0.7),
    stroke(x + 1.8, y - half - lean, x + 1.8, y + half - lean, 0.7),
    stroke(x - 3.4, y + 1.6, x + 3.4, y + 3.2, 1.5),
    stroke(x - 3.4, y - 3.2, x + 3.4, y - 1.6, 1.5),
  ].join('\n');
}

/** A flat: the stem plus its bowl, as one small curve. */
function flat(x: number, y: number, height: number): string {
  const half = height / 2;
  const bowl = height * 0.34;
  return [
    stroke(x + 2, y + half, x + 2, y - half, 0.8),
    `${num(x + 2)} ${num(y + bowl * 0.2)} m ` +
      `${num(x - 1.4)} ${num(y + bowl * 0.1)} ${num(x - 2.2)} ${num(y - bowl * 0.5)} ` +
      `${num(x - 1.2)} ${num(y - bowl)} c S`,
  ].join('\n');
}

/** Text at an absolute position (Tm, so no font-relative guessing). */
function text(
  font: 'F1' | 'F2' | 'F3',
  size: number,
  x: number,
  y: number,
  value: string,
  grey = 0,
): string {
  return (
    `${grey} ${grey} ${grey} rg\nBT /${font} ${num(size)} Tf ` +
    `1 0 0 1 ${num(x)} ${num(y)} Tm (${pdfText(value)}) Tj ET\n0 0 0 rg`
  );
}

/**
 * A treble clef, drawn the way a clef is drawn: the long stem with its hook, the
 * small loop on the G line, and the upper loop that fills the staff. It is a
 * stylised mark, not a font's glyph — the page's legend names the clef in words
 * so nothing depends on the reader recognising the shape.
 */
function trebleClef(x: number, bottomY: number): string {
  const stemTop = bottomY + STAFF_LINE_GAP * STAFF_LINE_COUNT;
  const loopY = bottomY + STAFF_LINE_GAP; // the G line
  return [
    // The stem: down through the staff, hooking left at the bottom.
    `${num(x + 1.5)} ${num(stemTop - 2)} m ` +
      `${num(x - 2.5)} ${num(stemTop - 16)} ${num(x - 4)} ${num(bottomY + 10)} ` +
      `${num(x - 1)} ${num(bottomY - 1)} c`,
    `${num(x + 2)} ${num(bottomY - 12)} ${num(x + 5)} ${num(bottomY + 2)} ` +
      `${num(x + 1)} ${num(bottomY + 5)} c S`,
    // The lower loop, sitting on the G line.
    ellipse(x + 1.5, loopY + 1, 3.4, 3.4, -10, 'stroke'),
    // The upper loop.
    ellipse(x - 0.5, bottomY + STAFF_LINE_GAP * 3.1, 4.2, 5, -10, 'stroke'),
  ].join('\n');
}

/** One system (staff + notes), drawn into the content stream. */
function systemOps(
  notes: PlacedNote[],
  opts: {
    signature: StaffKeySignature;
    bottomY: number;
    chords: ReadonlyArray<TakePdfChord>;
    showHeader: boolean;
  },
): string {
  const { bottomY, signature } = opts;
  const left = PDF_MARGIN;
  const right = PDF_PAGE_WIDTH - PDF_MARGIN;
  const notesX = left + STAFF_HEADER_WIDTH;
  const ops: string[] = ['0 0 0 RG'];
  for (let line = 0; line < STAFF_LINE_COUNT; line += 1) {
    const y = bottomY + line * STAFF_LINE_GAP;
    ops.push(stroke(left, y, right, y, line === 0 || line === STAFF_LINE_COUNT - 1 ? 1 : 0.6));
  }
  // The system's closing bar line.
  ops.push(
    stroke(right, bottomY, right, bottomY + STAFF_LINE_GAP * (STAFF_LINE_COUNT - 1), 0.9),
  );
  if (opts.showHeader) {
    ops.push(trebleClef(left + 12, bottomY));
    // Key signature: the sharps (or flats) of the signature, in the circle of fifths.
    const accidentalYByLetter: Record<StaffLetter, number> = {
      F: 5, // F5
      C: 4,
      G: 3,
      D: 4,
      A: 4.5,
      E: 5.5,
      B: 4.5,
    };
    let markerX = left + 42;
    for (const letter of STAFF_LETTERS) {
      const value = signature.accidentals[letter];
      if (value === 0) continue;
      const y = bottomY + accidentalYByLetter[letter] * STAFF_LINE_GAP * 0.5;
      ops.push(value > 0 ? sharp(markerX, y, 12) : flat(markerX, y, 12));
      markerX += 7;
    }
    // Time signature: 4 over 4, in the two halves of the staff.
    ops.push(text('F2', 13, notesX - 22, bottomY + STAFF_LINE_GAP * 1.6, '4'));
    ops.push(text('F2', 13, notesX - 22, bottomY + STAFF_LINE_GAP * 3.1, '4'));
  }

  // The notes.
  let barUnits = 0;
  notes.forEach((note, position) => {
    const x = notesX + position * NOTE_SPACING;
    const y = bottomY + (note.step - STAFF_BOTTOM_STEP) * STAFF_STEP;
    if (barUnits >= STAFF_BAR_UNITS) {
      ops.push(stroke(x - 13, bottomY, x - 13, bottomY + STAFF_LINE_GAP * 4, 0.7));
      barUnits = 0;
    }
    // The accidental mark, when the signature does not already cover the note.
    if (note.marked) {
      ops.push(
        note.alter > 0
          ? sharp(x - 11, y, 12)
          : note.alter < 0
            ? flat(x - 11, y, 12)
            : text('F2', 11, x - 15, y - 4, 'n'),
      );
    }
    // Ledger lines, above and below the staff.
    const topStep = STAFF_BOTTOM_STEP + (STAFF_LINE_COUNT - 1) * 2;
    if (note.step < STAFF_BOTTOM_STEP) {
      for (let step = STAFF_BOTTOM_STEP - 2; step >= note.step; step -= 2) {
        const ledgerY = bottomY + (step - STAFF_BOTTOM_STEP) * STAFF_STEP;
        ops.push(stroke(x - 9, ledgerY, x + 9, ledgerY, 0.8));
      }
    } else if (note.step > topStep) {
      for (let step = topStep + 2; step <= note.step; step += 2) {
        const ledgerY = bottomY + (step - STAFF_BOTTOM_STEP) * STAFF_STEP;
        ops.push(stroke(x - 9, ledgerY, x + 9, ledgerY, 0.8));
      }
    }
    // The head: hollow for a half note or longer, filled otherwise.
    const hollow = note.units >= 4;
    ops.push(ellipse(x, y, 4.6, 3.4, -20, hollow ? 'stroke' : 'fill'));
    // The stem, and a flag for anything shorter than a half note.
    if (note.units < 8) {
      const stemUp = note.step < STAFF_BOTTOM_STEP + 4;
      const stemX = stemUp ? x + 4.2 : x - 4.2;
      const stemEnd = stemUp
        ? y + STAFF_LINE_GAP * 3.5
        : y - STAFF_LINE_GAP * 3.5;
      ops.push(stroke(stemX, y, stemX, stemEnd, 1));
      if (note.units <= 2) {
        const flagDir = stemUp ? -1 : 1;
        ops.push(
          `${num(stemX)} ${num(stemEnd)} m ` +
            `${num(stemX + 6)} ${num(stemEnd + flagDir * 3)} ` +
            `${num(stemX + 8)} ${num(stemEnd + flagDir * 9)} ` +
            `${num(stemX + 5)} ${num(stemEnd + flagDir * 13)} c S`,
        );
      }
    }
    // The chord symbol for this note, above the staff.
    const chord = opts.chords.find((entry) => entry.index === note.index);
    if (chord && chord.name) {
      ops.push(text('F2', 9, x - 6, bottomY + STAFF_LINE_GAP * 6, chord.name));
    }
    barUnits += note.units;
  });

  return ops.join('\n');
}

/**
 * BUILD THE WHOLE PDF. Always returns bytes for a take with notes (a take with no
 * notes returns null — a blank staff would be a false claim). The result is
 * validated by `validateTakePdf` before it is written or shared.
 */
export function buildTakeNotationPdf(
  take: SavedCaptureTake | null | undefined,
  opts: TakePdfOptions = {},
): Uint8Array | null {
  const notes = Array.isArray(take?.notes) ? take.notes : [];
  const placed = placedNotesFor(notes, staffKeySignature(take?.key ?? null), eighthSecOf(take));
  if (placed.length === 0) return null;

  const signature = staffKeySignature(take?.key ?? null);
  const title = (opts.title ?? '').trim() || 'Your take';
  const chords = (Array.isArray(opts.chords) ? opts.chords : []).filter(
    (entry) => !!entry && Number.isFinite(entry.index) && !!entry.name,
  );
  const includeAbcSource = opts.includeAbcSource !== false;
  const tempo =
    typeof take?.tempoBpm === 'number' && take.tempoBpm > 0 ? Math.round(take.tempoBpm) : null;

  // Split the notes into systems.
  const systems: PlacedNote[][] = [];
  for (let at = 0; at < placed.length; at += NOTES_PER_SYSTEM) {
    systems.push(placed.slice(at, at + NOTES_PER_SYSTEM));
  }

  const pages: string[] = [];
  let ops: string[] = [];
  let systemIndex = 0;
  let pageIndex = 0;

  const startPage = (): void => {
    ops = [];
    pageIndex += 1;
    const headerY = PDF_PAGE_HEIGHT - 78;
    ops.push(text('F2', 17, PDF_MARGIN, headerY, title));
    ops.push(text('F1', 9, PDF_MARGIN, headerY - 15, TAKE_PDF_CAPTION));
    ops.push(text('F1', 9, PDF_MARGIN, headerY - 27, TAKE_PDF_LEGEND));
    const facts = [
      `${placed.length} note${placed.length === 1 ? '' : 's'}`,
      `key ${signature.label}`,
      tempo ? `${tempo} bpm` : 'tempo not measured',
    ];
    ops.push(text('F1', 9, PDF_MARGIN, headerY - 39, facts.join(' · ')));
  };

  startPage();
  let bottomY = FIRST_SYSTEM_Y;
  for (const system of systems) {
    if (systemIndex > 0 && systemIndex % SYSTEMS_PER_PAGE === 0) {
      pages.push(ops.join('\n'));
      startPage();
      bottomY = FIRST_SYSTEM_Y;
    }
    ops.push(
      systemOps(system, {
        signature,
        bottomY,
        chords,
        showHeader: true,
      }),
    );
    systemIndex += 1;
    bottomY -= SYSTEM_DROP;
  }

  // The ABC source block: the same string the on-screen staff is drawn from.
  if (includeAbcSource) {
    const abc = takeToAbc(notes, {
      signature,
      eighthSec: eighthSecOf(take),
      title,
      suffix: 'your take',
    });
    const lines = abc.split('\n');
    const needed = (lines.length + 2) * 11 + 20;
    if (bottomY - needed < 70) {
      pages.push(ops.join('\n'));
      startPage();
    }
    const blockTop = Math.max(70, bottomY - 12);
    ops.push(text('F1', 9, PDF_MARGIN, blockTop, TAKE_PDF_SOURCE_LABEL));
    lines.forEach((line, index) => {
      ops.push(
        text('F3', 9, PDF_MARGIN, blockTop - 12 - index * 11, line),
      );
    });
  }

  ops.push(
    text(
      'F1',
      8,
      PDF_MARGIN,
      40,
      `${TAKE_PDF_FOOTER}${take?.capturedAt ? ` · ${String(take.capturedAt).slice(0, 10)}` : ''}`,
    ),
  );
  ops.push(text('F1', 8, PDF_PAGE_WIDTH - PDF_MARGIN - 30, 40, `page ${pageIndex}`));
  pages.push(ops.join('\n'));

  return writePdf(pages);
}

/** The eighth-note duration for this take (the staff's own grid). */
export function eighthSecOf(take: SavedCaptureTake | null | undefined): number {
  const tempo =
    typeof take?.tempoBpm === 'number' && Number.isFinite(take.tempoBpm) && take.tempoBpm > 0
      ? take.tempoBpm
      : 100;
  return 30 / tempo;
}

/**
 * SERIALISE THE PAGE OBJECTS AS A REAL PDF FILE: header, the objects at known
 * byte offsets, the cross-reference table those offsets are read back from, the
 * trailer, and the startxref pointer. Every byte is accounted for.
 */
export function writePdf(pages: ReadonlyArray<string>): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalogNumber = add('');
  const pagesNumber = add('');
  const fontNumbers = {
    F1: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    F2: add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ),
    F3: add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'),
  };

  const pageNumbers: number[] = [];
  const contents: { number: number; body: string }[] = [];
  for (const content of pages) {
    const pageNumber = add('');
    pageNumbers.push(pageNumber);
    const stream = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    contents.push({ number: add(stream), body: content });
  }

  objects[catalogNumber - 1] = `<< /Type /Catalog /Pages ${pagesNumber} 0 R >>`;
  objects[pagesNumber - 1] =
    `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] ` +
    `/Count ${pageNumbers.length} >>`;
  pageNumbers.forEach((pageNumber, index) => {
    objects[pageNumber - 1] =
      `<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontNumbers.F1} 0 R /F2 ${fontNumbers.F2} 0 R ` +
      `/F3 ${fontNumbers.F3} 0 R >> >> /Contents ${contents[index].number} 0 R >>`;
  });

  let out = `%PDF-${PDF_VERSION}\n`;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNumber} 0 R >>\n`;
  out += `startxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

// ─── Reading the bytes back ─────────────────────────────────────

export interface TakePdfStructureReport {
  ok: boolean;
  errors: string[];
  version: string | null;
  objectCount: number;
  pageCount: number;
  declaredPageCount: number | null;
  xrefEntries: number;
  startxref: number | null;
  totalBytes: number;
  /** Bytes of content streams the file declares. */
  streamBytes: number;
}

function asciiOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] & 0xff);
  return out;
}

/**
 * PARSE THE PDF WE WROTE AND SAY WHAT IS WRONG WITH IT. Walks the real layout —
 * header, the objects at their declared offsets, each stream's declared /Length,
 * the cross-reference table (whose offsets must point AT `N 0 obj`), the trailer
 * and the startxref pointer — and never throws: a truncated or corrupt file comes
 * back as a report the caller (and a test) can read and refuse.
 */
export function parseTakePdfStructure(
  bytes: Uint8Array | null | undefined,
): TakePdfStructureReport {
  const data = bytes && typeof bytes.length === 'number' ? bytes : new Uint8Array(0);
  const report: TakePdfStructureReport = {
    ok: false,
    errors: [],
    version: null,
    objectCount: 0,
    pageCount: 0,
    declaredPageCount: null,
    xrefEntries: 0,
    startxref: null,
    totalBytes: data.length,
    streamBytes: 0,
  };
  const fail = (message: string): TakePdfStructureReport => {
    report.errors.push(message);
    report.ok = false;
    return report;
  };

  if (data.length < 64) return fail('file is too short to be a PDF');
  const text = asciiOf(data);
  if (!text.startsWith('%PDF-')) return fail('file does not start with a %PDF- header');
  report.version = text.slice(5, 8);
  if (!/^1\.[0-9]$/.test(report.version)) {
    fail(`header version "${report.version}" is not a PDF 1.x version`);
  }
  const eofAt = text.lastIndexOf('%%EOF');
  if (eofAt < 0) return fail('file has no %%EOF trailer marker');
  if (text.slice(eofAt + 5).trim().length > 0) {
    fail(`${text.length - (eofAt + 5)} byte(s) after %%EOF`);
  }

  /**
   * The `xref` TABLE keyword, found as a keyword — `startxref` also contains the
   * letters "xref", so a plain search for them would read the pointer as the
   * table (and every offset check after it would be nonsense).
   */
  const xrefLine = text.lastIndexOf('\nxref\n');
  const xrefKeyword = xrefLine < 0 ? -1 : xrefLine + 1;
  if (xrefKeyword < 0) return fail('file has no cross-reference table');
  const startxrefAt = text.lastIndexOf('startxref');
  if (startxrefAt < 0) return fail('file has no startxref pointer');
  else {
    const value = Number.parseInt(text.slice(startxrefAt + 9).trim(), 10);
    report.startxref = Number.isFinite(value) ? value : null;
    if (!Number.isFinite(value)) fail('startxref pointer is not a number');
    else if (value !== xrefKeyword) {
      fail(`startxref points at byte ${value}, the xref table is at ${xrefKeyword}`);
    }
  }

  // The cross-reference table: every entry's offset must land on its object.
  const xrefBody = text.slice(xrefKeyword);
  const header = /^xref\s+0\s+(\d+)\s/.exec(xrefBody);
  if (!header) return fail('cross-reference table header is malformed');
  const declared = Number.parseInt(header[1], 10);
  report.xrefEntries = declared;
  const entryStart = xrefKeyword + header[0].length;
  const free = text.slice(entryStart, entryStart + 20);
  if (!/^0000000000 65535 f/.test(free)) {
    fail('the first cross-reference entry is not the free object');
  }
  for (let index = 1; index < declared; index += 1) {
    const entry = text.slice(entryStart + index * 20, entryStart + index * 20 + 20);
    const match = /^(\d{10}) (\d{5}) n/.exec(entry);
    if (!match) {
      fail(`cross-reference entry ${index} is malformed`);
      continue;
    }
    const offset = Number.parseInt(match[1], 10);
    const at = text.slice(offset, offset + 24);
    if (!at.startsWith(`${index} 0 obj`)) {
      fail(
        `cross-reference entry ${index} points at byte ${offset}, which does not start object ${index}`,
      );
      continue;
    }
    report.objectCount += 1;
  }
  if (report.objectCount !== declared - 1) {
    fail(
      `cross-reference table declares ${declared - 1} object(s), found ${report.objectCount}`,
    );
  }

  // The trailer must name the catalog, and the catalog must name its pages.
  const trailer = /trailer\s*<<([^>]*)>>/.exec(text);
  if (!trailer) return fail('file has no trailer dictionary');
  const rootMatch = /\/Root (\d+) 0 R/.exec(trailer[1]);
  if (!rootMatch) return fail('trailer names no /Root catalog');
  const rootOffset = text.indexOf(`${rootMatch[1]} 0 obj`);
  if (rootOffset < 0) return fail('the trailer’s /Root object is not in the file');
  const rootBody = text.slice(rootOffset, text.indexOf('endobj', rootOffset));
  if (rootBody.indexOf('/Type /Catalog') < 0) {
    fail(`object ${rootMatch[1]} is not a /Type /Catalog`);
  }
  const pagesRef = /\/Pages (\d+) 0 R/.exec(rootBody);
  if (!pagesRef) return fail('the catalog names no /Pages tree');
  const pagesOffset = text.indexOf(`${pagesRef[1]} 0 obj`);
  if (pagesOffset < 0) return fail('the catalog’s /Pages object is not in the file');
  const pagesEnd = text.indexOf('endobj', pagesOffset);
  const pagesBody = text.slice(pagesOffset, pagesEnd);
  if (pagesBody.indexOf('/Type /Pages') < 0) fail('the /Pages object is not a /Type /Pages');
  const count = /\/Count (\d+)/.exec(pagesBody);
  report.declaredPageCount = count ? Number.parseInt(count[1], 10) : null;
  const kids = /\/Kids \[([^\]]*)\]/.exec(pagesBody);
  const kidCount = kids ? kids[1].split('R').filter((part) => part.trim().length > 0).length : 0;
  if (report.declaredPageCount === null) fail('the /Pages object declares no /Count');
  if (report.declaredPageCount !== kidCount) {
    fail(`/Count is ${report.declaredPageCount}, /Kids lists ${kidCount} page(s)`);
  }
  report.pageCount = kidCount;

  // Every page object, and every content stream's declared /Length.
  const pageRefs = [...text.matchAll(/\/Type \/Page[^s]/g)].length;
  if (pageRefs !== kidCount) {
    fail(`found ${pageRefs} /Type /Page object(s) but /Kids lists ${kidCount}`);
  }
  const streams = [...text.matchAll(/<< \/Length (\d+) >>\s*stream\n/g)];
  if (streams.length === 0) return fail('file holds no content stream');
  for (const stream of streams) {
    const declaredLength = Number.parseInt(stream[1], 10);
    const start = (stream.index ?? 0) + stream[0].length;
    const end = text.indexOf('\nendstream', start);
    if (end < 0) {
      fail('a content stream is not terminated');
      continue;
    }
    if (end - start !== declaredLength) {
      fail(
        `a content stream declares ${declaredLength} bytes but holds ${end - start}`,
      );
      continue;
    }
    report.streamBytes += declaredLength;
  }
  if (streams.length !== kidCount) {
    fail(`file holds ${streams.length} content stream(s) for ${kidCount} page(s)`);
  }

  report.ok = report.errors.length === 0;
  return report;
}

/** The one-line verdict the export gates on, plus the report for the message. */
export function validateTakePdf(bytes: Uint8Array | null | undefined): {
  ok: boolean;
  errors: string[];
  report: TakePdfStructureReport;
} {
  const report = parseTakePdfStructure(bytes);
  return { ok: report.ok, errors: report.errors, report };
}

/** Where a note sits vertically on a system (its own step position, in points). */
export function staffYForStep(step: number, bottomY: number): number {
  return bottomY + (step - STAFF_BOTTOM_STEP) * STAFF_STEP;
}

/**
 * THE BOUNDING BOX OF EVERYTHING DRAWN IN A CONTENT STREAM — the pure check that
 * nothing this page draws lands off the paper. Every drawing operator in the
 * generated stream moves to, or curves through, absolute points (`x y m`,
 * `x y l`, and the six numbers of a `c` curve); a coordinate outside the page box
 * means a note the reader never sees. Text positions (`Tm`) are checked too, so a
 * caption cannot run off the right edge unnoticed.
 */
export function contentBounds(content: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  points: number;
  /** Points that fall outside the page rectangle. */
  outside: number;
} {
  const numbers = (snippet: string): number[] => {
    const out: number[] = [];
    const re = /-?\d+(?:\.\d+)?/g;
    let match = re.exec(snippet);
    while (match) {
      out.push(Number.parseFloat(match[0]));
      match = re.exec(snippet);
    }
    return out;
  };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let points = 0;
  let outside = 0;
  const consider = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    points += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (x < 0 || y < 0 || x > PDF_PAGE_WIDTH || y > PDF_PAGE_HEIGHT) outside += 1;
  };
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Every absolute point a drawing operator moves to or curves through.
    const move = /(-?[\d.]+) (-?[\d.]+) m(?:\s|$)/.exec(trimmed);
    if (move) consider(Number.parseFloat(move[1]), Number.parseFloat(move[2]));
    const lineTo = /(-?[\d.]+) (-?[\d.]+) l(?:\s|$)/.exec(trimmed);
    if (lineTo) consider(Number.parseFloat(lineTo[1]), Number.parseFloat(lineTo[2]));
    if (/ c(?:\s|$)/.test(trimmed)) {
      const coords = numbers(trimmed.split(' c')[0]);
      for (let at = 0; at + 1 < coords.length; at += 2) consider(coords[at], coords[at + 1]);
    }
    // …and every text anchor, so a caption cannot run off the paper either.
    const anchor = /(-?[\d.]+) (-?[\d.]+) Tm/.exec(trimmed);
    if (anchor) consider(Number.parseFloat(anchor[1]), Number.parseFloat(anchor[2]));
  }
  return {
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    maxX: Number.isFinite(maxX) ? maxX : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
    points,
    outside,
  };
}

/**
 * File name for the take PDF: `<safe title>.pdf`, the SAME convention and the same
 * sanitising as the MIDI export's `midiFileName` (never empty, never a path), so
 * the two files a user sends sit side by side in a mail app.
 */
export function takePdfFileName(title?: string | null): string {
  const base =
    typeof title === 'string'
      ? title
          .replace(/[^A-Za-z0-9 _.-]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  const safe = base.length > 0 ? base.slice(0, 60) : 'notesnap-take';
  return `${safe}.pdf`;
}

/** The sentence the screen shows after a PDF was handed over. */
export function exportedTakePdfMessage(take: SavedCaptureTake | null | undefined): string {
  const count = Array.isArray(take?.notes) ? take!.notes.length : 0;
  return `Saved your take (${count} note${count === 1 ? '' : 's'}) as a PDF and opened the share sheet.`;
}
