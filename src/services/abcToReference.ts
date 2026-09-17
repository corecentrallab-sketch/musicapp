/**
 * abcToReference.ts — ABC notation → ReferenceNote[] for the practice coach
 * (owner-approved roadmap #3, slice 2: the detection/reference pipeline — pure
 * logic, deliberately NO UI).
 *
 * Searched first, as briefed: the repo has NO ABC parser or renderer — no
 * abcjs / abc2svg dependency anywhere (checked src/, scripts/, package.json,
 * the site workspace and the Mutopia ingest data, which is LilyPond `.ly`, not
 * ABC). So this is a MINIMAL, hand-written, deliberately-lenient ABC melody
 * reader, scoped to the melody line the coach needs rather than to engraving.
 *
 * SUPPORTED (a partial parser has to say where it stops):
 *  - header fields X, T, C, M, L, Q, K (other `X:`-style fields are skipped);
 *    the body may re-declare K:/M:/L:/Q: and inline `[K:...]`-style fields are
 *    applied, other inline fields are stripped.
 *  - M: meter → used ONLY to infer the default unit note length when L: is
 *    absent (ABC rule: meter < 0.75 → 1/8, else 1/16; no M: at all → 1/8).
 *  - Q: tempo → quarter-note beats per minute. Accepts `Q:1/4=100`,
 *    `Q:3/8=120` (dotted quarter), `Q:120` and `Q:1/4 100`. Default 100.
 *  - L: unit note length, as a fraction of a whole note. Durations are in
 *    QUARTER-NOTE beats: L:1/4 → 1 beat, L:1/8 → 0.5, L:1/2 (half note) → 2.
 *    The meter never changes the beat unit — a beat is always a quarter note,
 *    matching slice 1's ReferenceNote/PlayedNote convention.
 *  - melody: `a`–`g` / `A`–`G` with `^` `^^` `_` `__` `=` accidentals, octave
 *    marks `,` (down) and `'` (up), in ABC octaves (C = middle C = MIDI 60,
 *    c = C5 = 72, c' = C6, C, = C3).
 *  - lengths: default L, digit multipliers (`C2`), fractions (`C/`, `C/2`,
 *    `C3/2`, `C//`).
 *  - bar lines `|`, `[|`, `|]`, `||`, `:|`, `|:`, `:` — they reset the
 *    bar-scoped accidentals and advance no time.
 *  - rests `z` / `x` (and `Z` / `X`) — NOT emitted, but they DO advance the
 *    beat cursor: a rest is time in the timeline.
 *  - key signatures: the K: sharps/flats apply to the named notes; an explicit
 *    accidental (including `=`) holds for the rest of that bar and then the
 *    key signature returns (the ABC bar rule).
 *  - ties `-`: a tied note of the same pitch extends the previous note instead
 *    of adding a new one.
 *
 * NOT SUPPORTED (all of these are ignored rather than thrown on — a degraded
 * reference beats a broken one, same rule as the recognition surfaces):
 *  - chords `[CEG]`: the FIRST note is taken, the rest is dropped (the coach is
 *    monophonic).
 *  - grace notes `{c}`: skipped entirely (no note, no time).
 *  - repeats `|:` `:|`, `P:` parts, `V:` voices, `&` overlays: NOT expanded.
 *    A `V:`/`P:`/`W:`/`w:` line is skipped; multiple voices on one line are
 *    read as a single melody; repeat marks advance no time.
 *  - tuplets: only `(3` (triplet → ×2/3) and `(2` (duplet → ×3/2) are scaled;
 *    other `(n` are stripped without scaling.
 *  - broken rhythm `>` `<`: stripped without rescaling (lengths stay
 *    symmetric).
 *  - decorations: `!f!`, `+f+`, `~`, `.` and quoted annotations `"Am"` are
 *    stripped; single-letter decorations (H L M O P S T u v) are NOT stripped
 *    because they are ambiguous with note letters.
 *  - modal keys (dorian/mixolydian/…) are treated as their major or minor
 *    parent; a key change mid-tune takes effect only from a bare `K:` body
 *    line or an `[K:...]` inline field.
 *  - pickup/anacrusis bars are not modelled: the first note starts at beat 0.
 *
 * Kept FREE of any react-native / expo imports so it compiles and runs under
 * plain Node (see scripts/coachPipeline.test.ts) — same convention as tier1.ts.
 */

import type { ReferenceNote } from './practiceCoach';

