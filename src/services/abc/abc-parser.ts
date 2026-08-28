/**
 * Minimal ABC (abc v2.1) parser — enough to convert the single-melody
 * public-domain scores used by NoteSnap's notation editor to MIDI and
 * MusicXML.
 *
 * Scope is intentionally narrow and deterministic:
 *   - Headers parsed: X, T, C, M, L, K.  (P/V/Q and other fields ignored.)
 *   - Tune body: notes `a-g A-G`, accidentals (^ _ = ^^ __), octave markers
 *     (` for down, ' for up), length suffixes (n, /n, /, dotted `.`), ties,
 *     rests (z/x), bar lines, and chords `[...]` (treated as a simultaneous
 *     set of pitches sharing one onset/duration).
 *
 * It returns a flat, time-ordered sequence of note "events" measured in
 * quarter-note beats, which is the shared input for both the MIDI and the
 * MusicXML writers. Everything here is pure and dependency-free so it can be
 * unit-tested under plain Node.
 */

export interface Meter {
  beats: number;
  beatType: number;
}

export interface NoteEvent {
  /** Onset in quarter-note beats from the start of the tune. */
  onsetQb: number;
  /** One or more MIDI pitches (a chord produces >1). A rest produces []. */
  pitches: number[];
  /** Duration in quarter-note beats. */
  durationQb: number;
}

export interface ParsedAbc {
  title: string;
  composer: string;
  meter: Meter | null;
  /** Default note length (L:) as a fraction of a whole note. */
  defaultLength: { num: number; den: number };
  /** Key tonic letter (lowercase) + mode, from K:. */
  key: { tonic: string; mode: "major" | "minor" } | null;
  events: NoteEvent[];
}

const LETTER_SEMITONE: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/** Fetches a header value (returns null when absent). */
function headerField(lines: string[], tag: string): string | null {
  for (const line of lines) {
    const m = /^([A-Za-z]):\s*(.*)$/.exec(line.trim());
    if (m && m[1].toUpperCase() === tag) {
      return m[2].trim();
    }
  }
  return null;
}

function parseFraction(
  raw: string,
): { num: number; den: number } | null {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!num || !den) return null;
  return { num, den };
}

function parseKey(raw: string): ParsedAbc["key"] {
  if (!raw) return null;
  const m = /^\s*([A-Ga-g])\s*(m|min|minor|maj|major)?/.exec(raw);
  if (!m) return null;
  const tonic = m[1].toLowerCase();
  const suffix = (m[2] ?? "").toLowerCase();
  const mode =
    suffix === "" ? "major" : suffix.startsWith("m") ? "minor" : "major";
  return { tonic, mode };
}

/** Build the multi-line tune body (drops header lines and inline comments). */
function tuneBodyLines(lines: string[]): string[] {
  return lines
    .filter((line) => !/^[A-Za-z]:/.test(line.trim()))
    .map((line) => line.split("%")[0].trim())
    .filter((line) => line.length > 0);
}

