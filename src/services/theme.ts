/**
 * theme.ts — the app's light/dark choice (v33 slice F, owner 10-04 email batch:
 * "a dark/light mode toggle in Settings").
 *
 * HONEST SCOPE. A full theme of every screen is a large, risky pass; this module
 * ships the REAL mechanism (one palette table, one persisted mode, one resolver)
 * and this build applies it to the Settings screen and to the v33 melody tools
 * (capture window, take editor, preview) — the surfaces this release actually
 * touches. The remaining screens keep their dark styling until the next pass,
 * and Settings says so in words rather than implying the whole app switched.
 *
 * PURE (no react / react-native / fs / AsyncStorage): the palette, the resolver
 * and the persisted-value contract are asserted by scripts/v33TakeEditor.test.ts.
 */

export type ThemeMode = 'dark' | 'light';

/** Every colour the themed surfaces read. No surface hard-codes a hex. */
export interface ThemeTokens {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  subtext: string;
  accent: string;
  accentSoft: string;
  positive: string;
  danger: string;
  chipBg: string;
  chipText: string;
  /** The staff's ink on the notation WebView (which is always white paper). */
  staffInk: string;
  staffRawInk: string;
}

/** NoteSnap's own dark palette — the app's existing colours, named once. */
export const DARK_THEME: ThemeTokens = {
  background: '#12122b',
  surface: '#16213e',
  surfaceAlt: '#1a1a2e',
  border: '#0f3460',
  text: '#ffffff',
  subtext: '#a0a0b8',
  accent: '#e94560',
  accentSoft: '#ff8fa3',
  positive: '#4ecdc4',
  danger: '#e94560',
  chipBg: '#0f3460',
  chipText: '#cfe9ff',
  staffInk: '#0b1220',
  staffRawInk: '#9aa0b4',
};

/** The light palette: the same roles, readable on paper-white. */
export const LIGHT_THEME: ThemeTokens = {
  background: '#f6f7fb',
  surface: '#ffffff',
  surfaceAlt: '#eef1f7',
  border: '#d5dae6',
  text: '#161a24',
  subtext: '#5b6377',
  accent: '#c2233c',
  accentSoft: '#a01b31',
  positive: '#0f7a72',
  danger: '#c2233c',
  chipBg: '#e6ebf5',
  chipText: '#25324a',
  staffInk: '#0b1220',
  staffRawInk: '#9aa0b4',
};

export const THEMES: Record<ThemeMode, ThemeTokens> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};

/** The storage key the chosen mode lives under (AsyncStorage). */
export const THEME_STORAGE_KEY = 'notesnap.theme.mode';

/** The app ships dark — the owner's own styling is the default. */
export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

/** The mode a stored value really means; anything unrecognised is the default. */
export function resolveThemeMode(value: unknown): ThemeMode {
  if (value === 'light' || value === 'dark') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase().replace(/"/g, '');
    if (trimmed === 'light' || trimmed === 'dark') return trimmed as ThemeMode;
  }
  return DEFAULT_THEME_MODE;
}

export function themeFor(mode: ThemeMode | string | null | undefined): ThemeTokens {
  return THEMES[resolveThemeMode(mode)];
}

export function toggleThemeMode(mode: ThemeMode | string | null | undefined): ThemeMode {
  return resolveThemeMode(mode) === 'dark' ? 'light' : 'dark';
}

// ───────────────────────────── the Settings surface ─────────────────────────────

export const THEME_SECTION_TITLE = 'Appearance';
export const THEME_ROW_TITLE = 'Dark mode';
export const THEME_DARK_LABEL = 'Dark';
export const THEME_LIGHT_LABEL = 'Light';
export const THEME_ACCESSIBILITY_LABEL = 'Dark mode — switch the app between dark and light';
/** The honest scope note (see the module header). */
export const THEME_HONEST_NOTE =
  'This build themes the Settings screen and the new melody tools (capture, editor, preview). The rest of the app keeps its dark styling for now.';
/** What the toggle says it did. */
export function themeAppliedLine(mode: ThemeMode | string | null | undefined): string {
  return resolveThemeMode(mode) === 'light'
    ? 'Light mode on — your choice is remembered on this device.'
    : 'Dark mode on — your choice is remembered on this device.';
}

// ─────────────────────── the practice-components grouping (F4) ───────────────────────

/**
 * Owner 10-04: the "Start your streak" nudge and the "Daily streak nudge" were in
 * two unrelated places (the reminder toggle read as part of Billing). They are
 * PAIRED here: one section owns both, and the copy says how they work together.
 */
export const PRACTICE_SECTION_TITLE = 'Practice & streaks';
export const PRACTICE_SECTION_SUBTITLE =
  'Your streak lives in two places that work together: the card on Home (beside today’s piece) and this reminder.';
export const PRACTICE_STREAK_ROW_TITLE = 'Daily streak nudge';
export const PRACTICE_STREAK_ROW_HINT =
  'One reminder a day, at the time below. The in-app streak card on Home tracks the same streak.';
