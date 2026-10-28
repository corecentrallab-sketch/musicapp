/**
 * lyricsSheet.ts — THE LYRIC SHEET's MODEL (v45 slice 6, owner THREE-WAY LYRICS
 * SCOPE ratified 2026-10-26).
 *
 * WHAT A LYRIC SHEET MAY BE, AND NOTHING ELSE. The owner fixed three — and only
 * three — legal sources for the words this app may ever show next to a tune:
 *
 *   1. `pd`       — PUBLIC-DOMAIN LYRICS FOR A PUBLIC-DOMAIN PIECE: our own
 *                   verified PD lyric texts (PD translations pre-1929 only).
 *   2. `original` — THE USER'S OWN ORIGINAL COMPOSITION: words the user wrote
 *                   for their own piece.
 *   3. `take`     — THE USER'S OWN CAPTURED TAKE, SHOWN BACK TO THEM: words the
 *                   user typed for their own rendition. A performed take is the
 *                   user's own rendition, distinct from the underlying copyright.
 *
 * THE BANS, AND WHY THEY ARE STRUCTURAL RATHER THAN A POLICY NOTE. There is no
 * third-party lyrics database anywhere in this app, no lyric API, no audio →
 * lyrics transcription (no speech-to-text over a vocal), and no path that
 * INVENTS words for an instrumental. A lyric sheet is not generated here: it is
 * either (1) a verified text we hold, (2) the user's own words, or (3) nothing.
 * This module therefore has exactly one entry point that can produce words,
 * `lyricSheetFor()`, it routes on the three legal kinds, and every other outcome
 * is an HONEST EMPTY STATE — never invented text, never a placeholder poem.
 *
 * WHY A `LyricSheet` CARRIES ITS OWN EMPTY LINE. An empty lyric sheet is a real
 * outcome (we ship no PD lyric corpus yet; an instrumental has no words) and the
 * surface must say so in words a user can act on. Returning the sentence with the
 * model — not typing it at the call site — means the surface and the tier1 proof
 * read the SAME string, so "No lyrics available for this piece" can never drift
 * into a promise.
 *
 * NOTHING HERE IS LABELLED OFFICIAL. The user's words are their own rendition;
 * the model offers no way to describe them as the publisher's or as an official
 * text (see `LYRICS_NOT_OFFICIAL_LINE`, the one denial the surface shows).
 *
 * PURE: no React, no storage, no network. tier1-compiled; proven by
 * scripts/v45Lyrics.test.ts and pinned on the screens by
 * src/services/v45LyricsContract.ts.
 */

// ─── The three legal sources ────────────────────────────────────

/** The ONLY kinds of lyric sheet that exist. Order = shown order. */
export type LyricsSourceKind = 'pd' | 'original' | 'take';

export const LYRICS_SOURCE_KINDS: readonly LyricsSourceKind[] = ['pd', 'original', 'take'];

/** True only for the three legal kinds — a fourth spelling is not a source. */
export function isLyricsSourceKind(value: unknown): value is LyricsSourceKind {
  return typeof value === 'string' && (LYRICS_SOURCE_KINDS as readonly string[]).includes(value);
}

/** Ready = there are words to show; the other two are the honest empty outcomes. */
export type LyricsStatus = 'ready' | 'empty' | 'instrumental';

export interface LyricSheet {
  kind: LyricsSourceKind;
  status: LyricsStatus;
  /** The words, one entry per line, in reading order ([] when not ready). */
  lines: string[];
  /** The card's own heading for this kind. */
  label: string;
  /** What this sheet is, and where the words come from (one honest sentence). */
  hint: string;
  /** The sentence the surface shows when there is nothing to read. */
  line: string;
}

// ─── Copy (the ONE place these sentences live) ──────────────────

export const LYRICS_TITLE = 'Lyrics';
export const LYRICS_PD_LABEL = 'Public-domain lyrics';
export const LYRICS_ORIGINAL_LABEL = 'Your words for your composition';
export const LYRICS_TAKE_LABEL = 'Your words for this take';

export const LYRICS_PD_HINT =
  'Words in the public domain, kept with this piece in the library.';
export const LYRICS_ORIGINAL_HINT =
  'The words you wrote for your own composition. They stay on this device with it.';
export const LYRICS_TAKE_HINT =
  'The words you sing or hum with this take. They stay on this device with the take.';

/**
 * THE ONE DENIAL THE SURFACE SHOWS. The user's words are their own rendition,
 * never the publisher's words and never an official text — said in one line so
 * the surface cannot imply otherwise.
 */
export const LYRICS_NOT_OFFICIAL_LINE =
  'Your words are never labelled official — this is your own rendition.';