/** Parse one note/rest token; returns event pitches + a length multiplier. */
function parseToken(
  token: string,
  unitQb: number,
): { pitches: number[]; durQb: number } | null {
  if (token.length === 0) return null;
  let octaveMod = 0; // cumulative from ` and '
  let accidental = 0;
  let i = 0;

  // Accidental(s) first (may be up to two ^ or _ chars, or =).
  while (i < token.length && "^_=".includes(token[i])) {
    if (token[i] === "^") accidental += 1;
    else if (token[i] === "_") accidental -= 1;
    else accidental = 0;
    i += 1;
  }

  const letter = token[i]?.toLowerCase();
  if (letter && "abcdefg".includes(letter)) {
    const isUpper = token[i] !== letter; // original had uppercase
    i += 1;
    const base = 60 + LETTER_SEMITONE[letter] + (isUpper ? -12 : 0);

    // Octave markers (`,` down, `'` up) — may appear before and/or after length.
    while (i < token.length && (token[i] === "," || token[i] === "'")) {
      octaveMod += token[i] === "'" ? 1 : -1;
      i += 1;
    }

    // Length: [n][/n] — a bare `/` means divide by 2.
    let lengthNum = 1;
    let lengthDen = 1;
    let numStr = "";
    while (i < token.length && /\d/.test(token[i])) {
      numStr += token[i];
      i += 1;
    }
    if (numStr) lengthNum = Number(numStr);
    if (i < token.length && token[i] === "/") {
      i += 1;
      let denStr = "";
      while (i < token.length && /\d/.test(token[i])) {
        denStr += token[i];
        i += 1;
      }
      lengthDen = denStr ? Number(denStr) : 2;
    }

    // More octave markers after length.
    while (i < token.length && (token[i] === "," || token[i] === "'")) {
      octaveMod += token[i] === "'" ? 1 : -1;
      i += 1;
    }

    // Dots (each adds 1.5×).
    let dotFactor = 1;
    while (i < token.length && token[i] === ".") {
      dotFactor *= 1.5;
      i += 1;
    }

    const pitch = base + accidental + octaveMod * 12;
    const durQb = unitQb * (lengthNum / lengthDen) * dotFactor;
    return { pitches: [pitch], durQb };
  }

  // Rest (z or x) — advances time, no pitch.
  if (token[0] === "z" || token[0] === "x") {
    let j = 1;
    let lengthNum = 1;
    let lengthDen = 1;
    let numStr = "";
    while (j < token.length && /\d/.test(token[j])) {
      numStr += token[j];
      j += 1;
    }
    if (numStr) lengthNum = Number(numStr);
    if (j < token.length && token[j] === "/") {
      j += 1;
      let denStr = "";
      while (j < token.length && /\d/.test(token[j])) {
        denStr += token[j];
        j += 1;
      }
      lengthDen = denStr ? Number(denStr) : 2;
    }
    return { pitches: [], durQb: unitQb * (lengthNum / lengthDen) };
  }

  // Unrecognised token (bar line, tie, decoration, etc.) — zero duration.
  return { pitches: [], durQb: 0 };
}

/**
 * Convert the tune body to time-ordered note events. Chords in `[...]` are
 * handled: the first note inside a bracket starts the chord (advancing time),
 * and every later note until the closing `]` shares that onset and duration.
 */
function parseEvents(bodyLines: string[], unitQb: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  let onset = 0;
  let inChord = false;
  let chordRoot: NoteEvent | null = null;

  for (const line of bodyLines) {
    let i = 0;
    while (i < line.length) {
      const ch = line[i];

      if (" \t|:".includes(ch)) {
        i += 1;
        continue;
      }
      if (ch === "]") {
        inChord = false;
        chordRoot = null;
        i += 1;
        continue;
      }
      if (ch === "[") {
        inChord = true;
        chordRoot = null;
        i += 1;
        continue;
      }

      // Consume a token up to the next separator.
      let j = i;
      while (j < line.length && !" \t|[]".includes(line[j])) {
        j += 1;
      }
      const token = line.slice(i, j);

      const parsed = parseToken(token, unitQb);
      if (parsed) {
        if (inChord && chordRoot) {
          // Additional chord member: share the root's onset and duration.
          if (parsed.pitches.length > 0) {
            chordRoot.pitches.push(parsed.pitches[0]);
          }
        } else {
          const ev: NoteEvent = {
            onsetQb: onset,
            pitches: parsed.pitches,
            durationQb: parsed.durQb > 0 ? parsed.durQb : unitQb,
          };
          events.push(ev);
          onset += ev.durationQb;
          if (inChord) chordRoot = ev;
        }
      }
      i = j;
    }
  }

  return events;
}

/** Parse a full ABC string into header metadata + melody note events. */
export function parseAbc(abc: string): ParsedAbc {
  const lines = abc.replace(/\r\n/g, "\n").split("\n");

  const title = headerField(lines, "T") ?? "";
  const composer = headerField(lines, "C") ?? "";

  let meter: Meter | null = null;
  const meterRaw = headerField(lines, "M");
  if (meterRaw) {
    const f = parseFraction(meterRaw);
    if (f) meter = { beats: f.num, beatType: f.den };
    else if (meterRaw.toUpperCase() === "C") meter = { beats: 4, beatType: 4 };
    else if (meterRaw.toUpperCase() === "C|") meter = { beats: 2, beatType: 2 };
  }

  let defaultLength = { num: 1, den: 4 };
  const lRaw = headerField(lines, "L");
  if (lRaw) {
    const f = parseFraction(lRaw);
    if (f) defaultLength = f;
  }

  const key = parseKey(headerField(lines, "K") ?? "");
  // Unit length in quarter-note beats: an L:1/8 note = 0.5 quarter beats.
  const unitQb = (defaultLength.num / defaultLength.den) * 4;

  const bodyLines = tuneBodyLines(lines);
  const events = parseEvents(bodyLines, unitQb);

  return { title, composer, meter, defaultLength, key, events };
}
