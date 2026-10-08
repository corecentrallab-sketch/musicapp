/**
 * sheetViewerHtml — the WebView document ScoreViewer renders a score with
 * (PDF.js on a canvas). Split out of ScoreViewer.tsx so the document is a pure
 * string the tier1 gate can assert on, and so the viewer component holds no
 * rendering logic.
 *
 * Behaviour contract (each point is covered by scripts/sheetViewerFit.test.ts):
 *
 *   • CONTAIN-FIT — the page is scaled to the largest size that fits the whole
 *     document in the WebView:
 *         scale = min(W*0.95 / pageWidth, H*0.92 / pageHeight, 3.0)
 *     (the numbers come from sheetViewerFit.ts — one source of truth), and
 *     #pageCanvas may use 96% of the WebView height. The old width-only fit plus
 *     an 85% cap is what made the sheet small and hard to read on a phone;
 *   • RE-FIT — setImmersive()/resize re-render the current page so hiding the
 *     native chrome immediately enlarges the sheet instead of waiting for the
 *     next page turn;
 *   • TAP ZONES ROUTE THROUGH RN — tapZone() posts {type:'tapPage', zone} and
 *     lets ScoreViewer decide (auto-turn running → pause, no page turn; idle →
 *     turn). The zone only falls back to a local page turn when there is no
 *     ReactNativeWebView bridge at all, so a tap can never double-advance;
 *   • SWIPE still turns pages locally (unchanged), and pinch-zoom stays enabled
 *     (viewport user-scalable=yes, maximum-scale=3);
 *   • the page indicator is pointer-events:none (never blocks a tap), shows
 *     "Page N of M" normally and a compact "N / M" pill in immersive mode, and
 *     fades back to a subtle opacity after each page change.
 */
import {
  SHEET_FIT_HEIGHT_RATIO,
  SHEET_FIT_WIDTH_RATIO,
  SHEET_MAX_ZOOM,
  SHEET_PAGE_MAX_HEIGHT_PCT,
  SHEET_REFIT_EPSILON,
} from './sheetViewerFit';
import {
  DARK_THEME,
  DEFAULT_THEME_MODE,
  LIGHT_THEME,
  resolveThemeMode,
  type ThemeMode,
} from './theme';

/**
 * THE DOCUMENT'S OWN CHROME, PER MODE (v34b, owner FAIL item 6 — app-wide theming).
 *
 * The reader is a user-visible surface, so the default is CONVERT: the document is
 * built for a mode, flips with the app, and every colour it paints comes from here.
 *
 * The DARK column is byte-identical to what this document shipped before v34b — the
 * app's own design is the identity, nothing about the dark reader changes. LIGHT is
 * the light palette, read from the SAME tokens as every screen (services/theme.ts),
 * so the reader cannot drift away from the rest of the app.
 *
 * THE PAPER IS THE ONE DELIBERATE EXEMPTION and is NOT themed in either mode: a
 * score is white paper with dark ink, and inverting the page itself would make the
 * staff unreadable — the same reasoning as AbcScoreView / TakeStaffCard, which keep
 * their staff ink. Only the chrome AROUND the page follows the app.
 */
export interface SheetViewerPalette {
  /** The area around the page (html/body, the loading and error overlays). */
  chrome: string;
  /** The page counter's text. */
  indicator: string;
  /** The immersive page pill (translucent, so the sheet shows through). */
  pillBg: string;
  pillText: string;
  errorTitle: string;
  errorBody: string;
  spinnerTrack: string;
  accent: string;
}

export const SHEET_PALETTE: Record<ThemeMode, SheetViewerPalette> = {
  dark: {
    chrome: DARK_THEME.surfaceAlt, // #1a1a2e — unchanged from v33
    indicator: DARK_THEME.subtext, // #a0a0b8
    pillBg: 'rgba(22, 33, 62, 0.72)', // DARK_THEME.surface at 72% — unchanged
    pillText: '#eaeaff', // unchanged from v33
    errorTitle: DARK_THEME.text, // #ffffff
    errorBody: DARK_THEME.subtext,
    spinnerTrack: DARK_THEME.border, // #0f3460
    accent: DARK_THEME.accent, // #e94560
  },
  light: {
    chrome: LIGHT_THEME.surfaceAlt, // #eef1f7
    indicator: LIGHT_THEME.subtext, // #5b6377
    pillBg: 'rgba(230, 235, 245, 0.85)',
    pillText: LIGHT_THEME.chipText, // #25324a
    errorTitle: LIGHT_THEME.text, // #161a24
    errorBody: LIGHT_THEME.subtext,
    spinnerTrack: LIGHT_THEME.border, // #d5dae6
    accent: LIGHT_THEME.accent, // #c2233c
  },
};

