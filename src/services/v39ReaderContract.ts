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
  'src/services/readerKeyControl.ts',
  'scripts/transposedScoreReader.test.ts',
  'scripts/uxr1-step3-reader.test.ts',
];

export const READER_TIER1_SUITES: readonly string[] = [
  'scripts/transposedScoreReader.test.ts',
  'scripts/uxr1-step3-reader.test.ts',
];

/** The pure module behind the in-place key control (UX round 1 step 3). */
export const READER_KEY_CONTROL_MODULE_PATH = 'src/services/readerKeyControl.ts';
/** This batch's suite (the key control, the unsaved state, the back-out guard). */
export const READER_KEY_CONTROL_SUITE_PATH = 'scripts/uxr1-step3-reader.test.ts';

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

// ═══════════════════════════════════════════════════════════════════════════════
// UX ROUND 1 STEP 3 — the render fix, the in-place key control and the back-out
// guard (owner 10-18 item 1.1/1.2/1.3). The owner's item 1 has three halves, and
// each one has a way of being "in the code" while doing nothing:
//
//   1.1 THE RENDER. The reader could ask for its band (`readerShowsTheWholeWork`
//       above passes) while the MESSAGE the band is computed from was already
//       clamped to the app's box ceiling — so the band could never be
//       `self-scroll` and every bar below 4000px stayed unreachable. That is a
//       chain across two modules (services/scoreHeight.ts → AbcScoreView), so it
//       is guarded as a chain, on the real functions — not by grepping for a
//       constant's name.
//   1.2 THE KEY CONTROL. A chip with no stepper, a stepper with no re-key, a
//       re-key that does not use the pure plan (and so loses every bar), or a
//       change with no unsaved state — each an inert half of the feature.
//   1.3 THE BACK-OUT GUARD. The prompt must be raised by the ROUTE's own
//       `beforeRemove` (never a hardware-BACK handler — the route class), it must
//       ask exactly once, and the leave must be the decided one.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GUARD S1 — THE REPORTED HEIGHT REACHES THE BAND (the v36/v37 residual clip).
 *
 * THE CHAIN, on the real functions: a document reports its height → the parser
 * reads it → the band decides whether the VIEWER must scroll itself → the box is
 * built. A whole work (9000px is the size the clip was measured on) must come out
 * the other side as a `self-scroll` band with the VIEWPORT as its box. If any link
 * pre-clamps the measurement to the app's box ceiling, the work reads as `page`,
 * the viewer stays non-interactive and the score is clipped — silently, with the
 * screen looking correct. The last assertion keeps the v37 rule itself alive: the
 * app ceiling must STILL bite where it belongs, on a BOX (`clamp`), so this can
 * never be "fixed" by deleting the clamp.
 */
export function readerHeightReportReachesTheBand(value: {
  parse: (data: unknown) => number | null;
  band: (measured: unknown) => string;
  height: (input: { measuredHeight: unknown; viewportHeight: unknown }) => number;
  clamp: (measured: unknown) => number | null;
  message: (height: number) => string;
  appCeiling: number;
  readerCeiling: number;
}): boolean {
  if (
    typeof value?.parse !== 'function' ||
    typeof value?.band !== 'function' ||
    typeof value?.height !== 'function' ||
    typeof value?.clamp !== 'function' ||
    typeof value?.message !== 'function'
  ) {
    return false;
  }
  if (!Number.isFinite(value.appCeiling) || !Number.isFinite(value.readerCeiling)) return false;
  if (value.appCeiling <= 0 || value.readerCeiling < value.appCeiling) return false;

  // THE SIZE THE CLIP WAS MEASURED ON — a real work, taller than the app ceiling.
  const wholeWork = value.appCeiling * 2 + 1000;
  const reported = value.parse(value.message(wholeWork));
  if (reported !== wholeWork) return false;

  // THE BAND HANDS OFF INSTEAD OF CLIPPING, and the box is the viewport.
  if (value.band(reported) !== 'self-scroll') return false;
  if (value.height({ measuredHeight: reported, viewportHeight: 620 }) !== 620) return false;

  // A DOCUMENT THAT FITS IS UNCHANGED: still laid out inline at its own height.
  if (value.band(1800) !== 'page') return false;
  if (value.height({ measuredHeight: 1800, viewportHeight: 620 }) !== 1800) return false;

  // THE APP CEILING STILL CLAMPS A BOX, and a junk report is still refused.
  if (value.clamp(wholeWork) !== value.appCeiling) return false;
  if (value.parse(value.message(0)) !== null) return false;
  return value.parse('not a height report') === null;
}

