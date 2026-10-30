/**
 * v47.1 Part A · SETTINGS TEXT FIT — THE CLASS, NOT THE INSTANCE.
 *
 * THE DEFECT (owner report 10-30): the NoteSnap Pro box at the top of Settings
 * "looks jammed in" — bold 16 dp title and 12 dp sub squeezed into a row pinned
 * at `height: 62`. The same pattern was in the §3 spec rows: `height: 52` holding
 * a 15 dp/700 title plus an 11 dp sub, and `specRowCopy: { flex: 1,
 * paddingRight: 100 }` reserving 100 dp for a trailing value that is MEASURED by
 * nothing.
 *
 * WHY IT IS A CLASS: a fixed `height` + a hard right pad + a `numberOfLines={1}`
 * title is a layout that only fits at the default font scale on a wide phone.
 * Raise the OS font size (or use a 320 dp screen, or a longer string) and the
 * text is CLIPPED — the row cannot grow, and the hard pad keeps the copy out of
 * space the value may not even use.
 *
 * THE RULES THIS MODULE ENFORCES (read off the screen's own StyleSheet):
 *   1. A row that carries text has NO fixed `height`. It has `minHeight` (the
 *      spec's 62/52 dp floor) plus vertical padding, so it GROWS with the text.
 *   2. The text block FLEXES (`flex: 1`, `minWidth: 0`) and carries no hard
 *      `paddingRight` reserving room for a trailing control.
 *   3. A trailing value/pill is MEASURED, not assumed: the pill is
 *      `flexShrink: 0` and the value may shrink (`flexShrink: 1`) and wrap.
 *   4. No `numberOfLines={1}` on a TITLE or a SUB — they wrap. (The short
 *      trailing value keeps one line, and may ellipsize.)
 *   5. The screen honours the OS font scale: no `allowFontScaling={false}` and no
 *      `maxFontSizeMultiplier` cap.
 *
 * The numbers still come from SETTINGS_SPEC (settingsSpec.ts); this module only
 * asserts the SHAPE those numbers are applied in. Pure string functions — no
 * react-native, no fs — so the tier1 gate runs it with node_modules absent.
 */
import { maskSourceComments } from './audioFocusContract';
import { SETTINGS_SPEC, settingsStyleBody, settingsStyleValue } from './settingsSpec';

/** The rows on this screen that carry text and therefore may never be fixed-height. */
export const TEXT_ROW_STYLES: readonly string[] = ['proRow', 'specRow'];

/** The smallest comfortable touch row; a minHeight below this is a squeeze. */
export const MIN_TAP_TARGET_DP = 44;

/** A right pad this large is reserving space for a control instead of laying out. */
export const HARD_RIGHT_PAD_DP = 40;

/**
 * One text row: no `height`, a `minHeight` at or above the tap target, and real
 * vertical padding so the row can grow past its floor.
 */
export function textRowCarriesNoFixedHeight(screenSource: string, styleName: string): boolean {
  const body = settingsStyleBody(screenSource, styleName);
  if (body === null) return false;
  if (settingsStyleValue(screenSource, styleName, 'height') !== null) return false;
  const minHeight = settingsStyleValue(screenSource, styleName, 'minHeight');
  if (minHeight === null) return false;
  const floor = Number(minHeight);
  if (!Number.isFinite(floor) || floor < MIN_TAP_TARGET_DP) return false;
  const padY = settingsStyleValue(screenSource, styleName, 'paddingVertical');
  if (padY === null) return false;
  const pad = Number(padY);
  return Number.isFinite(pad) && pad > 0;
}

/** Every text row on the screen obeys rule 1. */
export function textRowsCarryNoFixedHeight(screenSource: string): boolean {
  return TEXT_ROW_STYLES.every((style) => textRowCarriesNoFixedHeight(screenSource, style));
}

/**
 * The text block flexes and reserves nothing: `flex: 1` and `minWidth: 0`, with
 * NO `paddingRight` — the v47 defect's `paddingRight: 100`.
 */