/** Tempo used when the ABC has no usable `Q:`. */
export const DEFAULT_ABC_TEMPO_BPM = 100;
/** Meter assumed when the ABC has no usable `M:`. */
export const DEFAULT_ABC_METER: [number, number] = [4, 4];
/** Unit note length when neither L: nor M: is present (ABC standard rule). */
export const DEFAULT_ABC_UNIT_NOTE_LENGTH: [number, number] = [1, 8];
/** Below this meter value the inferred unit note length is 1/8, else 1/16. */
export const ABC_METER_UNIT_THRESHOLD = 0.75;

export interface AbcReferenceOptions {
  /** Overrides any Q: in the ABC (the caller's tempo always wins). */
  tempoBpm?: number;
  /** Overrides any M: — feeds only the default-unit-length inference (an explicit L: wins). */
  meter?: [number, number];
}

export interface AbcReference {
  notes: ReferenceNote[];
  /** Tempo the caller should hand to segmentsToPlayedNotes. */
  tempoBpm: number;
  meter: [number, number];
  /** Unit note length used, as a fraction of a whole note (e.g. [1, 8]). */
  unitNoteLength: [number, number];
}

/** Letters → semitones above C within an octave. */
const NOTE_LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Order in which sharps are added to a key signature. */
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
/** Order in which flats are added. */
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
/** Major-key pitch class → number of sharps in its signature. */
const MAJOR_SHARP_COUNT: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: 7 };
/** Major-key pitch class → number of flats in its signature. */
const MAJOR_FLAT_COUNT: Record<number, number> = { 5: 1, 10: 2, 3: 3, 8: 4, 1: 5, 6: 6, 11: 7 };

/**
 * Parse an ABC tune's melody into reference notes, plus the tempo/meter/unit
 * length the segmentation step needs. Never throws: an empty or unusable body
 * yields an empty note list.
 */
export function parseAbcMelody(abc: string, opts: AbcReferenceOptions = {}): AbcReference {
  const state = new ParseState();
  state.meterOverride = normalizeMeter(opts.meter);
  if (typeof abc === 'string' && abc.length > 0) {
    for (const rawLine of abc.split(/\r?\n/)) {
      const line = stripComment(rawLine).trim();
      if (line.length === 0) continue;
      if (line.startsWith('%%')) continue; // typesetting directive
      const field = readField(line);
      if (field) {
        if (field.letter === 'V' || field.letter === 'P' || field.letter === 'W' || field.letter === 'w') {
          continue; // voices / parts / lyrics: not modelled
        }
        applyField(state, field.letter, field.value);
        continue;
      }
      parseMusicLine(state, line);
    }
  }

  const meter = state.meterOverride ?? state.meter ?? DEFAULT_ABC_METER;
  const unitNoteLength = state.unitNoteLength ?? inferUnitNoteLength(state.meterOverride ?? state.meter);
  const tempoBpm =
    isPositiveFinite(opts.tempoBpm) ? (opts.tempoBpm as number) : state.tempoBpm ?? DEFAULT_ABC_TEMPO_BPM;

  return { notes: state.notes, tempoBpm, meter, unitNoteLength };
}

/** Convenience: just the notes — what slice 1 scores. */
export function abcToReference(abc: string, opts: AbcReferenceOptions = {}): ReferenceNote[] {
  return parseAbcMelody(abc, opts).notes;
}

/** Convenience for the UI: the tempo the ABC declares (or the default). */
export function abcTempoBpm(abc: string): number {
  return parseAbcMelody(abc).tempoBpm;
}

/**
 * The key signature's accidental for a letter name (+1 sharp, −1 flat, 0
 * natural). Exported so the rule is testable in isolation.
 */
export function keyAccidentalFor(keyAccidentals: Record<string, number>, letter: string): number {
  const value = keyAccidentals[(letter || '').toUpperCase()];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// ─── parser state ───────────────────────────────────────────────

interface Field {
  letter: string;
  value: string;
}

class ParseState {
  notes: ReferenceNote[] = [];
  /** Beats elapsed so far (quarter-note beats). Never decreases. */
  cursor = 0;
  /** Unit note length as a fraction of a whole note, when L: is declared. */
  unitNoteLength: [number, number] | null = null;
  meter: [number, number] | null = null;
  /** The caller's meter override (see AbcReferenceOptions.meter). */
  meterOverride: [number, number] | null = null;
  tempoBpm: number | null = null;
  /** Key signature: letter → +1 sharp / −1 flat. */
  keyAccidentals: Record<string, number> = {};
  /** Explicit accidentals still in force this bar, keyed `LETTER+octave`. */
  barAccidentals: Record<string, number> = {};
  /** Notes left in the current tuplet (0 = none) and the factor to apply. */
  tupletRemaining = 0;
  tupletFactor = 1;
}

/** `K:`-style field header, or null when the line is music. */
function readField(line: string): Field | null {
  const m = /^([A-Za-z]):(.*)$/.exec(line);
  if (!m) return null;
  return { letter: m[1].toUpperCase(), value: m[2].trim() };
}

/** Strip `%` comments (ABC's comment character) outside of quotes. */
function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '%' && !inQuote) return line.slice(0, i);
  }
  return line;
}

function isPositiveFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function applyField(state: ParseState, letter: string, value: string): void {
  switch (letter) {
    case 'K':
      state.keyAccidentals = parseKeySignature(value);
      state.barAccidentals = {};
      break;
    case 'M': {
      const meter = parseMeter(value);
      if (meter) state.meter = meter;
      break;
    }
    case 'L': {
      const unit = parseFraction(value);
      if (unit && unit[0] > 0 && unit[1] > 0) state.unitNoteLength = unit;
      break;
    }
    case 'Q': {
      const bpm = parseTempo(value);
      if (bpm !== null) state.tempoBpm = bpm;
      break;
    }
    default:
      break; // X, T, C, S, R, O, Z, N, G, F, U, I … irrelevant to the melody
  }
}

/** `4/4`, `3/8`, or `C` / `C|` (common time) → a meter pair, or null. */
function parseMeter(value: string): [number, number] | null {
  const trimmed = value.trim();
  if (/^C\|?$/.test(trimmed)) return [4, 4];
  const fraction = parseFraction(trimmed);
  if (!fraction || fraction[0] <= 0 || fraction[1] <= 0) return null;
  return fraction;
}

/** `1/8`, `3/2`, `4` → a [numerator, denominator] pair, or null. */
function parseFraction(value: string): [number, number] | null {
  const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(value);
  if (!m) return null;
  const num = Number.parseInt(m[1], 10);
  const den = m[2] === undefined ? 1 : Number.parseInt(m[2], 10);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return [num, den];
}

function fractionValue(fraction: [number, number] | null): number {
  if (!fraction) return 0.25;
  return fraction[0] / fraction[1];
}

/**
 * `Q:` → quarter-note beats per minute. Accepts `1/4=100`, `3/8=120`,
 * `C=120`, `1/4 100` and a bare `120`. The unit is a length as a fraction of a
 * whole note, so the beat rate is value × 4 × unit — a dotted quarter at 120
 * implies 180 quarter-note beats per minute. (`C`/`C|` is read as a whole-note
 * unit, the rare literal reading.)
 */