/**
 * GUARD S2 — THE KEY CONTROL RE-KEYS IN PLACE (owner item 1.2).
 *
 * Both steppers, the chip, the PURE plan (so the re-key is an absolute derivation
 * from the reader's own ABC and cannot drop bars), the one pulse per change, and
 * the chip's words derived from the score's key rather than hard-coded.
 */
export function readerKeyControlIsWired(screenSource: string): boolean {
  const src = maskComments(screenSource ?? '');
  if (src.length < 4000) return false;
  const chip = src.indexOf('<Animated.View');
  if (chip < 0) return false;
  // The chip pulses: a scale animation on the chip itself, not a decorative spinner.
  const chipBlock = src.slice(chip, chip + 700);
  if (chipBlock.indexOf('transform: [{ scale:') < 0) return false;
  if (src.indexOf('readerKeyChipLabel(') < 0) return false;
  if (src.indexOf('READER_KEY_CHIP_LABEL') < 0) return false;
  // Both steppers, in both directions, through the pure plan.
  if (src.indexOf('readerKeyPlan(') < 0) return false;
  if (src.indexOf('applyKeyStep(-1)') < 0) return false;
  if (src.indexOf('applyKeyStep(1)') < 0) return false;
  if (src.indexOf('READER_KEY_DECREASE_LABEL') < 0) return false;
  if (src.indexOf('READER_KEY_INCREASE_LABEL') < 0) return false;
  // … and each stepper is really MOUNTED on the control that carries its label
  // (a label on a dead Pressable is the same as no stepper at all).
  if (src.indexOf('onPress={handleKeyDown}') < 0) return false;
  if (src.indexOf('onPress={handleKeyUp}') < 0) return false;
  // The re-key writes the score, the key AND the offset together — a step that
  // moved the key without moving the score is the "wrong score in the chip" class.
  if (src.indexOf('setAbc(plan.abc)') < 0) return false;
  if (src.indexOf('setKeyLabel(plan.keyLabel)') < 0) return false;
  if (src.indexOf('setOffset(plan.offset)') < 0) return false;
  if (src.indexOf('if (!plan.changed) return;') < 0) return false;
  if (src.indexOf('pulseKeyChip()') < 0) return false;
  // A spent stepper is disabled AND explained: no dead area on a control.
  if (src.indexOf('disabled={keyPlan.atFloor}') < 0) return false;
  if (src.indexOf('disabled={keyPlan.atCeiling}') < 0) return false;
  return src.indexOf('READER_KEY_LIMIT_LINE') >= 0;
}

/**
 * GUARD S3 — THE UNSAVED STATE IS VISIBLE AND THE SAVE PERSISTS THE CHOSEN KEY
 * (owner item 1.2, second half).
 *
 * Three facts: the owner's one-line warning is RENDERED (in the footer, which is
 * outside the scroller — the action that loses work must never hide), the save
 * writes what the user is LOOKING AT through the pure plan (`readerSavePlan`), and
 * the save records the offset it wrote, which is what quiets the back-out guard
 * after a save and lets it speak again after the next change.
 */
export function readerUnsavedStateIsVisible(screenSource: string): boolean {
  const src = maskComments(screenSource ?? '');
  if (src.length < 4000) return false;
  const scrollerEnd = src.indexOf('</ScrollView>');
  const footer = src.indexOf('style={styles.footer}');
  const unsaved = src.indexOf('{READER_UNSAVED_LINE}');
  if (scrollerEnd < 0 || footer < 0 || unsaved < 0) return false;
  // THE FOOTER COMES AFTER THE SCROLLER (it is a sibling, not content of it) …
  if (footer < scrollerEnd) return false;
  // … and the warning lives inside that footer, beside the control it is about.
  if (unsaved < footer) return false;
  // THE WRITE IS THE PLAN'S ABC AND THE PLAN'S TITLE — the current score, never params.
  if (src.indexOf('readerSavePlan(') < 0) return false;
  if (src.indexOf('addAbcToLibrary({ title: plan.title, abc: plan.abc })') < 0) return false;
  // THE SAVED BASELINE, without which the guard either nags after a save or
  // forgets the next change.
  if (src.indexOf('readerIsDirty({') < 0) return false;
  return src.indexOf('setSavedOffset(plan.offset)') >= 0;
}

