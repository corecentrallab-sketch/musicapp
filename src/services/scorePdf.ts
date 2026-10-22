/**
 * scorePdf.ts — THE TRANSPOSED FULL SCORE AS A REAL PDF (v44 slice C, owner
 * 10-24 checklist 4.1: "If I want to see the full score as transposed - or to
 * print it out/share it out as pdf etc - it is not there - fix into v44").
 *
 * WHAT THIS IS. The reader (`TransposedScoreReaderScreen`) shows the transposed
 * score the user chose. This module takes THE SAME ABC STRING — the one on
 * screen, in the key the user stepped to — and writes a multi-page vector PDF of
 * THE WHOLE SCORE, every bar, and hands nothing else to the caller. The file is
 * named honestly (`scorePdfFileName`) and its footer says where the notation
 * came from ("Transposed from NoteSnap's public-domain library"). It never
 * claims to be an edition, a publisher's engraving or anything else.
 *
 * NO VIEWING CAP, BY CONSTRUCTION. The on-screen reader has a VIEWPORT (its
 * WebView shows as much as the screen is tall); the PDF has no viewport at all.
 * It lays out every measure the ABC holds, then paginates. There is no count,
 * no slice and no "first N bars" parameter in this module — the only way to get
 * fewer bars in the PDF is to hand in an ABC with fewer bars.
 *
 * WHY IT DRAWS THE NOTATION ITSELF INSTEAD OF PRINTING THE WEBVIEW. The app's
 * on-screen renderer is abcjs inside a WebView (v43 slice 2 inlined it offline).
 * Turning that WebView into a PDF needs a native HTML-to-PDF module (expo-print)
 * that is NOT in this binary — adding it means a native rebuild, and a slice that
 * has to rebuild the app cannot be verified on this box. So this module follows
 * the app's OWN established PDF path (`takeNotationPdf.ts`, v37 item 7a, proven
 * on device by the take export): a deterministic vector writer, in pure
 * TypeScript, whose bytes are parsed back by `parseTakePdfStructure` before
 * anything is shared. Every glyph is a line, a curve or a text run we wrote.
 *
 * WHAT THE PAGE DRAWS (and what it deliberately does not). It is a single-staff
 * MELODY engraving, the same thing the bundled ABC is: an honest length line on
 * the header says "melody line". It draws the staff, the treble clef, the key
 * signature of the key the score is now in, the time signature, one notehead per
 * note (chords stacked), stems and flags, accidentals as written in the ABC,
 * ledger lines, barlines, and whole/half rests. It does NOT draw beams, slurs,
 * ties, dynamics or ornaments — those are not in this engraver, and the header
 * line says "treble staff, melody line" rather than pretending otherwise.
 *
 * PURE: no react, no react-native, no expo, no fs, no network. Compiles and runs
 * under tsconfig.tier1.json (the same rule `takeNotationPdf.ts` follows), so the
 * gate can build every bundled score's PDF and read it back.
 */
import {
  PDF_MARGIN,
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
  contentBounds,
  hasPdfHeaderAtByteZero,
  parseTakePdfStructure,
  pdfText,
  writePdf,
  type TakePdfStructureReport,
} from './takeNotationPdf';

// ─── The words the surfaces render ───────────────────────────────

/** The control in the reader's footer. Says print AND share: both are the ask. */
export const SCORE_PDF_CTA = 'Print / share as PDF';
/** The control while the file is being built and handed over. */
export const SCORE_PDF_BUSY_LINE = 'Building the PDF…';
/** What the control does, said once, honestly (the owner's own words). */
export const SCORE_PDF_HINT =
  'The whole score — every bar — in the key you are reading, as a PDF you can print or send.';

/** THE HONEST FOOTER, printed at the foot of every page. */
export const SCORE_PDF_FOOTER =
  "Transposed from NoteSnap's public-domain library";
/** The line under the title: what the page is, and what it is not. */
export const SCORE_PDF_NOT_EDITION_LINE =
  'Rendered by NoteSnap from its own public-domain score data - not a published edition.';
/** How the notation is drawn, said out loud (a single treble staff melody). */
export const SCORE_PDF_ENGRAVING_LINE = 'Treble staff, melody line, every bar of the score.';

/** Said when the PDF we built does not parse — we never hand over a broken file. */
export const SCORE_PDF_STRUCTURE_INVALID_MESSAGE =
  'The PDF we built did not pass its own structure check, so we did not hand it over. Please try again.';
/** Said when the file could not be written or the share sheet could not open. */
export const SCORE_PDF_FAILED_MESSAGE = 'We could not save the PDF just now. Please try again.';
/** Said when this device has no share sheet to hand a file to. */
export const SCORE_PDF_UNAVAILABLE_MESSAGE =
  'Printing and PDF sharing need the system share sheet, which is not available on this device right now.';
/** Said when the score holds no music (a blank page would be a lie). */
export const SCORE_PDF_EMPTY_MESSAGE = 'There is no PDF to write for this score — it holds no notes.';
/** The MIME type the share sheet receives. */
export const SCORE_PDF_MIME_TYPE = 'application/pdf';

