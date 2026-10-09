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
