/**
 * sheetViewerFit — the pure geometry + copy half of the sheet-music viewer
 * (ScoreViewer). Owner request 2026-09-18: the sheet is "visually hard to read"
 * → full-screen mode + a speed control for turning/scrolling pages.
 *
 * Everything the viewer computes for itself lives here, so it can be exercised
 * in plain Node (tsconfig.tier1.json + scripts/sheetViewerFit.test.ts) and so
 * the generated WebView HTML can interpolate the SAME numbers instead of
 * repeating magic constants in a template string:
 *
 *   • containScale()             — how large the PDF page is rendered inside the
 *     WebView:
 *         scale = min(W * 0.95 / pageWidth, H * 0.92 / pageHeight, 3.0)
 *     a contain-fit (whole page visible, nothing cropped). It replaces the old
 *     width-only fit (W * 0.92), which on a phone left a portrait page small
 *     and — with the chrome taking 15% — genuinely hard to read;
 *   • shouldRefit()              — whether a container resize (immersive toggle,
 *     rotation) is big enough to be worth re-rendering the page;
 *   • secondsPerPage()           — the honest speed mapping behind auto page
 *     turn, mirroring useAutoScroll's model:
 *         secondsPerPage = (60 / bpm) * beatsPerPage
 *     (60 BPM, 4 beats/page → 4.0 s/page);
 *   • autoTurnChipLabel()        — the compact immersive-mode speed readout;
 *   • autoTurnEndedAtLastPage()  — "auto-turn stopped because it reached the last
 *     page", so the viewer says so instead of looking like the user pressed stop;
 *   • pageChipText()             — the compact "1 / 4" page counter used in
 *     immersive mode (mirrored by the in-WebView indicator).
 *
 * Pure + dependency-free on purpose: no react, no react-native, no network — a
 * module the tier1 gate can compile with node_modules absent.
 */

/** Share of the container width the page may occupy (contain-fit). */
export const SHEET_FIT_WIDTH_RATIO = 0.95;
/** Share of the container height the page may occupy (contain-fit). */
export const SHEET_FIT_HEIGHT_RATIO = 0.92;
/** CSS max-height of the rendered page canvas, in percent of the WebView. */
export const SHEET_PAGE_MAX_HEIGHT_PCT = 96;
/** Never zoom a page past this (keeps the pinch-zoom ceiling meaningful). */
export const SHEET_MAX_ZOOM = 3;
/** Never render below this scale (a 0-px canvas cannot render at all). */
export const SHEET_MIN_SCALE = 0.1;
/**
 * A container resize smaller than this share of the old dimension is ignored —
 * pinch-zoom and scroll can fire `resize` without the layout really changing,
 * and re-rendering the canvas on every one of those would flicker.
 */
export const SHEET_REFIT_EPSILON = 0.02;

/**
 * Auto-turn tempo bounds. These mirror the exported constants of
 * `src/hooks/useAutoScroll.ts` (which owns the timer) — duplicated here because
 * that module imports react and therefore cannot be part of the tier1 gate.
 * scripts/sheetViewerFit.test.ts cross-checks the two sources.
 */
export const AUTO_TURN_BPM_MIN = 30;
export const AUTO_TURN_BPM_MAX = 200;
export const AUTO_TURN_DEFAULT_BPM = 60;
export const AUTO_TURN_BEATS_PER_PAGE_MIN = 1;
export const AUTO_TURN_BEATS_PER_PAGE_MAX = 16;
export const AUTO_TURN_DEFAULT_BEATS_PER_PAGE = 4;

/** Auto-turn lifecycle, identical to useAutoScroll's status union. */
export type AutoTurnStatus = 'idle' | 'running' | 'paused';

/** Accessibility / UI copy for immersive mode. */
export const IMMERSIVE_ENTER_LABEL = 'Full screen';
export const IMMERSIVE_EXIT_LABEL = 'Exit full screen';
export const AUTO_TURN_TOGGLE_LABEL = 'Auto page-turn controls';

export interface SheetFitInput {
  /** Width of the WebView container (CSS px). */
  containerWidth: number;
  /** Height of the WebView container (CSS px). */
  containerHeight: number;
  /** PDF page width at scale 1 (PDF points). */
  pageWidth: number;
  /** PDF page height at scale 1 (PDF points). */
  pageHeight: number;
  /** Optional zoom ceiling override (defaults to SHEET_MAX_ZOOM). */
  maxZoom?: number;
}

const isPositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

/**
 * Contain-fit scale: the largest scale at which the whole page fits inside the
 * container, never above `maxZoom`.
 *
 * Degenerate inputs never produce a NaN / 0 / negative scale (a 0-px canvas
 * makes PDF.js render nothing at all):
 *   • a known width but unknown height → width-only fit (the old behaviour);
 *   • nothing known, or a non-positive page size → 1 (PDF.js's native scale).
 */
export function containScale({
  containerWidth,
  containerHeight,
  pageWidth,
  pageHeight,
  maxZoom = SHEET_MAX_ZOOM,
}: SheetFitInput): number {
  const candidates: number[] = [];
  if (isPositive(containerWidth) && isPositive(pageWidth)) {
    candidates.push((containerWidth * SHEET_FIT_WIDTH_RATIO) / pageWidth);
  }
  if (isPositive(containerHeight) && isPositive(pageHeight)) {
    candidates.push((containerHeight * SHEET_FIT_HEIGHT_RATIO) / pageHeight);
  }
  if (candidates.length === 0) return 1;
  const ceiling = isPositive(maxZoom) ? maxZoom : SHEET_MAX_ZOOM;
  const scale = Math.min(Math.min(...candidates), ceiling);
  return Math.max(SHEET_MIN_SCALE, scale);
}

/**
 * Should the current page be re-rendered after a container resize? True for the
 * first measurement (nothing rendered yet) and for any change of more than
 * `threshold` in either dimension.
 */
export function shouldRefit(
  prevWidth: number,
  prevHeight: number,
  nextWidth: number,
  nextHeight: number,
  threshold: number = SHEET_REFIT_EPSILON,
): boolean {
  if (!isPositive(nextWidth) || !isPositive(nextHeight)) return false;
  if (!isPositive(prevWidth) || !isPositive(prevHeight)) return true;
  const dw = Math.abs(nextWidth - prevWidth) / prevWidth;
  const dh = Math.abs(nextHeight - prevHeight) / prevHeight;
  return dw > threshold || dh > threshold;
}

const clampInt = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

/**
 * Seconds between page turns for a tempo and a page length in beats:
 *   secondsPerPage = (60 / bpm) * beatsPerPage
 * Out-of-range tempi are clamped exactly as useAutoScroll clamps them, so the
 * number shown to the user matches the timer that actually runs.
 */
export function secondsPerPage(bpm: number, beatsPerPage: number): number {
  const tempo = clampInt(bpm, AUTO_TURN_BPM_MIN, AUTO_TURN_BPM_MAX, AUTO_TURN_DEFAULT_BPM);
  const beats = clampInt(
    beatsPerPage,
    AUTO_TURN_BEATS_PER_PAGE_MIN,
    AUTO_TURN_BEATS_PER_PAGE_MAX,
    AUTO_TURN_DEFAULT_BEATS_PER_PAGE,
  );
  return (60 / tempo) * beats;
}

const oneDecimal = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/**
 * Compact label for the immersive-mode auto-turn chip: the control's name when
 * idle, and the honest effective speed while it is running or paused.
 */
export function autoTurnChipLabel(
  status: AutoTurnStatus,
  seconds: number,
): string {
  if (status === 'idle' || !Number.isFinite(seconds) || seconds <= 0) {
    return 'Auto-turn';
  }
  return `Auto-turn · ${oneDecimal(seconds)} s/page`;
}

/**
 * The auto-turn scheduler stops itself at the last page. This detects exactly
 * that transition (running → idle while already on the final page) so the
 * viewer can say "auto-turn stopped — last page" rather than showing an idle
 * control that looks like the user's own stop.
 */
export function autoTurnEndedAtLastPage(
  prevStatus: AutoTurnStatus,
  status: AutoTurnStatus,
  page: number,
  total: number,
): boolean {
  return (
    prevStatus === 'running' &&
    status === 'idle' &&
    Number.isFinite(total) &&
    total > 0 &&
    Number.isFinite(page) &&
    page >= total
  );
}

/** Compact page counter for immersive mode, e.g. "2 / 4". Empty when unknown. */
export function pageChipText(page: number, total: number): string {
  if (!isPositive(total) || !Number.isFinite(page) || page <= 0) return '';
  const shown = Math.min(Math.round(page), Math.round(total));
  return `${shown} / ${Math.round(total)}`;
}
