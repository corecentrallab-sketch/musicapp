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

// ─── v44 #58/#60 — THE FRAMING TIP'S OWN COLOURS, AND "NEVER CLIPPED" ───────
//
// THE DEFECT (owner, v43 on-device checklist — backlog bdb27d6c / 33732422). The
// tip rendered BLACK text on a BLACK panel, and only its top half was visible.
//
// WHY THE COLOUR BROKE, exactly. The panel's fill was a hard-coded rgba literal
// (`rgba(9,11,22,0.78)`) while its text used `'#ffffff'`. services/themeApply.ts
// repaints a StyleSheet by LOOKING UP each literal in LIGHT_ROLE_BY_COLOR, and
// that table holds hex literals only — so the fill stayed near-black in BOTH
// modes while `#ffffff` was repainted to the light palette's `text` token
// (`#161a24`, near-black). Light mode therefore drew near-black ink on a
// near-black panel: unreadable, exactly as the owner reported.
//
// THE RULE THIS FILE NOW ENFORCES. The camera tip is NOT a themed surface — it
// floats over a PHOTO, which can be a white score or a dark stage, and the theme
// is irrelevant to it. So its colours are ONE fixed, high-contrast set in both
// modes, defined here (pure, tier1-compiled) instead of in a repaintable
// StyleSheet, and the screen renders them as INLINE colours (the sanctioned path
// in services/themeStore.ts for "the handful of inline colours that a StyleSheet
// cannot carry"). `contrastRatio` proves the ink is readable over the WORST CASE
// backings a photo can present — pure white paper and pure black — so the fix is
// a measurement, not an opinion. scripts/uxr2-scan-viewport.test.ts asserts it.
export const SCAN_TIP_SCRIM = 'rgba(9,11,22,0.88)';
export const SCAN_TIP_INK = '#ffffff';
export const SCAN_TIP_TITLE_INK = '#7fe3da';
/** The tip's ink must clear this ratio over the scrim on ANY photo behind it. */
export const SCAN_TIP_MIN_CONTRAST = 4.5;

/** '#rgb'/'#rrggbb' → [r,g,b] 0-255 (null when the literal is not a hex colour). */
export function parseHexColor(value: unknown): [number, number, number] | null {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text);
  if (!match) return null;
  const raw = match[1]!;
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** 'rgba(r,g,b,a)' / 'rgb(r,g,b)' → { rgb, alpha } (null when it is not one). */
export function parseRgbaColor(value: unknown): { rgb: [number, number, number]; alpha: number } | null {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text);
  if (!match) return null;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const alpha = match[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4])));
  return {
    rgb: [clamp(Number(match[1])), clamp(Number(match[2])), clamp(Number(match[3]))],
    alpha: Number.isFinite(alpha) ? alpha : 1,
  };
}

/** The colour a translucent scrim actually shows over a backing colour. */
export function compositeOver(top: unknown, bottom: unknown): [number, number, number] | null {
  const over = parseRgbaColor(top);
  const under = parseHexColor(bottom);
  if (!over || !under) return null;
  return [0, 1, 2].map((i) =>
    Math.round(over.rgb[i]! * over.alpha + under[i]! * (1 - over.alpha)),
  ) as [number, number, number];
}

