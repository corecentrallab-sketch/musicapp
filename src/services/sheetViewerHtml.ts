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

/** Generate the HTML document that wraps PDF.js for rendering. */
export function buildSheetViewerHtml(pdfUrl: string): string {
  // Escape the URL for safe embedding in HTML
  const escapedUrl = pdfUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    width: 100%;
    background: #1a1a2e;
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
    background: #fff;
  }
  #pageIndicator {
    position: absolute;
    bottom: 16px;
    left: 0;
    right: 0;
    text-align: center;
    color: #a0a0b8;
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
    background: rgba(22, 33, 62, 0.72);
    border-radius: 12px;
    padding: 4px 12px;
    color: #eaeaff;
    font-size: 12px;
  }
  #loadingOverlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1a2e;
    z-index: 10;
  }
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #0f3460;
    border-top-color: #e94560;
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
    background: #1a1a2e;
    z-index: 10;
    padding: 32px;
  }
  #errorOverlay .err-icon { font-size: 48px; margin-bottom: 16px; }
  #errorOverlay .err-title { color: #fff; font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  #errorOverlay .err-body { color: #a0a0b8; font-size: 14px; text-align: center; line-height: 1.5; margin-bottom: 20px; }
  #errorOverlay .err-retry {
    background: #e94560;
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
