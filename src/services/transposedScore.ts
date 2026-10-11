/**
 * transposedScore.ts — the ONE place the app names a transposed copy and labels a
 * bundled sample (v39 Part 2, owner direction 10-11, backlog 5e3dffd3).
 *
 * WHY IT EXISTS.
 *
 * 1. THE TITLE. The notation editor built its saved title inline:
 *    `` `${title} (${key} · +2)` ``. The new full-score reader saves the SAME copy
 *    from a SECOND surface, and two chains of string building drift — a reader
 *    that saved "Für Elise (+2 · Am)" beside the editor's "Für Elise (Am · +2)"
 *    would fill the Library with two names for one score. The builder lives here
 *    so both surfaces cannot disagree, and `scripts/transposedScoreReader.test.ts`
 *    asserts the reader and the editor both call it.
 *
 * 2. THE SAMPLE LABEL. The owner opened a transposed copy and saw "4 bars". That
 *    is the DATA, not the renderer: every bundled ABC score is a 3-4 bar excerpt
 *    (`src/data/abcScores.ts`), so a reader window showing the entire piece shows
 *    four bars — correctly. The honest fix is to SAY so, derived from the score
 *    itself (its bar count), never by editing titles: `src/services/pieceAbc.ts`
 *    fuzzy-matches on the title to find a piece, so a title is a key, not a label.
 *
 * PURE: no react, no react-native, no fs, no network. Compiles and runs under
 * tsconfig.tier1.json.
 */

/** A transposed copy's title never carries more than this many key words. */
export const TRANSPOSED_COPY_UNTITLED = 'Untitled score';

/** A bundled excerpt is a few bars; a work that reports more is not called one. */
export const SAMPLE_EXCERPT_MAX_BARS = 8;

/** Shown when the caller says a score is a sample but its bar count cannot be read. */
export const SAMPLE_EXCERPT_FALLBACK_LABEL = 'Sample — short excerpt';

/** The character a bar token must contain to count as music (a note or a rest). */
const NOTE_TOKEN_CHARACTER = /[A-Ga-gzZxX]/;

/** A pure ABC header/information field line (`X:`, `T:`, `M:`, `L:`, `K:`, `V:`…). */
const ABC_HEADER_LINE = /^[A-Za-z]:/;

/**
 * A bracketed CHORD group (`[CEG]`) — one note event however many notes it holds.
 * The inner text may not contain a bar line, so a first/second ending (`[1 C D |`)
 * is never mistaken for a chord that swallows the bars after it.
 */
const ABC_CHORD_GROUP = /\[([^\]|\n]*)\]/g;

/**
 * ABC notation that is not a pitch: barlines/repeat marks, endings, ties and slurs,
 * grace notes, decorations, accidentals, octave marks, length numbers.
 */
const ABC_NOTATION_SYNTAX = /[:\[\]0-9,^_='()!.<>~{}\-]/g;

/** What is left of a bar token once the notation is removed: notes, rests, spaces. */
const ABC_NOTES_AND_RESTS_ONLY = /^[A-Ga-gzZxX\s]*$/;

/** The note a bracketed chord stands in for (one event, never one bar per note). */
const ABC_CHORD_NOTE = 'C';

/**
 * The MUSIC lines of an ABC score: everything after the key field (`K:`), with
 * blank lines, comments (`%…`) and inline information fields dropped.
 *
 * The `K:` boundary is the ABC v2.1 rule — the header ends there — and a score
 * with no `K:` at all is treated as body-only rather than as having no music,
 * because a caller that hands this module a bare bar string still deserves an
 * answer.
 */
export function abcBodyLines(abc: unknown): string[] {
  if (typeof abc !== 'string' || abc.length === 0) return [];
  const lines = abc.split(/\r?\n/);
  const keyAt = lines.findIndex((line) => /^K:/.test(line.trim()));
  const from = keyAt >= 0 ? keyAt + 1 : 0;
  const body: string[] = [];
  for (const raw of lines.slice(from)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('%')) continue;
    if (ABC_HEADER_LINE.test(line)) continue;
    body.push(line);
  }
  return body;
}

/**
 * HOW MANY BARS THE SCORE ACTUALLY HOLDS — the honest basis for the sample label.
 *
 * A bar is a run of music between two bar lines. Three things are not bars:
 *   • annotations (`"Am"`) and inline comments (`% …`) — text over the staff;
 *   • repeat marks (`|:`, `:|`, `::`), endings (`[1`, `[2`) and the closing `|]`;
 *   • a bracketed CHORD, which is ONE note event: it makes the bar it sits in music,
 *     and its inner notes never add a bar of their own (`[CEG] [DFA] | c2 z2` is two
 *     bars, not three — the fix for the v39 mis-count).
 * A token counts only when what survives the notation syntax is notes and rests and
 * nothing else, so a line of prose that merely contains note letters (`#not abc`)
 * is not music. Returns 0 when there is no readable music.
 */
