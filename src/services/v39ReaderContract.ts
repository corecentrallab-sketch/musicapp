/**
 * v39ReaderContract.ts — LIVE-SOURCE GUARDS for the FULL-SCORE READER (v39 Part 2,
 * owner direction 10-11, backlog 5e3dffd3).
 *
 * The owner's ask was concrete: transposing must open the ENTIRE transposed score,
 * every bar, in its own full-screen scrollable window, with SAVE and SHARE — and
 * free (no paywall code). The pure rules behind it are unit-tested in
 * `scripts/transposedScoreReader.test.ts`; THIS module guards the wiring, which is
 * where a feature of this shape actually fails:
 *
 *   • a screen that is never registered (the door exists, the room does not);
 *   • a reader that renders the score WITHOUT `wholeWork` — i.e. clipped at the
 *     app's height ceiling exactly like the v37 residual bug (services/scoreHeight);
 *   • a second title builder, so the reader and the editor drift apart on what a
 *     transposed copy is called;
 *   • a save that does not go through the Library store, or a share that quietly
 *     does nothing when the platform refuses;
 *   • a sample excerpt presented as the whole piece (the "4 bars" the owner saw —
 *     that was the DATA, and the surface now has to say so).
 *
 * Style follows the rest of the gate: comments are masked first (a commented-out
 * fix never satisfies a guard), every guard has a length floor so an empty or
 * truncated read fails instead of passing vacuously, and every guard is shown to
 * BITE against a mutated copy in the suite.
 *
 * PURE LOGIC: imports nothing native, so it compiles under tsconfig.tier1.json.
 */
import { maskComments } from './modalBackContract';

// ───────────────────────────── the paths the walk reads ─────────────────────

export const READER_SCREEN_PATH = 'src/screens/TransposedScoreReaderScreen.tsx';
export const READER_PURE_MODULE_PATH = 'src/services/transposedScore.ts';
export const READER_SHARE_MODULE_PATH = 'src/services/scoreShare.ts';
export const READER_SHARE_DEVICE_PATH = 'src/services/scoreShareDevice.ts';
export const READER_VIEWER_PATH = 'src/components/AbcScoreView.tsx';
export const READER_SCORE_HEIGHT_PATH = 'src/services/scoreHeight.ts';
export const READER_EDITOR_PATH = 'src/screens/NotationEditorScreen.tsx';
export const READER_APP_PATH = 'App.tsx';
export const READER_TYPES_PATH = 'src/types/index.ts';
export const READER_CONTRACT_PATH = 'src/services/v39ReaderContract.ts';
export const READER_TIER1_CONFIG_PATH = 'tsconfig.tier1.json';
export const READER_PACKAGE_PATH = 'package.json';

/** The pure modules the gate must compile and the suites it must run. */
export const READER_TIER1_MODULES: readonly string[] = [
  'src/services/transposedScore.ts',
  'src/services/scoreShare.ts',
  'src/services/v39ReaderContract.ts',
  'scripts/transposedScoreReader.test.ts',
];

export const READER_TIER1_SUITES: readonly string[] = ['scripts/transposedScoreReader.test.ts'];

/** The route name the reader is registered under (App.tsx + the param list). */
export const READER_ROUTE_NAME = 'TransposedScoreReader';
/** The component symbol the screen is registered as. */
export const READER_COMPONENT_NAME = 'TransposedScoreReaderScreen';

/** The window title the reader opens with. */
export const READER_WINDOW_TITLE = 'Full score';