/** The staff's paper — the ONE surface no mode may re-colour (white paper, dark ink). */
export const SHEET_PAPER = '#ffffff';

/**
 * One mode's CSS custom properties. BOTH blocks in the document come from this one
 * function, so the two columns cannot drift apart.
 */
export function sheetCssVariables(mode: ThemeMode | string | null): string {
  const p = SHEET_PALETTE[resolveThemeMode(mode)];
  return [
    `--sheet-chrome: ${p.chrome};`,
    `--sheet-indicator: ${p.indicator};`,
    `--sheet-pill-bg: ${p.pillBg};`,
    `--sheet-pill-text: ${p.pillText};`,
    `--sheet-error-title: ${p.errorTitle};`,
    `--sheet-error-body: ${p.errorBody};`,
    `--sheet-spinner-track: ${p.spinnerTrack};`,
    `--sheet-accent: ${p.accent};`,
  ].join(' ');
}

/**
 * The script the host injects when the mode changes while a score is open. It flips
 * the document's own attribute instead of rebuilding the source, so a live toggle
 * re-paints the reader WITHOUT reloading the WebView and losing the reader's page.
 * Defensive: if the document is not ready yet, the baked-in mode already stands.
 */
export function sheetThemeScript(mode: ThemeMode | string | null): string {
  const resolved = resolveThemeMode(mode);
  return `(function(){ try { if (typeof setSheetTheme === 'function') { setSheetTheme('${resolved}'); } } catch (e) {} })(); true;`;
}

