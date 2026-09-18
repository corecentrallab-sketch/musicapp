/**
 * Unit tests for the v21 sheet-viewer UX upgrade (owner request 2026-09-18:
 * the sheet was "visually hard to read" → full-screen mode + a speed control):
 *
 *   • src/services/sheetViewerFit.ts  — contain-fit scale, re-fit decision,
 *     auto-turn speed mapping, immersive copy/counters;
 *   • src/services/sheetViewerHtml.ts — the generated WebView document that
 *     must actually USE those numbers (contain-fit both axes, 96% cap, tap
 *     zones routed through RN, setImmersive/refit, pinch-zoom kept).
 *
 * The HTML is a template string, so it is asserted as text: every claim here is
 * about something a user would otherwise only discover on a device.
 *
 * Run with: npm run test:tier1 — pure modules + plain Node, no app runtime, no
 * react-native, no network, same convention as the other scripts/*.test.ts.
 */
import {
  AUTO_TURN_BEATS_PER_PAGE_MAX,
  AUTO_TURN_BEATS_PER_PAGE_MIN,
  AUTO_TURN_BPM_MAX,
  AUTO_TURN_BPM_MIN,
  AUTO_TURN_DEFAULT_BEATS_PER_PAGE,
  AUTO_TURN_DEFAULT_BPM,
  AUTO_TURN_TOGGLE_LABEL,
  IMMERSIVE_ENTER_LABEL,
  IMMERSIVE_EXIT_LABEL,
  SHEET_FIT_HEIGHT_RATIO,
  SHEET_FIT_WIDTH_RATIO,
  SHEET_MAX_ZOOM,
  SHEET_MIN_SCALE,
  SHEET_PAGE_MAX_HEIGHT_PCT,
  autoTurnChipLabel,
  autoTurnEndedAtLastPage,
  containScale,
  pageChipText,
  secondsPerPage,
  shouldRefit,
} from '../src/services/sheetViewerFit';
import { buildSheetViewerHtml } from '../src/services/sheetViewerHtml';

declare const process: { exit(code: number): never; cwd(): string };
declare const require: (moduleName: string) => any;

let failures = 0;
let passes = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

