/**
 * takeStaffPalette.ts — THE PAPER AND INK THE TAKE'S STAFF IS DRAWN IN (v42 fix B1).
 *
 * THE OWNER'S COMPLAINT (v41 device pass, 10-20): the take's notes ("NoteSnap
 * heard your take", on the History page and under the practice video) rendered on
 * a BLACK screen with the notes invisible — "screen needs to be lighter".
 *
 * THE DEFECT. TakeStaffCard painted its staff with literals of the DARK palette
 * handed over as PROPS (`background={DARK_THEME.surface}` = #16213e, ink
 * `DARK_THEME.staffRawInk` = #9aa0b4). The app-wide theme remapper
 * (services/themeApply.ts) rewrites StyleSheets; it cannot see a prop. So in LIGHT
 * mode the card around the staff turned white and the staff stayed a black block —
 * and the raw trace's dim grey was drawn on it. Nothing could catch that, because
 * the app had no way to ask "are these two colours readable together".
 *
 * THE FIX, AS DATA. The take's staff now uses the SAME paper the score reader
 * uses (AbcScoreView's ABC_DEFAULT_BACKGROUND: white notation paper) and inks
 * that clear WCAG AA on it — `services/inkContrast.ts` is the rule, this module is
 * the palette, and `scripts/uxr-v42-fixes.test.ts` asserts the pair (so a future
 * "make it look nicer" edit cannot quietly put grey back on navy).
 *
 * WHY NOT THE BRAND TEAL FOR THE CLEANED LINE. #4ecdc4 is 1.7:1 on white paper —
 * it was legible only because the paper used to be dark. The cleaned line keeps
 * its teal IDENTITY in the legible dark form below (5.5:1 on white), which is the
 * same trade the score reader already makes with its near-black ink.
 *
 * PURE: no react, no react-native, no fs. Compiled by tsconfig.tier1.json.
 */

/**
 * The paper behind the take's staves. Identical to the score reader's paper
 * (AbcScoreView's ABC_DEFAULT_BACKGROUND) on purpose: notation reads the same on
 * every surface in the app, in BOTH themes, and a white page on a dark card is the
 * look the reader has always had.
 */
export const TAKE_STAFF_PAPER = '#ffffff';

/**
 * The RAW trace's ink — "as you hummed it", deliberately the quieter of the two
 * lines (it is the before-cleanup take), but still 4.8:1 on the paper above.
 */
export const TAKE_STAFF_RAW_INK = '#6b7280';

/**
 * The AUTO-CLEANED line's ink — the app's teal, in the only form that is readable
 * on white paper (5.5:1). The crisp line must read as the "after", so it is the
 * darker, higher-contrast of the two.
 */
export const TAKE_STAFF_CLEANED_INK = '#0f766e';

/**
 * The card the staves sit on. A theme TOKEN, never a literal: `theme.surface` is
 * #16213e in dark mode and #ffffff in light mode, so the card follows the app's
 * theme the way every other surface does.
 */
export const TAKE_STAFF_CARD_TOKEN = 'surface';