/** Generate the HTML document that wraps PDF.js for rendering, for a theme MODE. */
export function buildSheetViewerHtml(
  pdfUrl: string,
  mode: ThemeMode | string | null = DEFAULT_THEME_MODE,
): string {
  // Escape the URL for safe embedding in HTML
  const escapedUrl = pdfUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  // The mode this document is BUILT for (an unknown value lands on the app default).
  const themeMode = resolveThemeMode(mode);

  return `<!DOCTYPE html>
<html data-theme="${themeMode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
<style>
  /* ── v34b: the reader follows the app's mode (owner FAIL item 6) ──
     Both columns come from ONE table (services/sheetViewerHtml.ts
     SHEET_PALETTE, fed by services/theme.ts), so the reader cannot drift away
     from the screens. The DARK column is what this document always painted.
     --sheet-paper is the deliberate exemption: a score is white paper with dark
     ink, and no mode re-colours the page itself. */
  :root {
    ${sheetCssVariables('dark')}
    --sheet-paper: ${SHEET_PAPER};
  }
  :root[data-theme='light'] {
    ${sheetCssVariables('light')}
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    width: 100%;
    background: var(--sheet-chrome, #1a1a2e);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  #container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    position: relative;
    touch-action: pan-x pan-y pinch-zoom;
  }
  #pageCanvas {
    max-width: 100%;
    max-height: ${SHEET_PAGE_MAX_HEIGHT_PCT}%;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    border-radius: 4px;
    /* THE PAPER — the one surface no mode re-colours (white paper, dark ink). */
    background: var(--sheet-paper, #ffffff);
  }
  #pageIndicator {
    position: absolute;
    bottom: 16px;
    left: 0;
    right: 0;
    text-align: center;
    color: var(--sheet-indicator, #a0a0b8);
    font-size: 13px;
    font-weight: 600;
    pointer-events: none;
    transition: opacity 0.6s ease;
    opacity: 0.28;
  }
  /* Immersive mode: compact "N / M" pill so the page number survives the
     native chrome being hidden — and it never intercepts a tap. */
  body.immersive #pageIndicator {
    bottom: 10px;
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    background: var(--sheet-pill-bg, rgba(22, 33, 62, 0.72));
    border-radius: 12px;
    padding: 4px 12px;
    color: var(--sheet-pill-text, #eaeaff);
    font-size: 12px;
  }
  #loadingOverlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--sheet-chrome, #1a1a2e);
    z-index: 10;
  }
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--sheet-spinner-track, #0f3460);
    border-top-color: var(--sheet-accent, #e94560);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  #errorOverlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--sheet-chrome, #1a1a2e);
    z-index: 10;
    padding: 32px;
  }
  #errorOverlay .err-icon { font-size: 48px; margin-bottom: 16px; }
  #errorOverlay .err-title { color: var(--sheet-error-title, #ffffff); font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  #errorOverlay .err-body { color: var(--sheet-error-body, #a0a0b8); font-size: 14px; text-align: center; line-height: 1.5; margin-bottom: 20px; }
  #errorOverlay .err-retry {
    background: var(--sheet-accent, #e94560);
    /* a label ON a brand fill stays white in both modes — the same rule as
       themeApply's named ON_FILL_TEXT_KEYS. */
    color: #fff;
    border: none;
    padding: 12px 28px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }

  /* Tap zones */
  .tap-zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30%;
    z-index: 5;
  }
  .tap-zone-left { left: 0; }
  .tap-zone-right { right: 0; }
</style>
</head>
<body>
<div id="container">
  <div id="loadingOverlay"><div class="spinner"></div></div>
  <div id="errorOverlay">
    <div class="err-icon">⚠️</div>
    <div class="err-title">Could not load sheet music</div>
    <div class="err-body">The PDF may be unavailable or in an unsupported format.</div>
    <button class="err-retry" onclick="retry()">Retry</button>
  </div>
  <canvas id="pageCanvas"></canvas>
  <div id="pageIndicator"></div>
  <div class="tap-zone tap-zone-left" onclick="tapZone('left')"></div>
  <div class="tap-zone tap-zone-right" onclick="tapZone('right')"></div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var FIT_WIDTH_RATIO = ${SHEET_FIT_WIDTH_RATIO};
  var FIT_HEIGHT_RATIO = ${SHEET_FIT_HEIGHT_RATIO};
  var MAX_ZOOM = ${SHEET_MAX_ZOOM};
  var REFIT_EPSILON = ${SHEET_REFIT_EPSILON};

  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let renderTask = null;
  let immersive = false;

  const container = document.getElementById('container');
  const canvas = document.getElementById('pageCanvas');
  const ctx = canvas.getContext('2d');
  const loadingEl = document.getElementById('loadingOverlay');
  const errorEl = document.getElementById('errorOverlay');
  const indicator = document.getElementById('pageIndicator');

  /** Size of the container the current canvas was rendered for. */
  let lastFit = { width: 0, height: 0 };

  /** Contain-fit scale — mirrors containScale() in src/services/sheetViewerFit.ts. */
  function computeScale(viewport) {
    var cw = container.clientWidth;
    var ch = container.clientHeight;
    var byWidth = cw > 0 ? (cw * FIT_WIDTH_RATIO) / viewport.width : Infinity;
    var byHeight = ch > 0 ? (ch * FIT_HEIGHT_RATIO) / viewport.height : Infinity;
    var scale = Math.min(byWidth, byHeight, MAX_ZOOM);
    if (!isFinite(scale) || scale <= 0) return 1;
    return Math.max(0.1, scale);
  }

  function showLoading() {
    loadingEl.style.display = 'flex';
    errorEl.style.display = 'none';
  }

  function hideLoading() {
    loadingEl.style.display = 'none';
  }

  function showError() {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'flex';
    // Notify RN about the error
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error' }));
    }
  }

  let indicatorFadeTimer = null;

  /** Keep the page number visible right after a turn, then fade it back so it
   *  never competes with the music (it is pointer-events:none either way). */
  function pulseIndicator() {
    indicator.style.opacity = '1';
    if (indicatorFadeTimer) clearTimeout(indicatorFadeTimer);
    indicatorFadeTimer = setTimeout(function () {
      indicator.style.opacity = '0.28';
    }, 1600);
  }

  function updateIndicator() {
    indicator.textContent = immersive
      ? (currentPage + ' / ' + totalPages)
      : ('Page ' + currentPage + ' of ' + totalPages);
    pulseIndicator();
    // Notify RN
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pageChange',
        page: currentPage,
        total: totalPages
      }));
    }
  }

  function renderPage(num) {
    if (renderTask) { renderTask.cancel(); }
    showLoading();

    pdfDoc.getPage(num).then(function(page) {
      var viewport = page.getViewport({ scale: 1 });
      var scale = computeScale(viewport);
      var scaledViewport = page.getViewport({ scale: scale });

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      lastFit = { width: container.clientWidth, height: container.clientHeight };

      renderTask = page.render({
        canvasContext: ctx,
        viewport: scaledViewport
      });

      renderTask.promise.then(function() {
        hideLoading();
        renderTask = null;
        updateIndicator();
      }).catch(function(err) {
        if (err.name === 'RenderingCancelledException') return;
        showError();
      });
    }).catch(function(err) {
      showError();
    });
  }

  /** Re-render the current page — used when the container changes size (the
   *  immersive toggle, rotation) so the sheet grows immediately. */
  function refit() {
    if (!pdfDoc || totalPages === 0) return;
    renderPage(currentPage);
  }

  /** Re-render only if the container really changed size. */
  function maybeRefit() {
    var cw = container.clientWidth;
    var ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    var prevW = lastFit.width;
    var prevH = lastFit.height;
    if (prevW <= 0 || prevH <= 0) { refit(); return; }
    var dw = Math.abs(cw - prevW) / prevW;
    var dh = Math.abs(ch - prevH) / prevH;
    if (dw > REFIT_EPSILON || dh > REFIT_EPSILON) refit();
  }

  /** Called from RN when full-screen mode is toggled. The WebView itself is
   *  resized by the host a frame or two later, so schedule the re-fit. */
  function setImmersive(on) {
    immersive = !!on;
    document.body.className = immersive ? 'immersive' : '';
    updateIndicator();
    setTimeout(refit, 80);
    setTimeout(refit, 300);
  }

  /** Re-paint this document for the app's mode (v34b). The host injects this
   *  when the user flips the toggle while a score is open — the attribute flips
   *  the CSS custom properties above, so the reader re-paints WITHOUT reloading
   *  and keeps the page the reader is on. Both columns are already in the
   *  document, so this never needs a rebuild. */
  function setSheetTheme(mode) {
    document.documentElement.setAttribute(
      'data-theme',
      mode === 'light' ? 'light' : 'dark',
    );
  }
  window.setSheetTheme = setSheetTheme;

  function prevPage() {
    if (currentPage <= 1) return;
    currentPage--;
    renderPage(currentPage);
  }

  function nextPage() {
    if (currentPage >= totalPages) return;
    currentPage++;
    renderPage(currentPage);
  }

  /** Tap zones ask RN to decide: auto-turn running → pause (and do NOT also
   *  turn a page), idle → turn. Falls back to a local turn only when there is
   *  no RN bridge at all. */
  function tapZone(zone) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'tapPage',
        zone: zone
      }));
      return;
    }
    if (zone === 'left') { prevPage(); } else { nextPage(); }
  }

  function retry() {
    showLoading();
    renderPage(currentPage);
  }

  // Load the PDF
  pdfjsLib.getDocument('${escapedUrl}').promise.then(function(pdf) {
    pdfDoc = pdf;
    totalPages = pdf.numPages;
    currentPage = 1;
    renderPage(1);
    // Notify RN
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'loaded',
        totalPages: totalPages
      }));
    }
  }).catch(function(err) {
    showError();
  });

  // Swipe handling
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    // Only trigger if horizontal swipe dominates
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) {
        nextPage();
      } else {
        prevPage();
      }
    }
  });

  // A container resize (rotation, immersive toggle in the host) re-fits the
  // page. Debounced: pinch-zoom can fire resize without a layout change.
  window.addEventListener('resize', function() {
    setTimeout(maybeRefit, 120);
  });
</script>
</body>
</html>`;
}