export function countAbcBars(abc: unknown): number {
  let bars = 0;
  for (const line of abcBodyLines(abc)) {
    const withoutText = line.replace(/"[^"]*"/g, ' ').replace(/%.*$/, ' ');
    const withChordsAsOneNote = withoutText.replace(ABC_CHORD_GROUP, (group: string) =>
      ABC_NOTES_AND_RESTS_ONLY.test(group.replace(ABC_NOTATION_SYNTAX, '').trim()) &&
      NOTE_TOKEN_CHARACTER.test(group.replace(ABC_NOTATION_SYNTAX, ''))
        ? ABC_CHORD_NOTE
        : ' ',
    );
    for (const token of withChordsAsOneNote.split('|')) {
      if (isMusicToken(token)) bars += 1;
    }
  }
  return bars;
}

/**
 * True when a bar TOKEN carries music: with the notation syntax removed, only notes
 * and rests (and at least one of them) may remain. `c2 z2` is music; `#not abc` and
 * a bare `|]` are not.
 */
function isMusicToken(token: string): boolean {
  const music = token.replace(ABC_NOTATION_SYNTAX, '').trim();
  if (music.length === 0) return false;
  return ABC_NOTES_AND_RESTS_ONLY.test(music) && NOTE_TOKEN_CHARACTER.test(music);
}

/** True when the score is a short excerpt rather than a whole work. */
export function isSampleScore(abc: unknown): boolean {
  const bars = countAbcBars(abc);
  return bars > 0 && bars <= SAMPLE_EXCERPT_MAX_BARS;
}

/**
 * "Sample — 4-bar excerpt" for an excerpt, null for anything longer (or empty).
 * The bar count is the score's own, so the label can never claim a length the
 * reader is not showing.
 */
export function sampleExcerptLabel(abc: unknown): string | null {
  const bars = countAbcBars(abc);
  if (bars <= 0 || bars > SAMPLE_EXCERPT_MAX_BARS) return null;
  return `Sample — ${bars}-bar excerpt`;
}

/**
 * The label a READER shows: nothing unless the caller flagged the score as a
 * sample, and the derived bar label when it did. The flag is the caller's
 * assertion (it comes from `isSampleScore` at the entry point); the number always
 * comes from the score itself.
 */
export function readerSampleLabel(input: { isSample: boolean; abc: unknown }): string | null {
  if (!input || input.isSample !== true) return null;
  return sampleExcerptLabel(input.abc) ?? SAMPLE_EXCERPT_FALLBACK_LABEL;
}

/**
 * THE TITLE OF A SAVED TRANSPOSED COPY — the exact format the notation editor has
 * shipped since v33, now shared with the reader:
 *
 *   `<title> (<key> · <sign><offset>)`     e.g. "Für Elise (Am · +2)"
 *
 * A zero offset prints "· 0" (no sign) so a saved original is still labelled with
 * the key it is in. A missing title or key falls back to a readable placeholder
 * rather than printing "undefined"; a non-finite offset is 0.
 */
export function transposedCopyTitle(input: {
  title: unknown;
  keyLabel: unknown;
  offset: unknown;
}): string {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const keyLabel = typeof input?.keyLabel === 'string' ? input.keyLabel.trim() : '';
  const rawOffset = Number(input?.offset);
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  const sign = offset > 0 ? '+' : '';
  return `${title.length > 0 ? title : TRANSPOSED_COPY_UNTITLED} (${
    keyLabel.length > 0 ? keyLabel : 'C'
  } · ${sign}${offset})`;
}

/**
 * The reader's one-line subtitle: which key the user is looking at, and — when
 * they transposed — by how much. Honest by construction: offset 0 says the score
 * is in its original key rather than claiming a shift of zero semitones.
 */
export function transposedReaderSubtitle(input: {
  keyLabel: unknown;
  offset: unknown;
}): string {
  const keyLabel = typeof input?.keyLabel === 'string' && input.keyLabel.trim().length > 0
    ? input.keyLabel.trim()
    : 'C';
  const rawOffset = Number(input?.offset);
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  if (offset === 0) return `Original key · ${keyLabel}`;
  const sign = offset > 0 ? '+' : '';
  return `${keyLabel} · ${sign}${offset} semitone${Math.abs(offset) === 1 ? '' : 's'} from the original`;
}
