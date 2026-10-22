/**
 * scanViewport.ts — THE SCAN SCREEN'S FLOATING LAYOUT, AS PURE RULES
 * (UX Round 2 Step 1, owner green-lit 2026-10-18, owner item C).
 *
 * THE OWNER'S SPEC, in their own words: "Edge-to-Edge Camera: let the camera view
 * take up the entire screen. Floating Minimalist Bar: replace the heavy bottom
 * container with a semi-transparent floating pill hosting only the essential
 * controls: a crisp shutter button, a flash toggle, and a clear Done / Finish
 * action. Ensure no UI elements block or overlap critical controls."
 *
 * WHY THESE RULES LIVE IN A PURE MODULE. The screen is where the pixels are laid
 * out, and a screen is invisible to the tier1 gate (the gate compiles no .tsx), so
 * this is the only place a layout decision can be proved before a build. Every
 * number and every decision the new layout depends on is here:
 *
 *   • WHERE the floating dock sits — derived from the device's own safe-area
 *     insets, so the Android gesture bar and the status bar can never sit on top
 *     of the shutter or the Done button;
 *   • THE PILL'S GEOMETRY (radius, shutter size, minimum touch target, the
 *     translucent fill) — so "a pill, not a bar" is a constant the screen uses
 *     instead of a style someone can quietly flatten back into a full-width strip;
 *   • THE FLASH CYCLE (off → auto → on → off) — a camera setting, written down
 *     once so the toggle's label and its icon can never disagree with the mode
 *     handed to the camera;
 *   • WHICH CONTROL IS ENABLED — the PRE-EXISTING capture flow's own rule, moved
 *     here so a pure relayout cannot change what a tap does: Undo and Done need a
 *     page, and the shutter is spent while a capture is in flight.
 *
 * WHAT THIS IS NOT. No camera, no OCR, no recognition, no search, no URL, no
 * library write, and no new promise to the user: it moves controls and nothing
 * else. PURE: no react, no react-native, no fs, no network.
 */

// ───────────────────────────── the flash toggle ──────────────────────────────

/** The camera's own flash modes, in the order the toggle walks them. */
export type ScanFlashMode = 'off' | 'auto' | 'on';

export const SCAN_FLASH_ORDER: readonly ScanFlashMode[] = ['off', 'auto', 'on'];

/** A scan opens with the flash OFF — a lit page is the normal case. */
export const DEFAULT_SCAN_FLASH_MODE: ScanFlashMode = 'off';

/**
 * The next mode in the cycle. One tap moves exactly one step and wraps, and an
 * unknown mode (a restored state from an older build) lands on the default rather
 * than on `undefined`.
 */
export function nextScanFlashMode(current: unknown): ScanFlashMode {
  const at = SCAN_FLASH_ORDER.indexOf(current as ScanFlashMode);
  const next = at < 0 ? 0 : (at + 1) % SCAN_FLASH_ORDER.length;
  return SCAN_FLASH_ORDER[next];
}

/** The mode in words, for the control's accessible name. */
export function scanFlashLabel(mode: unknown): string {
  if (mode === 'on') return 'Flash on';
  if (mode === 'auto') return 'Flash auto';
  return 'Flash off';
}

/** The mode in one word, for the tiny caption under the toggle's icon. */
export function scanFlashShortLabel(mode: unknown): string {
  if (mode === 'on') return 'On';
  if (mode === 'auto') return 'Auto';
  return 'Off';
}

/** The icon for a mode (Ionicons names that exist in this app's icon set). */
export function scanFlashIcon(mode: unknown): 'flash' | 'flash-outline' | 'flash-off-outline' {
  if (mode === 'on') return 'flash';
  if (mode === 'auto') return 'flash-outline';
  return 'flash-off-outline';
}

/** The toggle's accessible name: what it is now, and that tapping changes it. */
export function scanFlashControlLabel(mode: unknown): string {
  return `${scanFlashLabel(mode)} — tap to change`;
}

// ───────────────────── where the floating layers may sit ─────────────────────

/** The dock's own floor above the gesture bar, on a device that reports none. */
export const SCAN_DOCK_MIN_BOTTOM = 18;
/** How far above a reported bottom inset the dock clears the gesture bar. */
export const SCAN_DOCK_BOTTOM_GAP = 12;
/** The top chip's floor below the status bar, on a device that reports none. */
export const SCAN_TOP_MIN_INSET = 8;
/** How far below a reported top inset the top chip starts. */
export const SCAN_TOP_GAP = 8;

