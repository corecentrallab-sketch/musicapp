/**
 * modernRetailerInterstitial.test.ts — the modern-song → affiliate money path.
 *
 * Owner-reproduced defect on device (09-22): on a recognized modern song, tapping
 * "🛒 Get the Official Sheet Music" closed the page and dropped the user back on
 * ModernSearchScreen's "Find any song" card. Cause: the branch that rendered the
 * retailer <WebView> returned a plain <View> (not a <Modal>), so the
 * recognized-song Modal unmounted underneath it and the caller became visible —
 * and nothing could take the user back.
 *
 * This suite guards the whole path twice over:
 *
 *   1. behaviour — `interstitialSurface()` is the decision the component's render
 *      chain is built from, so "match + retailerUrl ⇒ the retailer surface" and
 *      "BACK ⇒ back to the interstitial, not out to the caller" are asserted as
 *      logic (no emulator, no react-native, no test renderer: the repo has none,
 *      and the tier1 gate must compile with node_modules absent);
 *   2. structure — `findBrowserContractViolations()` reads the app's own source
 *      and requires every returned tree that renders a <WebView> to be rooted in
 *      a BACK-closable <Modal>, which is the detail the modalBackContract scanner
 *      cannot see (it only looks at <Modal> tags, so a plain <View> slipped past
 *      it — that is why this defect shipped).
 */
import {
  closeRetailer,
  interstitialSurface,
  type InterstitialViewState,
} from '../src/services/modernInterstitialSurface';
import {
  browserSurfaces,
  findBrowserContractViolations,
  formatBrowserViolations,
  jsxRootTag,
  matchDelimiter,
  propSource,
  returnBlocks,
  type BrowserContractViolation,
} from '../src/services/inAppBrowserContract';
import type { SourceFile } from '../src/services/modalBackContract';
import type { ModernMatch } from '../src/types';

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

// ─── Fixtures ───────────────────────────────────────────────────

const SONG: ModernMatch = {
  song: 'Test Song',
  artist: 'Test Artist',
  matchConfidence: 1,
  source: 'audd',
  retailerUrl: 'https://www.sheetmusicdirect.com/en-US/se/ID_No/1/Product.aspx',
};

function viewState(
  over: Partial<InterstitialViewState> = {},
): InterstitialViewState {
  return {
    visible: true,
    loading: false,
    error: null,
    match: null,
    recognized: false,
    retailerUrl: null,
    ...over,
  };
}

// ─── 1. Behaviour: which surface is on screen ────────────────────

function surfaceTests(): void {
  console.log('\nwhich surface the interstitial shows (the render decision)');

  assertEq(
    interstitialSurface(viewState({ visible: false, match: SONG, recognized: true, retailerUrl: 'https://x.test' })),
    'hidden',
    'visible={false} hides the whole component (no stale surface leaks through)',
  );
  assertEq(
    interstitialSurface(viewState({ loading: true, match: SONG, recognized: true })),
    'loading',
    'a recognition in flight shows the spinner, not a stale match',
  );
  assertEq(
    interstitialSurface(viewState({ error: 'Upload failed', match: SONG, recognized: true })),
    'error',
    'an error shows the error card even if a match is still set',
  );

  // THE regression: tapping the buy button must show the retailer surface.
  const bought = viewState({ match: SONG, recognized: true, retailerUrl: SONG.retailerUrl! });
  assertEq(
    interstitialSurface(bought),
    'retailer',
    'a recognized match with a retailer URL shows the retailer page',
  );
  assertEq(
    interstitialSurface(viewState({ match: SONG, recognized: true })),
    'recognized',
    'the same match WITHOUT a retailer URL shows the interstitial (no auto-redirect)',
  );

  // Hardware BACK on the retailer page.
  const afterBack = closeRetailer(bought);
  assertEq(afterBack.retailerUrl, null, 'BACK clears the retailer URL');
  assertEq(
    interstitialSurface(afterBack),
    'recognized',
    'BACK lands on the recognized-song interstitial — not out to the caller card',
  );
  assertEq(
    bought.retailerUrl,
    SONG.retailerUrl,
    'closeRetailer() does not mutate the state it was given',
  );

  assertEq(
    interstitialSurface(viewState({ match: null })),
    'no-match',
    'no identified song falls through to the honest no-match card',
  );
  assertEq(
    interstitialSurface(viewState({ match: SONG, recognized: false, retailerUrl: 'https://x.test' })),
    'no-match',
    'a stray retailer URL with no recognized match can never strand the user on a page',
  );
}

