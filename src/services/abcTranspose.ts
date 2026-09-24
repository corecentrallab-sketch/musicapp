/**
 * abcTranspose — a pure, dependency-free ABC notation transposer (v1).
 *
 * Performs a REAL semitone/key shift on ABC text (used by the notation editor
 * for public-domain sheet music). It rewrites the note pitches in the tune
 * body AND updates the `K:` key signature, so the rendered score genuinely
 * changes key. This module has NO React Native / Expo imports — it runs in
 * Node for unit testing and in the app.
 *
 * Scope notes (v1):
 *  - Single/whole-tune transposition via a +/- semitone stepper.
 *  - Supports common major/minor keys and note accidentals (^ _ = ^^ __).
 *  - Rests, bar lines, slurs, ties, chord brackets, durations, decorations
 *    and inline headers (except `K:`) are passed through untouched.
 *  - Full note-by-note editing is deliberately out of scope for v1.
 */

// ─── Note math tables ───────────────────────────────────────────
const LETTER_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const LETTER_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};
const INDEX_TO_LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Canonical key names by pitch class, preferring the conventional spelling
// (fewest accidentals; ties broken toward sharps for majors and toward flats
// for subdominant minors where standard).
interface KeyCandidate {
  name: string;
  pc: number;
  acc: number; // 0 = natural, 1 = sharp, -1 = flat
  letterIdx: number;
}
const MAJOR_BY_PC: (KeyCandidate | null)[] = [
  { name: 'C', pc: 0, acc: 0, letterIdx: 0 },
  { name: 'C#', pc: 1, acc: 1, letterIdx: 0 },
  null, // pc2 D
  { name: 'Eb', pc: 3, acc: -1, letterIdx: 2 },
  { name: 'E', pc: 4, acc: 0, letterIdx: 2 },
  { name: 'F', pc: 5, acc: 0, letterIdx: 3 },
  { name: 'F#', pc: 6, acc: 1, letterIdx: 3 },
  { name: 'G', pc: 7, acc: 0, letterIdx: 4 },
  { name: 'Ab', pc: 8, acc: -1, letterIdx: 4 },
  { name: 'A', pc: 9, acc: 0, letterIdx: 5 },
  { name: 'Bb', pc: 10, acc: -1, letterIdx: 6 },
  { name: 'B', pc: 11, acc: 0, letterIdx: 6 },
];
const MAJOR_BY_PC_ALL: KeyCandidate[] = [
  { name: 'C', pc: 0, acc: 0, letterIdx: 0 },
  { name: 'C#', pc: 1, acc: 1, letterIdx: 0 },
  { name: 'Db', pc: 1, acc: -1, letterIdx: 1 },
  { name: 'D', pc: 2, acc: 0, letterIdx: 1 },
  { name: 'Eb', pc: 3, acc: -1, letterIdx: 2 },
  { name: 'D#', pc: 3, acc: 1, letterIdx: 1 },
  { name: 'E', pc: 4, acc: 0, letterIdx: 2 },
  { name: 'F', pc: 5, acc: 0, letterIdx: 3 },
  { name: 'F#', pc: 6, acc: 1, letterIdx: 3 },
  { name: 'Gb', pc: 6, acc: -1, letterIdx: 4 },
  { name: 'G', pc: 7, acc: 0, letterIdx: 4 },
  { name: 'Ab', pc: 8, acc: -1, letterIdx: 4 },
  { name: 'G#', pc: 8, acc: 1, letterIdx: 4 },
  { name: 'A', pc: 9, acc: 0, letterIdx: 5 },
  { name: 'Bb', pc: 10, acc: -1, letterIdx: 6 },
  { name: 'A#', pc: 10, acc: 1, letterIdx: 5 },
  { name: 'B', pc: 11, acc: 0, letterIdx: 6 },
  { name: 'Cb', pc: 11, acc: -1, letterIdx: 0 },
];
const MINOR_BY_PC_ALL: KeyCandidate[] = [
  { name: 'C', pc: 0, acc: 0, letterIdx: 0 },
  { name: 'C#', pc: 1, acc: 1, letterIdx: 0 },
  { name: 'Db', pc: 1, acc: -1, letterIdx: 1 },
  { name: 'D', pc: 2, acc: 0, letterIdx: 1 },
  { name: 'Eb', pc: 3, acc: -1, letterIdx: 2 },
  { name: 'D#', pc: 3, acc: 1, letterIdx: 1 },
  { name: 'E', pc: 4, acc: 0, letterIdx: 2 },
  { name: 'F', pc: 5, acc: 0, letterIdx: 3 },
  { name: 'F#', pc: 6, acc: 1, letterIdx: 3 },
  { name: 'Gb', pc: 6, acc: -1, letterIdx: 4 },
  { name: 'G', pc: 7, acc: 0, letterIdx: 4 },
  { name: 'Ab', pc: 8, acc: -1, letterIdx: 4 },
  { name: 'G#', pc: 8, acc: 1, letterIdx: 4 },
  { name: 'A', pc: 9, acc: 0, letterIdx: 5 },
  { name: 'Bb', pc: 10, acc: -1, letterIdx: 6 },
  { name: 'A#', pc: 10, acc: 1, letterIdx: 5 },
  { name: 'B', pc: 11, acc: 0, letterIdx: 6 },
  { name: 'Cb', pc: 11, acc: -1, letterIdx: 0 },
];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Resolve letter-shift in diatonic steps consistent with the transpose sign. */
function resolveLetterShift(d: number, semitones: number): number {
  const cands = [d, d - 7, d + 7].filter(
    (c) => c >= -6 && c <= 6 && Number.isInteger(c)
  );
  if (semitones === 0) {
    return cands.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  }
  const sign = semitones > 0 ? 1 : -1;
  const sameSign = cands.filter((c) => Math.sign(c) === sign);
  const pool = sameSign.length ? sameSign : cands;
  return pool.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a), pool[0]);
}