function insetValue(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

/**
 * THE SHUTTER'S DISTANCE FROM THE BOTTOM EDGE. The Android gesture bar is an
 * overlay, not a reserved strip, so a pill placed at `bottom: 0` puts the shutter
 * under it and the owner's tap lands on the system UI instead of the capture. The
 * measured bottom inset is the input; the floor covers devices that report 0.
 */
export function scanDockBottomInset(insetBottom: unknown): number {
  return Math.max(SCAN_DOCK_MIN_BOTTOM, insetValue(insetBottom) + SCAN_DOCK_BOTTOM_GAP);
}

/** THE TOP CHIP'S DISTANCE FROM THE TOP EDGE: the status bar's own height, plus a gap. */
export function scanTopChipInset(insetTop: unknown): number {
  return Math.max(SCAN_TOP_MIN_INSET, insetValue(insetTop) + SCAN_TOP_GAP);
}

/** The two insets the floating layers are placed with, from one measurement. */
export function scanOverlayInsets(input: {
  top?: unknown;
  bottom?: unknown;
}): { top: number; bottom: number } {
  return {
    top: scanTopChipInset(input?.top),
    bottom: scanDockBottomInset(input?.bottom),
  };
}

/**
 * WHERE THE FRAMING TIP SITS (v43 item C5b). It hangs BELOW the top chip and
 * above the middle of the preview, so the area the user is aiming at — the title
 * at the top of the score, held inside the frame — stays visible. Its own height
 * is bounded (`SCAN_FRAMING_HINT_MAX_HEIGHT`) so the panel can never creep down
 * over the shutter.
 */
export const SCAN_FRAMING_HINT_GAP = 10;
/** The most room the tip's panel may take under the chip. */
export const SCAN_FRAMING_HINT_MAX_HEIGHT = 132;
/** The chip's own height, which the tip's offset must clear. */
export const SCAN_TOP_CHIP_HEIGHT = 44;

export function scanFramingHintTop(insetTop: unknown): number {
  return scanTopChipInset(insetTop) + SCAN_TOP_CHIP_HEIGHT + SCAN_FRAMING_HINT_GAP;
}

// ───────────────────────────── the pill's geometry ───────────────────────────

/** The pill's corner radius — well past half its own height, so it reads as a pill. */
export const SCAN_PILL_RADIUS = 34;
/** The shutter's outer ring, in points (unchanged from the pre-redesign control). */
export const SCAN_SHUTTER_SIZE = 68;
/** The smallest tap target any control in the pill may have. */
export const SCAN_TOUCH_MIN = 44;
/** The gap between the pill's controls. */
export const SCAN_CONTROL_GAP = 10;
/** The filmstrip's own height, above the pill. */
export const SCAN_FILMSTRIP_HEIGHT = 64;

/**
 * THE PILL IS TRANSLUCENT, NEVER OPAQUE. It floats OVER the camera preview, and the
 * owner's complaint was a heavy bar hiding the picture; a translucent fill is what
 * makes it a floating control surface instead of a second footer.
 */
export const SCAN_SURFACE_TRANSLUCENT = 'rgba(12,14,26,0.62)';
/** The lighter fill for the smaller chips (filmstrip, status, find). */
export const SCAN_CHIP_TRANSLUCENT = 'rgba(12,14,26,0.48)';

/**
 * HOW MUCH OF THE SCREEN THE DETAIL PANEL MAY TAKE. The find-this-music panel is
 * the only expandable thing on this screen; it is capped so the preview and the
 * shutter stay visible while it is open, and floored so it is usable on a small
 * phone. Its own default is COLLAPSED — see `scanFindPanel`.
 */
export const SCAN_FIND_SHEET_MAX_RATIO = 0.42;
export const SCAN_FIND_SHEET_MIN = 180;
export const SCAN_FIND_SHEET_MAX = 380;

/** The detail panel's height cap, from the window's own height. */
export function scanFindSheetMaxHeight(windowHeight: unknown): number {
  const height = typeof windowHeight === 'number' && Number.isFinite(windowHeight) && windowHeight > 0
    ? windowHeight
    : 0;
  const scaled = Math.round(height * SCAN_FIND_SHEET_MAX_RATIO);
  return Math.min(SCAN_FIND_SHEET_MAX, Math.max(SCAN_FIND_SHEET_MIN, scaled));
}

/**
 * THE DETAIL PANEL OPENS CLOSED. Every line of explanation the old footer carried
 * is still reachable — behind one tap — but nothing dense is on screen while the
 * user is framing a page, which is the clutter the owner called out.
 */
export function scanFindPanel(open: unknown): { open: boolean; collapsed: boolean } {
  const isOpen = open === true;
  return { open: isOpen, collapsed: !isOpen };
}

// ──────────────────── which control is enabled, and why ──────────────────────

export interface ScanControlState {
  /** The shutter: spent while a capture is already in flight. */
  shoot: boolean;
  /** Undo: it needs a page to remove. */
  undo: boolean;
  /** Done: it needs at least one page (the pre-existing rule, unchanged). */
  finish: boolean;
  /** The flash toggle: a camera setting, not something to change mid-capture. */
  flash: boolean;
}

/**
 * THE PRE-EXISTING CAPTURE FLOW'S OWN ENABLEMENT RULES, moved into one place.
 *
 * This is a RELAYOUT: the shutter was disabled while `capturing`, and Undo and Done
 * were disabled with zero pages, before this change and after it. Pinning them here
 * means the redesign cannot quietly make a control tappable that used to be inert
 * (or the reverse) — the screen reads this state instead of re-deriving it.
 */
export function scanControlState(input: {
  capturing?: unknown;
  pageCount?: unknown;
}): ScanControlState {
  const capturing = input?.capturing === true;
  const count = typeof input?.pageCount === 'number' && Number.isFinite(input.pageCount) && input.pageCount > 0
    ? Math.floor(input.pageCount)
    : 0;
  return {
    shoot: !capturing,
    undo: count > 0,
    finish: count > 0,
    flash: !capturing,
  };
}

/** What the top chip counts out loud, so a resumed scan reads as itself. */
export function scanPageCountLabel(pageCount: unknown): string {
  const count = typeof pageCount === 'number' && Number.isFinite(pageCount) && pageCount > 0
    ? Math.floor(pageCount)
    : 0;
  if (count === 0) return 'No pages yet';
  return `${count} ${count === 1 ? 'page' : 'pages'} in this scan`;
}

/** The line the top chip shows before the first capture. */
export const SCAN_EMPTY_HINT = 'Frame the page, then tap the shutter.';
