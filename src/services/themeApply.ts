/**
 * themeApply.ts — the app-wide application of the chosen palette (v34b, owner
 * FAIL item 6: "Light button only works on one page, the settings page — needs to
 * work on all pages through the app").
 *
 * WHY A REMAPPER AND NOT 1,000 EDITED LINES. The app's surfaces were written
 * against ONE palette: its dark colours are literals scattered through 39
 * screens/components (~1,000 colour sites). v33 shipped the real mechanism —
 * services/theme.ts (the two palettes, the resolver) + services/themeStore.ts
 * (the persisted mode) — and applied it to the Settings screen only.
 *
 * This module is the missing half: ONE pure function that takes a screen's
 * existing StyleSheet and returns the same sheet with every palette literal
 * replaced by the LIGHT token for its role. Screens change by one line
 * (`const { styles, theme } = useThemedStyles(baseStyles)`), the dark design is
 * untouched by construction (dark mode is the IDENTITY — see themedSheet), and a
 * future palette is a value in theme.ts.
 *
 * DARK IS THE IDENTITY. `themedSheet(sheet, 'dark')` returns the sheet itself, so
 * the owner's existing dark styling cannot drift by so much as a shade; only the
 * light mode re-maps. That also means the app's dark literals ARE the mapping
 * key, and a colour this table does not know simply stays as it is (never a
 * surprise).
 *
 * PURE (no react / react-native / fs): asserted by scripts/v34bThemeWiring.test.ts.
 */
import { LIGHT_THEME, type ThemeMode, type ThemeTokens } from './theme';

export type ThemeStyle = Record<string, unknown>;
export type ThemeSheet = Record<string, ThemeStyle>;

/** Props that PAINT a fill (a chip/card/button background, a slider track). */
export const BACKGROUND_PROPS: readonly string[] = [
  'backgroundColor',
  'minimumTrackTintColor',
  'maximumTrackTintColor',
];
/** Props that stroke an edge. */
export const BORDER_PROPS: readonly string[] = [
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'borderStartColor',
  'borderEndColor',
  'outlineColor',
];
/** Props that paint text/glyphs (the ones a filled button must keep white). */
export const FOREGROUND_PROPS: readonly string[] = [
  'color',
  'tintColor',
  'textDecorationColor',
  'placeholderTextColor',
  'thumbTintColor',
  'shadowColor',
];
export const THEME_COLOR_PROPS: readonly string[] = [
  ...BACKGROUND_PROPS,
  ...BORDER_PROPS,
  ...FOREGROUND_PROPS,
];

/**
 * The app's dark palette literal → the ROLE it plays. Every entry is a colour
 * that exists in the app today (counted from the source, 2026-10-08); the light
 * value comes from theme.LIGHT_THEME, so the light look is defined in ONE place.
 */
export const LIGHT_ROLE_BY_COLOR: Record<string, keyof ThemeTokens> = {
  // surfaces
  '#12122b': 'background',
  '#10101c': 'background',
  '#1a1a2e': 'surfaceAlt',
  '#16213e': 'surface',
  '#0f3460': 'border',
  // text
  '#ffffff': 'text',
  '#fff': 'text',
  '#eaeaff': 'text',
  '#c0c0d0': 'text',
  '#d5d5e4': 'text',
  '#a0a0b8': 'subtext',
  '#8a8aa3': 'subtext',
  '#8a8ab0': 'subtext',
  '#7d7d99': 'subtext',
  '#6f6f88': 'subtext',
  '#707090': 'subtext',
  '#6a6a85': 'subtext',
  '#6a6a8a': 'subtext',
  // brand
  '#e94560': 'accent',
  '#c2233c': 'accent',
  '#4ecdc4': 'positive',
  '#ff6b6b': 'danger',
  '#ffb347': 'danger',
  '#ff8fa3': 'accentSoft',
  // raised chips / rails
  '#3a3a5c': 'chipBg',
  '#3a3a52': 'chipBg',
  '#3a3a55': 'chipBg',
  '#2a2a4a': 'chipBg',
  '#2a2a45': 'chipBg',
  '#1f2b52': 'chipBg',
  '#4a4a6a': 'border',
  // the deep-red error surfaces
  '#b52f47': 'danger',
  '#3a1020': 'danger',
  '#7a1f2b': 'danger',
};

/** Same colour, different job: a fill that is a stroke elsewhere. */
export const LIGHT_BACKGROUND_ROLE: Record<string, keyof ThemeTokens> = {
  '#0f3460': 'chipBg',
  '#4a4a6a': 'chipBg',
  '#ffffff': 'surface',
  '#fff': 'surface',
  '#eaeaff': 'surfaceAlt',
  '#c0c0d0': 'chipBg',
};

/** Same colour, different job: a glyph that would vanish on a light page. */
export const LIGHT_FOREGROUND_ROLE: Record<string, keyof ThemeTokens> = {
  '#0f3460': 'chipText',
  '#4a4a6a': 'subtext',
  '#3a3a5c': 'subtext',
  '#3a3a52': 'subtext',
  '#3a3a55': 'subtext',
  '#2a2a4a': 'subtext',
  '#2a2a45': 'subtext',
  '#1f2b52': 'subtext',
  '#7a1f2b': 'danger',
  '#3a1020': 'danger',
};

