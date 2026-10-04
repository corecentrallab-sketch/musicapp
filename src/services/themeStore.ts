/**
 * themeStore.ts — persistence for the light/dark choice (v33 slice F).
 *
 * The mode lives in AsyncStorage under ONE key (theme.THEME_STORAGE_KEY) and is
 * read through the pure resolver, so a corrupted or missing value lands on the
 * app's own dark default instead of breaking the surface. The React binding is
 * `useThemeMode` below: the Settings toggle writes, every themed surface reads.
 */
import { useCallback, useEffect, useState } from 'react';
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

/** Read + write the app's theme mode from any surface. */
export function useThemeMode(): ThemeModeBinding {
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
