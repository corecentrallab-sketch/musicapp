/**
 * v34bThemeContract.ts — the v34b app-wide theme wiring contracts (pure, tier1).
 *
 * WHY. The owner's FAIL item 6 was that the Settings toggle "only works on one
 * page". The fix is structural (one provider at the app root + one hook per
 * screen), and no emulator runs in this repo's gate — so the wiring is asserted
 * the way every other screen-level rule here is: by reading the REAL sources
 * (skill `musicapp-tier1-live-scan-suite`). Every scanner below is a pure string
 * function, so scripts/v34bThemeWiring.test.ts can run it against the real files
 * AND against mutated (un-wired) text that MUST fail — a guard that cannot fail
 * proves nothing (skill `musicapp-guard-mutation-probes`).
 */
import { maskComments } from './modalBackContract';

/** The repo-root App.tsx mounts ONE provider outside the navigation container. */
export function themeProviderMountedAtRoot(appSource: string): boolean {
  const src = maskComments(appSource);
  if (src.indexOf("from './src/services/themeStore'") < 0) return false;
  if (src.indexOf('ThemeModeProvider') < 0) return false;
  if (src.indexOf('<ThemeModeProvider>') < 0) return false;
  if (src.indexOf('<AppShell />') < 0) return false;
  // The provider wraps the shell, and the container lives INSIDE the shell.
  const providerAt = src.indexOf('<ThemeModeProvider>');
  const shellAt = src.indexOf('<AppShell />');
  const navAt = src.indexOf('<NavigationContainer');
  if (providerAt < 0 || shellAt < 0 || navAt < 0) return false;
  if (!(providerAt < shellAt && shellAt < navAt)) return false;
  // …and the shell really reads the mode (a provider nobody reads is inert).
  if (src.indexOf('useThemeMode()') < 0) return false;
  if (src.indexOf('const { mode, tokens: theme } = useThemeMode();') < 0) return false;
  return true;
}

/** The status bar follows the mode (dark glyphs on the light palette). */
export function statusBarIsThemed(appSource: string): boolean {
  const src = maskComments(appSource);
  if (src.indexOf("const statusBarStyle = mode === 'light' ? 'dark' : 'light';") < 0) {
    return false;
  }
  const uses = src.split('<StatusBar style={statusBarStyle} />').length - 1;
  return uses >= 2; // the onboarding branch AND the main stack
}

/** The navigation container + the stack chrome are themed from the tokens. */
export function navigationChromeIsThemed(appSource: string): boolean {
  const src = maskComments(appSource);
  if (src.indexOf('navigationTheme(mode, theme)') < 0) return false;
  if (src.indexOf('headerStyle: { backgroundColor: theme.surface }') < 0) return false;
  if (src.indexOf('headerTintColor: theme.accent') < 0) return false;
  if (src.indexOf('contentStyle: { backgroundColor: theme.surfaceAlt }') < 0) return false;
  if (src.indexOf('backgroundColor: theme.surfaceAlt,') < 0) return false; // loading view
  return true;
}

/** The tab bar (its own file) reads the same shared mode. */
export function tabBarIsThemed(tabSource: string): boolean {
  const src = maskComments(tabSource);
  if (src.indexOf("from '../services/themeStore'") < 0) return false;
  if (src.indexOf('useThemeMode()') < 0) return false;
  if (src.indexOf('backgroundColor: theme.surface,') < 0) return false;
  if (src.indexOf('borderTopColor: theme.border,') < 0) return false;
  if (src.indexOf('tabBarActiveTintColor: theme.accent,') < 0) return false;
  if (src.indexOf('tabBarInactiveTintColor: theme.subtext,') < 0) return false;
  if (src.indexOf('color={theme.accent}') < 0) return false; // the header button
  return true;
}

/**
 * A screen consumes the SHARED theme: its StyleSheet is the re-paintable base and
 * the hook hands it back per render, so a toggle repaints it live. A screen that
 * keeps a module-level `styles` (or never calls the hook) fails — that is exactly
 * the "works on one page" state.
 */
export function screenConsumesTheTheme(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 800) return false;
  if (src.indexOf("from '../services/themeStore'") < 0) return false;
  if (src.indexOf('useThemedStyles(') < 0) return false;
  if (src.indexOf('const { styles, theme } = useThemedStyles(baseStyles);') < 0) return false;
  if (src.indexOf('const baseStyles = StyleSheet.create(') < 0) return false;
  // The old module-level name must be GONE (a screen with both would keep painting
  // the dark sheet on every surface the hook does not reach).
  if (/\nconst styles = StyleSheet\.create\(/.test(src)) return false;
  return true;
}

/**
 * The Settings toggle still WRITES the persisted mode — through the shared store,
 * which is what makes the choice survive a restart (v33 behaviour kept).
 */
export function settingsToggleWritesTheSharedMode(
  settingsSource: string,
  storeSource: string,
): boolean {
  const settings = maskComments(settingsSource);
  const store = maskComments(storeSource);
  if (settings.indexOf('useThemeMode(') < 0) return false;
  if (settings.indexOf("setThemeMode('dark')") < 0) return false;
  if (settings.indexOf("setThemeMode('light')") < 0) return false;
  if (settings.indexOf('const { styles } = useThemedStyles(baseStyles);') < 0) return false;
  if (store.indexOf('THEME_STORAGE_KEY') < 0) return false;
  if (store.indexOf('AsyncStorage.setItem(THEME_STORAGE_KEY') < 0) return false;
  if (store.indexOf('export function ThemeModeProvider') < 0) return false;
  if (store.indexOf('ThemeModeContext.Provider') < 0) return false;
  return true;
}

/** The applier is PURE, dark mode is the IDENTITY, and light really re-maps. */
export function themeApplierIsPureAndDarkIsIdentity(applySource: string): boolean {
  const src = maskComments(applySource);
  if (src.length < 2000) return false;
  if (src.indexOf("if (mode !== 'light') return sheet;") < 0) return false;
  if (src.indexOf('LIGHT_ROLE_BY_COLOR') < 0) return false;
  if (src.indexOf("'#e94560': 'accent'") < 0) return false;
  if (src.indexOf("'#1a1a2e': 'surfaceAlt'") < 0) return false;
  // No React / React Native in the pure module.
  if (/from 'react/.test(src)) return false;
  if (/from 'react-native/.test(src)) return false;
  return true;
}
