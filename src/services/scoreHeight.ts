/**
 * scoreHeight.ts — HOW TALL A RENDERED SCORE REALLY IS (v37 item 2, backlog
 * 9e71e467: "the transposed copy re-opens showing only ~4 bars").
 *
 * THE BUG. `AbcScoreView` draws ABC into a WebView, and the WebView is told
 * `scrollEnabled={interactive}`. Every page that hosts a score passes
 * `interactive={false}` (the score is decoration; the PAGE scrolls — see the
 * touch shield in AbcScoreView). The notation editor then gave that viewer a box
 * with a `minHeight` and nothing else, so on a score longer than the box the
 * WebView could not scroll ITSELF and the page had no height to give it: the
 * document simply clipped, and the owner saw a few bars.
 *
 * THE FIX. A non-interactive viewer MEASURES its own document and sizes itself to
 * it, so the whole score lays out and the page's scroller carries it. This module
 * is the pure half: the probe the document runs, the message it posts, and the
 * clamp that decides what height may be applied.
 *
 * PURE: no react, no react-native, no fs. Asserted by scripts/v37UiWiring.test.ts.
 */

/**
 * THE FLOOR A SCORE BOX CAN NEVER COLLAPSE BELOW (v36 fix 3). A `flex: 1`
 * renderer inside an auto-height parent lays out at ZERO, which is what opened
 * the score card empty on the saved transposed copy. The floor makes that
 * structurally impossible for every present and future call site, and it is also
 * the lower clamp for a measured height.
 */
export const ABC_SCORE_MIN_HEIGHT = 120;

/** The upper clamp: a runaway/hostile document may not grow the page without end. */
export const ABC_SCORE_MAX_HEIGHT = 4000;

/** The message type the viewer document posts with its rendered height. */
export const ABC_HEIGHT_MESSAGE_TYPE = 'abc-score-height';

/**
 * The probe script the viewer document runs. Plain ES5 string concatenation on
 * purpose: it is embedded in a template literal, so no `${` may appear in it.
 */
export function abcHeightProbeScript(): string {
  return [
    '<script>',
    '(function () {',
    '  var last = -1;',
    '  function post() {',
    '    var paper = document.getElementById("paper");',
    '    var height = Math.round(Math.max(document.body.scrollHeight, paper ? paper.scrollHeight : 0));',
    '    if (!height || height === last) return;',
    '    last = height;',
    '    if (window.ReactNativeWebView) {',
    '      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "' +
      ABC_HEIGHT_MESSAGE_TYPE +
      '", height: height }));',
    '    }',
    '  }',
    '  window.addEventListener("load", function () { setTimeout(post, 120); setTimeout(post, 700); });',
    '  if (window.ResizeObserver) { try { new ResizeObserver(post).observe(document.body); } catch (e) {} }',
    '  setTimeout(post, 1400);',
    '})();',
    '</script>',
  ].join('\n');
}

/** Clamp a measured document height into the band this app is willing to apply. */
export function clampScoreHeight(height: unknown): number | null {
  const value = Math.round(Number(height));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(ABC_SCORE_MAX_HEIGHT, Math.max(ABC_SCORE_MIN_HEIGHT, value));
}

/** The height a height message carries, or null when it is not one (or is junk). */
export function abcHeightFromMessage(data: unknown): number | null {
  if (typeof data !== 'string' || data.length === 0 || data.length > 400) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as { type?: unknown; height?: unknown };
  if (record.type !== ABC_HEIGHT_MESSAGE_TYPE) return null;
  return clampScoreHeight(record.height);
}

/**
 * The height the score's container should be given, or null to leave the layout
 * alone. NULL UNLESS THE VIEWER IS NON-INTERACTIVE: an interactive viewer scrolls
 * itself and must keep the box its caller gave it (the capture page's 132, the
 * take editor's 150) — only the decorative case may grow.
 */