// ─── Key parsing / transposition ────────────────────────────────

export interface ParsedKey {
  pc: number;
  mode: 'major' | 'minor';
  letterIdx: number;
  acc: number;
}

/**
 * Parse an ABC key value into a tonic pitch class + mode.
 * Accepts: `C`, `Dm`, `F#`, `Bb`, `Am`, `Eb major`, `a` (lowercase = minor),
 * `^F`, `_B` etc.
 */
export function parseKey(value: string): ParsedKey | null {
  let s = value.trim();
  // Strip accidentals prefix (^ _ =) — supports ^^ / __ too.
  let acc = 0;
  while (
    s.length > 0 &&
    (s[0] === '^' || s[0] === '_' || s[0] === '=')
  ) {
    if (s[0] === '^') acc += 1;
    else if (s[0] === '_') acc -= 1;
    // '=' resets to natural; keep accumulating shown accidentals as-is.
    s = s.slice(1);
  }
  // Handle a real key value like "Bb" / "F#" / "C major" / "Am" / "amin".
  let mode: 'major' | 'minor' = 'major';
  let letter = '';
  let j = 0;
  if (s.length > 0 && /[A-Ga-g]/.test(s[0])) {
    letter = s[0];
    if (letter === letter.toLowerCase()) {
      mode = 'minor'; // lowercase key letter (e.g. K:a) = minor by convention
    }
    letter = letter.toUpperCase();
    j = 1;
  } else {
    return null;
  }
  // Optional accidental suffix (e.g. "Bb", "F#").
  if (j < s.length && (s[j] === 'b' || s[j] === '#') && s[j - 1] !== ':') {
    acc += s[j] === '#' ? 1 : -1;
    j++;
  }
  // Optional mode suffix.
  const rest = s.slice(j).trim();
  if (/^m(inor)?$/i.test(rest) || /^min$/i.test(rest)) {
    mode = 'minor';
  } else if (/^maj(or)?$/i.test(rest) || /^M$/.test(rest)) {
    mode = 'major';
  } else if (rest.length > 0 && /^(min|minor|harm|mel)$/i.test(rest)) {
    mode = 'minor';
  }
  const letterIdx = LETTER_INDEX[letter];
  const pc = mod(LETTER_PC[letter] + acc, 12);
  return { pc, mode, letterIdx, acc };
}

export function keyToLabel(key: ParsedKey): string {
  const table = key.mode === 'major' ? MAJOR_BY_PC_ALL : MINOR_BY_PC_ALL;
  const cand = table.find((c) => c && c.pc === key.pc && c.acc === key.acc);
  const base = cand
    ? cand.name
    : table.find((c) => c && c.pc === key.pc)?.name ?? 'C';
  return key.mode === 'minor' ? `${base}m` : base;
}

