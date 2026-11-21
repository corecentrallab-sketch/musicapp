/**
 * THE TWO ABCjs DOCUMENTS — the card's and the reader's (D27).
 *
 * WHY THIS FILE EXISTS. `generateAbcHtml` used to live inside the React Native
 * component, so nothing outside a handset could render the score and the "make
 * the notes bigger" claim could not be measured. The builder is now a pure
 * module: the pixel harness (scripts/d27NoteheadHarness.ts) renders the REAL
 * document in a headless browser and reads notehead and staff-line heights back
 * out of `getBoundingClientRect()`, before and after. A fix without that number
 * is an opinion.
 *
 * TWO DOCUMENTS, ONE RENDERER, ONE SCORE:
 *
 *   • `generateAbcHtml` — THE CARD. Unchanged from v43: `responsive: 'resize'`
 *     re-lays the tune out at the container's width so the score FITS its card,
 *     and `max-width: 100%` caps the result. It can only ever shrink, which is
 *     exactly right for a card and exactly wrong for a reader.
 *   • `generateAbcReaderHtml` — THE READER. `responsive` is off (with it on,
 *     abcjs throws `scale` away: see its own `getScale`, "resize" → undefined),
 *     so a fixed `staffwidth` decides the layout and `scale` decides the size.
 *     The drawing is then WIDER than the phone on purpose and `#paper` lets the
 *     WebView pan sideways: bigger notes, a few bars per system, and the last
 *     bar one scroll away.
 *
 * Neither document carries a remote URL: both take the renderer script from the
 * app's own bundle (`ABCJS_BASIC_MIN_JS`), so the reader still renders offline.
 */
import { ABCJS_BASIC_MIN_JS } from '../assets/abcjsBasic';
import { abcHeightProbeScript } from './scoreHeight';

/** The ink a score is drawn in when the caller names none (near-black on paper). */
export const ABC_DEFAULT_INK = '#0b1220';
/** The paper a score is drawn on when the caller names none. */
export const ABC_DEFAULT_BACKGROUND = '#ffffff';

/**
 * HOW BIG THE READER DRAWS (D27, measured — see scripts/d27NoteheadHarness.ts).
 *
 * `scale` multiplies the whole engraving, so it is the only knob that makes a
 * NOTEHEAD bigger; `responsive: 'resize'` only re-flows the tune to fit, which
 * is why the vc61 full-screen window showed the owner the same small notes with
 * more margin around them.
 */
export const READER_SCALE = 1.8;
/** A 4/4 bar at scale 1, in abcjs layout pixels. */
export const READER_BAR_WIDTH_PX = 80;
/** Bars per system in the reader. Four is the ceiling §2 of the D27 spec allows. */
export const READER_BARS_PER_SYSTEM = 4;
/** abcjs turns `staffwidth` into a layout width of `1.33 * staffwidth` px. */
export const READER_STAFF_WIDTH_FACTOR = 1.33;
/** The narrowest scale the reader may ever be drawn at (D27 spec §2/§5). */
export const READER_MIN_SCALE = 1.5;

/**
 * THE SCALE → BAR-WIDTH MATH, as a pure function so a later "tuning" cannot
 * silently shrink the notes back (D27 spec §5, last guard).
 *
 * `staffwidth` is what abcjs uses to lay the tune out; `systemWidthPx` is what
 * the owner actually sees once `scale` has been applied. The relationship is
 * deliberately explicit: the reader's system is `scale` times the layout width,
 * so at `READER_SCALE` a four-bar system is wider than a 360 dp phone and the
 * reader has something to pan to — while every bar keeps its `READER_BAR_WIDTH_PX`
 * of unscaled room.
 */
export function readerLayout(scale: number = READER_SCALE): {
  scale: number;
  barsPerSystem: number;
  staffwidth: number;
  systemWidthPx: number;
} {
  const applied = Number.isFinite(scale) && scale >= READER_MIN_SCALE ? scale : READER_SCALE;
  const barsPerSystem = READER_BARS_PER_SYSTEM;
  const layoutWidthPx = barsPerSystem * READER_BAR_WIDTH_PX;
  return {
    scale: applied,
    barsPerSystem,
    staffwidth: Math.round(layoutWidthPx / READER_STAFF_WIDTH_FACTOR),
    systemWidthPx: Math.round(layoutWidthPx * applied),
  };
}

