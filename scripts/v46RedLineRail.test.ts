/**
 * Tests for THE v46 RED-LINE RAIL GUARD — src/services/v46RedLineRail.ts against
 * the REAL sources, plus the geometry arithmetic that names the defect.
 *
 * WHY A NEW SUITE. Every existing gate asked a question this defect passes:
 *   • tier1 compiles PURE services; a layout that squeezes a `flex: 1` child is
 *     invisible to it, and screens are not compiled by it at all;
 *   • v37UiContract asks "is SaveToLibraryButton mounted on the piece page, with
 *     a score URL and a dead-button gate?" — it was, and it still is; where in the
 *     JSX tree it sits is exactly what that guard cannot see;
 *   • the babel pre-flight parses the screen but does not lay it out.
 * So the owner's red bar shipped through a fully green gate.
 *
 * This suite asks the layout question instead: is the save block a child of the
 * two-CTA row? — and it re-derives the defect's width from the code's own padding
 * and the owner's measured pixels, so the arithmetic in the guard module is
 * checked against the screenshot rather than asserted from memory.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  ACTION_ROW_STYLE,
  OBSERVED_RAIL_LEFT_DP,
  OBSERVED_RAIL_RIGHT_DP,
  PIECE_PAGE_FILE,
  RESULT_CARD_FILE,
  SAVE_BLOCK_FILE,
  VIEW_SHEET_BTN_PADDING_DP,
  actionRowHoldsOnlyTheTwoCtas,
  noRowInFileContainsTheSaveBlock,
  railWidthMatchesSqueezedCta,
  saveBlockIsAFullWidthStackedBlock,
  saveBlockIsNotInsideTheActionRow,
  saveBlockStretchesAndWrapsItsHint,
  squeezedCtaWidthDp,
  styleIsRow,
  viewSpan,
} from '../src/services/v46RedLineRail';

let passes = 0;
let failures = 0;

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };

function assert(ok: boolean, label: string): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (!ok) {
    console.log(`     expected ${String(expected)}, got ${String(actual)}`);
  }
  assert(ok, label);
}

// ─── helpers ────────────────────────────────────────────────────

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

// ─── 1. the file map ────────────────────────────────────────────

function fileMapTests(): void {
  console.log('\nthe guard names the real files');
  assertEq(PIECE_PAGE_FILE, 'src/screens/PieceDetailScreen.tsx', 'the piece page is the defect home');
  assertEq(SAVE_BLOCK_FILE, 'src/components/SaveToLibraryButton.tsx', 'the save block is guarded on its component');
  assertEq(RESULT_CARD_FILE, 'src/components/RecognitionResultView.tsx', 'the other mount site is guarded too');
  assertEq(ACTION_ROW_STYLE, 'actions', 'the row keeps its style key');
  assertEq(VIEW_SHEET_BTN_PADDING_DP, 16, 'the CTA padding the arithmetic uses is still 16dp');
}

// ─── 2. the geometry: the arithmetic closes on the owner's pixels ─

function geometryTests(): void {
  console.log('\ngeometry — a collapsed padding-only CTA is the measured band');
  const measured = OBSERVED_RAIL_RIGHT_DP - OBSERVED_RAIL_LEFT_DP; // 31.67dp
  assertEq(Math.round(measured * 100) / 100, 31.67, 'the owner screenshot measures a 31.67dp band');
  assertEq(squeezedCtaWidthDp(VIEW_SHEET_BTN_PADDING_DP), 32, 'the row CTA floor is 16dp padding x 2 = 32dp');
  assert(railWidthMatchesSqueezedCta(16, measured), '32dp predicted vs 31.67dp measured — the collapse accounts for the band');
  // …and the negative controls, so this can never be satisfied by any old band.
  assertEq(railWidthMatchesSqueezedCta(16, 2), false, 'a 2dp hairline is NOT a collapsed CTA');
  assertEq(railWidthMatchesSqueezedCta(16, 380), false, 'a full-width button is NOT a collapsed CTA');
  assertEq(railWidthMatchesSqueezedCta(16, Number.NaN), false, 'a non-number measurement fails');
  assertEq(railWidthMatchesSqueezedCta(2, 4), false, 'a 4dp minimum is too small to be this defect');
  // The band starts at the page's own content padding, not at the screen edge.
  assertEq(OBSERVED_RAIL_LEFT_DP, 20, 'the band starts at the page content padding (20dp)');
}

// ─── 3. floors: a broken read must not pass ────────────────────

function floorTests(): void {
  console.log('\nfloors — an empty or truncated read fails every guard');
  assertEq(saveBlockIsNotInsideTheActionRow(''), false, 'empty page source → fails');
  assertEq(saveBlockIsNotInsideTheActionRow('const x = 1;'), false, 'tiny page source → fails');
  assertEq(actionRowHoldsOnlyTheTwoCtas(''), false, 'empty page source → row guard fails');
  assertEq(saveBlockIsAFullWidthStackedBlock(''), false, 'empty page source → stacking guard fails');
  assertEq(saveBlockStretchesAndWrapsItsHint(''), false, 'empty component source → fails');
  assertEq(noRowInFileContainsTheSaveBlock(''), false, 'empty source → generic row guard fails');
  assertEq(noRowInFileContainsTheSaveBlock('x'.repeat(3000)), false, 'a long source with no save block → fails (the mount is required)');
  assertEq(styleIsRow('', 'actions'), false, 'no source, no row');
  assertEq(viewSpan('', 'actions'), null, 'no source, no span');
  assertEq(styleIsRow('const s = StyleSheet.create({ actions: { flexDirection: "row" } });', 'actions'), false, 'a double-quoted row is not the RN style shape this guard pins');
}

// ─── 4. the real sources pass ──────────────────────────────────

function liveScanTests(): void {
  console.log('\nlive scan — the shipped sources hold the fix');
  const page = readAppFile(PIECE_PAGE_FILE);
  const save = readAppFile(SAVE_BLOCK_FILE);
  const card = readAppFile(RESULT_CARD_FILE);

  assertEq(styleIsRow(page, ACTION_ROW_STYLE), true, 'the two-CTA row is still a row (the design)');
  assertEq(saveBlockIsNotInsideTheActionRow(page), true, 'the save block is NOT a child of the action row');
  assertEq(actionRowHoldsOnlyTheTwoCtas(page), true, 'the row holds the score CTA + the wired Share button and nothing else');
  assertEq(saveBlockIsAFullWidthStackedBlock(page), true, 'the save block is one full-width sibling below the row, still fed the score URL');
  assertEq(saveBlockStretchesAndWrapsItsHint(save), true, 'the save block stretches full width and still renders its hint line');
  assertEq(noRowInFileContainsTheSaveBlock(page), true, 'no row-style container on the piece page holds the save block');
  assertEq(noRowInFileContainsTheSaveBlock(card), true, 'the recognition result card keeps it out of a row (symmetry)');

  // The row's own geometry, read out of the source: 16dp padding on each CTA is
  // what makes a collapse land on exactly the 32dp the screenshot shows.
  const viewSheet = page.slice(page.indexOf('viewSheetBtn: {'), page.indexOf('viewSheetText: {'));
  assert(/padding:\s*16/.test(viewSheet), 'styles.viewSheetBtn still declares the 16dp padding the arithmetic uses');
  assert(/backgroundColor:\s*'#e94560'/.test(viewSheet), 'the collapsed control is the accent-filled CTA (the red in the screenshot)');
  assert(/flex:\s*1/.test(viewSheet), '…and it is a flex: 1 child, which is why it could be squeezed at all');
}

// ─── 5. fixture tests: the shapes and their near-misses ────────

/**
 * Pad a fixture to a real-file length WITHOUT duplicating its JSX: a repeated
 * fixture would mount the save block many times and fail the single-render rule.
 * The pad is a comment, so it is masked to blanks and can never satisfy a guard.
 */