// ─── ABC: letters, keys, meters ─────────────────────────────────

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
type Letter = (typeof LETTERS)[number];
const LETTER_INDEX: Record<Letter, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const LETTER_NAMES: readonly Letter[] = LETTERS;
/** The treble staff's bottom line is E4 — two steps above middle C. */
const STAFF_BOTTOM_STEP = 30;

/** sharps (positive) or flats (negative) in order of appearance. */
const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** The conventional key signatures, as a count of sharps (+) or flats (−). */
const KEY_ACCIDENTAL_COUNT: Record<string, number> = {
  CB: -7, GB: -6, DB: -5, AB: -4, EB: -3, BB: -2, F: -1,
  C: 0,
  G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  // minor keys carry their relative major's signature
  ABM: -7, EBM: -6, BBM: -5, FM: -4, CM: -3, GM: -2, DM: -1,
  AM: 0, EM: 1, BM: 2, 'F#M': 3, 'C#M': 4, 'G#M': 5, 'D#M': 6, 'A#M': 7,
};

export interface ScoreKeySignature {
  /** The `K:` label exactly as the ABC wrote it ("Am", "Bb", "F#m"). */
  label: string;
  /** +n sharps, −n flats, 0 for C/Am. */
  accidentals: number;
  /** Per-letter alteration the key signature puts on the staff. */
  byLetter: Record<Letter, number>;
}

/**
 * The key signature of an ABC `K:` field. The label is kept verbatim (that is
 * what the user reads on the chip and in the file name); the accidentals are the
 * conventional ones for that tonic, so the printed signature and the noteheads
 * can never disagree about which notes are already altered.
 */
export function abcKeySignature(keyField: unknown): ScoreKeySignature {
  const raw = typeof keyField === 'string' ? keyField.trim() : '';
  const label = raw.length > 0 ? raw : 'C';
  // "K:Bb clef=treble" / "K:F#m mixolydian" — the tonic is the first word.
  const tonic = label.split(/\s+/)[0] ?? 'C';
  const lookup = tonic.replace(/♭/g, 'b').replace(/♯/g, '#').toUpperCase();
  const count = KEY_ACCIDENTAL_COUNT[lookup] ?? 0;
  const byLetter: Record<Letter, number> = {
    C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0,
  };
  const order = count >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(count) && i < order.length; i += 1) {
    byLetter[order[i]] = count >= 0 ? 1 : -1;
  }
  return { label: tonic, accidentals: count, byLetter };
}

export interface ScoreMeter {
  /** Beats per bar. */
  beats: number;
  /** The note value that gets the beat (4 = quarter note). */
  unit: number;
}

/** `M:4/4`, `M:C` (4/4) and `M:C|` (2/2) — the score's own meter. */
export function abcMeter(meterField: unknown): ScoreMeter {
  const raw = typeof meterField === 'string' ? meterField.trim() : '';
  if (/^C\|$/.test(raw)) return { beats: 2, unit: 2 };
  if (/^C$/.test(raw)) return { beats: 4, unit: 4 };
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
  if (match) {
    const beats = Number.parseInt(match[1], 10);
    const unit = Number.parseInt(match[2], 10);
    if (Number.isFinite(beats) && Number.isFinite(unit) && beats > 0 && unit > 0) {
      return { beats, unit };
    }
  }
  return { beats: 4, unit: 4 };
}

/** `L:1/8` → the default note length in eighth-note units (1/8 → 1, 1/4 → 2). */
export function abcDefaultUnits(lengthField: unknown): number {
  const raw = typeof lengthField === 'string' ? lengthField.trim() : '';
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
  if (!match) return 1;
  const numerator = Number.parseInt(match[1], 10);
  const denominator = Number.parseInt(match[2], 10);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 1;
  const value = (numerator / denominator) * 8;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

// ─── The parsed score ───────────────────────────────────────────

/** One note, rest or chord member, as the ABC wrote it. */
export interface ScoreEvent {
  rest: boolean;
  letter: Letter | null;
  /** Scientific octave (C4 = middle C). */
  octave: number;
  /** The accidental WRITTEN on this note (null when the token carried none). */
  accidental: number | null;
  /** Length in eighth-note units (fractional values allowed). */
  units: number;
  dotted: boolean;
  /** 1 for a single note, 2+ when it belongs to a bracketed chord. */
  chordSize: number;
  /** Position inside its chord (0 = bottom). */
  chordIndex: number;
  /** The token this came from, kept for the gate's provenance checks. */
  token: string;
}

export interface ScoreMeasure {
  /** 1-based bar number, in score order. */
  number: number;
  events: ScoreEvent[];
}

export interface ParsedAbcScore {
  title: string;
  composer: string;
  key: ScoreKeySignature;
  meter: ScoreMeter;
  defaultUnits: number;
  measures: ScoreMeasure[];
  noteCount: number;
}

const NOTE_TOKEN = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)(\d*\/?\d*|\/+\d*)?/;
const REST_TOKEN = /^([zZxX])(\d*\/?\d*|\/+\d*)?/;
const FIELD_LINE = /^([A-Za-z]):\s*(.*)$/;