/** The reader's `staffwidth`, in abcjs layout px. */
export function readerStaffWidth(scale: number = READER_SCALE): number {
  return readerLayout(scale).staffwidth;
}

function documentShell(
  abc: string,
  ink: string,
  background: string,
  rendererScript: string,
  bodyCss: string,
  renderCall: string,
): string {
  const abcJson = JSON.stringify(abc);
  const inkJson = JSON.stringify(ink);
  const backgroundJson = JSON.stringify(background);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; min-height: 100%; background: ${background}; }
  body { padding: 12px 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
${bodyCss}
  /* The caller's ink, applied to every drawn shape: staff lines (stroked paths),
     noteheads (filled paths), beams and the title text. */
  #paper svg path, #paper svg text, #paper svg tspan, #paper svg rect,
  #paper svg line, #paper svg polyline, #paper svg polygon, #paper svg ellipse {
    fill: ${ink}; stroke: ${ink};
  }
  #error {
    display: none; color: #e94560; font-size: 14px; text-align: center;
    padding: 24px 16px; line-height: 1.5;
  }
</style>
</head>
<body>
  <div id="paper"></div>
  <div id="error">Could not render this ABC score.</div>
<script>${rendererScript}</script>
<script>
  (function () {
    var abc = ${abcJson};
    var ink = ${inkJson};
    var errorBox = document.getElementById('error');
    try {
      if (!window.ABCJS || typeof window.ABCJS.renderAbc !== 'function') {
        // Honest failure, on screen. The renderer is bundled, so this can only
        // happen if the bundle in this build is damaged — never because the
        // phone is offline. Silence here was the whole bug: an empty staff.
        errorBox.textContent = 'The score renderer did not load in this build.';
        errorBox.style.display = 'block';
      } else {
        ${renderCall}
      }
    } catch (e) {
      errorBox.textContent = 'Could not render this ABC score.';
      errorBox.style.display = 'block';
    }
  })();
</script>
${abcHeightProbeScript()}
</body>
</html>`;
}

/**
 * THE CARD DOCUMENT — unchanged (D27 spec §4.2). `responsive: 'resize'` and the
 * `max-width: 100%` cap are what make a score FIT its card; a guard asserts both
 * are still here.
 */
export function generateAbcHtml(
  abc: string,
  ink: string = ABC_DEFAULT_INK,
  background: string = ABC_DEFAULT_BACKGROUND,
  rendererScript: string = ABCJS_BASIC_MIN_JS,
): string {
  return documentShell(
    abc,
    ink,
    background,
    rendererScript,
    `  #paper { display: flex; flex-direction: column; align-items: center; }
  #paper svg { max-width: 100%; height: auto !important; }`,
    `window.ABCJS.renderAbc('paper', abc, {
          responsive: 'resize',
          paddingtop: 0,
          paddingbottom: 0,
          add_classes: true,
          foregroundColor: ink
        });`,
  );
}

/**
 * THE READER DOCUMENT — bigger notes, sideways scroll (D27 option A).
 *
 * `responsive` is deliberately ABSENT: abcjs drops `scale` when it is set, and
 * a fixed `staffwidth` is what keeps the system to `READER_BARS_PER_SYSTEM`
 * bars. The `max-width: 100%` cap is lifted for the same reason — a cap is what
 * stopped the score ever being drawn bigger than the box.
 */
