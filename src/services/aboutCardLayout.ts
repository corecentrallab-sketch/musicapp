/**
 * aboutCardLayout.ts — HOW TALL THE "ABOUT NOTESNAP" BOX IS (vc55).
 *
 * THE OWNER, vc54 handset pass (2026-11-11): *"The About Notesnap box can be made
 * smaller. It's currently unnecessarily large."*
 *
 * WHAT WAS LARGE. The box at the foot of Settings is one card holding the About
 * row (a full-height spec row: 52 dp minimum, 10 dp of vertical padding, a title
 * and a subtitle) plus the build stamp line under it (12 pt type, 17 dp leading,
 * 8 dp of space above). It measured about 87 dp of card for two short lines.
 *
 * THE GEOMETRY LIVES HERE, IN NUMBERS THE SCREEN READS. That is deliberate: a
 * "smaller card" whose dp values are inlined in a StyleSheet cannot be checked by
 * the gate, and the next tidy-up can silently put them back. The screen's styles
 * are built from these constants (`SettingsScreen` reads every one of them), so
 * shrinking the card and proving it shrank are the same act.
 *
 * NOTHING ELSE ON THE SCREEN MOVES: these values are used ONLY by the About card
 * at the bottom of Settings — not by the other spec rows, which keep their own
 * geometry.
 */

export interface AboutCardGeometry {
  /** The card's own vertical padding (top AND bottom). */
  cardPaddingV: number;
  /** The About row's minimum height. */
  rowMinHeight: number;
  /** The About row's own vertical padding. */
  rowPaddingV: number;
  /** Title + subtitle, as drawn (15 pt title, 11 pt subtitle). */
  rowContentHeight: number;
  /** Space between the row and the stamp line. */
  stampPaddingTop: number;
  /** The stamp's leading. */
  stampLineHeight: number;
}

/** vc55: the compact card the owner asked for. */
export const ABOUT_CARD_MARGIN_TOP = 10;
export const ABOUT_CARD_PADDING_H = 12;
export const ABOUT_CARD_PADDING_V = 2;
export const ABOUT_ROW_MIN_HEIGHT = 44;
export const ABOUT_ROW_PADDING_V = 6;
export const ABOUT_STAMP_FONT_SIZE = 11;
export const ABOUT_STAMP_LINE_HEIGHT = 15;
export const ABOUT_STAMP_PADDING_TOP = 2;

export const ABOUT_CARD_GEOMETRY: AboutCardGeometry = {
  cardPaddingV: ABOUT_CARD_PADDING_V,
  rowMinHeight: ABOUT_ROW_MIN_HEIGHT,
  rowPaddingV: ABOUT_ROW_PADDING_V,
  rowContentHeight: 34,
  stampPaddingTop: ABOUT_STAMP_PADDING_TOP,
  stampLineHeight: ABOUT_STAMP_LINE_HEIGHT,
};

/** What the same card measured before vc55 — kept so the shrink is provable. */
export const ABOUT_CARD_GEOMETRY_BEFORE: AboutCardGeometry = {
  cardPaddingV: 4,
  rowMinHeight: 52,
  rowPaddingV: 10,
  rowContentHeight: 34,
  stampPaddingTop: 8,
  stampLineHeight: 17,
};

/**
 * The card's height in dp: its own padding, the row (never shorter than its
 * minimum, never shorter than its content plus its padding), and the stamp.
 */
export function aboutCardHeight(geometry: AboutCardGeometry = ABOUT_CARD_GEOMETRY): number {
  const row = Math.max(
    Math.max(0, geometry.rowMinHeight),
    Math.max(0, geometry.rowContentHeight) + Math.max(0, geometry.rowPaddingV) * 2,
  );
  const card = Math.max(0, geometry.cardPaddingV) * 2;
  const stamp = Math.max(0, geometry.stampPaddingTop) + Math.max(0, geometry.stampLineHeight);
  return Math.round(card + row + stamp);
}

/** How much smaller the vc55 card is than the one the owner called too large. */
export function aboutCardSaving(): number {
  return aboutCardHeight(ABOUT_CARD_GEOMETRY_BEFORE) - aboutCardHeight(ABOUT_CARD_GEOMETRY);
}