function countOf(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

/** The opening tag of the first `element` in `source`, whitespace intact. */
export function openingTag(source: string, element: string): string {
  const masked = maskComments(source);
  const open = masked.indexOf(`<${element}`);
  if (open < 0) return '';
  const close = masked.indexOf('/>', open);
  return close < 0 ? '' : masked.slice(open, close + 2);
}

/**
 * GUARD R1 — the reader is a REGISTERED ROUTE with a typed param list.
 *
 * A tool nobody can reach is not a feature: App.tsx must import the screen and
 * mount it on a named `Stack.Screen`, and `RootStackParamList` must carry the same
 * name with the parameters the editor passes. It is deliberately a route (not a
 * modal): React Navigation pops routes itself, so the Android BACK key needs no
 * handler and the modal-overlay contract gains nothing to break
 * (services/backExitContract.ts — routes are its first class).
 */
export function readerRouteIsRegistered(input: {
  app: string;
  types: string;
}): boolean {
  const app = maskComments(input?.app ?? '');
  const types = maskComments(input?.types ?? '');
  if (app.length < 5000 || types.length < 3000) return false;
  if (app.indexOf(`from './src/screens/${READER_COMPONENT_NAME}'`) < 0) return false;
  if (app.indexOf(`component={${READER_COMPONENT_NAME}}`) < 0) return false;
  if (app.indexOf(`name="${READER_ROUTE_NAME}"`) < 0) return false;
  if (app.indexOf(`title: '${READER_WINDOW_TITLE}'`) < 0) return false;
  if (types.indexOf(`${READER_ROUTE_NAME}: {`) < 0) return false;
  for (const param of ['abc', 'title', 'keyLabel', 'offset', 'isSample']) {
    if (!new RegExp(`\\b${param}\\s*:`).test(types.slice(types.indexOf(`${READER_ROUTE_NAME}: {`)))) {
      return false;
    }
  }
  return true;
}

/**
 * GUARD R2 — the editor has a door to the reader and hands it the CURRENT score.
 *
 * The label is asserted through the exported constant, so the words on the button
 * cannot drift from the words the guard checks, and the navigation must carry the
 * transposed ABC itself — a reader opened with the ORIGINAL score would be a
 * "full score" of the wrong key, which is precisely the confusion the owner
 * reported about transposed copies.
 */
export function readerEntryPointExists(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 8000) return false;
  if (src.indexOf('READER_OPEN_LABEL') < 0) return false;
  if (src.indexOf(`navigation.navigate('${READER_ROUTE_NAME}'`) < 0) return false;
  const call = src.slice(src.indexOf(`navigation.navigate('${READER_ROUTE_NAME}'`));
  const end = call.indexOf(');');
  const args = end < 0 ? call.slice(0, 600) : call.slice(0, end);
  if (args.indexOf('abc: transposedAbc') < 0) return false;
  if (args.indexOf('keyLabel: keyLabels.to') < 0) return false;
  if (args.indexOf('isSample: isSampleScore(transposedAbc)') < 0) return false;
  return args.indexOf('offset,') >= 0;
}

/**
 * GUARD R3 — the reader shows the WHOLE WORK, every bar.
 *
 * Three facts, each one a way the "entire piece" requirement silently fails:
 *   • the reader mounts `<AbcScoreView … wholeWork />` (without it the viewer is a
 *     non-scrolling box clipped at the app's ceiling — the v37 residual bug);
 *   • the score sits in a scroller, so the reader PAGE can carry a document that
 *     fits (`page` band);
 *   • the viewer itself implements the band: it asks `scoreReaderBand(...)` which
 *     box it is in, sizes that box through `abcReaderContainerHeight(...)`, and
 *     hands the gesture to the WebView (`scrollEnabled={viewerInteractive}`) in the
 *     band where the document does not fit — otherwise the tail of a long piece
 *     stays unreachable, which is the whole defect.
 */
export function readerShowsTheWholeWork(input: {
  screen: string;
  viewer: string;
}): boolean {
  const screen = maskComments(input?.screen ?? '');
  const viewer = maskComments(input?.viewer ?? '');
  if (screen.length < 4000 || viewer.length < 4000) return false;
  const tag = openingTag(screen, 'AbcScoreView');
  if (tag.length === 0) return false;
  if (!/\bwholeWork\b/.test(tag)) return false;
  if (screen.indexOf('<ScrollView') < 0) return false;

  if (viewer.indexOf('wholeWork?: boolean') < 0) return false;
  if (viewer.indexOf('scoreReaderBand(') < 0) return false;
  if (viewer.indexOf('abcReaderContainerHeight(') < 0) return false;
  if (viewer.indexOf('scrollEnabled={viewerInteractive}') < 0) return false;
  if (viewer.indexOf("'self-scroll'") < 0) return false;
  // The v37 behaviour must survive for every OTHER call site: the pinned probe and
  // the pinned clamp call (asserted in full by v37UiContract) are re-checked here
  // only for presence, so a reader rewrite cannot quietly drop them.
  if (viewer.indexOf('abcHeightProbeScript()') < 0) return false;
  return viewer.indexOf('abcScoreContainerHeight({') >= 0;
}