/** Human label e.g. "C major", "D minor", "F# minor". */
export function keyDisplayName(
  keyLabel: string
): string {
  const trimmed = keyLabel.trim();
  const minor = /m$/i.test(trimmed);
  const name = minor ? trimmed.replace(/m$/i, '') : trimmed;
  return minor ? `${name} minor` : `${name} major`;
}

/** Choose the conventional key name for a tonic pitch class + mode. */
function pickKeyName(pc: number, mode: 'major' | 'minor'): KeyCandidate {
  if (mode === 'major') {
    const c = MAJOR_BY_PC[pc];
    if (c) return c;
    // Fallback (pc 2 D, pc 5 F): hand-built.
    return { name: pc === 2 ? 'D' : 'F', pc, acc: 0, letterIdx: pc === 2 ? 1 : 3 };
  }
  // Minor — prefer the spelling with the fewest accidentals.
  const cands = MINOR_BY_PC_ALL.filter((c) => c && c.pc === pc);
  if (cands.length === 0) {
    return { name: 'A', pc: 9, acc: 0, letterIdx: 5 };
  }
  const fewest = cands.sort((a, b) => Math.abs(a.acc) - Math.abs(b.acc))[0];
  return fewest;
}

export interface TransposedKey {
  /** Updated `K:` value, e.g. `D`, `Dm`, `F#`. */
  keyLabel: string;
  /** Diatonic letter shift for the note re-spelling. */
  letterShift: number;
  mode: 'major' | 'minor';
}

/** Transpose a parsed key by semitones and return the new key + letter shift. */
export function transposeKey(
  parsed: ParsedKey,
  semitones: number
): TransposedKey {
  const newPc = mod(parsed.pc + semitones, 12);
  const chosen = pickKeyName(newPc, parsed.mode);
  const d = chosen.letterIdx - parsed.letterIdx;
  const letterShift = resolveLetterShift(d, semitones);
  const keyLabel =
    parsed.mode === 'minor' ? `${chosen.name}m` : chosen.name;
  return { keyLabel, letterShift, mode: parsed.mode };
}

// ─── Note transposition ─────────────────────────────────────────

/** Transpose a single ABC note token and return its re-written form. */
function transposeNote(
  letter: string,
  acc: number,
  octaveMods: number,
  semitones: number,
  letterShift: number
): string {
  const isLower = letter !== letter.toUpperCase();
  const upper = letter.toUpperCase();
  const letterIdx = LETTER_INDEX[upper];
  const letterPc = LETTER_PC[upper];
  const oct =
    (isLower ? 1 : 0) + octaveMods; // uppercase base = oct 0
  const absSemis = oct * 12 + letterPc + acc;
  const newAbs = absSemis + semitones;

  const newLetterGlobal = letterIdx + letterShift;
  const newLetterIdx = mod(newLetterGlobal, 7);
  const octWrap = floorDiv(newLetterGlobal, 7);
  const newOct = oct + octWrap;
  const newLetterPc = LETTER_PC[INDEX_TO_LETTER[newLetterIdx]];
  const newAcc = newAbs - (newOct * 12 + newLetterPc);

  // Build the accidental prefix.
  const accChars =
    newAcc > 0 ? '^'.repeat(Math.min(newAcc, 2)) : '_'.repeat(Math.min(-newAcc, 2));

  // Build the octave representation.
  let noteChar: string;
  let commas = 0;
  let apostrophes = 0;
  if (newOct >= 1) {
    noteChar = INDEX_TO_LETTER[newLetterIdx].toLowerCase();
    apostrophes = newOct - 1;
  } else {
    noteChar = INDEX_TO_LETTER[newLetterIdx];
    commas = -newOct;
  }
  // ABC octave markers come AFTER the note letter.
  return (
    accChars + noteChar + "'".repeat(apostrophes) + ','.repeat(commas)
  );
}

const ACCIDENTALS = new Set(['^', '_', '=']);
const NOTE_LETTERS = /[A-Ga-g]/;