// ─── 2. The source scan (the guard) ──────────────────────────────

/** The exact shape that shipped on v22: the retailer page returned from a View. */
const PREFIXED_SOURCE = [
  'const C = () => {',
  '  if (match && recognized && retailerUrl) {',
  '    return (',
  '      <View style={styles.webviewContainer}>',
  '        <View style={styles.webviewHeader}>',
  '          <TouchableOpacity onPress={() => setRetailerUrl(null)}>',
  '            <Text>← Back to NoteSnap</Text>',
  '          </TouchableOpacity>',
  '        </View>',
  '        <WebView source={{ uri: retailerUrl }} style={styles.webview} />',
  '      </View>',
  '    );',
  '  }',
  '  return null;',
  '};',
].join('\n');

/** The fixed shape: the retailer page in its own BACK-closable Modal. */
const FIXED_SOURCE = PREFIXED_SOURCE.replace(
  '      <View style={styles.webviewContainer}>',
  '      <Modal visible={!!retailerUrl} animationType="slide" onRequestClose={handleRetailerBack}>\n        <View style={styles.webviewContainer}>',
)
  .replace(
  '      </View>\n    );',
  '        </View>\n      </Modal>\n    );',
);

function scanTests(): void {
  console.log('\nthe in-app browser guard (WebView ⇒ Modal)');

  assertEq(matchDelimiter('a (b (c) d) e', 2), 10, 'a nested pair matches its own closer');
  assertEq(matchDelimiter('f(")", 1)', 1), 8, 'a ) inside a string does not close the pair');
  assertEq(matchDelimiter('no opener', 0), -1, 'a non-delimiter has no match');

  // JSX text is unquoted, so prose apostrophes are everywhere. If the scanner
  // mistook one for a string opener it would swallow the rest of the returned
  // tree and report this file clean — the one failure the guard must not have.
  const prose: SourceFile = {
    path: 'src/Prose.tsx',
    source: [
      'const C = () => {',
      '  return (',
      '    <Modal visible onRequestClose={close}>',
      "      <Text>Can't play it? It isn't linked yet.</Text>",
      '      <WebView source={{ uri: url }} />',
      '    </Modal>',
      '  );',
      '};',
    ].join('\n'),
  };
  const proseBlocks = returnBlocks(prose.source);
  assertEq(proseBlocks.length, 1, "an apostrophe in JSX prose does not swallow the returned tree");
  assertEq(
    jsxRootTag(proseBlocks[0].text)?.name,
    'Modal',
    'the whole tree is read, so its root element is still found',
  );
  assertEq(
    findBrowserContractViolations([prose]).length,
    0,
    'a prose apostrophe does not hide a correctly wrapped browser surface',
  );
  const proseUnwrapped = prose.source.replace('    <Modal visible onRequestClose={close}>', '    <View>').replace('    </Modal>', '    </View>');
  assertEq(
    findBrowserContractViolations([{ path: 'src/ProseView.tsx', source: proseUnwrapped }]).length,
    1,
    'the same tree WITHOUT the Modal is still flagged (prose cannot mask a violation)',
  );

  const preFix: SourceFile = { path: 'src/PreFix.tsx', source: PREFIXED_SOURCE };
  const preFixSurfaces = browserSurfaces([preFix]);
  assertEq(preFixSurfaces.length, 1, 'the shipped (buggy) shape is detected as a browser surface');
  assertEq(preFixSurfaces[0].rootTag, 'View', 'its root element is a View, not a Modal');
  const preFixViolations = findBrowserContractViolations([preFix]);
  assertEq(preFixViolations.length, 1, 'the shipped shape is a violation (the guard would have caught it)');
  assertEq(preFixViolations[0].reason, 'not-in-modal', 'the reason names the missing Modal');
  assertEq(preFixViolations[0].line, 3, 'the violation points at the offending return');
  assert(
    formatBrowserViolations(preFixViolations)[0].includes('outside a Modal'),
    'the report explains what breaks in words',
  );

  const fixed: SourceFile = { path: 'src/Fixed.tsx', source: FIXED_SOURCE };
  const fixedSurfaces = browserSurfaces([fixed]);
  assertEq(fixedSurfaces.length, 1, 'the fixed shape is still detected as a browser surface');
  assertEq(fixedSurfaces[0].rootTag, 'Modal', 'its root element is a Modal');
  assertEq(
    findBrowserContractViolations([fixed]).length,
    0,
    'a WebView in a Modal with onRequestClose is clean',
  );

  // A Modal that BACK cannot close is still a violation.
  const noHandler: SourceFile = {
    path: 'src/NoHandler.tsx',
    source: FIXED_SOURCE.replace(' onRequestClose={handleRetailerBack}', ''),
  };
  const noHandlerViolations = findBrowserContractViolations([noHandler]);
  assertEq(noHandlerViolations.length, 1, 'a browser Modal without onRequestClose is a violation');
  assertEq(noHandlerViolations[0].reason, 'no-back-handler', 'the reason names the missing BACK handler');

  // Things that must NOT count as browser surfaces.
  const commented: SourceFile = {
    path: 'src/Commented.tsx',
    source: '// <WebView source={{ uri: x }} />\nconst a = () => {\n  return <View>ok</View>;\n};',
  };
  assertEq(browserSurfaces([commented]).length, 0, 'a WebView inside a comment is not a surface');
  const other: SourceFile = {
    path: 'src/Other.tsx',
    source: 'const B = () => {\n  return (\n    <Modal visible onRequestClose={close}>\n      <Text>no browser here</Text>\n    </Modal>\n  );\n};',
  };
  assertEq(browserSurfaces([other]).length, 0, 'a returned tree with no WebView is not a surface');

  // Prop reading (how the suite reads a Modal's BACK handler).
  const tag = fixedSurfaces[0].rootTagSource ?? '';
  assertEq(propSource(tag, 'onRequestClose'), 'handleRetailerBack', 'propSource reads a braced handler');
  assertEq(propSource(tag, 'animationType'), '"slide"', 'propSource reads a plain attribute');
  assertEq(propSource(tag, 'presentationStyle'), null, 'a missing prop reads as null');

  assertEq(
    returnBlocks('const c = () => {\n  return (\n    <View />\n  );\n};').length,
    1,
    'returnBlocks finds a parenthesized return',
  );
  assertEq(
    returnBlocks('function f() { return <View />; }').length,
    1,
    'returnBlocks finds a bare return',
  );
  assertEq(
    jsxRootTag('(\n  <Modal visible onRequestClose={c}>\n')?.name,
    'Modal',
    'jsxRootTag reads the root element of a returned tree',
  );
}