const PAD = (n: number, ch: string): string => '\n/*' + ch.repeat(n) + '*/';

const FIXTURE_PAGE = `
import { SaveToLibraryButton } from '../components/SaveToLibraryButton';
export const Page = () => (
  <ScrollView>
    <View style={styles.hero} />
    <View style={styles.actions}>
      {piece.sheetMusicUrl ? (
        <TouchableOpacity style={styles.viewSheetBtn} onPress={handleViewSheetMusic}>
          <Text>View Sheet Music</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
        <Text>Share</Text>
      </TouchableOpacity>
    </View>
    <SaveToLibraryButton
      pieceId={piece.id}
      title={piece.title}
      composer={piece.composer ?? null}
      scoreUrl={piece.sheetMusicUrl ?? null}
    />
  </ScrollView>
);
const baseStyles = StyleSheet.create({
  hero: { padding: 20 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  viewSheetBtn: { flex: 1, backgroundColor: '#e94560', borderRadius: 14, padding: 16, alignItems: 'center' },
  shareBtn: { flex: 1, backgroundColor: '#16213e', padding: 16, alignItems: 'center' },
});` + PAD(6000, 'p');

const FIXTURE_SAVE = `
export const SaveToLibraryButton = ({ scoreUrl }) => {
  if (!isSaveableScoreUrl(scoreUrl)) return null;
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => void save()}>save</Pressable>
      <Text style={styles.hint}>{SAVE_TO_LIBRARY_HINT}</Text>
    </View>
  );
};
const baseStyles = StyleSheet.create({
  wrap: { marginTop: 12, alignSelf: 'stretch' },
  hint: { color: '#a0a0b8', fontSize: 11 },
});` + PAD(3000, 'q');