/** WCAG relative luminance of an sRGB colour (0 = black, 1 = white). */
export function relativeLuminance(rgb: [number, number, number] | null): number {
  if (!rgb) return 0;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio between two opaque colours (1…21); 1 for bad input. */
export function contrastRatio(a: unknown, b: unknown): number {
  const la = relativeLuminance(parseHexColor(a));
  const lb = relativeLuminance(parseHexColor(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The tip's ink over the scrim, over the worst-case photo backings. */
export function scanTipContrast(backing: string): number {
  const seen = compositeOver(SCAN_TIP_SCRIM, backing);
  if (!seen) return 0;
  return contrastRatio(SCAN_TIP_INK, toHexColor(seen));
}

/** The dot colour a scrim shows over a backing — the real fill behind the ink. */
function toHexColor(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** True when BOTH tip inks stay readable over a white photo AND a black one. */
export function scanTipInkIsReadable(): boolean {
  return ['#ffffff', '#000000'].every((backing) => {
    const seen = compositeOver(SCAN_TIP_SCRIM, backing);
    if (!seen) return false;
    const behind = toHexColor(seen);
    return (
      contrastRatio(SCAN_TIP_INK, behind) >= SCAN_TIP_MIN_CONTRAST &&
      contrastRatio(SCAN_TIP_TITLE_INK, behind) >= SCAN_TIP_MIN_CONTRAST
    );
  });
}

// ─── v44 #60 — THE TIP IS NEVER CLIPPED ─────────────────────────────────────
//
// The panel used to be CAPPED (`maxHeight: SCAN_FRAMING_HINT_MAX_HEIGHT`), so the
// last sentence of the copy was cut through the middle of its glyphs — the
// owner's "only the TOP half of the box is visible". A fixed cap cannot be right
// for text whose height depends on the device width AND the user's font scale, so
// the panel now sizes to its content and the room it needs is MEASURED here
// instead: at the largest font scale the tip allows (1.25×, `maxFontSizeMultiplier`
// on the screen's Texts), the whole box must fit between the top chip and the
// middle of the preview. scripts/uxr2-scan-viewport.test.ts asserts the fit.
export const SCAN_TIP_MAX_FONT_SCALE = 1.25;
export const SCAN_TIP_TITLE_FONT = 11;
export const SCAN_TIP_TITLE_LINE_HEIGHT = 14;
export const SCAN_TIP_BODY_FONT = 12;
export const SCAN_TIP_BODY_LINE_HEIGHT = 16;
export const SCAN_TIP_TAKE_FONT = 12;
export const SCAN_TIP_TAKE_LINE_HEIGHT = 16;
/** Padding inside the panel, per side, and the gap between its three lines. */
export const SCAN_TIP_PADDING_Y = 9;
export const SCAN_TIP_PADDING_X = 12;
export const SCAN_TIP_GAP = 2;
/** The widest the box may get — it hugs the top-left, never a full-width bar. */
export const SCAN_TIP_MAX_WIDTH_RATIO = 0.86;

/**
 * THE PANEL'S HEIGHT AT ITS LARGEST ALLOWED FONT SCALE, from how many lines each
 * of its three pieces of text takes on the device. No cap, no clipping: this is
 * the truth the layout has to make room for.
 */
export function scanTipPanelHeight(input: {
  titleLines?: number;
  bodyLines?: number;
  takeLines?: number;
} | null): number {
  const count = (value: unknown) =>
    Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
  const scale = SCAN_TIP_MAX_FONT_SCALE;
  const lines = [
    count(input?.titleLines) * SCAN_TIP_TITLE_LINE_HEIGHT,
    count(input?.bodyLines) * SCAN_TIP_BODY_LINE_HEIGHT,
    count(input?.takeLines) * SCAN_TIP_TAKE_LINE_HEIGHT,
  ].filter((height) => height > 0);
  if (lines.length === 0) return 0;
  const text = lines.reduce((sum, height) => sum + height, 0) * scale;
  const gaps = (lines.length - 1) * SCAN_TIP_GAP;
  return Math.ceil(text + gaps + SCAN_TIP_PADDING_Y * 2);
}

/**
 * ROOM UNDER THE TOP CHIP BEFORE THE MIDDLE OF THE PREVIEW — the band the tip may
 * occupy without covering the area the user is framing the title in. It is
 * generous enough for the real copy at 1.25× (proved by the tier1 suite) and it is
 * the number the panel's placement is documented against.
 */
export const SCAN_TIP_ROOM = 152;

/** Does the real tip fit the room it is given, at the biggest font scale allowed? */
export function scanTipFits(layout: { titleLines?: number; bodyLines?: number; takeLines?: number } | null): boolean {
  const height = scanTipPanelHeight(layout);
  return height > 0 && height <= SCAN_TIP_ROOM && height <= SCAN_FRAMING_HINT_MAX_HEIGHT + 40;
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