function parseTempo(value: string): number | null {
  const s = value.replace(/"/g, ' ').trim();
  const bare = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (bare) {
    const bpm = Number.parseFloat(bare[1]);
    return isPositiveFinite(bpm) ? bpm : null;
  }
  const m = /^(\d+\s*\/\s*\d+|C\|?)\s*[= ]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const bpm = Number.parseFloat(m[2]);
  if (!isPositiveFinite(bpm)) return null;
  const unit = /^C\|?$/.test(m[1]) ? 1 : fractionValue(parseFraction(m[1]));
  return bpm * 4 * unit;
}

/**
 * Key signature for a `K:` value, as letter → +1 / −1. Handles major and minor
 * tonics with `#`/`b`/`^`/`_` spellings; a modal suffix is treated as its major
 * parent (or minor when the suffix starts with `m`, e.g. `K:Am`).
 */
function parseKeySignature(value: string): Record<string, number> {
  const map: Record<string, number> = {};
  const m = /^([_^]{0,2}|=)?\s*([A-Ga-g])([#b]?)/.exec(value.trim());
  if (!m) return map;
  const explicit = m[1] ?? '';
  const letter = m[2].toUpperCase();
  const accidental = m[3] ?? '';
  const rest = value.trim().slice(m[0].length).trim().toLowerCase();

  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : explicit.startsWith('^') ? 1 : explicit.startsWith('_') ? -1 : 0;
  const isFlatSpelling = accidental === 'b' || explicit.startsWith('_');
  const isSharpSpelling = accidental === '#' || explicit.startsWith('^');

  const tonicPc = (((NOTE_LETTERS[letter] ?? 0) + offset) % 12 + 12) % 12;
  const isMinor = rest.startsWith('m') && !rest.startsWith('maj') && !rest.startsWith('mix');
  const majorPc = isMinor ? (tonicPc + 3) % 12 : tonicPc;

  const sharps = MAJOR_SHARP_COUNT[majorPc];
  const flats = MAJOR_FLAT_COUNT[majorPc];
  const useFlats = isFlatSpelling ? true : isSharpSpelling ? false : sharps === undefined;
  const count = useFlats ? flats : sharps;
  if (typeof count !== 'number') return map;
  if (useFlats) for (let i = 0; i < count; i++) map[FLAT_ORDER[i]] = -1;
  else for (let i = 0; i < count; i++) map[SHARP_ORDER[i]] = 1;
  return map;
}

function normalizeMeter(meter: [number, number] | undefined): [number, number] | null {
  if (!meter) return null;
  const [num, den] = meter;
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null;
  return [num, den];
}

/**
 * ABC's default-unit rule: no meter at all → 1/8; meter value < 0.75 → 1/8;
 * otherwise → 1/16. An explicit L: always wins (checked by the caller first).
 */
function inferUnitNoteLength(meter: [number, number] | null): [number, number] {
  if (!meter) return DEFAULT_ABC_UNIT_NOTE_LENGTH;
  return meter[0] / meter[1] < ABC_METER_UNIT_THRESHOLD ? [1, 8] : [1, 16];
}

// ─── music line parsing ─────────────────────────────────────────

/** Unit note length in quarter-note beats (L:1/4 → 1 beat, L:1/8 → 0.5). */
function unitBeats(state: ParseState): number {
  const unit = state.unitNoteLength ?? inferUnitNoteLength(state.meterOverride ?? state.meter);
  return 4 * (unit[0] / unit[1]);
}

function parseMusicLine(state: ParseState, line: string): void {
  let i = 0;
  /** Set by a `-`; consumed by the next note. */
  let tiePending = false;

  while (i < line.length) {
    const ch = line[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Quoted annotation / guitar chord.
    if (ch === '"') {
      const end = line.indexOf('"', i + 1);
      i = end === -1 ? line.length : end + 1;
      continue;
    }

    // Decorations: !f! and +f+, plus the standalone symbols.
    if (ch === '!') {
      const end = line.indexOf('!', i + 1);
      i = end === -1 ? line.length : end + 1;
      continue;
    }
    if (ch === '+') {
      const end = line.indexOf('+', i + 1);
      i = end === -1 ? line.length : end + 1;
      continue;
    }
    if (ch === '.' || ch === '~') {
      i++;
      continue;
    }

    // Inline field, or a chord (first note only).
    if (ch === '[') {
      const end = line.indexOf(']', i + 1);
      if (end === -1) {
        i = line.length;
        continue;
      }
      const inner = line.slice(i + 1, end);
      const field = readField(inner);
      if (field) {
        applyField(state, field.letter, field.value);
        i = end + 1;
        continue;
      }
      const note = readNoteToken(inner, 0);
      const suffix = readLength(line, end + 1);
      const multiplier = suffix ? suffix.multiplier : 1;
      if (note) emitNote(state, note, multiplier, tiePending);
      tiePending = false;
      i = suffix ? suffix.next : end + 1;
      continue;
    }

    // Grace notes: skipped entirely (no note, no time).
    if (ch === '{') {
      const end = line.indexOf('}', i + 1);
      i = end === -1 ? line.length : end + 1;
      continue;
    }

    // Tuplet marker (only 3 and 2 are rescaled), slur start, closing paren.
    if (ch === '(' || ch === ')') {
      const digit = line[i + 1];
      if (ch === '(' && digit && digit >= '2' && digit <= '9') {
        state.tupletRemaining = Number.parseInt(digit, 10);
        state.tupletFactor = digit === '3' ? 2 / 3 : digit === '2' ? 3 / 2 : 1;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Bar lines (and '&' overlays): no time, reset the bar accidentals.
    if (ch === '|' || ch === ':' || ch === '&' || ch === ']') {
      state.barAccidentals = {};
      i++;
      continue;
    }

    // Ties.
    if (ch === '-') {
      tiePending = true;
      i++;
      continue;
    }

    // Broken rhythm: stripped, not rescaled.
    if (ch === '>' || ch === '<') {
      i++;
      continue;
    }

    // Rests: time passes, nothing is emitted.
    if (ch === 'z' || ch === 'x' || ch === 'Z' || ch === 'X') {
      const length = readLength(line, i + 1);
      const beats = (length ? length.multiplier : 1) * unitBeats(state);
      state.cursor += beats; // rests are time in the timeline
      i = length ? length.next : i + 1;
      continue;
    }

    // A note.
    const note = readNoteToken(line, i);
    if (note) {
      const suffix = readLength(line, note.next);
      i = suffix ? suffix.next : note.next;
      emitNote(state, note, suffix ? suffix.multiplier : 1, tiePending);
      tiePending = false;
      continue;
    }

    i++; // unknown character: lenient skip
  }
}

interface NoteToken {
  /** Uppercase letter name. */
  letter: string;
  /** Written accidental in semitones, or null when none is written. */
  accidental: number | null;
  octave: number;
  /** Index just past the note (where its length suffix, if any, begins). */
  next: number;
}

interface LengthToken {
  multiplier: number;
  next: number;
}

/** Read one note at `start` (accidental + letter + octave marks). */
function readNoteToken(text: string, start: number): NoteToken | null {
  let i = start;
  let accidental: number | null = null;
  while (i < text.length && (text[i] === '^' || text[i] === '_' || text[i] === '=')) {
    const ch = text[i];
    accidental = ch === '^' ? (accidental ?? 0) + 1 : ch === '_' ? (accidental ?? 0) - 1 : 0;
    i++;
  }
  const letter = text[i];
  if (!letter || !/[A-Ga-g]/.test(letter)) return null;
  const upper = letter.toUpperCase();
  if (!(upper in NOTE_LETTERS)) return null;
  i++;

  let octave = letter === upper ? 4 : 5; // ABC: C = middle C (C4), c = C5
  while (i < text.length && (text[i] === ',' || text[i] === "'")) {
    octave += text[i] === ',' ? -1 : 1;
    i++;
  }
  return { letter: upper, accidental, octave, next: i };
}

/**
 * Read an ABC length suffix: `2` (×2), `/` (×½), `/2` (×½), `//` (×¼),
 * `3/2` (×1.5), `2/` (×1). Returns null when there is no suffix at all (and
 * never consumes characters in that case).
 */
function readLength(text: string, start: number): LengthToken | null {
  let i = start;
  let numerator: number | null = null;
  let denominator: number | null = null;
  let slashes = 0;
  let sawAny = false;

  while (i < text.length) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9') {
      let value = 0;
      while (i < text.length && text[i] >= '0' && text[i] <= '9') {
        value = value * 10 + (text.charCodeAt(i) - 48);
        i++;
      }
      sawAny = true;
      if (slashes === 0) numerator = value;
      else denominator = value;
      continue;
    }
    if (ch === '/') {
      slashes++;
      sawAny = true;
      i++;
      continue;
    }
    break;
  }

  if (!sawAny) return null;
  const multiplier =
    slashes === 0 ? numerator ?? 1 : (numerator ?? 1) / (denominator ?? Math.pow(2, slashes));
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  return { multiplier, next: i };
}

/**
 * Emit one melody note: resolve the pitch against the key signature (or the
 * written accidental), remember incidents for the rest of the bar, scale by
 * the active tuplet, extend the previous note on a tie, then advance the beat
 * cursor.
 */
function emitNote(
  state: ParseState,
  note: NoteToken,
  lengthMultiplier: number,
  tiePending: boolean,
): void {
  const midi = resolveMidi(state, note);
  if (!isPositiveFinite(lengthMultiplier)) lengthMultiplier = 1;
  const beats = noteDurationBeats(state, lengthMultiplier);

  const previous = state.notes[state.notes.length - 1];
  if (tiePending && previous && Math.round(previous.midi) === midi) {
    previous.durationBeats = round4(previous.durationBeats + beats);
    state.cursor += beats;
    consumeTuplet(state);
    return;
  }

  state.notes.push({ midi, startBeat: round4(state.cursor), durationBeats: round4(beats) });
  state.cursor += beats;
  consumeTuplet(state);
}

/** Written pitch → MIDI, applying the bar rule and the key signature. */
function resolveMidi(state: ParseState, note: NoteToken): number {
  const key = `${note.letter}${note.octave}`;
  let accidental: number;
  if (note.accidental !== null) {
    accidental = note.accidental;
    state.barAccidentals[key] = accidental; // holds for the rest of the bar
  } else {
    const remembered = state.barAccidentals[key];
    accidental =
      typeof remembered === 'number' && Number.isFinite(remembered)
        ? remembered
        : keyAccidentalFor(state.keyAccidentals, note.letter);
  }
  return 12 * (note.octave + 1) + NOTE_LETTERS[note.letter] + accidental;
}

function noteDurationBeats(state: ParseState, lengthMultiplier: number): number {
  return unitBeats(state) * lengthMultiplier * state.tupletFactor;
}

function consumeTuplet(state: ParseState): void {
  if (state.tupletRemaining > 0) {
    state.tupletRemaining--;
    if (state.tupletRemaining === 0) state.tupletFactor = 1;
  }
}

/** Float noise from triplet lengths is invisible but ugly in assertions. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