function fixtureTests(): void {
  console.log('\nfixtures — the fixed shape passes, its near-misses fail');
  assertEq(saveBlockIsNotInsideTheActionRow(FIXTURE_PAGE), true, 'fixture: save block below the row → passes');
  assertEq(actionRowHoldsOnlyTheTwoCtas(FIXTURE_PAGE), true, 'fixture: two CTAs in the row → passes');
  assertEq(saveBlockIsAFullWidthStackedBlock(FIXTURE_PAGE), true, 'fixture: stacked block with the score URL → passes');
  assertEq(saveBlockStretchesAndWrapsItsHint(FIXTURE_SAVE), true, 'fixture: stretch + hint → passes');

  // The defect shape: the save block back between the two CTAs.
  const brokenPage = FIXTURE_PAGE.replace(
    '      <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>',
    `      <SaveToLibraryButton pieceId={piece.id} title={piece.title}
        composer={piece.composer ?? null} scoreUrl={piece.sheetMusicUrl ?? null} />
      <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>`,
  );
  assertEq(saveBlockIsNotInsideTheActionRow(brokenPage), false, 'the v37 shape (save block inside the row) is rejected');
  assertEq(actionRowHoldsOnlyTheTwoCtas(brokenPage), false, 'the row guard rejects a third child');
  assertEq(noRowInFileContainsTheSaveBlock(brokenPage), false, 'the generic row guard rejects it too');

  // A "fix" that deletes the Share button to make room is not a fix.
  const noShare = FIXTURE_PAGE.replace(
    `      <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
        <Text>Share</Text>
      </TouchableOpacity>`,
    '',
  );
  assertEq(actionRowHoldsOnlyTheTwoCtas(noShare), false, 'losing the Share button fails the row guard');
  assertEq(saveBlockIsNotInsideTheActionRow(noShare), true, '…even though the save block is still outside the row');

  // A dead share button (rendered, not wired) is not a CTA.
  const deadShare = FIXTURE_PAGE.replace('onPress={handleShare}', 'onPress={() => {}}');
  assertEq(actionRowHoldsOnlyTheTwoCtas(deadShare), false, 'an unwired Share button fails the row guard');

  // A CTA row that quietly became a column (so the "squeeze" cannot happen) is a
  // design change, not this fix: the guard pins the shipped two-CTA row.
  const columnRow = FIXTURE_PAGE.replace("actions: { flexDirection: 'row'", "actions: { flexDirection: 'column'");
  assertEq(actionRowHoldsOnlyTheTwoCtas(columnRow), false, 'the row is required to stay a row (the shipped design)');

  // The block must still stretch and still print its hint.
  const noStretch = FIXTURE_SAVE.replace("alignSelf: 'stretch'", "alignSelf: 'center'");
  assertEq(saveBlockStretchesAndWrapsItsHint(noStretch), false, 'a save block that no longer stretches fails');
  const noHint = FIXTURE_SAVE.replace('{SAVE_TO_LIBRARY_HINT}', 'saved');
  assertEq(saveBlockStretchesAndWrapsItsHint(noHint), false, 'a save block without the hint line fails');
  const asRow = FIXTURE_SAVE.replace(
    "wrap: { marginTop: 12, alignSelf: 'stretch' }",
    "wrap: { marginTop: 12, alignSelf: 'stretch', flexDirection: 'row' }",
  );
  assertEq(saveBlockStretchesAndWrapsItsHint(asRow), false, 'a save block that becomes a row fails');
  const noGate = FIXTURE_SAVE.replace('if (!isSaveableScoreUrl(scoreUrl)) return null;', '');
  assertEq(saveBlockStretchesAndWrapsItsHint(noGate), false, 'losing the dead-button gate fails');
}

// ─── 6. mutation probes on the REAL sources ───────────────────

