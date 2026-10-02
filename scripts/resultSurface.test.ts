/**
 * resultSurface.test.ts — the gate for the ONE result surface (bundle A, owner
 * 10-02).
 *
 * Bundle A folds three result cards (the recognition card, the hum screen's own
 * `stage === 'result'` card, the modern interstitial's match view) onto ONE
 * surface and renders the hosted score INLINE in it. Every one of those is a
 * WIRING fact that no logic test can see and no emulator on this box can run:
 * a screen that grew its own card back, a score block that was deleted, a
 * WebView tag that lost its runtime flags, a modern (copyrighted) branch that
 * grew notation, a sheet URL the surface invented for itself.
 *
 * So the predicates live in src/services/resultSurfaceContract.ts (pure text, in
 * the house style) and this suite:
 *   • pins each one against a synthetic PRE-fix and POST-fix source, so the
 *     predicate is proven to discriminate before it is trusted on the app;
 *   • runs them on the REAL files off disk (RecognitionResultView, HumSearchScreen,
 *     ModernSearchScreen, HomeScreen) and asserts the whole contract over the set;
 *   • runs ONE MUTATION PROBE PER PREDICATE — the defect is put back into the real
 *     source and the guard must FAIL (a guard that only ever sees healthy source
 *     proves nothing, the lesson from midiExportContract/historyDeadEndContract);
 *   • cross-checks the two regressions the surface could reintroduce in the
 *     existing gates: the in-app-browser contract (the new inline WebView is
 *     Modal-rooted and carries its flags) and the bundle C money-path contract
 *     (no purchase action may leave the app through the system browser).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  FULL_SCREEN_CHIP_MARKER,
  INLINE_SHEET_STYLE,
  INVENTED_SHEET_CALL,
  MODERN_BRANCH_MARKER,
  RESULT_SURFACE_COMPONENT,
  RETIRED_PER_SCREEN_RESULT_MARKERS,
  SHEET_VIEWER_HTML_CALL,
  findResultSurfaceViolations,
  formatResultSurfaceViolations,
  inlineScoreCarriesFlags,
  inlineScoreFlagViolations,
  inlineSheetMissingFlags,
  modernResultRendersNoNotation,
  resultSheetIsNeverInvented,
  sheetRendersInline,
  singleResultSurfaceWired,
  type SourceFile,
} from '../src/services/resultSurfaceContract';
import {
  findExternalUrlOpens,
  formatExternalUrlOpens,
  noPurchaseActionLeavesTheApp,
} from '../src/services/purchaseCta';
import {
  findBrowserContractViolations,
  findWebViewFlagViolations,
  formatBrowserViolations,
  formatWebViewFlagViolations,
  webViewTags,
} from '../src/services/inAppBrowserContract';

declare const process: { exit(code: number): never; cwd(): string };
declare const require: (moduleName: string) => any;

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
    console.error(`  ✗ FAILED: ${msg} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

// ─── the real files, read off disk ──────────────────────────────

const SURFACE_PATH = 'src/components/RecognitionResultView.tsx';
const SURFACE_CONTRACT_PATH = 'src/services/resultSurfaceContract.ts';
const HUM_PATH = 'src/screens/HumSearchScreen.tsx';
const MODERN_PATH = 'src/screens/ModernSearchScreen.tsx';
const HOME_PATH = 'src/screens/HomeScreen.tsx';
const SURFACE_PATHS: readonly string[] = [SURFACE_PATH, HUM_PATH, MODERN_PATH, HOME_PATH];

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

function predicatesOf(violations: readonly { predicate: string }[]): string[] {
  return violations.map((v) => v.predicate);
}

// ─── 1. one surface, not three ──────────────────────────────────

function singleSurfaceTests(): void {
  console.log('\nsingleResultSurfaceWired — one surface handles a match, not three');

  // Verbatim SHAPE of the retired hum card (the pre-fix source): the hum screen
  // rendered its own result card off its own `stage === 'result'` stage.
  const preFixHum = [
    'export const HumSearchScreen = () => {',
    "  {stage === 'result' && outcome && (",
    '    <View style={styles.matchCard}>',
    '      <Text>{outcome.topMatch.title}</Text>',
    '    </View>',
    '  )}',
    '};',
  ].join('\n');
  assertEq(
    singleResultSurfaceWired(preFixHum),
    false,
    'the retired per-screen result card fails the contract',
  );
  assert(
    RETIRED_PER_SCREEN_RESULT_MARKERS.indexOf("stage === 'result'") >= 0 &&
      RETIRED_PER_SCREEN_RESULT_MARKERS.indexOf('styles.matchCard') >= 0,
    'both retired markers are what the predicate scans for',
  );

  const postFixHum = [
    'export const HumSearchScreen = () => {',
    '  {humResult ? (',
    `    <${RESULT_SURFACE_COMPONENT} visible phase={{ type: 'success', response: humResult }} />`,
    '  ) : null}',
    '};',
  ].join('\n');
  assertEq(singleResultSurfaceWired(postFixHum), true, 'a screen that mounts the ONE surface passes');

  const surfaceFile = 'export const RecognitionResultView: React.FC<Props> = (props) => {};';
  assertEq(singleResultSurfaceWired(surfaceFile), true, 'the surface file passes by BEING the surface');

  const unrelated = 'export const Home = () => <View><Text>hi</Text></View>;';
  assertEq(singleResultSurfaceWired(unrelated), false, 'a file with no result rendering fails');

  // A marker inside a COMMENT is not code: the contract must not fire on prose
  // that merely NAMES the retired card (this file's own docs do exactly that).
  const commented = [
    '// the hum screen used to render `stage === \'result\'` itself',
    `export const HumSearchScreen = () => <${RESULT_SURFACE_COMPONENT} visible />;`,
  ].join('\n');
  assertEq(singleResultSurfaceWired(commented), true, 'a commented-out marker does not fail the contract');
}

// ─── 2. the inline score + the reader chip ──────────────────────

function inlineSheetTests(): void {
  console.log('\nsheetRendersInline — the score is IN the card, and the reader is one chip away');

  const complete = [
    '{sheetDecision === \'inline\' ? (',
    '  <View style={styles.sheetBlock}>',
    `    <WebView source={{ html: ${SHEET_VIEWER_HTML_CALL}inlineSheetUrl) }}`,
    '      style={styles.inlineSheet} javaScriptEnabled domStorageEnabled />',
    '    <TouchableOpacity onPress={() => setShowScoreViewer(true)}>',
    `      <Text>{${FULL_SCREEN_CHIP_MARKER}}</Text>`,
    '    </TouchableOpacity>',
    '  </View>',
    ') : null}',
    '<ScoreViewer url={viewerSheetUrl} onClose={() => setShowScoreViewer(false)} />',
  ].join('\n');
  assertEq(sheetRendersInline(complete), true, 'the inline block + the reader chip pass together');

  // Either half missing is a real defect: no inline block = no score in the card;
  // no chip = the score cannot be read properly (and ScoreViewer would be dead).
  const noInlineBlock = complete.replace('style={styles.inlineSheet} ', '');
  assert(noInlineBlock !== complete, 'the fixture edit applied');
  assertEq(sheetRendersInline(noInlineBlock), false, 'a surface with no inline sheet block fails');

  const rawUrlNotTheViewerDocument = complete.replace(
    `{{ html: ${SHEET_VIEWER_HTML_CALL}inlineSheetUrl) }}`,
    '{{ uri: inlineSheetUrl }}',
  );
  assert(rawUrlNotTheViewerDocument !== complete, 'the fixture edit applied');
  assertEq(
    sheetRendersInline(rawUrlNotTheViewerDocument),
    false,
    'an inline tag NOT fed the viewer document fails (it is not the app’s reader)',
  );

  const noChip = complete.replace(FULL_SCREEN_CHIP_MARKER, 'COMING SOON');
  assertEq(sheetRendersInline(noChip), false, 'a surface with no full-screen chip fails');

  const chipOpensNothing = complete.replace('setShowScoreViewer(true)', 'noop()');
  assertEq(
    sheetRendersInline(chipOpensNothing),
    false,
    'a chip that does not open the reader fails (a dead control)',
  );

  const noReader = complete.replace('<ScoreViewer', '<ScoreGone');
  assertEq(sheetRendersInline(noReader), false, 'a surface with no ScoreViewer fails');
}

// ─── 3. the inline tag's runtime flags ──────────────────────────

function inlineFlagTests(): void {
  console.log('\ninlineScoreCarriesFlags — the inline document can actually run');

  const flagged =
    `<WebView source={{ html: ${SHEET_VIEWER_HTML_CALL}u) }} javaScriptEnabled domStorageEnabled />`;
  assertEq(inlineScoreCarriesFlags(flagged), true, 'the inline tag carries both runtime flags');
  assertEq(
    inlineSheetMissingFlags(flagged).join(','),
    '',
    'a compliant inline tag reports no missing flag',
  );

  const noStorage = flagged.replace(' domStorageEnabled', '');
  assertEq(
    inlineScoreCarriesFlags(noStorage),
    false,
    'dropping domStorageEnabled fails (Android defaults it to false → a blank score)',
  );
  assertEq(
    inlineSheetMissingFlags(noStorage).join(','),
    'domStorageEnabled',
    'and the missing flag is named, not just counted',
  );

  const noJs = flagged.replace(' javaScriptEnabled', '');
  assertEq(inlineScoreCarriesFlags(noJs), false, 'dropping javaScriptEnabled fails (the viewer needs JS)');

  const switchedOff = flagged.replace('domStorageEnabled', 'domStorageEnabled={false}');
  assertEq(
    inlineScoreCarriesFlags(switchedOff),
    false,
    'an explicitly DISABLED flag fails like a missing one',
  );

  const explicitTrue = flagged.replace('javaScriptEnabled', 'javaScriptEnabled={true}').replace(
    'domStorageEnabled',
    'domStorageEnabled={true}',
  );
  assertEq(inlineScoreCarriesFlags(explicitTrue), true, 'the explicit-{true} spelling passes');

  const noTag = 'const x = 1;';
  assertEq(inlineScoreCarriesFlags(noTag), false, 'a file with no inline score tag fails');
  assert(
    inlineSheetMissingFlags(noTag)[0].indexOf('no inline score WebView tag') >= 0,
    'and says WHY (no inline score tag at all)',
  );
}

// ─── 4. a modern match renders no notation ──────────────────────

function modernNotationTests(): void {
  console.log('\nmodernResultRendersNoNotation — the copyright boundary, frozen');

  const modernOnly = [
    `{${MODERN_BRANCH_MARKER} ? (`,
    '  <View style={styles.modernBlock}>',
    '    <Text>{MODERN_COPYRIGHT_NOTE}</Text>',
    '    <TouchableOpacity onPress={() => setPurchaseWebUrl(purchaseUrl)}>',
    '      <Text>🛒 Get the Official Sheet Music</Text>',
    '    </TouchableOpacity>',
    '  </View>',
    ') : null}',
  ].join('\n');
  assertEq(modernResultRendersNoNotation(modernOnly), true, 'identity + the retailer offer, no notation');

  const withScore = modernOnly.replace(
    '<Text>{MODERN_COPYRIGHT_NOTE}</Text>',
    `<Text>{MODERN_COPYRIGHT_NOTE}</Text>\n    <WebView source={{ html: ${SHEET_VIEWER_HTML_CALL}u) }} />`,
  );
  assertEq(
    modernResultRendersNoNotation(withScore),
    false,
    'a SCORE rendered on a modern match fails the copyright boundary',
  );

  const withAbc = modernOnly.replace('<Text>{MODERN_COPYRIGHT_NOTE}</Text>', '<AbcScoreView abc={abc} />');
  assertEq(modernResultRendersNoNotation(withAbc), false, 'ABC notation on a modern match fails');

  const withChords = modernOnly.replace('<Text>{MODERN_COPYRIGHT_NOTE}</Text>', '<Text>{chords}</Text>');
  assertEq(modernResultRendersNoNotation(withChords), false, 'chord rendering on a modern match fails');

  const noModernBranch = 'const x = <View><Text>hi</Text></View>;';
  assertEq(modernResultRendersNoNotation(noModernBranch), false, 'a file with no modern branch fails');

  // A modern branch is only known by its marker: prose that names it, and a
  // LIBRARY branch, must not be mistaken for the copyrighted branch.
  const libraryBranchOnly = [
    "{kind === 'library' ? <WebView source={{ html: 1 }} /> : null}",
  ].join('\n');
  assertEq(modernResultRendersNoNotation(libraryBranchOnly), false, 'no modern branch = no verdict');
}

// ─── 5. the sheet URL is never invented ─────────────────────────

function inventedSheetTests(): void {
  console.log('\nresultSheetIsNeverInvented — the URL comes from the backend, always');

  const fromMatch = 'const url = hostedSheetUrl({ hostedSheetUrl: topMatch.sheet_music_url });';
  assertEq(resultSheetIsNeverInvented(fromMatch), true, 'a URL read from the match passes');

  const fromCatalog = 'const url = hostedSheetUrl({ hostedSheetUrl: info.sheetMusicUrl });';
  assertEq(resultSheetIsNeverInvented(fromCatalog), true, 'a URL read from the catalog passes');

  const fromCaller = 'const url = hostedSheetUrl({ hostedSheetUrl: props.hostedSheetUrl });';
  assertEq(resultSheetIsNeverInvented(fromCaller), true, 'a URL the caller resolved passes');

  const invented = "const url = sheetUrlForPieceId(topMatch.piece_id ?? '');";
  assertEq(
    resultSheetIsNeverInvented(invented),
    false,
    'a surface that BUILDS the URL fails — that helper is the gated-ingest key builder',
  );
  assertEq(INVENTED_SHEET_CALL, 'sheetUrlForPieceId(', 'and the predicate scans for that exact call');

  const noSource = 'const url = mystery();';
  assertEq(resultSheetIsNeverInvented(noSource), false, 'a file with no known URL source fails');
}

// ─── 6. the real files, and the whole contract over them ────────

function realSourceTests(): SourceFile[] {
  console.log('\nthe REAL result surface and its three hosts');

  const files: SourceFile[] = SURFACE_PATHS.map((path) => ({
    path,
    source: readAppFile(path),
  }));

  assert(files[0].source.length > 5000, `read ${SURFACE_PATH} (${files[0].source.length} chars)`);
  for (const file of files.slice(1)) {
    assert(file.source.length > 3000, `read ${file.path} (${file.source.length} chars)`);
  }

  for (const file of files) {
    assertEq(
      singleResultSurfaceWired(file.source),
      true,
      `${file.path} handles a match through the ONE surface (no card of its own)`,
    );
  }

  const surface = files[0].source;
  assertEq(sheetRendersInline(surface), true, 'the real surface renders the score inline + the reader chip');
  assertEq(inlineScoreCarriesFlags(surface), true, 'the real inline tag carries both runtime flags');
  assertEq(
    inlineSheetMissingFlags(surface).join(','),
    '',
    'the real inline tag reports no missing flag',
  );
  assertEq(
    modernResultRendersNoNotation(surface),
    true,
    'the real modern branch renders no notation at all',
  );
  assertEq(resultSheetIsNeverInvented(surface), true, 'the real surface never builds a sheet URL');

  // The whole contract over the file set: the surface is checked for the score
  // half, every file for "one surface, not three".
  const violations = findResultSurfaceViolations(files, SURFACE_PATH);
  assertEq(
    formatResultSurfaceViolations(violations).join('\n'),
    '',
    `the whole result-surface contract holds over ${files.length} real files`,
  );

  // Only the surface is checked for the score half — a HOST is not the surface.
  const hostOnly = findResultSurfaceViolations([files[1]], SURFACE_PATH);
  assertEq(hostOnly.length, 0, 'a host file is judged by the one-surface rule only');
  const wrongPath = findResultSurfaceViolations([files[1]], HUM_PATH);
  assertEq(
    predicatesOf(wrongPath).indexOf('sheetRendersInline') >= 0,
    true,
    'naming a host as the surface exposes the missing inline sheet (the check is path-scoped)',
  );

  // ── the two existing gates this change must not break ──
  //
  // 1. the in-app-browser contract (RC v26/v28): the NEW inline WebView is
  //    Modal-rooted (this file's returned tree is) and carries its flags, so the
  //    tree-wide scan stays at zero. This is the regression guard for A.3.
  const browser = findBrowserContractViolations(files);
  assertEq(
    formatBrowserViolations(browser).join('\n'),
    '',
    'every WebView-bearing return block in the result surface is a BACK-closable Modal',
  );
  const flagViolations = findWebViewFlagViolations(files);
  assertEq(
    formatWebViewFlagViolations(flagViolations).join('\n'),
    '',
    'no WebView in the surface or its hosts is missing javaScriptEnabled/domStorageEnabled',
  );
  assertEq(
    inlineScoreFlagViolations(surface, SURFACE_PATH).length,
    0,
    'and the surface’s own inline-score flag report is empty',
  );

  // 2. the CONTRACT MODULE must not report itself. Its messages name the tags it
  //    scans for, and the tree-wide in-app-browser scan cannot tell a message
  //    STRING that reads `<WebView>` from a rendered tag — a raw tag literal in a
  //    violation message failed the whole gate on this branch's first full run
  //    (the same self-report trap modalBackContract.ts documents for `<Modal`).
  const contractSource = readAppFile(SURFACE_CONTRACT_PATH);
  assert(contractSource.length > 1000, `read ${SURFACE_CONTRACT_PATH} (${contractSource.length} chars)`);
  assertEq(
    webViewTags(contractSource).length,
    0,
    `${SURFACE_CONTRACT_PATH} carries no tag literal the tree-wide scan would read as a rendered WebView`,
  );
  assertEq(
    findWebViewFlagViolations([{ path: SURFACE_CONTRACT_PATH, source: contractSource }]).length,
    0,
    'and the tree-wide flag scan is clean on the contract module itself',
  );

  return files;
}

// ─── 7. MUTATION PROBES: one per predicate, on the real sources ─

function mutationProbes(files: SourceFile[]): void {
  console.log('\nMUTATION probes: put each defect back into the REAL source');

  const surfaceSource = files[0].source;
  const humSource = files[1].source;

  // ── P1: the hum screen grows its own result card back ──
  const humWithOwnCard = humSource.replace(
    "{stage === 'no-match' && outcome && (",
    "{stage === 'result' && humResult && (",
  );
  assert(humWithOwnCard !== humSource, 'the own-card mutation changed the real hum source');
  assertEq(
    singleResultSurfaceWired(humWithOwnCard),
    false,
    'MUTATION: `stage === \'result\'` back in HumSearchScreen FAILS the one-surface contract',
  );
  const ownCardViolations = findResultSurfaceViolations(
    [{ path: HUM_PATH, source: humWithOwnCard }, ...files.slice(1)],
    SURFACE_PATH,
  );
  assert(
    predicatesOf(ownCardViolations).indexOf('singleResultSurfaceWired') >= 0,
    `MUTATION: it is reported as a singleResultSurfaceWired violation (${ownCardViolations.length} found)`,
  );

  // ── P2: the inline score block is deleted ──
  const noInlineBlock = surfaceSource.replace(
    /\{sheetDecision === 'inline'[\s\S]*?\) : sheetDecision === 'open-full'/,
    "{sheetDecision === 'open-full'",
  );
  assert(noInlineBlock !== surfaceSource, 'the block-deletion mutation changed the real surface');
  assertEq(
    sheetRendersInline(noInlineBlock),
    false,
    'MUTATION: deleting the inline score block FAILS sheetRendersInline',
  );
  assert(
    inlineSheetMissingFlags(noInlineBlock)[0].indexOf('no inline score WebView tag') >= 0,
    'and the flag report says there is no inline score tag left',
  );
  const deletedViolations = findResultSurfaceViolations(
    [{ path: SURFACE_PATH, source: noInlineBlock }, ...files.slice(1)],
    SURFACE_PATH,
  );
  assert(
    predicatesOf(deletedViolations).indexOf('sheetRendersInline') >= 0,
    'MUTATION: the deletion is reported as a sheetRendersInline violation',
  );

  // ── P3: the inline tag loses domStorageEnabled ──
  const noStorage = surfaceSource.replace(/\n\s*domStorageEnabled\b/, '');
  assert(noStorage !== surfaceSource, 'the flag mutation changed the real surface');
  assertEq(
    inlineScoreCarriesFlags(noStorage),
    false,
    'MUTATION: dropping domStorageEnabled from the real inline tag FAILS the flag guard',
  );
  assert(
    inlineSheetMissingFlags(noStorage).indexOf('domStorageEnabled') >= 0,
    'and the missing flag is named in the report',
  );
  const flagReport = inlineScoreFlagViolations(noStorage, SURFACE_PATH);
  assertEq(flagReport.length, 1, 'the surface’s own flag report names the inline tag');
  assert(
    formatWebViewFlagViolations(findWebViewFlagViolations([{ path: SURFACE_PATH, source: noStorage }])).length >
      0,
    'MUTATION: the tree-wide in-app-browser flag scan fails on the same mutation',
  );

  // ── P4: the modern branch grows notation ──
  const modernWithScore = surfaceSource.replace(
    '{MODERN_COPYRIGHT_NOTE}</Text>',
    `{MODERN_COPYRIGHT_NOTE}</Text>\n                <WebView source={{ html: ${SHEET_VIEWER_HTML_CALL}topMatch.sheet_music_url ?? '') }} />`,
  );
  assert(modernWithScore !== surfaceSource, 'the modern-notation mutation changed the real surface');
  assertEq(
    modernResultRendersNoNotation(modernWithScore),
    false,
    'MUTATION: rendering a score on a modern (copyrighted) match FAILS the boundary',
  );
  const modernViolations = findResultSurfaceViolations(
    [{ path: SURFACE_PATH, source: modernWithScore }, ...files.slice(1)],
    SURFACE_PATH,
  );
  assert(
    predicatesOf(modernViolations).indexOf('modernResultRendersNoNotation') >= 0,
    'MUTATION: the notation is reported as a modernResultRendersNoNotation violation',
  );

  // ── P5: the surface invents a sheet URL ──
  const invented = surfaceSource.replace(
    'const inlineSheetUrl = hostedSheetUrl(sheetInput);',
    `const inlineSheetUrl = hostedSheetUrl(sheetInput) ?? ${INVENTED_SHEET_CALL}topMatch.piece_id ?? '');`,
  );
  assert(invented !== surfaceSource, 'the invented-URL mutation changed the real surface');
  assertEq(
    resultSheetIsNeverInvented(invented),
    false,
    'MUTATION: a surface that BUILDS a sheet URL FAILS resultSheetIsNeverInvented',
  );
  const inventedViolations = findResultSurfaceViolations(
    [{ path: SURFACE_PATH, source: invented }, ...files.slice(1)],
    SURFACE_PATH,
  );
  assert(
    predicatesOf(inventedViolations).indexOf('resultSheetIsNeverInvented') >= 0,
    'MUTATION: it is reported as a resultSheetIsNeverInvented violation',
  );

  // ── P6 (bundle C, the money path the surface also answers for): a purchase
  //       action that leaves the app through the system browser. ──
  const leavesTheApp = surfaceSource.replace(
    'if (purchaseUrl) setPurchaseWebUrl(purchaseUrl);',
    'if (purchaseUrl) Linking.openURL(purchaseUrl);',
  );
  assert(leavesTheApp !== surfaceSource, 'the system-browser mutation changed the real surface');
  const offenders = findExternalUrlOpens([{ path: SURFACE_PATH, source: leavesTheApp }]);
  assertEq(offenders.length > 0, true, 'the offender scan sees the re-added Linking.openURL');
  assertEq(
    noPurchaseActionLeavesTheApp([{ path: SURFACE_PATH, source: leavesTheApp }]),
    false,
    'MUTATION: a purchase action re-opened with Linking.openURL FAILS bundle C’s no-dead-end money guard',
  );
  assert(
    formatExternalUrlOpens(offenders)[0].indexOf('in-app shell') >= 0,
    'and the offender report renders with the fix it asks for (a readable failure line)',
  );
  assertEq(
    noPurchaseActionLeavesTheApp([{ path: SURFACE_PATH, source: surfaceSource }]),
    true,
    'the REAL surface still opens its retailer in the in-app shell',
  );

  // ── the surface is where the reader overlay lives, and must stay an overlay ──
  assert(
    surfaceSource.indexOf('<ScoreViewer') >= 0 && surfaceSource.indexOf('setShowScoreViewer(true)') >= 0,
    'the full-screen reader is mounted (as an overlay) in the surface',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== the ONE result surface (bundle A) ===');
  singleSurfaceTests();
  inlineSheetTests();
  inlineFlagTests();
  modernNotationTests();
  inventedSheetTests();
  const files = realSourceTests();
  mutationProbes(files);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