export function generateAbcReaderHtml(
  abc: string,
  ink: string = ABC_DEFAULT_INK,
  background: string = ABC_DEFAULT_BACKGROUND,
  rendererScript: string = ABCJS_BASIC_MIN_JS,
  scale: number = READER_SCALE,
): string {
  const layout = readerLayout(scale);
  return documentShell(
    abc,
    ink,
    background,
    rendererScript,
    `  /* THE READER PANS SIDEWAYS (D27). No max-width cap, no centring: the
     drawing is as wide as the music needs and the WebView scrolls it. */
  #paper { display: block; }
  #paper svg { max-width: none !important; height: auto !important; }
  /* ── D37: THE DOCUMENT IS AS WIDE AS THE DRAWING, NOT AS WIDE AS THE PHONE ──
     The shell pins html/body to 'width: 100%', which is right for the CARD (the
     drawing is capped to the card) and wrong for the reader: a drawing wider
     than the viewport overflowed a body whose width was already fixed, so the
     right-hand end of every system — the last bar, and any text drawn over it —
     could not be reached by panning at all, however far the user dragged. The
     body is now its own content width (never narrower than the screen), so the
     WebView's scroll width IS the drawing's width and the last pixel is
     reachable. The card document does not carry these rules. */
  html { width: max-content; }
  body { width: max-content; min-width: 100vw; }`,
    `window.ABCJS.renderAbc('paper', abc, {
          scale: ${layout.scale},
          staffwidth: ${layout.staffwidth},
          wrap: { preferredMeasuresPerLine: ${layout.barsPerSystem} },
          paddingtop: 0,
          paddingbottom: 0,
          add_classes: true,
          foregroundColor: ink
        });`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// D40 — THE SCORE WRAPS (owner 2026-11-21)
// ─────────────────────────────────────────────────────────────────────────────
//
// THE BUG. A 32-bar take was drawn as ONE unbroken system: a strip of marks a few
// pixels tall across the full width, with the rest of the screen empty. Both the
// card and the full-screen reader did it.
//
// WHY IT HAPPENED, in abcjs's own terms. The card document passes no `staffwidth`,
// so abcjs lays the tune out at its default 740 layout px — the whole 32 bars on
// one line — and `max-width: 100%` then scales that 740 px drawing down into a
// ~330 px card. Nothing is "fit", everything is SHRUNK. abcjs only ever wraps a
// tune when BOTH `wrap` and `staffwidth` are given (`calcLineWraps` returns early
// otherwise), and the card gave it neither. The reader document gave it both, but
// with a staffwidth small enough that abcjs's fixed-measures attempt failed and
// fell through to whatever it could fit.
//
// THE FIX, and the rule it encodes:
//
//   • THE SCORE IS FIT TO THE WIDTH IT HAS, AND THEN WRAPS DOWN THE PAGE. The
//     document measures its own paper, and lays the tune out at exactly that
//     width — so nothing is ever scaled down to fit — with `wrap` telling abcjs
//     how many bars may share a system.
//   • A BAR IS NEVER SQUEEZED TO MAKE ONE LINE WORK (the D27 legibility floor).
//     `WRAP_MIN_BAR_WIDTH_PX` is the room a bar must keep; when the width cannot
//     hold four bars at that size, the system holds fewer bars and the music
//     continues on the next one. More bars never means smaller marks.
//   • FOUR BARS IS THE CEILING (D27 spec §2), one is the floor.
//
// `wrapLayout` is the math, pure, so the gate can prove the floor holds at every
// width and scale without a browser; the document runs the same math on its own
// measured width (see `wrapRenderCall`).

/** The room a bar must keep, in abcjs layout px, before the score wraps instead. */
export const WRAP_MIN_BAR_WIDTH_PX = READER_BAR_WIDTH_PX;
/** The most bars a system may hold (D27 spec §2 ceiling). */
export const WRAP_MAX_BARS_PER_SYSTEM = READER_BARS_PER_SYSTEM;
/** The fewest bars a system may hold — one very wide bar beats a squeezed two. */
export const WRAP_MIN_BARS_PER_SYSTEM = 1;
/** The scale a wrapped CARD is drawn at: natural size, never shrunk. */
export const WRAP_DEFAULT_SCALE = 1;
/** The smallest scale a wrapped score may be drawn at (the D27 floor is higher). */
export const WRAP_SCALE_FLOOR = 1;
/** The width the document assumes when it cannot measure itself (a headless render). */
export const WRAP_FALLBACK_WIDTH_PX = 320;

export interface WrapLayout {
  /** The scale the music is engraved at (never below `WRAP_SCALE_FLOOR`). */
  scale: number;
  /** How many bars share a system. */
  barsPerSystem: number;
  /** The `staffwidth` abcjs needs for that layout width. */
  staffwidth: number;
  /** The layout width, unscaled — the room the music is laid out in. */
  layoutWidthPx: number;
  /** What the reader sees: the layout width drawn at `scale`. */
  systemWidthPx: number;
}

/**
 * HOW A WRAPPED SCORE IS LAID OUT AT A GIVEN WIDTH. Pure; the document's own
 * script runs the same arithmetic against the width it measured.
 *
 * `containerWidthPx` is what the score may occupy on screen. The layout width is
 * that divided by the scale (a bigger engraving needs more screen per layout px),
 * and the bars per system is the layout width divided by the floor a bar needs —
 * clamped to one..four. So a narrower card, or a bigger scale, gives FEWER bars
 * per system and more systems down the page: exactly the trade a reader wants,
 * and never a smaller mark.
 */
export function wrapLayout(
  containerWidthPx: unknown,
  scale: unknown = WRAP_DEFAULT_SCALE,
): WrapLayout {
  const rawWidth = Number(containerWidthPx);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : WRAP_FALLBACK_WIDTH_PX;
  const rawScale = Number(scale);
  const applied =
    Number.isFinite(rawScale) && rawScale >= WRAP_SCALE_FLOOR ? rawScale : WRAP_DEFAULT_SCALE;
  const layoutWidthPx = Math.max(
    WRAP_MIN_BAR_WIDTH_PX * WRAP_MIN_BARS_PER_SYSTEM,
    Math.round(width / applied),
  );
  const barsPerSystem = Math.max(
    WRAP_MIN_BARS_PER_SYSTEM,
    Math.min(WRAP_MAX_BARS_PER_SYSTEM, Math.floor(layoutWidthPx / WRAP_MIN_BAR_WIDTH_PX)),
  );
  return {
    scale: applied,
    barsPerSystem,
    staffwidth: Math.max(1, Math.round(layoutWidthPx / READER_STAFF_WIDTH_FACTOR)),
    layoutWidthPx,
    systemWidthPx: Math.round(layoutWidthPx * applied),
  };
}

/**
 * THE WRAPPED DOCUMENT'S RENDER CALL. It measures its own paper, runs the same
 * arithmetic as `wrapLayout` on that width, and hands abcjs a `staffwidth` AND a
 * `wrap` — the two options abcjs needs before it will break a tune into systems
 * at all. It re-draws when the paper's width changes (a rotation, or the reader's
 * own zoom re-sizing the box), so a wrapped score is never laid out for a width
 * it no longer has.
 *
 * TWO MEASURED FACTS ABOUT ABCJS 6.2.3 SHAPE THIS, both read back out of a real
 * headless render rather than assumed:
 *
 *   1. `scale` is applied as a CSS `transform: scale(s)` on the <svg>, NOT as a
 *      bigger layout. A transformed box does not move its neighbours, so at
 *      `scale: 1.8` a 32-bar take drew 679 px wide inside a 377 px paper and the
 *      document reported a height 1.8× too small — the drawing ran off the side
 *      and the box under it was short. So this document renders at `scale: 1` and
 *      does the enlargement the honest way: it lays the music out in a NARROWER
 *      layout width (that is what `layoutWidthPx` is) and then stretches the
 *      finished drawing to exactly the paper's width, recording the stretched
 *      height on the paper so the height probe reports the truth.
 *   2. Without a `staffwidth`, abcjs lays the tune out at 740 px and CSS shrinks
 *      it — a 32-bar take measured SIX PIXELS TALL in a 393 px phone. That is the
 *      owner's "strip of marks", and it is why both options are mandatory here.
 */
function wrapRenderCall(scale: number): string {
  return [
    'var SCALE = ' + scale + ';',
    'var MIN_BAR = ' + WRAP_MIN_BAR_WIDTH_PX + ';',
    'var MAX_BARS = ' + WRAP_MAX_BARS_PER_SYSTEM + ';',
    'var MIN_BARS = ' + WRAP_MIN_BARS_PER_SYSTEM + ';',
    'var FACTOR = ' + READER_STAFF_WIDTH_FACTOR + ';',
    'var lastWidth = -1;',
    'function draw() {',
    '  var paper = document.getElementById("paper");',
    '  if (!paper) return;',
    '  var width = Math.round(paper.clientWidth || window.innerWidth || ' + WRAP_FALLBACK_WIDTH_PX + ');',
    '  if (!width || width === lastWidth) return;',
    '  lastWidth = width;',
    // The same arithmetic as wrapLayout(): the layout width is the screen width
    // divided by the scale, and the bars per system is that divided by the room a
    // bar must keep — clamped to one..four, so a bar is never squeezed.
    '  var layoutWidth = Math.max(MIN_BAR * MIN_BARS, Math.round(width / SCALE));',
    '  var bars = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(layoutWidth / MIN_BAR)));',
    '  var staffwidth = Math.max(1, Math.round(layoutWidth / FACTOR));',
    "  window.ABCJS.renderAbc('paper', abc, {",
    '    scale: 1,',
    '    staffwidth: staffwidth,',
    '    wrap: { preferredMeasuresPerLine: bars },',
    '    paddingtop: 0,',
    '    paddingbottom: 0,',
    '    add_classes: true,',
    '    foregroundColor: ink',
    '  });',
    // FIT TO WIDTH: the finished drawing is stretched to exactly the paper's
    // width (the layout width was `scale` times narrower, so this is what makes
    // the notes `scale` times bigger), and the paper is given the stretched
    // height so the height probe — and the box the app grows for it — is right.
    '  var svg = paper.querySelector("svg");',
    '  if (!svg) return;',
    '  var drawn = svg.getBoundingClientRect().width;',
    '  if (!drawn) return;',
    '  var factor = width / drawn;',
    '  svg.style.transformOrigin = "0 0";',
    '  svg.style.transform = "scale(" + factor + ", " + factor + ")";',
    '  paper.style.height = Math.ceil(svg.getBoundingClientRect().height) + "px";',
    '}',
    'draw();',
    'window.addEventListener("resize", function () { setTimeout(draw, 60); });',
  ].join('\n');
}

/**
 * THE WRAPPED DOCUMENT — fit to width, then wrap down the page (D40).
 *
 * NO `responsive: 'resize'` here, and that is the whole point: with it abcjs lays
 * the tune out at its own 740 px default and throws `scale` away, which is how a
 * 32-bar take became one microscopic line. The drawing is instead laid out at a
 * fixed `staffwidth` with a fixed bars-per-system, and then fitted to the paper's
 * real width (see `wrapRenderCall`).
 */
export function generateAbcWrappedHtml(
  abc: string,
  ink: string = ABC_DEFAULT_INK,
  background: string = ABC_DEFAULT_BACKGROUND,
  rendererScript: string = ABCJS_BASIC_MIN_JS,
  scale: number = WRAP_DEFAULT_SCALE,
): string {
  const applied = wrapLayout(WRAP_FALLBACK_WIDTH_PX, scale).scale;
  return documentShell(
    abc,
    ink,
    background,
    rendererScript,
    `  /* ── D40: FIT TO WIDTH, THEN WRAP ── the paper is the box the drawing is
     fitted to (its height is set by the render call), and the music continues on
     the next system instead of being squeezed onto one line. No width cap: the
     drawing is already exactly as wide as the paper. */
  #paper { display: block; position: relative; }
  #paper svg { max-width: none; }`,
    wrapRenderCall(applied),
  );
}

/**
 * The document measures itself and posts its height back (v37 item 2). It lives
 * in services/scoreHeight.ts — the one probe, imported by both documents.
 */