// ─── 3. The real component ───────────────────────────────────────

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
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

/** Every .ts/.tsx under src/ plus App.tsx — the app's own source. */
function appSources(): SourceFile[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir) as string[]) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
        files.push({
          path: path.relative(root, full),
          source: fs.readFileSync(full, 'utf8') as string,
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  files.push({ path: 'App.tsx', source: readAppFile('App.tsx') });
  return files;
}

const COMPONENT = 'src/components/ModernSongInterstitial.tsx';
const SCREEN = 'src/screens/ModernSearchScreen.tsx';

function componentTests(): void {
  console.log('\nModernSongInterstitial (the real source)');

  const source = readAppFile(COMPONENT);
  const blocks = returnBlocks(source);
  assert(blocks.length >= 5, `the component has ${blocks.length} returned surfaces (≥ 5)`);

  const roots = blocks.map((b) => (jsxRootTag(b.text)?.name ?? null));
  assert(
    roots.filter((r) => r !== null).every((r) => r === 'Modal'),
    `every returned surface is a Modal — roots: ${roots.map((r) => r ?? 'null').join(', ')}`,
  );
  assert(
    !roots.includes('View') && !roots.includes('ScrollView'),
    'no branch returns a bare View/ScrollView (the shipped defect shape)',
  );

  // The one in-app browser surface, and its Modal wrapper.
  const surfaces = browserSurfaces([{ path: COMPONENT, source }]);
  assertEq(surfaces.length, 1, 'the retailer page is the component\'s only browser surface');
  const retailer = surfaces[0];
  assertEq(retailer.rootTag, 'Modal', 'the retailer WebView is rooted in a Modal');
  const tag = retailer.rootTagSource ?? '';
  const backHandler = propSource(tag, 'onRequestClose');
  assert(
    backHandler !== null,
    'the retailer Modal sets onRequestClose (hardware BACK is handled — house contract)',
  );
  assert(
    backHandler !== 'onClose' && backHandler !== 'onRetry',
    'BACK on the retailer page is NOT the interstitial close/retry handler',
  );
  assertEq(
    (propSource(tag, 'transparent') ?? '').trim(),
    'false',
    'the retailer Modal is opaque (it fully covers the app behind it)',
  );
  assert(
    ['"slide"', '"fade"'].includes(propSource(tag, 'animationType') ?? ''),
    'the retailer Modal animates in (slide or fade)',
  );
  assertEq(
    (propSource(tag, 'presentationStyle') ?? '').replace(/"/g, ''),
    'fullScreen',
    'the retailer Modal is full screen',
  );
  assert(
    propSource(tag, 'visible') !== null,
    'the retailer Modal is bound to the retailer URL state',
  );

  // BACK and the visible back button must be the SAME transition.
  const retailerBlock = blocks.find((b) => b.text.includes('<WebView'));
  assert(!!retailerBlock, 'the retailer branch renders the WebView');
  const blockText = retailerBlock?.text ?? '';
  assert(
    blockText.includes('← Back to NoteSnap'),
    'the in-app shell keeps its "← Back to NoteSnap" affordance',
  );
  assert(
    /onPress=\{handleRetailerBack\}|onPress=\{\(\)\s*=>\s*setRetailerUrl\(null\)\}/.test(blockText),
    'the back button clears the retailer URL (returns to the interstitial)',
  );
  assert(
    backHandler === 'handleRetailerBack' || /setRetailerUrl\(null\)/.test(backHandler ?? ''),
    'hardware BACK clears the retailer URL through the declared handler',
  );
  const handlerDef = /const\s+handleRetailerBack\s*=[\s\S]{0,300}?;/.exec(source);
  if (handlerDef) {
    assert(
      /setRetailerUrl\(/.test(handlerDef[0]),
      'handleRetailerBack sets the retailer URL state',
    );
    assert(
      /closeRetailer\(/.test(handlerDef[0]),
      'handleRetailerBack uses the tested closeRetailer() semantics (one BACK rule)',
    );
  } else {
    assert(
      /setRetailerUrl\(null\)/.test(blockText),
      'the back affordance clears the retailer URL inline',
    );
  }
  assert(
    blockText.includes('onPress={handleRetailerBack}') &&
      backHandler === 'handleRetailerBack',
    'the back button and hardware BACK share ONE handler (they cannot drift apart)',
  );
  assert(
    /<WebView[\s\S]{0,120}retailerUrl/.test(blockText),
    'the WebView is bound to the retailer URL the backend supplied',
  );

  // The render chain must be driven by the tested decision function.
  assert(
    /interstitialSurface\(\s*state\s*\)/.test(source),
    'the render chain is driven by the tested interstitialSurface(state)',
  );
  assert(
    (source.match(/surface === '/g) ?? []).length >= 4,
    'every surface has its own explicit branch (no silent fallthrough)',
  );

  // The interstitial itself: no auto-redirect, retention levers intact.
  const recognizedBlock = blocks.find((b) =>
    b.text.includes('Get the Official Sheet Music'),
  );
  assert(!!recognizedBlock, 'the recognized-song interstitial renders the buy button');
  const recognizedText = recognizedBlock?.text ?? '';
  assertEq(
    jsxRootTag(recognizedText)?.name,
    'Modal',
    'the recognized-song interstitial is a Modal of its own',
  );
  assert(
    !recognizedText.includes('<WebView'),
    'the interstitial does NOT render the retailer page itself (no auto-redirect)',
  );
  assert(
    /setRetailerUrl\(\s*match\.retailerUrl[!)]/.test(recognizedText),
    'the buy button is the ONLY thing that opens the retailer (explicit tap)',
  );
  assert(
    recognizedText.includes('onHumIt') && recognizedText.includes('onBrowseLibrary'),
    'retention levers intact (hum it / browse the free library)',
  );
  assert(
    /never hosts[\s\S]{0,140}copyrighted sheet music/.test(recognizedText),
    'the "NoteSnap never hosts copyrighted sheet music" note is intact',
  );
  assert(
    /isn't linked yet/.test(recognizedText),
    'a match with no retailer URL still shows an honest card (no dead button)',
  );

  // Loading / error / no-match: still Modals, still closable by BACK.
  const loadingBlock = blocks.find((b) => b.text.includes('Listening for a song'));
  assert(!!loadingBlock, 'the loading branch is present');
  assert(
    jsxRootTag(loadingBlock?.text ?? '')?.name === 'Modal' &&
      /onRequestClose=\{onClose\}/.test(loadingBlock?.text ?? ''),
    'the loading card is a Modal that BACK closes via onClose',
  );
  const errorBlock = blocks.find((b) => b.text.includes('Something went wrong'));
  assert(!!errorBlock, 'the error branch is present');
  assert(
    jsxRootTag(errorBlock?.text ?? '')?.name === 'Modal' &&
      /onRequestClose=\{onClose\}/.test(errorBlock?.text ?? ''),
    'the error card is a Modal that BACK closes via onClose',
  );
  const noMatchBlock = blocks.find((b) => b.text.includes('No modern song found'));
  assert(!!noMatchBlock, 'the no-match branch is present');
  assert(
    jsxRootTag(noMatchBlock?.text ?? '')?.name === 'Modal' &&
      /onRequestClose=\{onClose\}/.test(noMatchBlock?.text ?? ''),
    'the no-match card is a Modal that BACK closes via onClose',
  );
}

// ─── 4. The caller keeps the interstitial's own flows working ────

function callerTests(): void {
  console.log('\nModernSearchScreen passes the interstitial every callback');

  const source = readAppFile(SCREEN);
  const start = source.indexOf('<ModernSongInterstitial');
  const end = source.indexOf('/>', start);
  assert(start >= 0 && end > start, 'the screen renders <ModernSongInterstitial … />');
  const props = start >= 0 && end > start ? source.slice(start, end) : '';
  for (const prop of ['onClose', 'onRetry', 'onHumIt', 'onBrowseLibrary', 'visible']) {
    assert(new RegExp(`\\b${prop}\\s*=`).test(props), `the screen passes ${prop}`);
  }
  assert(
    /onClose=\{[^}]*setShowInterstitial\(false\)/.test(props),
    'onClose actually dismisses the interstitial (no dead close button)',
  );
}

// ─── 5. The whole app ────────────────────────────────────────────

function liveScanTests(): void {
  console.log('\nlive scan of the app source');

  const files = appSources();
  assert(files.length >= 25, `scanned ${files.length} app source files (≥ 25)`);

  const surfaces = browserSurfaces(files);
  assert(
    surfaces.length >= 2,
    `found ${surfaces.length} in-app browser surfaces (≥ 2: the score viewer + the retailer page)`,
  );
  for (const surface of surfaces) {
    assert(
      surface.rootTag === 'Modal',
      `${surface.path}:${surface.line} roots its browser surface in a Modal`,
    );
  }

  const violations: BrowserContractViolation[] = findBrowserContractViolations(files);
  if (violations.length > 0) {
    for (const line of formatBrowserViolations(violations)) console.error(line);
  }
  assertEq(
    violations.length,
    0,
    'every in-app browser surface is a BACK-closable full-screen Modal',
  );
}

// ─── run ─────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== modern-song retailer path (WebView must live in its own Modal) ===');
  surfaceTests();
  scanTests();
  componentTests();
  callerTests();
  liveScanTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
