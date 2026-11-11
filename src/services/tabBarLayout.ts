/**
 * tabBarLayout.ts — THE ONE NUMBER FOR THE TAB BAR'S HEIGHT (vc53, item 2).
 *
 * `TabNavigator` gives the bar `60 + insets.bottom` and pads it by `6` top and
 * bottom. Every scrolling surface that lives UNDER that bar has to reserve the
 * same space, or its last control sits under the footer. On vc52 that produced
 * two owner-visible defects from one omission:
 *
 *   • Editor → Practice Tools: "Record your practice" was half hidden behind the
 *     footer (the screen was a plain flex column with no scroller at all, so the
 *     card was clipped exactly where the bar began);
 *   • "Send to…" → "Send your practice": the last destination sat under the
 *     Android navigation bar — a dead end in a shipped feature.
 *
 * The bar's height is a fact about the navigation chrome, so it lives in one pure
 * function and the chrome and the screens read the SAME one. Pure module: no React
 * Native imports, so the tier1 gate compiles and runs it.
 */

/** The bar's own content height, before the device's bottom inset. */
export const TAB_BAR_CONTENT_HEIGHT = 60;

/** The bar's vertical padding above and below its icons/labels. */
export const TAB_BAR_VERTICAL_PADDING = 6;

/** Extra breathing room under the last control on a scrolling tab screen. */
export const TAB_SCREEN_BREATHING_ROOM = 24;

/** The tab bar's total height for a device with this bottom safe-area inset. */
export function tabBarHeight(insetsBottom: number): number {
  const inset = Number.isFinite(insetsBottom) && insetsBottom > 0 ? insetsBottom : 0;
  return TAB_BAR_CONTENT_HEIGHT + inset;
}

/**
 * What a scrolling container under the tab bar adds to its content's bottom so the
 * last control clears the bar. The bar is laid out above the screen (not over it),
 * so this is breathing room rather than the bar's full height — but a screen that
 * renders its own content edge-to-edge (the Send-to sheets are full-screen Modals)
 * must add the DEVICE inset as well, which is what `sheetBottomPadding` is for.
 */
export function tabScreenBottomPadding(insetsBottom: number): number {
  const inset = Number.isFinite(insetsBottom) && insetsBottom > 0 ? insetsBottom : 0;
  return TAB_SCREEN_BREATHING_ROOM + inset;
}

/**
 * A full-screen modal's bottom padding: its own margin PLUS the device inset, so
 * the last button is never under the gesture/navigation bar. (32 was the sheet's
 * old fixed padding, which is less than a three-button Android nav bar.)
 */
export function sheetBottomPadding(insetsBottom: number, base = 32): number {
  const inset = Number.isFinite(insetsBottom) && insetsBottom > 0 ? insetsBottom : 0;
  return base + inset;
}