function assertClose(
  actual: number,
  expected: number,
  msg: string,
  eps = 1e-6,
): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= eps) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)} ±${eps})`,
    );
  }
}

// ─── contain-fit scale ──────────────────────────────────────────
function containScaleTests(): void {
  console.log('\ncontain-fit scale');

  // Portrait phone, A4 portrait page (595 x 842 pt) inside a 390 x 640 WebView.
  // Width binds: (390 * 0.95) / 595 = 0.622689…
  const phone = containScale({
    containerWidth: 390,
    containerHeight: 640,
    pageWidth: 595,
    pageHeight: 842,
  });
  assertClose(phone, 0.6226890756302521, 'portrait page on a phone fits by width');
  assert(
    phone > (390 * 0.92) / 595,
    'contain-fit is bigger than the old width-only fit (0.92 ratio)',
  );

  // Landscape WebView (800 x 500): height binds.
  // (500 * 0.92) / 842 = 0.546318…
  const landscape = containScale({
    containerWidth: 800,
    containerHeight: 500,
    pageWidth: 595,
    pageHeight: 842,
  });
  assertClose(landscape, 0.5463182897862233, 'tall page in a wide view fits by height');
  assert(
    landscape < (800 * 0.95) / 595,
    'the smaller of the two fits wins (nothing is cropped)',
  );

  // Immersive mode: the same page, a taller container once the chrome is gone.
  const withChrome = containScale({
    containerWidth: 390,
    containerHeight: 500,
    pageWidth: 400,
    pageHeight: 600,
  });
  const immersive = containScale({
    containerWidth: 390,
    containerHeight: 700,
    pageWidth: 400,
    pageHeight: 600,
  });
  assertClose(withChrome, 0.7666666666666667, 'short container height-limits the page');
  assertClose(immersive, 0.92625, 'immersive (taller) container gives a bigger page');
  assert(
    immersive > withChrome,
    'hiding the chrome materially enlarges a height-limited page',
  );

  // Zoom ceiling.
  assertEq(
    containScale({
      containerWidth: 4000,
      containerHeight: 4000,
      pageWidth: 100,
      pageHeight: 100,
    }),
    SHEET_MAX_ZOOM,
    'scale is capped at 3x',
  );
  assertEq(
    containScale({
      containerWidth: 4000,
      containerHeight: 4000,
      pageWidth: 100,
      pageHeight: 100,
      maxZoom: 2,
    }),
    2,
    'a maxZoom override is honoured',
  );

  // Degenerate inputs must never yield NaN / 0 / negative — a 0-px canvas
  // renders nothing at all.
  assertEq(
    containScale({
      containerWidth: 0,
      containerHeight: 0,
      pageWidth: 595,
      pageHeight: 842,
    }),
    1,
    'unknown container → scale 1',
  );
  assertEq(
    containScale({
      containerWidth: 390,
      containerHeight: 640,
      pageWidth: 0,
      pageHeight: 0,
    }),
    1,
    'unknown page size → scale 1',
  );
  assertClose(
    containScale({
      containerWidth: 390,
      containerHeight: 0,
      pageWidth: 595,
      pageHeight: 842,
    }),
    0.6226890756302521,
    'known width + unknown height → width-only fit (previous behaviour)',
  );
  assertEq(
    containScale({
      containerWidth: NaN,
      containerHeight: -5,
      pageWidth: 595,
      pageHeight: 842,
    }),
    1,
    'NaN / negative dimensions → scale 1',
  );
  assertEq(
    containScale({
      containerWidth: 1,
      containerHeight: 1,
      pageWidth: 10000,
      pageHeight: 10000,
    }),
    SHEET_MIN_SCALE,
    'absurdly large page is floored at a renderable minimum',
  );
}

// ─── re-fit decision ────────────────────────────────────────────
function shouldRefitTests(): void {
  console.log('\nre-fit after a container resize');
  assertEq(shouldRefit(0, 0, 390, 640), true, 'first measurement always fits');
  assertEq(shouldRefit(390, 640, 390, 780), true, 'immersive toggle (height) re-fits');
  assertEq(shouldRefit(390, 640, 430, 640), true, 'rotation (width) re-fits');
  assertEq(shouldRefit(390, 640, 392, 641), false, 'sub-1% jitter is ignored');
  assertEq(
    shouldRefit(390, 640, 398, 640),
    true,
    'a change just over the 2% threshold re-fits',
  );
  assertEq(shouldRefit(390, 640, 0, 0), false, 'collapsed container is not re-fit');
  assertEq(shouldRefit(390, 640, NaN, 640), false, 'NaN measurement is ignored');
}

// ─── auto-turn speed mapping ────────────────────────────────────
function speedTests(): void {
  console.log('\nauto-turn speed mapping (bpm x beats/page)');
  assertEq(secondsPerPage(60, 4), 4, '60 BPM, 4 beats/page → 4 s/page (the default)');
  assertEq(secondsPerPage(120, 4), 2, '120 BPM halves the page time');
  assertEq(secondsPerPage(60, 1), 1, '1 beat/page turns every beat');
  assertEq(secondsPerPage(200, 16), 4.8, 'the fastest sensible setting is 4.8 s/page');
  assertEq(secondsPerPage(10, 4), 8, 'below-min tempo clamps to 30 BPM (8 s/page)');
  assertEq(secondsPerPage(500, 4), 1.2, 'above-max tempo clamps to 200 BPM (1.2 s/page)');
  assertEq(secondsPerPage(60, 0), 1, 'below-min beats clamps to 1');
  assertEq(secondsPerPage(60, 99), 16, 'above-max beats clamps to 16');
  assertEq(secondsPerPage(NaN, NaN), 4, 'NaN tempo/beats fall back to the defaults');
  assertEq(secondsPerPage(60.4, 3.6), 4, 'tempo and beats are rounded');
  assertEq(
    secondsPerPage(AUTO_TURN_DEFAULT_BPM, AUTO_TURN_DEFAULT_BEATS_PER_PAGE),
    4,
    'the documented default is 4.0 s/page',
  );
}

// ─── immersive copy / chip labels ───────────────────────────────
function copyTests(): void {
  console.log('\nimmersive mode + auto-turn copy');
  assertEq(autoTurnChipLabel('idle', 4), 'Auto-turn', 'idle chip names the control');
  assertEq(
    autoTurnChipLabel('running', 4),
    'Auto-turn · 4 s/page',
    'running chip shows the honest speed',
  );
  assertEq(
    autoTurnChipLabel('paused', 2.5),
    'Auto-turn · 2.5 s/page',
    'paused chip keeps the speed to resume at',
  );
  assertEq(
    autoTurnChipLabel('running', NaN),
    'Auto-turn',
    'a non-finite speed is never printed',
  );

  assertEq(pageChipText(1, 4), '1 / 4', 'compact counter "1 / 4"');
  assertEq(pageChipText(3, 12), '3 / 12', 'compact counter for a long piece');
  assertEq(pageChipText(9, 4), '4 / 4', 'counter never exceeds the page count');
  assertEq(pageChipText(0, 4), '', 'unknown page → empty chip (nothing invented)');
  assertEq(pageChipText(1, 0), '', 'unknown total → empty chip');

  assert(IMMERSIVE_ENTER_LABEL.length > 0, 'immersive enter label exists');
  assert(IMMERSIVE_EXIT_LABEL.length > 0, 'immersive exit label exists');
  assert(AUTO_TURN_TOGGLE_LABEL.length > 0, 'auto-turn toggle label exists');
  assertEq(SHEET_PAGE_MAX_HEIGHT_PCT, 96, 'the page may use 96% of the WebView height');
}

// ─── honest stop at the last page ───────────────────────────────
function endedTests(): void {
  console.log('\nauto-turn end of piece');
  assertEq(
    autoTurnEndedAtLastPage('running', 'idle', 4, 4),
    true,
    'running → idle on the last page = stopped at the end',
  );
  assertEq(
    autoTurnEndedAtLastPage('running', 'idle', 3, 4),
    false,
    'a stop before the last page is not an end-of-piece stop',
  );
  assertEq(
    autoTurnEndedAtLastPage('running', 'paused', 4, 4),
    false,
    'pausing on the last page is not a stop',
  );
  assertEq(
    autoTurnEndedAtLastPage('idle', 'idle', 4, 4),
    false,
    'a single-page piece never reports an auto-turn stop',
  );
  assertEq(
    autoTurnEndedAtLastPage('running', 'idle', 4, 0),
    false,
    'unknown page count → no claim',
  );
}

// ─── the generated WebView document ─────────────────────────────
function htmlTests(): void {
  console.log('\ngenerated sheet-music document');
  const html = buildSheetViewerHtml('https://example.com/piece.pdf');

  assert(
    html.includes(`max-height: ${SHEET_PAGE_MAX_HEIGHT_PCT}%`),
    'page canvas max-height is 96% (was 85%)',
  );
  assert(
    html.includes(`FIT_WIDTH_RATIO = ${SHEET_FIT_WIDTH_RATIO}`) &&
      html.includes(`FIT_HEIGHT_RATIO = ${SHEET_FIT_HEIGHT_RATIO}`) &&
      html.includes(`MAX_ZOOM = ${SHEET_MAX_ZOOM}`),
    'the document uses the tested fit constants (no magic numbers of its own)',
  );
  assert(
    html.includes('Math.min(byWidth, byHeight, MAX_ZOOM)'),
    'both axes are contained, with the zoom cap',
  );
  assert(
    html.includes('canvas.width = scaledViewport.width') &&
      html.includes('canvas.height = scaledViewport.height'),
    'the canvas is rendered at that scale',
  );

  assert(
    html.includes('user-scalable=yes') && html.includes('maximum-scale=3.0'),
    'pinch-zoom is still enabled (max 3x)',
  );
  assert(html.includes('touch-action: pan-x pan-y pinch-zoom'), 'pinch-zoom gesture kept');

  assert(
    html.includes("onclick=\"tapZone('left')\"") &&
      html.includes("onclick=\"tapZone('right')\""),
    'tap zones ask RN to decide (no local turn in the zone handler)',
  );
  assert(
    html.includes("type: 'tapPage'"),
    'tap zones post {type:"tapPage"} so RN can pause auto-turn',
  );
  assert(
    html.includes('function tapZone(') &&
      html.includes('if (zone === \'left\') { prevPage(); } else { nextPage(); }'),
    'a bridgeless fallback still turns pages locally',
  );
  assert(
    html.includes('function nextPage(') && html.includes('function prevPage('),
    'nextPage()/prevPage() stay injectable from RN (injectJavaScript contract)',
  );

  assert(html.includes('function setImmersive('), 'setImmersive() exists for the RN toggle');
  assert(
    html.includes("document.body.className = immersive ? 'immersive' : ''"),
    'immersive mode switches the document class',
  );
  assert(
    html.includes('body.immersive #pageIndicator') && html.includes('background: rgba(22, 33, 62, 0.72)'),
    'immersive mode shows a translucent page pill',
  );
  assert(
    html.includes('pointer-events: none'),
    'the page counter never intercepts a tap',
  );
  assert(
    html.includes('function refit(') && html.includes('function maybeRefit('),
    'the page can be re-fitted without a page turn',
  );
  assert(
    html.includes('setTimeout(refit, 80)') && html.includes('setTimeout(refit, 300)'),
    'setImmersive re-fits after the host has resized the WebView',
  );
  assert(
    html.includes("addEventListener('resize'"),
    'a container resize (rotation) re-fits the page',
  );
  assert(html.includes('pulseIndicator'), 'the counter fades back after a page change');

  // The compact immersive counter format must match pageChipText() exactly.
  assert(
    html.includes("currentPage + ' / ' + totalPages"),
    'immersive counter uses the compact "N / M" form',
  );
  assertEq(pageChipText(2, 4), '2 / 4', 'pageChipText mirrors that "N / M" form');

  assert(
    html.includes("type: 'loaded'") && html.includes('type: \'pageChange\''),
    'page count still arrives from the document (drives the auto-turn clamp)',
  );
  assert(
    html.includes(`pdfjsLib.getDocument('https://example.com/piece.pdf')`),
    'the PDF URL is embedded',
  );

  const quoted = buildSheetViewerHtml("https://example.com/it's a piece.pdf");
  assert(
    quoted.includes("https://example.com/it\\'s a piece.pdf"),
    'a quote in the URL is escaped (no broken script)',
  );
}

// ─── parity with the auto-turn hook that owns the timer ─────────
function hookParityTests(): void {
  console.log('\nauto-turn bounds match useAutoScroll (the timer that actually runs)');
  let source: string | null = null;
  try {
    source = require('fs').readFileSync(
      `${process.cwd()}/src/hooks/useAutoScroll.ts`,
      'utf8',
    );
  } catch {
    source = null;
  }
  if (source === null) {
    console.log('  • skipped: src/hooks/useAutoScroll.ts not readable from cwd');
    return;
  }
  const pairs: Array<[string, number]> = [
    ['AUTO_SCROLL_BPM_MIN', AUTO_TURN_BPM_MIN],
    ['AUTO_SCROLL_BPM_MAX', AUTO_TURN_BPM_MAX],
    ['AUTO_SCROLL_DEFAULT_BPM', AUTO_TURN_DEFAULT_BPM],
    ['AUTO_SCROLL_BEATS_PER_PAGE_MIN', AUTO_TURN_BEATS_PER_PAGE_MIN],
    ['AUTO_SCROLL_BEATS_PER_PAGE_MAX', AUTO_TURN_BEATS_PER_PAGE_MAX],
    ['AUTO_SCROLL_DEFAULT_BEATS_PER_PAGE', AUTO_TURN_DEFAULT_BEATS_PER_PAGE],
  ];
  for (const [hookName, value] of pairs) {
    assert(
      source.includes(`${hookName} = ${value};`),
      `${hookName} still equals the viewer's ${value}`,
    );
  }
}

// ─── run ────────────────────────────────────────────────────────
function main(): void {
  console.log('\n=== sheet viewer fit + immersive + auto-turn (v21) ===');
  containScaleTests();
  shouldRefitTests();
  speedTests();
  copyTests();
  endedTests();
  htmlTests();
  hookParityTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