/** Read the `X:`/`T:`/`C:`/`M:`/`L:`/`K:` header, once. */
function readHeader(abc: string): {
  title: string;
  composer: string;
  keyField: string;
  meterField: string;
  lengthField: string;
  bodyStart: number;
} {
  const lines = abc.split(/\r?\n/);
  let title = '';
  let composer = '';
  let keyField = 'C';
  let meterField = '4/4';
  let lengthField = '1/8';
  let bodyStart = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    if (line.startsWith('%')) continue;
    const field = FIELD_LINE.exec(line);
    if (!field) {
      bodyStart = i;
      break;
    }
    const name = field[1];
    const value = field[2].trim();
    if (name === 'T') title = value;
    else if (name === 'C') composer = value;
    else if (name === 'K') {
      keyField = value;
      // ABC v2.1: the header ends at `K:`; the music starts on the next line.
      bodyStart = i + 1;
      break;
    } else if (name === 'M') meterField = value;
    else if (name === 'L') lengthField = value;
  }
  return { title, composer, keyField, meterField, lengthField, bodyStart };
}

/** The length multiplier written after a note (`2`, `/2`, `3/2`, `//`). */
function readMultiplier(text: string): number {
  if (text.length === 0) return 1;
  if (/^\/+$/.test(text)) return 1 / Math.pow(2, text.length);
  const match = /^(\d*)(?:\/(\d*))?$/.exec(text);
  if (!match) return 1;
  const numerator = match[1].length > 0 ? Number.parseInt(match[1], 10) : 1;
  const denominator = match[2] !== undefined && match[2].length > 0
    ? Number.parseInt(match[2], 10)
    : 1;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 1;
  const value = numerator / denominator;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Dotted lengths (1.5× the plain value) are printed with a dot. */
function isDottedMultiplier(text: string, multiplier: number): boolean {
  if (text.length === 0) return false;
  const whole = Math.round(multiplier);
  return whole > 0 && Math.abs(multiplier - whole * 1.5) < 1e-9;
}

/**
 * PARSE THE ABC INTO MEASURES. Everything the engraver needs comes from here,
 * and nothing is skipped silently: `|`, `||`, `|]`, `|:`, `:|`, `::`, `[1`/`[2`
 * endings and `[|` all end a measure (they are bar lines, not music), a bracketed
 * chord is ONE onset with stacked noteheads, and a trailing partial bar still
 * counts as a bar.
 */
export function parseAbcScore(abc: unknown): ParsedAbcScore {
  const text = typeof abc === 'string' ? abc : '';
  const header = readHeader(text);
  const key = abcKeySignature(header.keyField);
  const meter = abcMeter(header.meterField);
  const defaultUnits = abcDefaultUnits(header.lengthField);

  const measures: ScoreMeasure[] = [];
  let current: ScoreEvent[] = [];
  const closeMeasure = (): void => {
    if (current.length === 0) return;
    measures.push({ number: measures.length + 1, events: current });
    current = [];
  };

  const lines = text.split(/\r?\n/).slice(header.bodyStart);
  for (const rawLine of lines) {
    let line = rawLine.replace(/%.*$/, '').replace(/"[^"]*"/g, ' ');
    line = line.replace(/!\w+!/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\+[^+]*\+/g, ' ');
    line = line.replace(/\[[A-Za-z]:[^\]]*\]/g, ' ');
    let at = 0;
    while (at < line.length) {
      const rest = line.slice(at);
      // Bar lines and repeat/final markers: a measure boundary, never music.
      const bar = /^(\|\]|\|\||\[\||\|:|\|::|::|:\||\|)/.exec(rest);
      if (bar) {
        closeMeasure();
        at += bar[1].length;
        continue;
      }
      if (rest[0] === '[' && /^\[\d/.test(rest)) {
        at += 2;
        continue;
      }
      if (rest[0] === '[') {
        const close = line.indexOf(']', at);
        if (close < 0) break;
        const inner = line.slice(at + 1, close);
        const members: ScoreEvent[] = [];
        let cursor = 0;
        while (cursor < inner.length) {
          const note = NOTE_TOKEN.exec(inner.slice(cursor));
          if (!note) {
            cursor += 1;
            continue;
          }
          members.push(buildEvent(note, defaultUnits, inner.slice(cursor, cursor + note[0].length)));
          cursor += note[0].length;
        }
        if (members.length > 0) {
          members.forEach((member, index) => {
            member.chordSize = members.length;
            member.chordIndex = index;
            current.push(member);
          });
        }
        at = close + 1;
        continue;
      }
      const note = NOTE_TOKEN.exec(rest);
      if (note) {
        current.push(buildEvent(note, defaultUnits, note[0]));
        at += note[0].length;
        continue;
      }
      const restToken = REST_TOKEN.exec(rest);
      if (restToken) {
        const multiplier = readMultiplier(restToken[2] ?? '');
        const wholeBar = /^[ZX]$/.test(restToken[1]);
        current.push({
          rest: true,
          letter: null,
          octave: 4,
          accidental: null,
          units: wholeBar ? meter.beats * (8 / meter.unit) : defaultUnits * multiplier,
          dotted: isDottedMultiplier(restToken[2] ?? '', multiplier),
          chordSize: 1,
          chordIndex: 0,
          token: restToken[0],
        });
        at += restToken[0].length;
        continue;
      }
      at += 1;
    }
    // A bar line carries over a line break in ABC: the music continues, so an
    // unterminated measure is only closed by the `|` that follows it.
  }
  closeMeasure();

  let noteCount = 0;
  for (const measure of measures) {
    for (const event of measure.events) if (!event.rest) noteCount += 1;
  }
  return { title: header.title, composer: header.composer, key, meter, defaultUnits, measures, noteCount };
}

/** One note token → one event. */
function buildEvent(note: RegExpExecArray, defaultUnits: number, token: string): ScoreEvent {
  const accidentalText = note[1] ?? '';
  const letterRaw = note[2];
  const octaveMarks = note[3] ?? '';
  const multiplier = readMultiplier(note[4] ?? '');
  const letter = letterRaw.toUpperCase() as Letter;
  let octave = /[a-g]/.test(letterRaw) ? 5 : 4;
  for (const mark of octaveMarks) octave += mark === ',' ? -1 : 1;
  const accidental =
    accidentalText.length === 0
      ? null
      : accidentalText[0] === '^'
        ? accidentalText.length
        : accidentalText[0] === '_'
          ? -accidentalText.length
          : 0;
  return {
    rest: false,
    letter,
    octave,
    accidental,
    units: defaultUnits * multiplier,
    dotted: isDottedMultiplier(note[4] ?? '', multiplier),
    chordSize: 1,
    chordIndex: 0,
    token,
  };
}

// ─── The page geometry ──────────────────────────────────────────

/** Space between two staff lines (a diatonic step is half of it). */
export const PDF_STAFF_GAP = 7;
const STAFF_STEP = PDF_STAFF_GAP / 2;
const STAFF_LINES = 5;
/** Room reserved for the clef (and the key signature) at the start of a system. */
const CLEF_WIDTH = 26;
const KEY_WIDTH = 8;
const TIME_WIDTH = 22;
/** The first system's bottom staff line, and the drop to the next one. */
const FIRST_SYSTEM_Y = 656;
const SYSTEM_DROP = 84;
const SYSTEMS_PER_PAGE = 7;
/** Horizontal room one note event needs before the measures wrap. */
const NOTE_SLOT = 15;
/** A measure's own minimum width (its bar line plus breathing room). */
const MEASURE_MIN_WIDTH = 40;

interface PlacedEvent {
  event: ScoreEvent;
  x: number;
}

interface PlacedMeasure {
  measure: ScoreMeasure;
  startX: number;
  endX: number;
  events: PlacedEvent[];
}

// ─── Drawing primitives (the same low-level style as takeNotationPdf) ──

function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function stroke(x1: number, y1: number, x2: number, y2: number, width: number): string {
  return `${num(width)} w\n${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`;
}

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
  const curve = (c1: [number, number], c2: [number, number], end: [number, number]): string => {
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

function sharpMark(x: number, y: number, height: number): string {
  const half = height / 2;
  const lean = height * 0.18;
  return [
    stroke(x - 1.8, y - half + lean, x - 1.8, y + half + lean, 0.7),
    stroke(x + 1.8, y - half - lean, x + 1.8, y + half - lean, 0.7),
    stroke(x - 3.4, y + 1.6, x + 3.4, y + 3.2, 1.5),
    stroke(x - 3.4, y - 3.2, x + 3.4, y - 1.6, 1.5),
  ].join('\n');
}

function flatMark(x: number, y: number, height: number): string {
  const half = height / 2;
  const bowl = height * 0.34;
  return [
    stroke(x + 2, y + half, x + 2, y - half, 0.8),
    `${num(x + 2)} ${num(y + bowl * 0.2)} m ` +
      `${num(x - 1.4)} ${num(y + bowl * 0.1)} ${num(x - 2.2)} ${num(y - bowl * 0.5)} ` +
      `${num(x - 1.2)} ${num(y - bowl)} c S`,
  ].join('\n');
}

function naturalMark(x: number, y: number, height: number): string {
  const half = height / 2;
  return [
    stroke(x - 1.6, y - half, x - 1.6, y + half * 0.7, 0.8),
    stroke(x + 1.6, y - half * 0.7, x + 1.6, y + half, 0.8),
    stroke(x - 1.6, y - half * 0.2, x + 1.6, y - half * 0.5, 1.2),
    stroke(x - 1.6, y + half * 0.5, x + 1.6, y + half * 0.2, 1.2),
  ].join('\n');
}

/** Text at an absolute position. F1 = Helvetica, F2 = Helvetica-Bold. */
function textOp(
  font: 'F1' | 'F2',
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

/** A stylised treble clef (the mark, drawn — never a font glyph). */
function trebleClef(x: number, bottomY: number): string {
  const stemTop = bottomY + PDF_STAFF_GAP * STAFF_LINES;
  const loopY = bottomY + PDF_STAFF_GAP; // the G line
  return [
    `${num(x + 1.5)} ${num(stemTop - 2)} m ` +
      `${num(x - 2.5)} ${num(stemTop - 14)} ${num(x - 4)} ${num(bottomY + 9)} ` +
      `${num(x - 1)} ${num(bottomY - 1)} c`,
    `${num(x + 2)} ${num(bottomY - 11)} ${num(x + 5)} ${num(bottomY + 2)} ` +
      `${num(x + 1)} ${num(bottomY + 4)} c S`,
    ellipse(x + 1.5, loopY + 1, 3.2, 3.2, -10, 'stroke'),
    ellipse(x - 0.5, bottomY + PDF_STAFF_GAP * 3.1, 3.9, 4.6, -10, 'stroke'),
  ].join('\n');
}

/** A staff, from `left` to `right`, with its bar lines. */
function staffLines(left: number, right: number, bottomY: number): string {
  const ops: string[] = ['0 0 0 RG'];
  for (let line = 0; line < STAFF_LINES; line += 1) {
    const y = bottomY + line * PDF_STAFF_GAP;
    ops.push(stroke(left, y, right, y, line === 0 || line === STAFF_LINES - 1 ? 1 : 0.6));
  }
  return ops.join('\n');
}

/** The key signature, right after the clef. */
function keySignatureOps(key: ScoreKeySignature, x: number, bottomY: number): string {
  const ops: string[] = [];
  const yByLetter: Record<Letter, number> = { F: 5, C: 5.5, G: 4.5, D: 5, A: 4, E: 5, B: 4.5 };
  let markerX = x;
  for (const letter of LETTER_NAMES) {
    const value = key.byLetter[letter];
    if (value === 0) continue;
    const y = bottomY + (yByLetter[letter] - 0.5) * PDF_STAFF_GAP;
    ops.push(value > 0 ? sharpMark(markerX, y, 11) : flatMark(markerX, y, 11));
    markerX += KEY_WIDTH * 0.85;
  }
  return ops.join('\n');
}

/** One notehead, stem, flag, ledger lines and accidental. */
function noteOps(
  placed: PlacedEvent,
  key: ScoreKeySignature,
  bottomY: number,
): string {
  const { event, x } = placed;
  if (event.rest) return restOps(event, x, bottomY);
  const letter = event.letter ?? 'C';
  const step = event.octave * 7 + LETTER_INDEX[letter];
  const y = bottomY + (step - STAFF_BOTTOM_STEP) * STAFF_STEP;
  const ops: string[] = [];
  const topStep = STAFF_BOTTOM_STEP + (STAFF_LINES - 1) * 2;
  // Ledger lines, above and below the staff.
  if (step < STAFF_BOTTOM_STEP) {
    for (let ledger = STAFF_BOTTOM_STEP - 2; ledger >= step; ledger -= 2) {
      const ledgerY = bottomY + (ledger - STAFF_BOTTOM_STEP) * STAFF_STEP;
      ops.push(stroke(x - 9, ledgerY, x + 9, ledgerY, 0.8));
    }
  } else if (step > topStep) {
    for (let ledger = topStep + 2; ledger <= step; ledger += 2) {
      const ledgerY = bottomY + (ledger - STAFF_BOTTOM_STEP) * STAFF_STEP;
      ops.push(stroke(x - 9, ledgerY, x + 9, ledgerY, 0.8));
    }
  }
  // The accidental the ABC wrote, when the signature does not already say it.
  if (event.accidental !== null) {
    const keyValue = key.byLetter[letter];
    if (event.accidental === 0) ops.push(naturalMark(x - 10, y, 11));
    else if (event.accidental !== keyValue) {
      ops.push(
        event.accidental > 0
          ? sharpMark(x - 10, y, 11)
          : flatMark(x - 10, y, 11),
      );
    }
  }
  // The head: hollow from a half note up, filled below it.
  const hollow = event.units >= 4;
  ops.push(ellipse(x, y, 4.4, 3.2, -20, hollow ? 'stroke' : 'fill'));
  if (event.dotted) ops.push(ellipse(x + 7, y, 1.1, 1.1, 0, 'fill'));
  // The stem (a whole note has none) and its flags.
  if (event.units < 8) {
    const stemUp = step < STAFF_BOTTOM_STEP + 4;
    const stemX = stemUp ? x + 4 : x - 4;
    const stemEnd = stemUp ? y + PDF_STAFF_GAP * 3.5 : y - PDF_STAFF_GAP * 3.5;
    ops.push(stroke(stemX, y, stemX, stemEnd, 1));
    const flags = event.units <= 1 ? 2 : event.units <= 2 ? 1 : 0;
    for (let flag = 0; flag < flags; flag += 1) {
      const drop = flag * 5;
      ops.push(
        `${num(stemX)} ${num(stemEnd + (stemUp ? -drop : drop))} m ` +
          `${num(stemX + 6)} ${num(stemEnd + (stemUp ? -drop - 3 : drop + 3))} ` +
          `${num(stemX + 8)} ${num(stemEnd + (stemUp ? -drop - 9 : drop + 9))} ` +
          `${num(stemX + 5)} ${num(stemEnd + (stemUp ? -drop - 12 : drop + 12))} c S`,
      );
    }
  }
  return ops.join('\n');
}

/** Rests, drawn as the marks they are (whole/half bars, and a small squiggle). */
function restOps(event: ScoreEvent, x: number, bottomY: number): string {
  const ops: string[] = [];
  if (event.units >= 8) {
    // A whole-bar rest hangs from the fourth line.
    const y = bottomY + PDF_STAFF_GAP * 3;
    ops.push(`${num(x - 5)} ${num(y)} ${num(10)} ${num(-4)} re f`);
    return ops.join('\n');
  }
  if (event.units >= 4) {
    // A half rest sits on the third line.
    const y = bottomY + PDF_STAFF_GAP * 2;
    ops.push(`${num(x - 5)} ${num(y)} ${num(10)} ${num(4)} re f`);
    return ops.join('\n');
  }
  // A quarter/eighth/sixteenth rest: the zigzag the mark really is.
  const top = bottomY + PDF_STAFF_GAP * 3.2;
  ops.push(stroke(x + 3, top, x - 3, top - 6, 1.1));
  ops.push(stroke(x - 3, top - 6, x + 3, top - 10, 1.1));
  if (event.units <= 2) {
    ops.push(ellipse(x - 3, top - 1, 2.2, 1.6, -30, 'fill'));
    if (event.units <= 1) ops.push(ellipse(x + 3, top - 9, 2.2, 1.6, -30, 'fill'));
  }
  return ops.join('\n');
}

/** Lay the score's measures onto systems, wrapping by width. */
function layOutSystems(
  measures: ReadonlyArray<ScoreMeasure>,
  firstSystemHeaderWidth: number,
  otherSystemHeaderWidth: number,
): ScoreMeasure[][] {
  const right = PDF_PAGE_WIDTH - PDF_MARGIN;
  const systems: ScoreMeasure[][] = [];
  let current: ScoreMeasure[] = [];
  let used = 0;
  for (const measure of measures) {
    const headerWidth =
      (systems.length === 0 && current.length === 0
        ? firstSystemHeaderWidth
        : otherSystemHeaderWidth);
    const width = Math.max(MEASURE_MIN_WIDTH, measure.events.length * NOTE_SLOT);
    const budget = right - PDF_MARGIN;
    if (current.length > 0 && used + width > budget) {
      systems.push(current);
      current = [];
      used = 0;
    }
    if (current.length === 0) used = Math.max(used, headerWidth);
    current.push(measure);
    used += width;
    void headerWidth;
  }
  if (current.length > 0) systems.push(current);
  return systems;
}

/** Place one system's measures across the page width, in order. */
function placeSystem(
  system: ReadonlyArray<ScoreMeasure>,
  headerWidth: number,
): PlacedMeasure[] {
  const left = PDF_MARGIN + headerWidth;
  const right = PDF_PAGE_WIDTH - PDF_MARGIN;
  const weights = system.map((measure) => Math.max(MEASURE_MIN_WIDTH, measure.events.length * NOTE_SLOT));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const usable = Math.max(1, right - left);
  let cursor = left;
  const placed: PlacedMeasure[] = [];
  system.forEach((measure, index) => {
    const width = (weights[index] / total) * usable;
    const startX = cursor;
    const endX = cursor + width;
    const onsets = measure.events.filter((event) => event.chordIndex === 0);
    const slot = onsets.length > 0 ? width / onsets.length : width;
    const events: PlacedEvent[] = [];
    let onset = 0;
    for (const event of measure.events) {
      if (event.chordIndex === 0) {
        const x = startX + slot * (onset + 0.5);
        events.push({ event, x });
        onset += 1;
      } else {
        // A chord member shares its root's x — one onset, stacked heads.
        const root = events[events.length - 1];
        events.push({ event, x: root ? root.x : startX + slot * 0.5 });
      }
    }
    placed.push({ measure, startX, endX, events });
    cursor = endX;
  });
  return placed;
}

// ─── Naming ─────────────────────────────────────────────────────

/** Fold a title to plain ASCII (Helvetica is single-byte, filenames too). */
export function asciiFold(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

/** A filename that keeps the piece's name readable and claims nothing. */
function safeFileBase(value: unknown, fallback: string): string {
  const folded = asciiFold(value)
    .replace(/[^A-Za-z0-9 .()-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return folded.length > 0 ? folded.slice(0, 70).trim() : fallback;
}

/**
 * THE FILE NAME: `<Piece title> (transposed <key>) - NoteSnap.pdf`, or
 * `(original key <key>)` when the user did not transpose. It says what the file
 * is (a transposed copy), what made it (NoteSnap) and nothing else — no
 * publisher, no "edition", no catalogue claim.
 */
export function scorePdfFileName(input: {
  title: unknown;
  keyLabel: unknown;
  offset: unknown;
}): string {
  const base = safeFileBase(input?.title, 'NoteSnap score');
  const keyRaw = asciiFold(input?.keyLabel).trim();
  const key = keyRaw.length > 0 ? keyRaw : 'C';
  const rawOffset = Number(input?.offset);
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  const where = offset === 0 ? `original key ${key}` : `transposed ${key}`;
  return `${base} (${where}) - NoteSnap.pdf`;
}

// ─── Building the document ──────────────────────────────────────

export interface ScorePdfResult {
  bytes: Uint8Array;
  /** The raw content streams, one per page (so the gate can measure them). */
  contents: string[];
  pageCount: number;
  /** Bars printed — must equal the ABC's own bar count. */
  measureCount: number;
  noteCount: number;
  /** Bars actually drawn onto a page (proved equal to measureCount by the gate). */
  drawnMeasures: number;
  /** Noteheads actually drawn (proved equal to noteCount by the gate). */
  drawnNotes: number;
  parsed: ParsedAbcScore;
  /** The header line the first page prints (no edition claims). */
  headerLine: string;
}

export interface ScorePdfInput {
  abc: string;
  /** The piece's title (catalogue title; the ABC's `T:` is the fallback). */
  title?: string;
  /** The composer line from the catalogue. */
  composer?: string;
  /** The key the user is reading in (the chip's label). */
  keyLabel?: string;
  /** Semitones from the original (0 = the original key). */
  offset?: number;
}

/**
 * THE WHOLE SCORE, AS PDF BYTES. Returns null only when the ABC holds no notes —
 * a blank staff would be a false claim about the piece. EVERY measure parsed
 * from the ABC is printed: there is no cap to forget.
 */
export function buildScorePdf(input: ScorePdfInput): ScorePdfResult | null {
  const parsed = parseAbcScore(input?.abc);
  if (parsed.noteCount === 0 || parsed.measures.length === 0) return null;

  const title = asciiFold(input?.title).trim() || asciiFold(parsed.title).trim() || 'NoteSnap score';
  const composer = asciiFold(input?.composer).trim() || asciiFold(parsed.composer).trim();
  const keyLabel =
    asciiFold(input?.keyLabel).trim() || parsed.key.label;
  const rawOffset = Number(input?.offset);
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  const where =
    offset === 0
      ? `original key ${keyLabel}`
      : `transposed to ${keyLabel} (${offset > 0 ? '+' : ''}${offset} semitones)`;
  const headerLine = `${where} · ${parsed.measures.length} bars · ${parsed.noteCount} notes`;

  const firstHeaderWidth = CLEF_WIDTH + KEY_WIDTH * Math.abs(parsed.key.accidentals) * 0.85 + TIME_WIDTH;
  const otherHeaderWidth = CLEF_WIDTH + KEY_WIDTH * Math.abs(parsed.key.accidentals) * 0.85 + 8;
  const systems = layOutSystems(parsed.measures, firstHeaderWidth, otherHeaderWidth);

  const pages: string[] = [];
  let ops: string[] = [];
  let systemOnPage = 0;
  let pageIndex = 0;
  /** Everything the pages really received — the gate compares these to the parse. */
  let drawnMeasures = 0;
  let drawnNotes = 0;

  const startPage = (): void => {
    ops = [];
    pageIndex += 1;
    systemOnPage = 0;
    const headerY = PDF_PAGE_HEIGHT - 64;
    if (pageIndex === 1) {
      ops.push(textOp('F2', 17, PDF_MARGIN, headerY, title));
      if (composer.length > 0) ops.push(textOp('F1', 9, PDF_MARGIN, headerY - 14, composer));
      ops.push(textOp('F1', 9, PDF_MARGIN, headerY - 27, headerLine));
      ops.push(textOp('F1', 8, PDF_MARGIN, headerY - 39, SCORE_PDF_ENGRAVING_LINE, 0.35));
      ops.push(textOp('F1', 7.5, PDF_MARGIN, headerY - 50, SCORE_PDF_NOT_EDITION_LINE, 0.45));
    } else {
      ops.push(textOp('F1', 9, PDF_MARGIN, headerY + 10, title, 0.3));
      ops.push(textOp('F1', 8, PDF_MARGIN, headerY, headerLine, 0.4));
    }
  };

  startPage();
  let bottomY = FIRST_SYSTEM_Y;
  systems.forEach((system) => {
    if (systemOnPage === SYSTEMS_PER_PAGE) {
      pages.push(ops.join('\n'));
      startPage();
      bottomY = FIRST_SYSTEM_Y;
    }
    const isFirstOfPage = systemOnPage === 0;
    const headerWidth = isFirstOfPage
      ? CLEF_WIDTH + KEY_WIDTH * Math.abs(parsed.key.accidentals) * 0.85 + TIME_WIDTH
      : otherHeaderWidth;
    const right = PDF_PAGE_WIDTH - PDF_MARGIN;
    ops.push(staffLines(PDF_MARGIN, right, bottomY));
    ops.push(trebleClef(PDF_MARGIN + 12, bottomY));
    ops.push(keySignatureOps(parsed.key, PDF_MARGIN + CLEF_WIDTH, bottomY));
    if (isFirstOfPage) {
      const meterX = PDF_MARGIN + CLEF_WIDTH + KEY_WIDTH * Math.abs(parsed.key.accidentals) * 0.85;
      ops.push(textOp('F2', 12, meterX, bottomY + PDF_STAFF_GAP * 1.7, String(parsed.meter.beats)));
      ops.push(textOp('F2', 12, meterX, bottomY + PDF_STAFF_GAP * 3.2, String(parsed.meter.unit)));
    }
    const placed = placeSystem(system, headerWidth);
    for (const measure of placed) {
      for (const event of measure.events) {
        ops.push(noteOps(event, parsed.key, bottomY));
        if (!event.event.rest) drawnNotes += 1;
      }
      // The bar line that closes this measure (the last one is the closing bar).
      const isLast = measure.measure.number === parsed.measures.length;
      ops.push(stroke(measure.endX, bottomY, measure.endX, bottomY + PDF_STAFF_GAP * 4, isLast ? 1.6 : 0.8));
      drawnMeasures += 1;
    }
    systemOnPage += 1;
    bottomY -= SYSTEM_DROP;
  });

  ops.push(textOp('F1', 8, PDF_MARGIN, 40, SCORE_PDF_FOOTER, 0.3));
  ops.push(textOp('F1', 8, PDF_PAGE_WIDTH - PDF_MARGIN - 46, 40, `page ${pageIndex}`, 0.3));
  pages.push(ops.join('\n'));

  const bytes = writePdf(pages);
  return {
    bytes,
    contents: pages,
    pageCount: pages.length,
    measureCount: parsed.measures.length,
    noteCount: parsed.noteCount,
    drawnMeasures,
    drawnNotes,
    parsed,
    headerLine,
  };
}

// ─── Reading our own PDF back before it is shared ────────────────

export interface ScorePdfValidation {
  ok: boolean;
  errors: string[];
  report: TakePdfStructureReport;
  /** Content streams whose drawing points fall outside the page. */
  offPage: number[];
  bytes: number;
}

/** Strings a score PDF may never contain: this is our own data, not an edition. */
export const SCORE_PDF_FORBIDDEN_CLAIMS: readonly string[] = [
  'official edition',
  'official sheet music',
  'published edition',
  'publisher',
  'arranged by',
  'Urtext',
];

/**
 * THE CLAIM SCAN. A phrase on the block-list is a CLAIM only when it is asserted:
 * the page is allowed — required — to say "not a published edition", so an
 * occurrence that a reader would read as a negation ("not a …", "never a …",
 * "no …") is not a claim. Everything else is refused.
 */
export function editionClaimIn(text: string): string | null {
  const lower = typeof text === 'string' ? text.toLowerCase() : '';
  for (const claim of SCORE_PDF_FORBIDDEN_CLAIMS) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(claim.toLowerCase(), from);
      if (at < 0) break;
      const before = lower.slice(Math.max(0, at - 14), at);
      if (!/(?:\bnot|\bnever|\bno)\b[a-z ]*$/.test(before)) return claim;
      from = at + claim.length;
    }
  }
  return null;
}

/**
 * THE FILE WE HAND OVER IS THE FILE WE CHECK. Structure (via the app's existing
 * parser), the PDF header at byte 0, every drawing point on the paper, every bar
 * printed, and no edition claim anywhere in the bytes.
 */
export function validateScorePdf(result: ScorePdfResult | null | undefined): ScorePdfValidation {
  const empty: TakePdfStructureReport = {
    ok: false,
    errors: ['no PDF was built'],
    version: null,
    objectCount: 0,
    pageCount: 0,
    declaredPageCount: null,
    xrefEntries: 0,
    startxref: null,
    totalBytes: 0,
    streamBytes: 0,
  };
  if (!result || !result.bytes) {
    return { ok: false, errors: empty.errors, report: empty, offPage: [], bytes: 0 };
  }
  const report = parseTakePdfStructure(result.bytes);
  const errors: string[] = [...report.errors];
  if (!hasPdfHeaderAtByteZero(result.bytes)) errors.push('no %PDF header at byte 0');
  const offPage: number[] = [];
  result.contents.forEach((content, index) => {
    if (contentBounds(content).outside > 0) offPage.push(index + 1);
  });
  if (offPage.length > 0) errors.push(`page(s) ${offPage.join(', ')} draw outside the paper`);
  if (report.pageCount !== result.pageCount) {
    errors.push(`built ${result.pageCount} page(s), the file declares ${report.pageCount}`);
  }
  if (result.measureCount !== result.parsed.measures.length) {
    errors.push('the printed bar count does not match the score');
  }
  if (result.drawnMeasures !== result.measureCount) {
    errors.push(`drew ${result.drawnMeasures} of ${result.measureCount} bars`);
  }
  if (result.drawnNotes !== result.noteCount) {
    errors.push(`drew ${result.drawnNotes} of ${result.noteCount} notes`);
  }
  if (result.measureCount < 1) errors.push('the score has no bars');
  const ascii = asciiOf(result.bytes);
  const claim = editionClaimIn(ascii);
  if (claim) errors.push(`the file carries an edition claim ("${claim}")`);
  return { ok: errors.length === 0, errors, report, offPage, bytes: result.bytes.length };
}

function asciiOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] & 0xff);
  return out;
}

/** The sentence the reader shows once the file is handed over. */
export function scorePdfHandedOverMessage(bars: unknown): string {
  const raw = Number(bars);
  const count = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  return `Saved the whole score (${count} bar${count === 1 ? '' : 's'}) as a PDF and opened the share sheet.`;
}