export const LYRICS_INPUT_PLACEHOLDER = 'One line of words per line';
export const LYRICS_INPUT_LABEL = 'Your lyrics';
export const LYRICS_INPUT_HINT = 'Type one line of words per line. Everything here is yours.';

/** No verified public-domain text for this piece (we ship no lyric corpus yet). */
export const LYRICS_EMPTY_PIECE_LINE = 'No lyrics available for this piece.';
/** Nothing typed for this user's own tune yet. */
export const LYRICS_EMPTY_USER_LINE = 'No words added yet.';
/**
 * AN INSTRUMENTAL GETS NO INVENTED WORDS. Stated as the surface's own outcome so
 * no code path can fill the gap with generated text.
 */
export const LYRICS_INSTRUMENTAL_LINE =
  'This piece has no words, so there are no lyrics to show.';

export const LYRICS_SAVE_CTA = 'Save these words';
export const LYRICS_SAVE_BUSY_LABEL = 'Saving…';
export const LYRICS_SAVED_LINE = 'Saved on this device with this take.';
export const LYRICS_SAVED_ORIGINAL_LINE = 'Saved on this device with your composition.';
export const LYRICS_CLEARED_LINE = 'Words removed from this take.';
export const LYRICS_SAVE_FAILED_LINE =
  'Could not save your words just now — they are still on screen, so nothing is lost.';
export const LYRICS_NEEDS_SAVED_TAKE_LINE =
  'Save your take first — your words are kept with it.';

/** Caps, so one paste cannot wedge the storage layer. */
export const LYRICS_MAX_LINES = 200;
export const LYRICS_MAX_CHARS = 6000;

// ─── Text handling ─────────────────────────────────────────────

/**
 * The ONE normaliser. A lyric sheet is lines of text: CRLF → LF, no zero-width
 * junk, no trailing spaces, no run of more than one blank line, hard-capped at
 * `LYRICS_MAX_CHARS`. Never throws: anything that is not a string normalises to
 * '' (an empty sheet), which is the honest outcome rather than an error.
 */
