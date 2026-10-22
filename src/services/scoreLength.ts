/**
 * scoreLength.ts — the HONEST LENGTH LINE for a score, printed next to it.
 *
 * WHY IT EXISTS (v43 slice 2, owner 10-22). The owner's repeated on-device
 * complaint was "it only shows 4 bars". The app was telling the truth and the
 * owner could not tell: a bundled sample rendered exactly four bars, with no
 * words on screen saying that four bars was ALL THERE WAS. A short score and a
 * broken renderer looked identical.
 *
 * So every score surface now prints the score's own length, in the owner's
 * wording:
 *
 *   • a bundled sample  → "Bars 1–4 of 4"     (all of it, and it says so)
 *   • a whole melody    → "16 bars"           (no excerpt claim invented)
 *
 * The number always comes from the ABC itself (`countAbcBars`), never from a
 * typed constant, so the line can never claim a length the reader is not
 * showing. Returns null when the score has no readable music — a surface shows
 * nothing rather than "Bars 1–0 of 0".
 *
 * Pure logic, no react-native / expo imports (plain Node tests).
 */
import { SAMPLE_EXCERPT_MAX_BARS, countAbcBars } from './transposedScore';

/** testID / tag the surfaces render with (one source of truth for the gate). */
export const SCORE_LENGTH_TAG = 'score-length';

/**
 * Is this score one of the short bundled samples? (Same rule as the sample
 * badge: > 0 bars and at most SAMPLE_EXCERPT_MAX_BARS.)
 */
export function isExcerptScore(abc: unknown): boolean {
  const bars = countAbcBars(abc);
  return bars > 0 && bars <= SAMPLE_EXCERPT_MAX_BARS;
}

/**
 * The length line, or null when there is no music to measure.
 * NOTE the EN DASH (U+2013) in "1–4": that is the owner's wording, adopted
 * verbatim from the v43 diagnosis ("Bars 1–4 of 4").
 */
export function scoreLengthLine(abc: unknown): string | null {
  const bars = countAbcBars(abc);
  if (bars <= 0) return null;
  if (bars <= SAMPLE_EXCERPT_MAX_BARS) return `Bars 1\u2013${bars} of ${bars}`;
  return `${bars} bars`;
}

/**
 * The same line for a screen reader, with the caveat spoken out loud: a sample
 * says it is a sample, a longer score says only what it is (its bar count), so
 * neither reading over-claims what the work is.
 */
export function scoreLengthAccessibilityLabel(abc: unknown): string | null {
  const line = scoreLengthLine(abc);
  if (!line) return null;
  return isExcerptScore(abc)
    ? `${line} \u2014 a bundled sample, not the full work`
    : `${line} in this score`;
}
