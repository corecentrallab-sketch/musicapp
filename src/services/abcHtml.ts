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
  #paper svg { max-width: none !important; height: auto !important; }`,
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

/**
 * The document measures itself and posts its height back (v37 item 2). It lives
 * in services/scoreHeight.ts — the one probe, imported by both documents.
 */
