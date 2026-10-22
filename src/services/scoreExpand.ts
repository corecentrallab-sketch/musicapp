/**
 * scoreExpand.ts — THE PURE HALF OF "one full-screen score expander on every
 * notation surface" (v43 fix batch, slice 3, item E).
 *
 * THE PROBLEM THE EXPANDER SOLVES. Every notation surface in the app draws the
 * score inside a CARD: the editor's staff card, the take's two staves, the
 * capture window's preview, the practice-video page, the PDF and the scanned
 * pages. A card is the right size for a page you also read other things on, and
 * the wrong size for actually READING the music — the owner's recurring "only a
 * few bars" complaint has a second half that layout cannot fix: on a phone, a
 * card is simply narrow.
 *
 * ONE AFFORDANCE, ONE WORD. The expander is presentation ONLY: it re-renders the
 * SAME element the surface already renders (same props, same transposition, same
 * page, same ink and paper) inside a full-screen modal. That is why nothing here
 * touches the score: the module owns the LABELS, the VIEWPORT BOX the modal hands
 * the renderer, and the rule for when an expander makes sense at all.
 *
 * THE BOX REUSES THE ONE LAYOUT SYSTEM (services/scoreHeight.ts). A modal is the
 * one place in the app where a genuinely screen-sized window is known, so the box
 * is simply "the window, minus the insets, minus this component's own header" —
 * clamped into the band `AbcScoreView`'s `wholeWork` contract already speaks
 * (`ABC_SCORE_MIN_HEIGHT` floor, `ABC_READER_MAX_HEIGHT` ceiling). A long work
 * therefore lands in the SAME `self-scroll` band it lands in inside the editor and
 * the reader: the WebView scrolls itself, nothing is clipped, and there is no
 * second layout system to keep in step.
 *
 * PURE: no react, no react-native, no expo. Asserted by scripts/scoreExpand.test.ts
 * and pinned on the surfaces by src/services/scoreExpandContract.ts.
 */

import { ABC_READER_MAX_HEIGHT, ABC_SCORE_MIN_HEIGHT } from './scoreHeight';

/** The one word every notation surface uses for this affordance. */
export const SCORE_EXPAND_LABEL = 'Full screen';

/**
 * The take-correction editor's variant: the expanded staff is READ-ONLY (editing
 * stays in the modal's parent), and saying so in the label is the honest way to
 * prevent a user tapping notes that cannot respond.
 */
export const SCORE_EXPAND_READONLY_LABEL = 'Full screen (read-only)';

/** The close affordance's accessibility label (the visible glyph is a ✕). */
export const SCORE_EXPAND_CLOSE_LABEL = 'Close full screen';

/**
 * The modal's own header height (title + key chip + the 44x44 close button). The
 * viewport box subtracts it so the score is not laid out underneath the header.
 */
export const SCORE_EXPAND_HEADER_HEIGHT = 56;

/** A finite non-negative pixel value, or 0 (junk, negatives and NaN read as 0). */
function px(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * THE VIEWPORT THE MODAL HANDS THE RENDERER (`AbcScoreView`'s `viewportHeight`).
 *
 *   • the window, minus the top and bottom safe-area insets, minus the modal's
 *     header — i.e. exactly the rectangle the score may occupy;
 *   • clamped into the ONE band the renderer understands, so the number is always
 *     a usable box: never below `ABC_SCORE_MIN_HEIGHT` (a collapsed staff is the
 *     bug this app has fixed four times) and never above `ABC_READER_MAX_HEIGHT`
 *     (above it the reader hands the scroll to the WebView anyway).
 *
 * A junk or missing `windowHeight` (a headless render, a 0-height window during
 * an orientation change) falls back to the score floor rather than to 0: a visible
 * staff is always better than a collapsed one.
 */
export function fullScreenScoreBox(input: {
  windowHeight: unknown;
  topInset?: unknown;
  bottomInset?: unknown;
  headerHeight?: unknown;
}): number {
  const windowHeight = px(input?.windowHeight);
  const topInset = px(input?.topInset);
  const bottomInset = px(input?.bottomInset);
  const header = px(input?.headerHeight) || SCORE_EXPAND_HEADER_HEIGHT;
  const usable = windowHeight - topInset - bottomInset - header;
  if (!Number.isFinite(usable) || usable <= 0) return ABC_SCORE_MIN_HEIGHT;
  return Math.max(ABC_SCORE_MIN_HEIGHT, Math.min(Math.round(usable), ABC_READER_MAX_HEIGHT));
}

/**
 * WHETHER AN EXPANDER MAKES SENSE ON THIS SURFACE. A rendered score (a non-empty
 * notation string) can always be read bigger; so can a set of IMAGE pages — a
 * scanned or PDF page is the case where full screen helps MOST, so "images can
 * expand too" is a rule, not an exception. An empty surface must not offer a
 * button that would open an empty modal.
 */
export function canExpandScore(input: {
  hasAbc?: unknown;
  isImagePages?: unknown;
}): boolean {
  const hasAbc =
    input?.hasAbc === true ||
    (typeof input?.hasAbc === 'string' && input.hasAbc.trim().length > 0);
  return hasAbc || input?.isImagePages === true;
}

/** The transcript of "Am → Bm" when both names are known. Assembled, never typed. */
export const SCORE_EXPAND_ARROW = ' \u2192 ';
/** The separator the app already uses on its derived labels ("Choose a piece · 8"). */
export const SCORE_EXPAND_DOT = ' \u00b7 ';

/**
 * The header's honest second line: which key the user is actually looking at. It
 * is DERIVED from the two names the surface already knows, and null when there is
 * nothing truthful to say (no transposition, or the same key twice) — the modal
 * then shows no chip at all rather than an empty one.
 */
export function scoreExpandSubtitle(input: {
  from?: unknown;
  to?: unknown;
}): string | null {
  const from = typeof input?.from === 'string' ? input.from.trim() : '';
  const to = typeof input?.to === 'string' ? input.to.trim() : '';
  if (from.length === 0 || to.length === 0 || from === to) return null;
  return 'Transposed' + SCORE_EXPAND_DOT + from + SCORE_EXPAND_ARROW + to;
}