export function abcScoreContainerHeight(input: {
  interactive: boolean;
  measuredHeight: number | null;
}): number | null {
  if (input.interactive) return null;
  return clampScoreHeight(input.measuredHeight);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE READER BAND — "the entire piece, every bar" (v39 Part 2, owner direction
// 10-11, backlog 5e3dffd3)
// ─────────────────────────────────────────────────────────────────────────────
//
// THE RESIDUAL CLIP. `ABC_SCORE_MAX_HEIGHT` (4000) is the right ceiling for the
// cramped boxes the editor and the capture pages host a score in: it stops a
// runaway document from growing a page without end. But it is a HARD CLIP for a
// whole work: a sonata movement renders at roughly 9000px, so `clampScoreHeight`
// hands back 4000 and everything below the fold is unreachable — "the entire
// work" fails for exactly the pieces the reader exists for. The reader therefore
// runs in one of two BANDS, decided by the SAME measurement the viewer already
// reports:
//
//   • 'page'        — the document fits the reader's ceiling (a short piece, the
//                     bundled excerpts). The reader self-sizes to the FULL
//                     document and the reader's own page scrolls it, so the score
//                     reads like every other surface in the app.
//   • 'self-scroll' — the document is taller than the ceiling (a real work). The
//                     reader hands the viewer a screen-height box and the WebView
//                     scrolls ITSELF (scrollEnabled on), so every bar stays
//                     reachable no matter how long the piece is. Nothing is
//                     clipped; the reader page simply does not carry the scroll.
//
// The band is pure and is asserted by scripts/transposedScoreReader.test.ts.

/**
 * The tallest document the READER will lay out inline. Above it the reader stops
 * growing its box and lets the viewer scroll instead (see `scoreReaderBand`), so
 * this is a handoff point, never a clip: every bar is reachable on both sides.
 */
export const ABC_READER_MAX_HEIGHT = 4000;

/**
 * The box the reader falls back to when the document has not reported a height
 * yet AND the caller's viewport is unusable (a 0-height window during
 * orientation change, a headless render). A visible staff is always better than a
 * collapsed one: the floor is the app's own score minimum, doubled.
 */
export const ABC_READER_VIEWPORT_FALLBACK = ABC_SCORE_MIN_HEIGHT * 2;

/** Which of the reader's two layout bands a measured document belongs to. */
export type ScoreReaderBand = 'page' | 'self-scroll';

/**
 * THE BAND RULE. A document AT the ceiling still lays out inline (`page`): the
 * ceiling is inclusive, so `clampReaderScoreHeight` and this rule agree exactly
 * and a document can never be clamped into the other band's territory. An
 * unmeasured / junk / non-positive height is `page` — the reader lays out its
 * fallback box and waits for the real measurement rather than guessing that the
 * piece is long.
 */
export function scoreReaderBand(measuredHeight: unknown): ScoreReaderBand {
  const value = Math.round(Number(measuredHeight));
  if (!Number.isFinite(value) || value <= 0) return 'page';
  return value > ABC_READER_MAX_HEIGHT ? 'self-scroll' : 'page';
}

/**
 * Clamp a measured height into the reader's own band `[ABC_SCORE_MIN_HEIGHT,
 * ABC_READER_MAX_HEIGHT]`, or null when there is nothing to clamp. Same shape as
 * `clampScoreHeight` on purpose — this is the reader's ceiling, not the app's.
 */
export function clampReaderScoreHeight(height: unknown): number | null {
  const value = Math.round(Number(height));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(ABC_READER_MAX_HEIGHT, Math.max(ABC_SCORE_MIN_HEIGHT, value));
}

/**
 * THE BOX THE READER GIVES ITS VIEWER — a number, always, because a whole-work
 * reader must never render a collapsed staff while it waits for a measurement.
 *
 *   • 'page'        → the measured document height (clamped), so the WHOLE score
 *                     is laid out and the reader's page scrolls it.
 *   • 'self-scroll' → the caller's viewport height (clamped), i.e. a screen-sized
 *                     window the WebView scrolls inside. The document is taller
 *                     than the box on purpose here: that is the whole point of the
 *                     band, and `scrollEnabled` is on for it in AbcScoreView.
 *   • unmeasured    → the viewport box, so the first frame already shows a staff.
 */
export function abcReaderContainerHeight(input: {
  measuredHeight: unknown;
  viewportHeight: unknown;
}): number {
  const viewport = clampReaderScoreHeight(input.viewportHeight) ?? ABC_READER_VIEWPORT_FALLBACK;
  if (scoreReaderBand(input.measuredHeight) === 'self-scroll') return viewport;
  return clampReaderScoreHeight(input.measuredHeight) ?? viewport;
}