export function normalizeLyrics(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .slice(0, LYRICS_MAX_CHARS);
  const kept: string[] = [];
  let blankRun = 0;
  for (const line of text.split('\n')) {
    // Indentation is not part of the words: each line is trimmed at both ends,
    // so a paste out of an indented note comes back as the words themselves.
    const trimmed = line.replace(/^[ \t]+|[ \t]+$/g, '');
    if (trimmed === '') {
      blankRun += 1;
      if (blankRun > 1) continue;
      kept.push('');
      continue;
    }
    blankRun = 0;
    kept.push(trimmed);
  }
  // Leading and trailing blank lines are not part of the words.
  while (kept.length > 0 && kept[0] === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.slice(0, LYRICS_MAX_LINES).join('\n');
}

/** The words as the surface shows them: normalised, split, empty lines dropped. */
export function lyricLines(text: unknown): string[] {
  return normalizeLyrics(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** How many lines of words there are (0 = nothing to show). */
export function lyricLineCount(text: unknown): number {
  return lyricLines(text).length;
}

// ─── Storage record (encoded here, written by lyricsStore) ──────

/** Bumped only when the stored shape changes; unknown versions decode to null. */
export const LYRICS_RECORD_VERSION = 1;

/** Every lyric record lives under this key prefix, one record per subject. */
export const LYRICS_STORAGE_PREFIX = '@notesnap/lyrics/v1';

export interface LyricsRecord {
  version: number;
  kind: LyricsSourceKind;
  /** The take's History row id, or the composition's own id. */
  subjectId: string;
  text: string;
  updatedAt: string;
}

/**
 * The key a subject's words are stored under. The id is hex-escaped so a row id
 * containing '/' or ':' cannot collide with another subject's key.
 */
export function lyricsStorageKey(kind: LyricsSourceKind, subjectId: string): string | null {
  if (!isLyricsSourceKind(kind)) return null;
  const id = typeof subjectId === 'string' ? subjectId.trim() : '';
  if (id === '') return null;
  const safe = id.replace(/[^A-Za-z0-9._-]/g, (ch) => `%${ch.charCodeAt(0).toString(16)}`);
  return `${LYRICS_STORAGE_PREFIX}/${kind}/${safe}`;
}

/** Encode a record for storage. Returns null when there is nothing to keep. */
export function encodeLyricsRecord(input: {
  kind: LyricsSourceKind;
  subjectId: string;
  text: unknown;
  updatedAt?: string;
}): string | null {
  if (!isLyricsSourceKind(input.kind)) return null;
  const key = lyricsStorageKey(input.kind, input.subjectId);
  if (!key) return null;
  const text = normalizeLyrics(input.text);
  if (text === '') return null;
  const record: LyricsRecord = {
    version: LYRICS_RECORD_VERSION,
    kind: input.kind,
    subjectId: input.subjectId,
    text,
    updatedAt:
      typeof input.updatedAt === 'string' && input.updatedAt.length > 0
        ? input.updatedAt
        : new Date(0).toISOString(),
  };
  return JSON.stringify(record);
}

/**
 * Decode a stored record. Anything that is not OUR record — malformed JSON, a
 * different version, an unknown kind, a subject that moved, empty words — comes
 * back as null, i.e. "this subject has no words", never a thrown error and never
 * a half-read sheet.
 */
export function decodeLyricsRecord(
  raw: unknown,
  expected?: { kind?: LyricsSourceKind; subjectId?: string },
): LyricsRecord | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Partial<LyricsRecord>;
  if (record.version !== LYRICS_RECORD_VERSION) return null;
  if (!isLyricsSourceKind(record.kind)) return null;
  if (typeof record.subjectId !== 'string' || record.subjectId.trim() === '') return null;
  const text = normalizeLyrics(record.text);
  if (text === '') return null;
  if (expected?.kind && record.kind !== expected.kind) return null;
  if (expected?.subjectId && record.subjectId !== expected.subjectId) return null;
  return {
    version: LYRICS_RECORD_VERSION,
    kind: record.kind,
    subjectId: record.subjectId,
    text,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
  };
}

// ─── The ONE entry point that can produce words ────────────────

export interface LyricSheetInput {
  kind: LyricsSourceKind;
  /** The words we hold (PD text) or the user typed (original / take). */
  text?: unknown;
  /**
   * PUBLIC-DOMAIN PATH ONLY: true when the text is a VERIFIED public-domain
   * lyric whose composer AND lyricist are PD (translations pre-1929 only). We
   * hold no such corpus yet, so callers pass false and the surface says so.
   */
  verified?: boolean;
  /**
   * PUBLIC-DOMAIN PATH ONLY: false when the piece is an instrumental, so the
   * sheet is honestly empty instead of inventing words for it. `null`/absent =
   * unknown, which is treated as "no words to show" too.
   */
  hasWords?: boolean | null;
}

/**
 * THE LYRIC SHEET FOR A SUBJECT — and the only function that can hand words to a
 * surface. There is no parameter for a URL, a database id, a recording, an audio
 * file or a prompt: the words can only arrive as text the caller already holds
 * from one of the three legal sources.
 */
export function lyricSheetFor(input: LyricSheetInput): LyricSheet {
  const kind: LyricsSourceKind = isLyricsSourceKind(input?.kind) ? input.kind : 'pd';
  const label = lyricsLabelFor(kind);

  if (kind === 'pd') {
    // An instrumental has no words — stated, never filled in.
    if (input.hasWords === false) {
      return {
        kind,
        status: 'instrumental',
        lines: [],
        label,
        hint: LYRICS_PD_HINT,
        line: LYRICS_INSTRUMENTAL_LINE,
      };
    }
    const lines = input.verified === true ? lyricLines(input.text) : [];
    if (lines.length === 0) {
      return {
        kind,
        status: 'empty',
        lines: [],
        label,
        hint: LYRICS_PD_HINT,
        line: LYRICS_EMPTY_PIECE_LINE,
      };
    }
    return { kind, status: 'ready', lines, label, hint: LYRICS_PD_HINT, line: '' };
  }

  // `original` and `take` are the USER'S OWN words: whatever they typed, or an
  // honest "nothing here yet". Nothing else can occupy these kinds.
  const lines = lyricLines(input?.text);
  return {
    kind,
    status: lines.length > 0 ? 'ready' : 'empty',
    lines,
    label,
    hint: kind === 'take' ? LYRICS_TAKE_HINT : LYRICS_ORIGINAL_HINT,
    line: lines.length > 0 ? '' : LYRICS_EMPTY_USER_LINE,
  };
}

/** The heading for a kind (the surface never types one itself). */
export function lyricsLabelFor(kind: LyricsSourceKind): string {
  if (kind === 'pd') return LYRICS_PD_LABEL;
  if (kind === 'original') return LYRICS_ORIGINAL_LABEL;
  return LYRICS_TAKE_LABEL;
}

/** The honest line after a write attempt (the store hands its result in). */
export function lyricsSavedLine(kind: LyricsSourceKind): string {
  return kind === 'original' ? LYRICS_SAVED_ORIGINAL_LINE : LYRICS_SAVED_LINE;
}