/**
 * GUARD S4 — THE BACK-OUT GUARD (owner item 1.3).
 *
 * The prompt is raised by React Navigation's `beforeRemove` (the ROUTE's own
 * event, so the screen stays a route and the back-exit contract keeps being true),
 * the decision is pure (`readerLeaveOutcome`), the leave is the decided one
 * (`allowLeaveRef` + `navigation.goBack()`), the prompt offers both the owner's
 * actions, and the modal-overlay-style surface is NOT an RN Modal ELEMENT — it is
 * an absolute-fill overlay INSIDE this route (asserted separately by
 * `readerIsARouteNotAModal`). The word is spelled out here on purpose: this module
 * is one of the files the app-wide modal-BACK scan reads, and a literal tag name in
 * a comment is exactly the aliasing that scan exists to catch.
 */
export function readerGuardsTheBackOut(screenSource: string): boolean {
  const src = maskComments(screenSource ?? '');
  if (src.length < 4000) return false;
  if (src.indexOf("addListener('beforeRemove'") < 0) return false;
  if (src.indexOf('readerLeaveOutcome({ dirty, promptOpen: keepPromptOpen })') < 0) return false;
  if (src.indexOf('event.preventDefault()') < 0) return false;
  if (src.indexOf('setKeepPromptOpen(outcome === ') < 0) return false;
  if (src.indexOf('allowLeaveRef.current = true') < 0) return false;
  if (src.indexOf('navigation.goBack()') < 0) return false;
  if (src.indexOf('handlePromptSave') < 0 || src.indexOf('handlePromptLeave') < 0) return false;
  if (src.indexOf('READER_KEEP_PROMPT_TITLE') < 0) return false;
  if (src.indexOf('READER_KEEP_PROMPT_SAVE') < 0) return false;
  return src.indexOf('READER_KEEP_PROMPT_LEAVE') >= 0;
}

/**
 * GUARD S5 — THE STICKY FOOTER IS STILL A SIBLING OF THE SCROLLER (owner item 1:
 * "keep the sticky footer… scrolling to bar 40 must not hide the action that loses
 * work"), and it still carries every control and line it shipped with.
 */
export function readerKeepsTheStickyFooter(screenSource: string): boolean {
  const src = maskComments(screenSource ?? '');
  if (src.length < 4000) return false;
  const scrollerEnd = src.indexOf('</ScrollView>');
  const footer = src.indexOf('style={styles.footer}');
  if (scrollerEnd < 0 || footer < 0 || footer < scrollerEnd) return false;
  const footerBlock = src.slice(footer, footer + 2200);
  if (footerBlock.indexOf('<ScrollView') >= 0) return false;
  if (footerBlock.indexOf('onPress={handleSave}') < 0) return false;
  if (footerBlock.indexOf('onPress={handleShare}') < 0) return false;
  if (footerBlock.indexOf('READER_SAVE_CTA') < 0) return false;
  if (footerBlock.indexOf('READER_SHARE_CTA') < 0) return false;
  return footerBlock.indexOf('READER_FREE_NOTE') >= 0;
}

/**
 * GUARD S6 — THE VIEWER RENDERS THE WHOLE ABC IT IS GIVEN (owner item 1.1, the
 * "all bars present" half).
 *
 * The document must carry the score VERBATIM (`JSON.stringify(abc)` — the whole
 * string, escaping intact) and hand that same string to ABCjs; a viewer that
 * rendered a slice, a first line, or a re-built fragment would show a short score
 * that still looked like a score. This guards the renderer, not the caller, so a
 * future call site cannot inherit a truncating document.
 */
export function viewerRendersTheWholeAbc(viewerSource: string): boolean {
  const src = maskComments(viewerSource ?? '');
  if (src.length < 4000) return false;
  if (src.indexOf('const abcJson = JSON.stringify(abc);') < 0) return false;
  if (src.indexOf('var abc = ${abcJson};') < 0) return false;
  if (src.indexOf("renderAbc('paper', abc,") < 0) return false;
  // No truncation of the score anywhere in the viewer (a slice of an ABC string is
  // never a score: it loses bars, and often the `K:` line with them).
  if (/\babc\.(?:slice|substring|substr|split|replace)\s*\(/.test(src)) return false;
  return src.indexOf('abcHeightProbeScript()') >= 0;
}
