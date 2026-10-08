/**
 * v34bThemeWiring.test.ts — LIVE-SOURCE GUARDS for the app-wide light/dark theme
 * (owner FAIL item 6: "Light button only works on one page, the settings page —
 * needs to work on all pages through the app").
 *
 * The theme model (services/theme.ts) and the applier (services/themeApply.ts) are
 * pure and unit-tested below; the RISK is the WIRING — a provider nobody mounts,
 * a screen that keeps painting its own dark sheet, a status bar that stays light
 * on a light background. No emulator runs in this gate, so every one of those is
 * asserted by reading the REAL files, and each guard is ALSO run against mutated
 * (un-wired) text that MUST fail, so a guard that cannot fail is visible here
 * rather than on the owner's device.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  LIGHT_THEME,
  DARK_THEME,
  THEME_HONEST_NOTE,
  resolveThemeMode,
  themeFor,
} from '../src/services/theme';
import {
  themedSheet,
  lightRoleFor,
  labelSitsOnDarkFill,
  ON_FILL_TEXT_KEYS,
} from '../src/services/themeApply';
import {
  appPaintsFromTokensNotItsOwnSheet,
  hostPassesModeToSheetDocument,
  navigationChromeIsThemed,
  screenConsumesTheTheme,
  settingsToggleWritesTheSharedMode,
  sheetReaderRepaintsLive,
  statusBarIsThemed,
  tabBarIsThemed,
  themeApplierIsPureAndDarkIsIdentity,
  themeProviderMountedAtRoot,
} from '../src/services/v34bThemeContract';
import {
  SHEET_PAPER,
  SHEET_PALETTE,
  buildSheetViewerHtml,
  sheetCssVariables,
  sheetThemeScript,
} from '../src/services/sheetViewerHtml';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;

let passes = 0;
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function read(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}
function screens(): string[] {
  const fs = require('fs');
  const path = require('path');
  return (fs.readdirSync(path.join(repoRoot(), 'src/screens')) as string[])
    .filter((n: string) => /\.tsx$/.test(n))
    .sort();
}

const APP = read('App.tsx');
const STORE = read('src/services/themeStore.ts');
const APPLY = read('src/services/themeApply.ts');
const SETTINGS = read('src/screens/SettingsScreen.tsx');
const TAB = read('src/navigation/TabNavigator.tsx');
const HOME = read('src/screens/HomeScreen.tsx');
const HISTORY = read('src/screens/HistoryScreen.tsx');
const EDITOR = read('src/screens/EditorScreen.tsx');
const MELODY = read('src/components/MelodyCaptureWindow.tsx');
const TAKE_EDITOR = read('src/components/TakeCorrectionEditor.tsx');
const PREVIEW = read('src/components/TakePreviewSection.tsx');
const AUTO_SCROLL = read('src/components/AutoScrollControl.tsx');
const SCORE_VIEWER = read('src/components/ScoreViewer.tsx');
const RESULT_VIEW = read('src/components/RecognitionResultView.tsx');
const screenNames = screens();

// ── floors: the walk found the real files ────────────────────────────
console.log('\nv34b — the live-source walk (floors first)');
assert(APP.length > 3000, `read App.tsx (${APP.length} chars)`);
assert(STORE.length > 3000, `read themeStore.ts (${STORE.length} chars)`);
assert(APPLY.length > 3000, `read themeApply.ts (${APPLY.length} chars)`);
assert(SETTINGS.length > 8000, `read SettingsScreen.tsx (${SETTINGS.length} chars)`);
assert(MELODY.length > 20000, `read MelodyCaptureWindow.tsx (${MELODY.length} chars)`);
assertEq(screenNames.length, 18, `the walk found ${screenNames.length} screens (want 18)`);

// ── the wiring guards, on the REAL sources ───────────────────────────
console.log('\nv34b — the app-wide wiring');
assert(themeProviderMountedAtRoot(APP), 'App.tsx: ONE ThemeModeProvider mounted at the root, over the shell, above NavigationContainer');
assert(statusBarIsThemed(APP), 'App.tsx: the status bar follows the mode (dark glyphs on light)');
assert(navigationChromeIsThemed(APP), 'App.tsx: the stack chrome + loading view are painted from the tokens');
assert(tabBarIsThemed(TAB), 'TabNavigator: the tab bar, its labels, headers and header button are painted from the tokens');
assert(themeApplierIsPureAndDarkIsIdentity(APPLY), 'themeApply.ts: pure, dark is the identity, light re-maps');
assert(settingsToggleWritesTheSharedMode(SETTINGS, STORE), 'Settings: the toggle writes the SHARED persisted mode');
assert(STORE.indexOf('useThemedStyles') > 0, 'themeStore: the shared useThemedStyles hook exists');
assert(
  appPaintsFromTokensNotItsOwnSheet(APP),
  'App.tsx does not fake a per-screen sheet (it paints from the tokens directly)',
);
assert(SCORE_VIEWER.length > 15000, `read ScoreViewer.tsx (${SCORE_VIEWER.length} chars)`);
assert(RESULT_VIEW.length > 30000, `read RecognitionResultView.tsx (${RESULT_VIEW.length} chars)`);
assert(
  hostPassesModeToSheetDocument(SCORE_VIEWER),
  'ScoreViewer: the reader document is built for the app’s mode (no one-arg call)',
);
assert(
  hostPassesModeToSheetDocument(RESULT_VIEW),
  'RecognitionResultView: the inline score card is built for the app’s mode',
);
assert(
  sheetReaderRepaintsLive(SCORE_VIEWER),
  'ScoreViewer: a live toggle re-paints the OPEN reader (no reload, page kept)',
);

// ── EVERY screen consumes the theme (the owner's actual complaint) ───
console.log('\nv34b — every screen consumes the shared theme');
let wired = 0;
for (const name of screenNames) {
  const source = read('src/screens/' + name);
  if (screenConsumesTheTheme(source)) wired += 1;
  else console.error('  ✗ FAILED: src/screens/' + name + ' does not consume the shared theme');
}
assertEq(wired, screenNames.length, `all ${screenNames.length} screens call useThemedStyles(baseStyles)`);
assert(screenConsumesTheTheme(HOME), 'HomeScreen consumes the theme');
assert(screenConsumesTheTheme(SETTINGS), 'SettingsScreen consumes the theme');
assert(screenConsumesTheTheme(HISTORY), 'HistoryScreen consumes the theme');
assert(screenConsumesTheTheme(EDITOR), 'EditorScreen consumes the theme');
assert(screenConsumesTheTheme(MELODY), 'MelodyCaptureWindow consumes the theme');
assert(screenConsumesTheTheme(TAKE_EDITOR), 'TakeCorrectionEditor consumes the theme');
assert(screenConsumesTheTheme(PREVIEW), 'TakePreviewSection consumes the theme');
assert(screenConsumesTheTheme(AUTO_SCROLL), 'AutoScrollControl consumes the theme (both sub-components)');

// ── the applier really re-paints (and never touches dark) ────────────
console.log('\nv34b — the palette really applies');
const sheet = {
  screen: { flex: 1, backgroundColor: '#1a1a2e' },
  card: { backgroundColor: '#16213e', borderColor: '#0f3460', borderWidth: 1 },
  title: { color: '#e94560' },
  body: { color: '#a0a0b8' },
  heroBtn: { backgroundColor: '#e94560' },
  heroBtnText: { color: '#ffffff' },
  primaryBtnText: { color: '#ffffff' },
  primaryBtn: { backgroundColor: '#e94560' },
  label: { color: '#ffffff' },
  unknown: { backgroundColor: '#123456' },
  rail: { maximumTrackTintColor: '#3a3a55' },
};
const light = themedSheet(sheet, 'light');
assertEq(themedSheet(sheet, 'dark'), sheet, 'dark mode is the identity (the sheet object itself is returned)');
assertEq(light.screen.backgroundColor, LIGHT_THEME.surfaceAlt, 'a light screen background comes from the light palette');
assertEq(light.card.backgroundColor, LIGHT_THEME.surface, 'a card becomes the light surface');
assertEq(light.card.borderColor, LIGHT_THEME.border, 'a card border becomes the light border');
assertEq(light.title.color, LIGHT_THEME.accent, 'a brand title becomes the light accent');
assertEq(light.body.color, LIGHT_THEME.subtext, 'body text becomes the light subtext');
assertEq(light.label.color, LIGHT_THEME.text, 'a white label on a light surface becomes dark text');
assertEq(light.heroBtnText.color, '#ffffff', 'a white label on a brand fill STAYS white');
assertEq(light.primaryBtnText.color, '#ffffff', 'a white label on a filled button stays white (sibling key)');
assertEq(light.unknown.backgroundColor, '#123456', 'a colour the table does not know is left alone');
assertEq(light.rail.maximumTrackTintColor, LIGHT_THEME.chipBg, 'a slider rail becomes the light chip');
assertEq(DARK_THEME.accent, '#e94560', 'the dark palette is unchanged (the owner’s design)');
assertEq(resolveThemeMode('light'), 'light', 'the resolver still honours a stored light value');
assertEq(themeFor('nonsense').background, DARK_THEME.background, 'an unknown stored value still lands on dark');
assert(THEME_HONEST_NOTE.indexOf('whole app') > 0, 'the Settings copy now says the choice is app-wide');
assert(THEME_HONEST_NOTE.indexOf('rest of the app keeps its dark styling') < 0, 'the stale v33 scope note is gone');
assertEq(ON_FILL_TEXT_KEYS.length, 3, 'exactly the three named on-fill labels are excepted');
assert(labelSitsOnDarkFill('heroBtnText', sheet), 'labelSitsOnDarkFill sees a brand fill');
assert(!labelSitsOnDarkFill('label', sheet), 'a label on a plain surface is not on a fill');
assertEq(lightRoleFor('#ffffff', 'backgroundColor'), 'surface', 'white as a FILL is a surface, white as a GLYPH is text');
assertEq(lightRoleFor('#ffffff', 'color'), 'text', 'white glyph → text');

// ── the score / PDF WebView page follows the mode (owner FAIL item 6) ──
// The reader is user-visible, so it is CONVERTED, not exempted: the document is
// built for a mode, and the one deliberate carve-out is the PAPER (a score is
// white paper with dark ink — inverting the page would make the staff unreadable).
console.log('\nv34b — the sheet/PDF reader document follows the mode');
const SHEET_URL = 'https://example.com/piece.pdf';
const sheetDark = buildSheetViewerHtml(SHEET_URL, 'dark');
const sheetLight = buildSheetViewerHtml(SHEET_URL, 'light');
const sheetDefault = buildSheetViewerHtml(SHEET_URL);
assert(
  sheetDark.length > 4000 && sheetLight.length > 4000,
  `built both reader documents (${sheetDark.length}/${sheetLight.length} chars)`,
);
assertEq(sheetDefault, sheetDark, 'no mode given = the app’s dark design (dark is the identity)');
assert(sheetDark.indexOf('data-theme="dark"') > 0, 'the dark document declares its mode');
assert(sheetLight.indexOf('data-theme="light"') > 0, 'the light document declares its mode');
for (const doc of [sheetDark, sheetLight]) {
  assert(
    doc.indexOf(":root[data-theme='light']") > 0 &&
      doc.indexOf(sheetCssVariables('dark')) > 0 &&
      doc.indexOf(sheetCssVariables('light')) > 0,
    'both documents carry BOTH columns from the one shared table (a live switch needs no rebuild)',
  );
  assert(
    doc.indexOf('function setSheetTheme(') > 0 &&
      doc.indexOf('window.setSheetTheme = setSheetTheme;') > 0,
    'the document can be re-painted from the host (setSheetTheme)',
  );
  assert(
    doc.indexOf('background: var(--sheet-chrome, #1a1a2e);') > 0,
    'the area AROUND the page is themed (dark value kept as the fallback)',
  );
  assert(
    doc.indexOf('background: var(--sheet-paper, #ffffff);') > 0,
    'the page itself reads the paper variable',
  );
}
assertEq(
  SHEET_PALETTE.dark.chrome,
  DARK_THEME.surfaceAlt,
  'the dark chrome is the app’s own dark surface (unchanged from v33)',
);
assertEq(
  SHEET_PALETTE.light.chrome,
  LIGHT_THEME.surfaceAlt,
  'the light chrome is the light surface (the same token as every screen)',
);
assertEq(
  SHEET_PALETTE.dark.pillBg,
  'rgba(22, 33, 62, 0.72)',
  'the dark immersive page pill is byte-identical to v33 (still translucent)',
);
assertEq(
  SHEET_PALETTE.light.errorTitle,
  LIGHT_THEME.text,
  'the light error card uses dark ink (never white on a light surface)',
);
assert(
  sheetLight.indexOf(SHEET_PALETTE.light.chrome) > 0,
  'the light document really carries the light chrome',
);
assertEq(
  sheetLight.indexOf('background: #1a1a2e;'),
  -1,
  'no bare dark surface rule survives in the light document',
);
assertEq(SHEET_PAPER, '#ffffff', 'the paper is white in every mode (the exemption)');
assert(
  sheetCssVariables('dark').indexOf('--sheet-paper') < 0 &&
    sheetCssVariables('light').indexOf('--sheet-paper') < 0,
  'NEITHER mode overrides the paper (the staff is never inverted)',
);
assert(
  sheetThemeScript('light').indexOf("setSheetTheme('light')") > 0,
  'the injected script names the mode it flips to',
);
assert(
  sheetThemeScript('nonsense').indexOf("setSheetTheme('dark')") > 0,
  'an unknown mode in the injected script falls back to dark',
);
assert(
  sheetThemeScript('light').indexOf('catch (e)') > 0,
  'the injected script is defensive (a not-yet-ready document cannot throw into RN)',
);

// ── MUTATION PROBES: every guard must FAIL on un-wired text ──────────
console.log('\nv34b — mutation probes (each guard must fail when un-wired)');
const stripProvider = APP.replace('<ThemeModeProvider>', '').replace('<AppShell />', '');
assert(!themeProviderMountedAtRoot(stripProvider), 'MUTATION: un-mounting the provider fails the root guard');
const stripStatus = APP.replace("const statusBarStyle = mode === 'light' ? 'dark' : 'light';", "const statusBarStyle = 'light';");
assert(!statusBarIsThemed(stripStatus), 'MUTATION: a hardcoded status bar fails the status-bar guard');
assert(!navigationChromeIsThemed(APP.replace('headerStyle: { backgroundColor: theme.surface },', "headerStyle: { backgroundColor: '#16213e' },")), 'MUTATION: a hardcoded stack header fails the chrome guard');
assert(!tabBarIsThemed(TAB.replace('backgroundColor: theme.surface,', "backgroundColor: '#16213e',")), 'MUTATION: a hardcoded tab bar fails the tab-bar guard');
assert(!screenConsumesTheTheme(HOME.replace('const { styles, theme } = useThemedStyles(baseStyles);', '')), 'MUTATION: dropping the hook from HomeScreen fails the screen guard');
assert(!screenConsumesTheTheme(HISTORY.replace('const baseStyles = StyleSheet.create(', 'const styles = StyleSheet.create(')), 'MUTATION: keeping a module-level styles fails the screen guard');
assert(!settingsToggleWritesTheSharedMode(SETTINGS.replace("setThemeMode('light')", 'noop()'), STORE), 'MUTATION: an unwired Light button fails the Settings guard');
assert(!settingsToggleWritesTheSharedMode(SETTINGS, STORE.replace('AsyncStorage.setItem(THEME_STORAGE_KEY', 'AsyncStorage.nope(')), 'MUTATION: dropping the persisted write fails the persistence guard');
assert(!themeApplierIsPureAndDarkIsIdentity(APPLY.replace("if (mode !== 'light') return sheet;", '')), 'MUTATION: a non-identity dark mode fails the applier guard');
assert(!themeProviderMountedAtRoot(APP.replace('const { mode, tokens: theme } = useThemeMode();', '')), 'MUTATION: a provider nobody reads fails the root guard');
assert(
  !themeProviderMountedAtRoot(APP.replace('</ThemeModeProvider>', '')),
  'MUTATION: a provider that never closes around the shell fails the root guard',
);
assert(
  !appPaintsFromTokensNotItsOwnSheet(APP + '\nconst { styles } = useThemedStyles(baseStyles);\n'),
  'MUTATION: a per-screen sheet inside App.tsx fails the token guard',
);
assert(
  !appPaintsFromTokensNotItsOwnSheet(APP.split('theme.surfaceAlt').join('#1a1a2e')),
  'MUTATION: App.tsx painting a hardcoded colour fails the token guard',
);
assert(
  !screenConsumesTheTheme(SETTINGS.replace('const { styles } = useThemedStyles(baseStyles);', '')),
  'MUTATION: a Settings screen with no re-paintable sheet fails the screen guard',
);
assert(
  !screenConsumesTheTheme(SETTINGS.replace('tokens: theme', 'tokens: none')),
  'MUTATION: Settings tokens that do not come from the shared binding fail the screen guard',
);
// The ScoreViewer probe is the real file with the mode argument removed, i.e. the
// exact pre-fix call — the guard must see it.
assert(
  !hostPassesModeToSheetDocument(SCORE_VIEWER.replace('buildSheetViewerHtml(url, themeMode)', 'buildSheetViewerHtml(url)')),
  'MUTATION: a one-argument reader document fails the mode guard',
);
assert(
  !hostPassesModeToSheetDocument(RESULT_VIEW.replace('buildSheetViewerHtml(inlineSheetUrl, themeMode)', 'buildSheetViewerHtml(inlineSheetUrl)')),
  'MUTATION: a one-argument inline score card fails the mode guard',
);
assert(
  !sheetReaderRepaintsLive(SCORE_VIEWER.replace('sheetThemeScript(themeMode)', "'setSheetTheme(\\'light\\');'")),
  'MUTATION: a reader that never re-paints the open document fails the live-switch guard',
);

console.log(`\nv34bThemeWiring: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