/**
 * Transpose the note tokens in an ABC body/fragment. Header/field lines
 * (e.g. `T:`, `M:`, `L:`) must NOT be fed here (they are handled by
 * transposeAbc). Rests, bars, slurs, ties, chords, durations and decorations
 * are preserved.
 */
function transposeAbcNotes(body: string, semitones: number, letterShift: number): string {
  let out = '';
  let i = 0;
  const n = body.length;
  while (i < n) {
    const ch = body[i];
    // Is this the start of a note (with optional accidental prefix)?
    if (ACCIDENTALS.has(ch) || NOTE_LETTERS.test(ch)) {
      let j = i;
      let acc = 0;
      // Consume accidental prefix.
      while (j < n && ACCIDENTALS.has(body[j])) {
        if (body[j] === '^') acc += 1;
        else if (body[j] === '_') acc -= 1;
        // '=' → 0 (natural)
        else acc = 0;
        j++;
      }
      if (j < n && NOTE_LETTERS.test(body[j])) {
        const letter = body[j];
        j++;
        // Consume octave markers (apostrophes up, commas down) after letter.
        let octaveMods = 0;
        while (j < n && (body[j] === "'" || body[j] === ',')) {
          if (body[j] === "'") octaveMods += 1;
          else octaveMods -= 1;
          j++;
        }
        out += transposeNote(
          letter,
          acc,
          octaveMods,
          semitones,
          letterShift
        );
        i = j;
        continue;
      }
      // Accidentals not followed by a note — copy verbatim.
      out += body.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Transpose an entire ABC tune by `semitones` semitones (clamped to
 * -11..+11). Updates the `K:` key signature and shifts every note pitch.
 */
export function transposeAbc(abc: string, semitones: number): string {
  const s = clampSemitones(semitones);
  if (s === 0) return abc;

  let parsedKey: ParsedKey | null = null;
  let letterShift = 0;

  const lines = abc.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const isField = /^\s*[A-Za-z]:/.test(line);
    if (isField) {
      const keyMatch = line.match(/^(\s*)K:(.*)$/);
      if (keyMatch) {
        const [, lead, value] = keyMatch;
        const parsed = parseKey(value);
        if (parsed && !parsedKey) {
          parsedKey = parsed;
          const tk = transposeKey(parsed, s);
          letterShift = tk.letterShift;
          // Keep any trailing options after the key token.
          const valueTokens = value.split(/\s+/);
          const keyToken = valueTokens[0];
          const rest = value.slice(keyToken.length).trim(); // e.g. " clef=... "
          out.push(
            `${lead}K:${tk.keyLabel}${rest ? ' ' + rest : ''}`
          );
        } else {
          // No key parsed (unrecognised) — leave the K: line untouched.
          out.push(line);
        }
      } else {
        // Other header/field line — copy untouched.
        out.push(line);
      }
    } else if (parsedKey) {
      // Body line — transpose notes.
      out.push(transposeAbcNotes(line, s, letterShift));
    } else {
      // Body before any K: was seen — still transpose (rare/edge).
      out.push(transposeAbcNotes(line, s, letterShift));
    }
  }
  return out.join('\n');
}

/** Normalise a semitone offset to a clamped integer in -11..+11. */
export function clampSemitones(semitones: number): number {
  const rounded = Math.round(semitones);
  return Math.max(-11, Math.min(11, rounded));
}

/** Extract the tune key from an ABC string's `K:` line (e.g. `Am`, `D`, `Eb`). */
export function extractAbcKey(abc: string): string | null {
  const m = abc.match(/^\s*K:\s*([A-Za-z][^\s,]*)/m);
  return m ? m[1] : null;
}

/**
 * Convenience for the UI: given a source key label (e.g. `C`, `Dm`) and a
 * semitone offset, return `{ fromLabel, toLabel }` human names like
 * `{ from: "C major", to: "D major" }`.
 */
export function transposeKeyLabel(
  sourceKeyLabel: string,
  semitones: number
): { from: string; to: string } {
  const parsed = parseKey(sourceKeyLabel);
  if (!parsed) {
    return { from: sourceKeyLabel, to: sourceKeyLabel };
  }
  const tk = transposeKey(parsed, clampSemitones(semitones));
  return {
    from: keyDisplayName(sourceKeyLabel),
    to: keyDisplayName(tk.keyLabel),
  };
}