function mutationProbes(): void {
  console.log('\nmutation probes — each guard fails on the real bytes it protects');
  const page = readAppFile(PIECE_PAGE_FILE);
  const save = readAppFile(SAVE_BLOCK_FILE);
  const card = readAppFile(RESULT_CARD_FILE);

  // (1) put the save block back inside the action row — the shipped v37 defect.
  const saveEl = page.slice(page.indexOf('      <SaveToLibraryButton'), page.indexOf('      />', page.indexOf('      <SaveToLibraryButton')) + '      />'.length);
  const rowClose = viewSpan(page, ACTION_ROW_STYLE);
  assert(rowClose !== null, 'the real page still has the action row');
  if (rowClose === null) return;
  const withSaveInRow =
    page.slice(0, rowClose.end - '</View>'.length) + saveEl + '\n' + page.slice(rowClose.end - '</View>'.length);
  assertEq(saveBlockIsNotInsideTheActionRow(withSaveInRow), false, 'PROBE 1: save block back in the row → guard fails');
  assertEq(actionRowHoldsOnlyTheTwoCtas(withSaveInRow), false, 'PROBE 1: row guard fails on the same mutation');
  assertEq(noRowInFileContainsTheSaveBlock(withSaveInRow), false, 'PROBE 1: generic row guard fails on the same mutation');

  // (2) delete the shared CTA from the row.
  const withoutShare = page.replace(/\n        <TouchableOpacity\n          style=\{\[styles\.shareBtn[\s\S]*?<\/TouchableOpacity>/, '');
  assertEq(actionRowHoldsOnlyTheTwoCtas(withoutShare), false, 'PROBE 2: Share button deleted → row guard fails');

  // (3) unwire the score CTA (a rendered control that opens nothing).
  assertEq(
    saveBlockIsAFullWidthStackedBlock(page.replace('onPress={handleViewSheetMusic}', 'onPress={() => {}}')),
    true,
    'PROBE 3 (control): the score CTA is not this guard’s business — the row guard owns the wiring',
  );
  assertEq(
    actionRowHoldsOnlyTheTwoCtas(page.replace('onPress={handleViewSheetMusic}', 'onPress={() => {}}')),
    false,
    'PROBE 3: an unwired score CTA fails the row guard',
  );

  // (4) the save block loses the score URL it must hand over.
  assertEq(
    saveBlockIsAFullWidthStackedBlock(page.replace('scoreUrl={piece.sheetMusicUrl ?? null}', 'scoreUrl={null}')),
    false,
    'PROBE 4: save block no longer handed the score URL → fails',
  );

  // (5) the save component stops stretching.
  assertEq(
    saveBlockStretchesAndWrapsItsHint(save.replace("alignSelf: 'stretch',", '')),
    false,
    'PROBE 5: the real save block without alignSelf stretch → fails',
  );

  // (6) symmetry: wrap the recognition card's save block in a row container.
  const cardSaveAt = card.indexOf('<SaveToLibraryButton');
  assert(cardSaveAt > 0, 'the result card really mounts the save block');
  assertEq(noRowInFileContainsTheSaveBlock(card), true, 'the shipped result card passes');
  const armStart = card.indexOf('            {isLibraryKind(kind) && inlineSheetUrl ? (');
  const armEnd = card.indexOf(') : null}', armStart) + ') : null}'.length;
  assert(armStart > 0 && armEnd > armStart, 'the save-block arm is locatable in the real card');
  const cardAsRow =
    card.slice(0, armStart) +
    '            <View style={styles.sheetSaveRow}>\n' +
    card.slice(armStart, armEnd) +
    '            </View>\n' +
    card.slice(armEnd) +
    "\nconst probeStyles = StyleSheet.create({ sheetSaveRow: { flexDirection: 'row', gap: 12 } });\n";
  assertEq(noRowInFileContainsTheSaveBlock(cardAsRow), false, 'PROBE 6: the card’s block turned into a row holding the save button → fails');

  // (7) comment-masking: prose that mentions the guard cannot satisfy it.
  const commentedOut = page.replace('<View style={styles.actions}>', '{/* <View style={styles.actions}> */}');
  assertEq(actionRowHoldsOnlyTheTwoCtas(commentedOut), false, 'PROBE 7: a commented-out row fails (comments are masked, not read as layout)');

  // …and the untouched real sources still pass, so no probe proved a broken fixture.
  assertEq(saveBlockIsNotInsideTheActionRow(page), true, 'the real piece page still passes after every probe');
  assertEq(actionRowHoldsOnlyTheTwoCtas(page), true, 'the real action row still passes');
  assertEq(saveBlockStretchesAndWrapsItsHint(save), true, 'the real save block still passes');
  assertEq(noRowInFileContainsTheSaveBlock(card), true, 'the real result card still passes');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v46 red-line rail — the collapsed CTA on the opened piece (C-residual root cause)');
  fileMapTests();
  geometryTests();
  floorTests();
  liveScanTests();
  fixtureTests();
  mutationProbes();
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