/**
 * GUARD R4 — the reader SAVES through the Library store, named by the SHARED
 * builder.
 *
 * Both halves matter: a reader that wrote its own item would bypass the app's
 * single library path (thumbnails, rename, sync, delete), and a reader with its own
 * title format would fill the Library with two names for one score. The editor is
 * checked in R7 for the same builder.
 */
export function readerSavesThroughTheLibrary(value: {
  screen: string;
  editor: string;
}): boolean {
  const screen = maskComments(value?.screen ?? '');
  const editor = maskComments(value?.editor ?? '');
  if (screen.length < 4000 || editor.length < 8000) return false;
  if (screen.indexOf("from '../services/libraryStore'") < 0) return false;
  if (screen.indexOf('addAbcToLibrary({') < 0) return false;
  if (screen.indexOf('transposedCopyTitle(') < 0) return false;
  return editor.indexOf('transposedCopyTitle(') >= 0;
}

/**
 * GUARD R5 — the reader SHARES through the platform, and says so when it cannot.
 *
 * `expo-sharing` for the `.abc`, React Native's `Share` for the text — the pattern
 * shareCardShare established, because on Android a `file://` URL handed to
 * `Share.share` is silently dropped. The decision is pure (`scoreShare.ts`) and the
 * screen must render the honest failure line, otherwise a refused sheet looks like
 * a dead button.
 */
export function readerSharesThroughThePlatform(value: {
  screen: string;
  device: string;
  pure: string;
}): boolean {
  const screen = maskComments(value?.screen ?? '');
  const device = maskComments(value?.device ?? '');
  const pure = maskComments(value?.pure ?? '');
  if (screen.length < 4000 || device.length < 1500 || pure.length < 2000) return false;
  if (screen.indexOf("from '../services/scoreShareDevice'") < 0) return false;
  if (screen.indexOf('shareTransposedScore(') < 0) return false;
  if (screen.indexOf('SCORE_SHARE_FAILED_HINT') < 0) return false;
  if (device.indexOf('Sharing.shareAsync(') < 0) return false;
  if (device.indexOf('Share.share(') < 0) return false;
  if (device.indexOf('buildScoreSharePayload(') < 0) return false;
  if (pure.indexOf('buildScoreSharePayload') < 0) return false;
  return pure.indexOf("mode: 'file'") >= 0 && pure.indexOf("mode: 'text'") >= 0;
}

/**
 * GUARD R6 — the reader and the editor both SAY when a score is a sample.
 *
 * The owner opened a transposed copy and saw four bars. That is the data: every
 * bundled ABC score is a 3-4 bar excerpt. The label is derived from the score's own
 * bar count at both surfaces (never from an edited title, which services/pieceAbc
 * uses as a key), so neither surface can present an excerpt as a whole work.
 *
 * UX round 1 step 1 (owner 10-18 item 5) moved the RENDERING into ONE shared
 * component (`src/components/SampleBadge`), so the guard now asks for the surface
 * that carries the score — a badge with no `abc` prop could not derive its words.
 * The derivation itself (and the "never pass a label in" rule) is guarded where
 * the words are built: `src/services/sampleBadge.ts` +
 * `scripts/sampleBadge.test.ts`, which reads the component's real source.
 */
export function readerLabelsASample(value: { screen: string; editor: string }): boolean {
  const screen = maskComments(value?.screen ?? '');
  const editor = maskComments(value?.editor ?? '');
  if (screen.length < 4000 || editor.length < 8000) return false;
  if (screen.indexOf('<SampleBadge') < 0) return false;
  if (screen.indexOf('isSample') < 0) return false;
  return editor.indexOf('<SampleBadge') >= 0;
}

/**
 * GUARD R7 — no SECOND title builder: the copy's name is built once, in the pure
 * module, and both surfaces call it.
 *
 * The inline template the editor used (`` `${title} (${key} · ${offset})` ``) may
 * not reappear in a surface: a hand-rolled format is how the two windows would
 * drift. The check is deliberately narrow — it looks for a template literal that
 * carries both the round bracket and the middle dot next to a backtick — so it
 * cannot be tripped by prose.
 */
