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

/**
 * The repo-root App.tsx mounts ONE provider that WRAPS the shell, and the shell
 * owns the navigation container.
 *
 * Textual order is the wrong test here: the root App() is written at the BOTTOM of
 * the file, so `<NavigationContainer>` necessarily sits ABOVE `<ThemeModeProvider>`
 * in the source even though it is nested inside it at runtime. What actually
 * matters is CONTAINMENT — the provider's only child is `<AppShell />` — plus the
 * container living inside the AppShell component's own body. That is what a
 * half-fix (a provider nobody wraps, or a shell that reads no mode) fails.
 */
export function themeProviderMountedAtRoot(appSource: string): boolean {
  const src = maskComments(appSource);
  if (src.indexOf("from './src/services/themeStore'") < 0) return false;
  if (src.indexOf('ThemeModeProvider') < 0) return false;
  const openTag = '<ThemeModeProvider>';
  const open = src.indexOf(openTag);
  if (open < 0) return false;
  const close = src.indexOf('</ThemeModeProvider>', open);
  if (close < 0) return false;
  // The provider's ONLY child is the shell — that is the wrap.
  if (src.slice(open + openTag.length, close).trim() !== '<AppShell />') return false;
  // The shell is declared before it is mounted, and it owns the container.
  const shellFn = src.indexOf('function AppShell(');
  if (shellFn < 0 || shellFn > open) return false;
  if (src.indexOf('<NavigationContainer', shellFn) < 0) return false;
  // …and the shell really reads the mode (a provider nobody reads is inert).
  if (src.indexOf('useThemeMode()') < 0) return false;
  if (src.indexOf('const { mode, tokens: theme } = useThemeMode();') < 0) return false;
  return true;
}

/**
 * App.tsx paints from the TOKENS and holds no sheet of its own: it may not use the
 * per-screen hook (that is the screens' contract), it must not create a StyleSheet,
 * and it must actually read the shared tokens for the chrome it paints. Comments are
 * masked, so documenting the screens' `useThemedStyles` binding is not an offence.
 */
export function appPaintsFromTokensNotItsOwnSheet(appSource: string): boolean {
  const src = maskComments(appSource);
  if (src.length < 3000) return false;
  if (src.indexOf('useThemedStyles') >= 0) return false;
  if (src.indexOf('StyleSheet.create(') >= 0) return false;
  if (src.indexOf('theme.surfaceAlt') < 0) return false; // loading view + stack body
  if (src.indexOf('theme.accent') < 0) return false; // spinner + header tint
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
  if (src.indexOf('const baseStyles = StyleSheet.create(') < 0) return false;
  // The old module-level name must be GONE (a screen with both would keep painting
  // the dark sheet on every surface the hook does not reach).
  if (/\nconst styles = StyleSheet\.create\(/.test(src)) return false;
  // TWO honest shapes, because a screen may need the mode itself (Settings needs
  // `mode` + `setMode` for its toggle, so it takes the styles from the hook and the
  // tokens from the binding). Either way the sheet is the re-paintable one:
  //   (a) const { styles, theme } = useThemedStyles(baseStyles);          — 17 screens
  //   (b) const { styles } = useThemedStyles(baseStyles);                 — Settings
  //       …with the tokens read from the SAME shared binding: `tokens: theme`
  const combined = src.indexOf('const { styles, theme } = useThemedStyles(baseStyles);');
  const stylesOnly = src.indexOf('const { styles } = useThemedStyles(baseStyles);');
  if (combined < 0 && stylesOnly < 0) return false;
  if (combined >= 0) return true;
  return src.indexOf('tokens: theme') >= 0 && src.indexOf('useThemeMode()') >= 0;
}

/**
 * A host that renders the sheet/PDF WebView document passes the app's mode into it.
 * Every `buildSheetViewerHtml(...)` call site must carry `themeMode`: a one-argument
 * call compiles, runs and silently freezes that reader in the dark chrome on a
 * light app — the exact "works on one page" class of bug (owner FAIL item 6).
 */
export function hostPassesModeToSheetDocument(source: string): boolean {
  const src = maskComments(source);
  if (src.indexOf('useThemeMode()') < 0) return false;
  const marker = 'buildSheetViewerHtml(';
  let at = src.indexOf(marker);
  let calls = 0;
  while (at >= 0) {
    // Walk to the call's closing paren so the ARGUMENTS are what gets inspected.
    let depth = 0;
    let i = at + marker.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const args = src.slice(at + marker.length, i);
    calls += 1;
    if (args.indexOf('themeMode') < 0) return false;
    at = src.indexOf(marker, i);
  }
  return calls >= 1;
}

/**
 * The full-screen reader re-paints an OPEN document when the mode flips (instead of
 * rebuilding the source, which would reload the WebView and lose the reader's page).
 */
export function sheetReaderRepaintsLive(source: string): boolean {
  const src = maskComments(source);
  if (src.indexOf('sheetThemeScript(themeMode)') < 0) return false;
  if (src.indexOf('injectJavaScript(') < 0) return false;
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