export function rowCopyFlexesWithoutHardPad(screenSource: string): boolean {
  if (settingsStyleValue(screenSource, 'specRowCopy', 'flex') !== '1') return false;
  if (settingsStyleValue(screenSource, 'specRowCopy', 'minWidth') !== '0') return false;
  return settingsStyleValue(screenSource, 'specRowCopy', 'paddingRight') === null;
}

/**
 * The Pro row's copy flexes the same way, and its "View plans" pill is a measured
 * trailing control (`flexShrink: 0`) rather than something the text pads around.
 */
export function proRowLaysOutWithoutHardPad(screenSource: string): boolean {
  if (settingsStyleValue(screenSource, 'proCopy', 'flex') !== '1') return false;
  if (settingsStyleValue(screenSource, 'proCopy', 'minWidth') !== '0') return false;
  if (settingsStyleValue(screenSource, 'proCta', 'flexShrink') !== '0') return false;
  return settingsStyleValue(screenSource, 'proCopy', 'paddingRight') === null;
}

/**
 * No style on this screen that holds text reserves a wide right pad. The row's
 * own inset (`paddingRight: 10`) is a margin, not a reservation, so the rule is a
 * THRESHOLD: anything at or above HARD_RIGHT_PAD_DP fails.
 */
export function noRowReservesAHardRightPad(screenSource: string): boolean {
  const styles = ['proRow', 'proCopy', 'proCta', 'specRow', 'specRowCopy', 'specRowValue'];
  return styles.every((style) => {
    const pad = settingsStyleValue(screenSource, style, 'paddingRight');
    if (pad === null) return true;
    const value = Number(pad);
    return !Number.isFinite(value) || value < HARD_RIGHT_PAD_DP;
  });
}

/**
 * Rule 4: the TITLE and SUB texts wrap. The check reads the RENDERED element —
 * the line that uses `styles.<key>` — not the style block, because
 * `numberOfLines` is a prop on the `<Text>`.
 */
export function rowTitlesWrap(screenSource: string): boolean {
  const text = maskSourceComments(screenSource);
  const keys = ['specRowTitle', 'specRowSub', 'proTitle', 'proSub'];
  let checked = 0;
  for (const key of keys) {
    const at = text.indexOf(`styles.${key}`);
    if (at < 0) continue;
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const lineEnd = text.indexOf('\n', at);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (line.indexOf('numberOfLines') >= 0) return false;
    checked += 1;
  }
  // A floor: the scan must have found the elements it audits.
  return checked >= 4;
}

/** Rule 5: the OS font scale is honoured on this screen. */
export function settingsHonoursFontScale(screenSource: string): boolean {
  const text = maskSourceComments(screenSource);
  if (/allowFontScaling\s*=\s*\{?\s*false/.test(text)) return false;
  const cap = /maxFontSizeMultiplier/.test(text);
  return !cap;
}

/** The spec's own floors still match what the screen applies (no silent drift). */
export function settingsFloorsMatchTheSpec(screenSource: string): boolean {
  const row = settingsStyleValue(screenSource, 'specRow', 'minHeight');
  const pro = settingsStyleValue(screenSource, 'proRow', 'minHeight');
  return Number(row) === SETTINGS_SPEC.rowMinHeight && Number(pro) === SETTINGS_SPEC.proMinHeight;
}

/** The whole fit contract, one call. */
export function settingsFitContractHolds(screenSource: string): boolean {
  return (
    textRowsCarryNoFixedHeight(screenSource) &&
    rowCopyFlexesWithoutHardPad(screenSource) &&
    proRowLaysOutWithoutHardPad(screenSource) &&
    noRowReservesAHardRightPad(screenSource) &&
    rowTitlesWrap(screenSource) &&
    settingsHonoursFontScale(screenSource) &&
    settingsFloorsMatchTheSpec(screenSource)
  );
}