export function readerHasOneTitleBuilder(value: { editor: string; screen: string }): boolean {
  const inlineTemplate = /`[^`\n]*\$\{[^}`\n]*\}\s*\([^`\n]*·[^`\n]*\)[^`\n]*`/;
  for (const source of [value?.editor ?? '', value?.screen ?? '']) {
    const masked = maskComments(source);
    if (masked.length < 4000) return false;
    if (inlineTemplate.test(masked)) return false;
  }
  return true;
}

/** Every new module and suite must be in BOTH explicit gate lists. */
export function readerTier1ListsTheFeature(
  tsconfigSource: string,
  packageSource: string,
): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  if (tsconfigSource.length < 2000 || packageSource.length < 500) return false;
  for (const module of READER_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${module}"`) < 0) return false;
  }
  for (const suite of READER_TIER1_SUITES) {
    const compiled = suite.replace(/\.ts$/, '.js');
    if (packageSource.indexOf(`/tmp/tier1-test/${compiled}`) < 0) return false;
  }
  return true;
}

/**
 * GUARD R8 — THE BAND RULE ITSELF (pure, on the module the viewer calls).
 *
 * `scoreReaderBand` decides whether a document is laid out inline (`page`) or given
 * a screen-height box that scrolls itself (`self-scroll`), and `abcReaderContainerHeight`
 * turns that decision into the box. The ceiling is INCLUSIVE on the page side, so a
 * document at exactly the ceiling is never clamped into the other band's territory,
 * and a 9000px work — the size the v37 clip was measured on — is handed a viewport
 * box rather than a 4000px one. These are asserted positively here AND with a
 * mutation in the suite, so a changed boundary fails visibly.
 */
export function readerBandHandsOffInsteadOfClipping(value: {
  band: (measured: unknown) => string;
  height: (input: { measuredHeight: unknown; viewportHeight: unknown }) => number;
  ceiling: number;
  floor: number;
}): boolean {
  if (
    typeof value?.band !== 'function' ||
    typeof value?.height !== 'function' ||
    !Number.isFinite(value.ceiling) ||
    value.ceiling <= 0
  ) {
    return false;
  }
  if (value.band(value.ceiling) !== 'page') return false;
  if (value.band(value.ceiling + 1) !== 'self-scroll') return false;
  if (value.band(9000) !== 'self-scroll') return false;
  if (value.band(null) !== 'page' || value.band(Number.NaN) !== 'page') return false;
  // A whole work gets the VIEWPORT, never the clamped 4000px clip.
  if (value.height({ measuredHeight: 9000, viewportHeight: 800 }) !== 800) return false;
  // A document that fits gets its OWN height, clamped into the reader's band.
  if (value.height({ measuredHeight: 1800, viewportHeight: 800 }) !== 1800) return false;
  if (value.height({ measuredHeight: 10, viewportHeight: 800 }) !== value.floor) return false;
  if (value.height({ measuredHeight: null, viewportHeight: 700 }) !== 700) return false;
  return true;
}

/** The reader's user-facing sources, for the copy / network / paywall sweeps. */
export function readerUserFacingSources(input: {
  screen: string;
  pure: string;
  share: string;
  device: string;
}): string[] {
  return [input?.screen ?? '', input?.pure ?? '', input?.share ?? '', input?.device ?? ''];
}

/** How many of the reader's sources are non-empty (a floor for the sweeps). */
export function readerSourceCount(sources: readonly string[]): number {
  if (!Array.isArray(sources)) return 0;
  return sources.filter((source) => typeof source === 'string' && source.length > 200).length;
}

/** True when the reader is a ROUTE — it owns no modal element of its own (the route class). */
export function readerIsARouteNotAModal(screenSource: string): boolean {
  const src = maskComments(screenSource ?? '');
  if (src.length < 4000) return false;
  return src.indexOf('<Modal') < 0;
}

/** Count of the reader's own exported copy constants (a floor against a gutted screen). */
export function readerCopyConstantCount(screenSource: string): number {
  const src = maskComments(screenSource ?? '');
  let count = 0;
  for (const constant of [
    'READER_HEADLINE',
    'READER_WHOLE_WORK_NOTE',
    'READER_FREE_NOTE',
    'READER_SAVE_CTA',
    'READER_SHARE_CTA',
  ]) {
    if (countOf(src, `export const ${constant}`) === 1) count += 1;
  }
  return count;
}