/** Roles that stay a dark FILL in light mode — white labels on them stay white. */
export const BRAND_FILL_ROLES: readonly (keyof ThemeTokens)[] = [
  'accent',
  'accentSoft',
  'positive',
  'danger',
];

/**
 * Style keys whose white label sits on a fill the sheet's OWN background cannot
 * reveal (the fill is applied by a parent element, or by a sibling key whose name
 * is unrelated). Three, named explicitly: the Settings plan badge, the scan
 * screen's Done button and the metronome's beat orb.
 */
export const ON_FILL_TEXT_KEYS: readonly string[] = [
  'bestValueText',
  'doneLabel',
  'orbBeatNumber',
];

type PropClass = 'background' | 'border' | 'foreground';

export function propClassOf(prop: string): PropClass {
  if (BACKGROUND_PROPS.indexOf(prop) >= 0) return 'background';
  if (BORDER_PROPS.indexOf(prop) >= 0) return 'border';
  return 'foreground';
}

/** A colour literal normalised for lookup (`#FFF` and ` #fff ` are the same). */
export function normaliseColor(value: string): string {
  return value.trim().toLowerCase();
}

/** The light role this literal plays under `prop`, or null when it is not palette. */
export function lightRoleFor(value: string, prop: string): keyof ThemeTokens | null {
  const key = normaliseColor(value);
  const cls = propClassOf(prop);
  if (cls === 'background' && LIGHT_BACKGROUND_ROLE[key]) {
    return LIGHT_BACKGROUND_ROLE[key];
  }
  if (cls === 'foreground' && LIGHT_FOREGROUND_ROLE[key]) {
    return LIGHT_FOREGROUND_ROLE[key];
  }
  return LIGHT_ROLE_BY_COLOR[key] ?? null;
}

/**
 * Does a background with this literal stay DARK in light mode? True for the brand
 * fills and for any colour the table does not know — both keep white text white.
 */
export function backgroundStaysDark(value: string): boolean {
  const role = lightRoleFor(value, 'backgroundColor');
  if (!role) return true;
  return BRAND_FILL_ROLES.indexOf(role) >= 0;
}

/** The two ways this app writes white. */
export const WHITE_LITERALS: readonly string[] = ['#ffffff', '#fff'];

function isWhite(value: string): boolean {
  return WHITE_LITERALS.indexOf(normaliseColor(value)) >= 0;
}

function isPlainObject(value: unknown): value is ThemeStyle {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function backgroundLiteralOf(entry: unknown): string | null {
  if (!isPlainObject(entry)) return null;
  const value = entry.backgroundColor;
  return typeof value === 'string' ? value : null;
}

/**
 * Does `key`'s white label sit on a dark fill? Checked in this order: the style's
 * own background; the key's own button (primaryBtnText → primaryBtn,
 * tsChipTextSelected → tsChipSelected, upgradeBtnTextPrimary →
 * upgradeBtnPrimary); then the explicit ON_FILL_TEXT_KEYS.
 */
export function labelSitsOnDarkFill(
  key: string,
  sheet: ThemeSheet,
): boolean {
  const own = backgroundLiteralOf(sheet[key]);
  if (own && backgroundStaysDark(own)) return true;

  const at = key.indexOf('Text');
  if (at > 0) {
    const prefix = key.slice(0, at);
    const suffix = key.slice(at + 'Text'.length);
    for (const candidate of [prefix, prefix + suffix]) {
      if (!candidate || candidate === key) continue;
      const bg = backgroundLiteralOf(sheet[candidate]);
      if (bg && backgroundStaysDark(bg)) return true;
    }
  }
  const short = key.replace(/(Label|Value)$/, '');
  if (short && short !== key) {
    const bg = backgroundLiteralOf(sheet[short]);
    if (bg && backgroundStaysDark(bg)) return true;
  }
  return ON_FILL_TEXT_KEYS.indexOf(key) >= 0;
}

/** One style object, re-painted for the light palette. */
export function themedStyle(
  style: unknown,
  key: string,
  sheet: ThemeSheet,
): unknown {
  if (!isPlainObject(style)) return style;
  const out: ThemeStyle = { ...style };
  for (const prop of Object.keys(style)) {
    if (THEME_COLOR_PROPS.indexOf(prop) < 0) continue;
    const raw = style[prop];
    if (typeof raw !== 'string') continue;
    const role = lightRoleFor(raw, prop);
    if (!role) continue;
    // A white LABEL on a dark fill stays white: the dark fill is the design.
    if (
      propClassOf(prop) === 'foreground' &&
      isWhite(raw) &&
      labelSitsOnDarkFill(key, sheet)
    ) {
      continue;
    }
    out[prop] = LIGHT_THEME[role];
  }
  return out;
}

/**
 * The whole sheet, re-painted. DARK IS THE IDENTITY: `themedSheet(s, 'dark')`
 * returns `s` unchanged, so the owner's existing styling cannot drift.
 */
export function themedSheet<T>(sheet: T, mode: ThemeMode): T {
  if (mode !== 'light') return sheet;
  const source = sheet as unknown as ThemeSheet;
  const out: ThemeSheet = {};
  for (const key of Object.keys(source)) {
    out[key] = themedStyle(source[key], key, source) as ThemeStyle;
  }
  return out as unknown as T;
}
