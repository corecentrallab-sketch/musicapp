/**
 * themeStore.ts — the light/dark choice (v33 slice F) made APP-WIDE (v34b).
 *
 * v33 shipped this module with one consumer (Settings) and a per-caller local
 * state hook: every screen that read it got its OWN copy, so a toggle in Settings
 * could never repaint another page — exactly the owner's FAIL item 6 ("Light
 * button only works on one page"). The fix is small and structural: the mode
 * lives in a React CONTEXT mounted once at the app root (repo-root App.tsx), and
 * every surface reads that ONE binding.
 *
 * Mode lives in AsyncStorage under ONE key (theme.THEME_STORAGE_KEY) and is read
 * through the pure resolver, so a corrupted or missing value lands on the app's
 * own dark default instead of breaking the surface. The write path is unchanged
 * from v33: the Settings toggle calls setMode → writeThemeMode.
 *
 * TWO HOOKS:
 *   • useThemeMode()      — { mode, tokens, setMode, toggle } — the binding.
 *   • useThemedStyles(base) — { styles, theme }: the screen's existing StyleSheet
 *     re-painted for the chosen palette (services/themeApply.ts), plus the tokens
 *     for the handful of inline colours that a StyleSheet cannot carry. This is
 *     the one line every screen adds, and it re-renders on the toggle, so the
 *     change is LIVE (no restart, no navigation needed).
 *
 * The palette itself, the resolver and the persisted-value contract stay in the
 * PURE services/theme.ts (tier1-compiled, asserted by scripts/v33TakeEditor.test.ts
 * and scripts/v34bThemeWiring.test.ts). This module is the React binding and is
 * deliberately NOT in the tier1 include list (AsyncStorage).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_THEME_MODE,
  THEME_STORAGE_KEY,
  resolveThemeMode,
  themeFor,
  toggleThemeMode,
  type ThemeMode,
  type ThemeTokens,
} from './theme';
import { themedSheet } from './themeApply';

/** The stored mode (never throws: an unreadable store means the default). */
export async function readThemeMode(): Promise<ThemeMode> {
  try {
    const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    return resolveThemeMode(raw);
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export async function writeThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, resolveThemeMode(mode));
  } catch {
    // A failed write only costs the next launch's default — never a crash.
  }
}

export interface ThemeModeBinding {
  mode: ThemeMode;
  tokens: ThemeTokens;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

/**
 * The ONE app-wide binding. Mounted once, at the root (App.tsx), so every screen,
 * the navigation container and the status bar read the same mode and a toggle
 * repaints all of them at once.
 */
export const ThemeModeContext = createContext<ThemeModeBinding | null>(null);

/** The dark default, for a surface rendered outside the provider (never a crash). */
export const FALLBACK_THEME_BINDING: ThemeModeBinding = {
  mode: DEFAULT_THEME_MODE,
  tokens: themeFor(DEFAULT_THEME_MODE),
  setMode: () => {},
  toggle: () => {},
};

/** Read + write the app's theme mode (the provider's own state). */
export function useThemeModeBinding(): ThemeModeBinding {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE);

  useEffect(() => {
    let cancelled = false;
    readThemeMode().then((stored) => {
      if (!cancelled) setModeState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    const resolved = resolveThemeMode(next);
    setModeState(resolved);
    void writeThemeMode(resolved);
  }, []);

  const toggle = useCallback(() => {
    setModeState((current) => {
      const next = toggleThemeMode(current);
      void writeThemeMode(next);
      return next;
    });
  }, []);

  return { mode, tokens: themeFor(mode), setMode, toggle };
}

/**
 * The provider. Mounted at the repo root, OUTSIDE NavigationContainer, so the
 * navigation container, every screen, every modal and the status bar all read it.
 * (createElement rather than JSX: this module stays a .ts, so the tier1 gate and
 * the Node-only tooling can still load it without a JSX transform.)
 */
export function ThemeModeProvider(props: { children?: React.ReactNode }) {
  const binding = useThemeModeBinding();
  return React.createElement(
    ThemeModeContext.Provider,
    { value: binding },
    props.children,
  );
}

/** The app's chosen mode + palette from any surface. */
export function useThemeMode(): ThemeModeBinding {
  return useContext(ThemeModeContext) ?? FALLBACK_THEME_BINDING;
}

export interface ThemedStyles<T> {
  styles: T;
  theme: ThemeTokens;
}

/**
 * A screen's own StyleSheet, re-painted for the chosen palette, plus the tokens.
 * Dark mode is the identity (themeApply.themedSheet), so the existing design is
 * untouched; light mode replaces every palette literal with its light token.
 */
export function useThemedStyles<T>(base: T): ThemedStyles<T> {
  const { mode, tokens } = useThemeMode();
  const styles = useMemo(() => themedSheet(base, mode), [base, mode]);
  return useMemo(() => ({ styles, theme: tokens }), [styles, tokens]);
}
