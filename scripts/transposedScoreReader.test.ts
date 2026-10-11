/**
 * transposedScoreReader.test.ts — the v39 Part 2 gate: the FULL-SCORE READER
 * (owner direction 10-11, backlog 5e3dffd3).
 *
 * Three layers, the team's usual shape:
 *   1. PURE LOGIC — the reader band (page vs self-scroll) and the box it hands the
 *      viewer, the title builder the reader and the editor share, the sample bar
 *      label, the share payload decision;
 *   2. LIVE-SOURCE GUARDS — the wiring, read from the REAL files (a registered
 *      route, the editor's door, `wholeWork` on the viewer, save through the
 *      library, share through the platform, no second title builder);
 *   3. MUTATION PROBES — every guard run against a mutated copy that MUST fail, so
 *      a guard that cannot bite is visible here instead of on the owner's device.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  ABC_READER_MAX_HEIGHT,
  ABC_READER_VIEWPORT_FALLBACK,
  ABC_SCORE_MAX_HEIGHT,
  ABC_SCORE_MIN_HEIGHT,
  abcReaderContainerHeight,
  clampReaderScoreHeight,
  scoreReaderBand,
} from '../src/services/scoreHeight';
import {
  SAMPLE_EXCERPT_MAX_BARS,
  SAMPLE_EXCERPT_FALLBACK_LABEL,
  countAbcBars,
  isSampleScore,
  readerSampleLabel,
  sampleExcerptLabel,
  transposedCopyTitle,
  transposedReaderSubtitle,
} from '../src/services/transposedScore';
import {
  SCORE_SHARE_EXTENSION,
  SCORE_SHARE_FAILED_HINT,
  SCORE_SHARE_MIME_TYPE,
  buildScoreSharePayload,
  scoreShareFilename,
  scoreShareText,
} from '../src/services/scoreShare';
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';
import {
  READER_APP_PATH,
  READER_COMPONENT_NAME,
  READER_EDITOR_PATH,
  READER_PACKAGE_PATH,
  READER_ROUTE_NAME,
  READER_SCREEN_PATH,
  READER_SHARE_DEVICE_PATH,
  READER_SHARE_MODULE_PATH,
  READER_PURE_MODULE_PATH,
  READER_TIER1_CONFIG_PATH,
  READER_TYPES_PATH,
  READER_VIEWER_PATH,
  READER_WINDOW_TITLE,
  readerBandHandsOffInsteadOfClipping,
  readerCopyConstantCount,
  readerEntryPointExists,
  readerHasOneTitleBuilder,
  readerIsARouteNotAModal,
  readerLabelsASample,
  readerRouteIsRegistered,
  readerSavesThroughTheLibrary,
  readerShowsTheWholeWork,
  readerSharesThroughThePlatform,
  readerSourceCount,
  readerTier1ListsTheFeature,
  readerUserFacingSources,
} from '../src/services/v39ReaderContract';
import {
  v39CopyAvoidsBannedClaims,
  v39HasNoNetwork,
  v39IsFreeAndUnpaywalled,
  v39ModuleStaysPure,
} from '../src/services/v39UiContract';

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
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

const SCREEN = readAppFile(READER_SCREEN_PATH);
const PURE = readAppFile(READER_PURE_MODULE_PATH);
const SHARE = readAppFile(READER_SHARE_MODULE_PATH);
const SHARE_DEVICE = readAppFile(READER_SHARE_DEVICE_PATH);
const VIEWER = readAppFile(READER_VIEWER_PATH);
const EDITOR = readAppFile(READER_EDITOR_PATH);
const APP = readAppFile(READER_APP_PATH);
const TYPES = readAppFile(READER_TYPES_PATH);
const tsconfigSource = readAppFile(READER_TIER1_CONFIG_PATH);
const packageSource = readAppFile(READER_PACKAGE_PATH);
const readerSources = readerUserFacingSources({
  screen: SCREEN,
  pure: PURE,
  share: SHARE,
  device: SHARE_DEVICE,
});

console.log('\nv39 reader — the band (a whole work hands off, it never clips)');
assertEq(scoreReaderBand(ABC_READER_MAX_HEIGHT), 'page', 'a document exactly at the ceiling lays out inline');
assertEq(scoreReaderBand(ABC_READER_MAX_HEIGHT + 1), 'self-scroll', 'one pixel past the ceiling hands the scroll to the viewer');
assertEq(scoreReaderBand(9000), 'self-scroll', 'a 9000px sonata movement is the self-scroll band');
assertEq(scoreReaderBand(null), 'page', 'an unmeasured document is the page band (wait for the report)');
assertEq(scoreReaderBand(Number.NaN), 'page', 'a junk measurement does not claim the piece is long');
assertEq(scoreReaderBand(-5), 'page', 'a negative measurement is not a band');
assertEq(scoreReaderBand(0), 'page', 'a zero measurement is not a band');
assertEq(scoreReaderBand('1800'), 'page', 'a numeric string measures like a number');
assertEq(clampReaderScoreHeight(9000), ABC_READER_MAX_HEIGHT, 'the reader clamps a long document to ITS ceiling');
assertEq(clampReaderScoreHeight(1800), 1800, 'a document that fits keeps its own height');
assertEq(clampReaderScoreHeight(10), ABC_SCORE_MIN_HEIGHT, 'a tiny document still gets the score floor');
assertEq(clampReaderScoreHeight(null), null, 'nothing to clamp');
assertEq(clampReaderScoreHeight('junk'), null, 'junk does not clamp');
assert(ABC_READER_MAX_HEIGHT >= ABC_SCORE_MAX_HEIGHT, 'the reader ceiling is never tighter than the app ceiling');
assertEq(abcReaderContainerHeight({ measuredHeight: 9000, viewportHeight: 800 }), 800, 'a whole work gets the VIEWPORT box, not a 4000px clip');
assertEq(abcReaderContainerHeight({ measuredHeight: 1800, viewportHeight: 800 }), 1800, 'a document that fits is laid out in full inline');
assertEq(abcReaderContainerHeight({ measuredHeight: 10, viewportHeight: 800 }), ABC_SCORE_MIN_HEIGHT, 'a tiny document keeps the floor in page mode');
assertEq(abcReaderContainerHeight({ measuredHeight: null, viewportHeight: 700 }), 700, 'unmeasured: a visible staff while the document reports');
assertEq(abcReaderContainerHeight({ measuredHeight: null, viewportHeight: null }), ABC_READER_VIEWPORT_FALLBACK, 'a junk viewport falls back to a visible box');
assertEq(abcReaderContainerHeight({ measuredHeight: 9000, viewportHeight: 0 }), ABC_READER_VIEWPORT_FALLBACK, 'self-scroll with a zero viewport still shows a box');
assertEq(readerBandHandsOffInsteadOfClipping({ band: scoreReaderBand, height: abcReaderContainerHeight, ceiling: ABC_READER_MAX_HEIGHT, floor: ABC_SCORE_MIN_HEIGHT }), true, 'the band guard passes on the real module');

console.log('\nv39 reader — the title builder (one format, two surfaces)');
assertEq(transposedCopyTitle({ title: 'Für Elise', keyLabel: 'Am', offset: 2 }), 'Für Elise (Am · +2)', 'a transposed copy is titled like the editor always titled it');
assertEq(transposedCopyTitle({ title: 'Ode to Joy', keyLabel: 'D', offset: -3 }), 'Ode to Joy (D · -3)', 'a downward shift keeps its minus sign');
assertEq(transposedCopyTitle({ title: 'Ode to Joy', keyLabel: 'C', offset: 0 }), 'Ode to Joy (C · 0)', 'the original key still names its key');
assertEq(transposedCopyTitle({ title: '  Twinkle  ', keyLabel: ' G ', offset: 2.7 }), 'Twinkle (G · +2)', 'whitespace is trimmed and the offset is a whole semitone');
assertEq(transposedCopyTitle({ title: '', keyLabel: '', offset: Number.NaN }), 'Untitled score (C · 0)', 'a missing title/key/offset never prints undefined');
assertEq(transposedCopyTitle({ title: 'X', keyLabel: 'C', offset: -0 }), 'X (C · 0)', 'negative zero is zero');
assertEq(transposedReaderSubtitle({ keyLabel: 'Am', offset: 2 }), 'Am · +2 semitones from the original', 'the reader says which key and how far from the original');
assertEq(transposedReaderSubtitle({ keyLabel: 'Am', offset: 1 }), 'Am · +1 semitone from the original', 'one semitone reads in the singular');
assertEq(transposedReaderSubtitle({ keyLabel: 'Am', offset: -1 }), 'Am · -1 semitone from the original', 'a downward semitone reads in the singular');
assertEq(transposedReaderSubtitle({ keyLabel: 'Am', offset: 0 }), 'Original key · Am', 'offset zero says the original key, not "0 semitones"');
assertEq(transposedReaderSubtitle({ keyLabel: '', offset: Number.NaN }), 'Original key · C', 'a junk key/offset falls back honestly');

console.log('\nv39 reader — the sample label (the "4 bars" the owner saw is the DATA)');
assertEq(countAbcBars('X:1\nT:x\nM:3/8\nL:1/8\nK:Am\ne ^d e | ^d e B | d c A | A, z z |]'), 4, 'four bars between bar lines, the closing |] excluded');
assertEq(countAbcBars('K:C\nE E F G | G F E D | C C D E | E2 D2 |]'), 4, 'a bar is a run of music, not every token');
assertEq(countAbcBars('K:C\n|: C D | E F :|'), 2, 'repeat marks do not add bars');
assertEq(countAbcBars('K:C\n[CEG] [DFA] | c2 z2 ||'), 2, 'bracketed chords count once per bar, not once per chord');
assertEq(countAbcBars('K:C\n[1 C D | [2 E F |'), 2, 'first/second endings are not extra bars');
assertEq(countAbcBars(''), 0, 'no score, no bars');
assertEq(countAbcBars('X:1\nT:x\nK:C'), 0, 'a header with no music has no bars');
assertEq(countAbcBars(null), 0, 'a null score has no bars');
assertEq(countAbcBars('#not abc'), 0, 'a line with no note letter is not music');
assertEq(sampleExcerptLabel('K:C\nE E F G | G F E D | C C D E | E2 D2 |]'), 'Sample — 4-bar excerpt', 'a four-bar excerpt says so, with its own count');
assertEq(sampleExcerptLabel('K:C\nC D | E F | G A | B c | d e | f g | a b | c d |]'), 'Sample — 8-bar excerpt', 'a document at the excerpt limit is still an excerpt');
assertEq(sampleExcerptLabel('K:C\n' + 'C D | '.repeat(SAMPLE_EXCERPT_MAX_BARS + 1)), null, 'one bar past the limit is not called a sample');
assertEq(sampleExcerptLabel(''), null, 'an empty score has no sample label');
assertEq(isSampleScore(''), false, 'an empty score is not a sample by omission');
assertEq(readerSampleLabel({ isSample: false, abc: 'K:C\nC D | E F |]' }), null, 'a whole work shows no sample label');
assertEq(readerSampleLabel({ isSample: true, abc: 'K:C\nC D | E F |]' }), 'Sample — 2-bar excerpt', 'a flagged sample shows its own bar count');
assertEq(readerSampleLabel({ isSample: true, abc: 'K:C\nC D | E F |]' }) !== SAMPLE_EXCERPT_FALLBACK_LABEL, true, 'the fallback is only for an unreadable count');
assertEq(readerSampleLabel({ isSample: true, abc: '' }), SAMPLE_EXCERPT_FALLBACK_LABEL, 'a flagged sample with no readable music still says it is a sample');
for (const score of PUBLIC_DOMAIN_ABC_SCORES) {
  assertEq(sampleExcerptLabel(score.abc) !== null, true, `the bundled score "${score.title}" is labelled a sample (it is an excerpt)`);
}

console.log('\nv39 reader — the share decision (a file, or the score as text)');
assertEq(scoreShareFilename({ title: 'Für Elise', keyLabel: 'Am', offset: 2 }), 'fur-elise-am-plus2.abc', 'the filename is accent-folded and says the key and the shift');
assertEq(scoreShareFilename({ title: 'Ode to Joy', keyLabel: 'C', offset: 0 }), 'ode-to-joy-c-original.abc', 'an unshifted copy says original');
assertEq(scoreShareFilename({ title: 'Ode to Joy', keyLabel: 'C', offset: -3 }), 'ode-to-joy-c-minus3.abc', 'a downward shift reads minus3');
assertEq(scoreShareFilename({ title: '', keyLabel: '', offset: Number.NaN }).slice(-4), SCORE_SHARE_EXTENSION, 'a junk title still produces an .abc name');
assert(scoreShareFilename({ title: '', keyLabel: '', offset: 0 }).length > 5, 'and the name is not empty');
assert(scoreShareText({ title: 'Für Elise', keyLabel: 'Am', offset: 0 }).indexOf('Am') > 0, 'the sentence names the key');
assert(scoreShareText({ title: 'Für Elise', keyLabel: 'Am', offset: 2 }).indexOf('+2') > 0, 'the sentence names the shift');
const filePlan = buildScoreSharePayload({ abc: 'K:C\nC D |]', title: 'X', keyLabel: 'C', offset: 1, fileUri: 'file:///t/x.abc', fileSharingAvailable: true });
assertEq(filePlan.mode, 'file', 'a written file on a platform that shares files goes as a file');
assertEq(filePlan.mode === 'file' ? filePlan.mimeType : '', SCORE_SHARE_MIME_TYPE, 'the file is plain text (it is ABC)');
assertEq(filePlan.mode === 'file' ? filePlan.fileUri : '', 'file:///t/x.abc', 'the payload carries the file URI');
const textPlan = buildScoreSharePayload({ abc: 'K:C\nC D |]', title: 'X', keyLabel: 'C', offset: 1, fileUri: 'file:///t/x.abc', fileSharingAvailable: false });
assertEq(textPlan.mode, 'text', 'a platform that cannot share files falls back to text');
assertEq(textPlan.mode === 'text' ? textPlan.message.indexOf('K:C') > 0 : false, true, 'and the text carries the ABC itself');
assertEq(buildScoreSharePayload({ abc: '', title: 'X', keyLabel: 'C', offset: 0, fileUri: null, fileSharingAvailable: true }).mode, 'text', 'no file and no ABC still shares the sentence, never a dead button');
assert(SCORE_SHARE_FAILED_HINT.length > 10, 'the failure line is a real sentence');

console.log('\nv39 reader — the live-source walk (floors first)');
assert(SCREEN.length > 6000, `read ${READER_SCREEN_PATH} (${SCREEN.length} chars)`);
assert(PURE.length > 4000, `read ${READER_PURE_MODULE_PATH} (${PURE.length} chars)`);
assert(SHARE.length > 3000, `read ${READER_SHARE_MODULE_PATH} (${SHARE.length} chars)`);
assert(SHARE_DEVICE.length > 2000, `read ${READER_SHARE_DEVICE_PATH} (${SHARE_DEVICE.length} chars)`);
assert(VIEWER.length > 6000, `read ${READER_VIEWER_PATH} (${VIEWER.length} chars)`);
assert(EDITOR.length > 12000, `read ${READER_EDITOR_PATH} (${EDITOR.length} chars)`);
assertEq(readerSourceCount(readerSources), 4, 'the sweep covers the reader four user-facing sources');

console.log('\nv39 reader — the guards');
assertEq(readerRouteIsRegistered({ app: APP, types: TYPES }), true, 'App.tsx mounts the reader route and the param list is typed');
assertEq(readerEntryPointExists(EDITOR), true, 'the editor opens it with the CURRENT transposed ABC');
assertEq(readerShowsTheWholeWork({ screen: SCREEN, viewer: VIEWER }), true, 'the reader renders the whole work and the viewer implements the band');
assertEq(readerSavesThroughTheLibrary({ screen: SCREEN, editor: EDITOR }), true, 'save goes through the Library store, named by the shared builder');
assertEq(readerSharesThroughThePlatform({ screen: SCREEN, device: SHARE_DEVICE, pure: SHARE }), true, 'share goes through the platform sheet, with an honest failure line');
assertEq(readerLabelsASample({ screen: SCREEN, editor: EDITOR }), true, 'both surfaces say when a score is an excerpt');
assertEq(readerHasOneTitleBuilder({ editor: EDITOR, screen: SCREEN }), true, 'no second title builder anywhere in the two surfaces');
assertEq(readerIsARouteNotAModal(SCREEN), true, 'the reader is a route (BACK pops it), not a modal');
assertEq(readerCopyConstantCount(SCREEN), 5, 'the reader still carries its five copy constants');
assertEq(readerTier1ListsTheFeature(tsconfigSource, packageSource), true, 'every new module and suite is in BOTH gate lists');
assertEq(v39HasNoNetwork(readerSources), true, 'nothing on the reader path can reach the network');
assertEq(v39IsFreeAndUnpaywalled(readerSources), true, 'no Pro/paywall/subscription token anywhere in the reader path');
assertEq(v39CopyAvoidsBannedClaims(readerSources), true, 'no banned claim on the reader surface');
assertEq(v39ModuleStaysPure(PURE), true, 'transposedScore.ts stays pure');
assertEq(v39ModuleStaysPure(SHARE), true, 'scoreShare.ts stays pure');

console.log('\nv39 reader — the guards are not vacuous (empty input)');
assertEq(readerRouteIsRegistered({ app: '', types: '' }), false, 'empty sources register nothing');
assertEq(readerEntryPointExists(''), false, 'an empty editor has no door');
assertEq(readerShowsTheWholeWork({ screen: '', viewer: '' }), false, 'empty sources show nothing');
assertEq(readerSavesThroughTheLibrary({ screen: '', editor: '' }), false, 'empty sources save nothing');
assertEq(readerSharesThroughThePlatform({ screen: '', device: '', pure: '' }), false, 'empty sources share nothing');
assertEq(readerLabelsASample({ screen: '', editor: '' }), false, 'empty sources label nothing');
assertEq(readerHasOneTitleBuilder({ editor: '', screen: '' }), false, 'empty surfaces prove no builder');
assertEq(readerIsARouteNotAModal(''), false, 'an empty screen is not a route');
assertEq(readerCopyConstantCount(''), 0, 'an empty screen carries no copy');
assertEq(readerTier1ListsTheFeature('', ''), false, 'empty lists do not gate the feature');
assertEq(readerSourceCount([]), 0, 'an empty sweep covers nothing');
assertEq(v39HasNoNetwork([]), false, 'an empty source list proves no network block');

console.log('\nv39 reader — MUTATION PROBES (each guard must bite)');
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}
probe('the reader is never registered in App.tsx', APP.replace(READER_COMPONENT_NAME, 'SomeOtherScreen'), APP, () =>
  readerRouteIsRegistered({ app: APP.replace(READER_COMPONENT_NAME, 'SomeOtherScreen'), types: TYPES }),
);
probe('the route type loses its abc param', TYPES, TYPES, () =>
  readerRouteIsRegistered({
    app: APP,
    types: TYPES.replace(`${READER_ROUTE_NAME}: {`, `${READER_ROUTE_NAME}: { unused: string;`),
  }),
);
assertEq(
  readerRouteIsRegistered({ app: APP, types: TYPES.replace(/\babc\s*:/, 'scoreText:') }),
  false,
  'MUTATION FAILS THE GUARD — the param list renames the abc it carries',
);
probe('the editor navigates without the transposed ABC', EDITOR, EDITOR, () =>
  readerEntryPointExists(EDITOR.replace('abc: transposedAbc', 'abc: sourceAbc')),
);
probe('the editor stops flagging samples', EDITOR, EDITOR, () =>
  readerEntryPointExists(EDITOR.replace('isSample: isSampleScore(transposedAbc)', 'isSample: false')),
);
probe('the reader forgets wholeWork', SCREEN, SCREEN, () =>
  readerShowsTheWholeWork({ screen: SCREEN.replace('<AbcScoreView abc={abc} wholeWork />', '<AbcScoreView abc={abc} />'), viewer: VIEWER }),
);
probe('the viewer stops asking which band it is in', VIEWER, VIEWER, () =>
  readerShowsTheWholeWork({ screen: SCREEN, viewer: VIEWER.replace('scoreReaderBand(', 'clampScoreHeight(') }),
);
probe('the viewer stops handing the gesture to the WebView', VIEWER, VIEWER, () =>
  readerShowsTheWholeWork({ screen: SCREEN, viewer: VIEWER.replace('scrollEnabled={viewerInteractive}', 'scrollEnabled={false}') }),
);
probe('the reader writes its own library item', SCREEN, SCREEN, () =>
  readerSavesThroughTheLibrary({ screen: SCREEN.replace('addAbcToLibrary({', 'writeOwnItem({'), editor: EDITOR }),
);
probe('the editor stops using the shared title builder', EDITOR, EDITOR, () =>
  readerSavesThroughTheLibrary({ screen: SCREEN, editor: EDITOR.replace('transposedCopyTitle(', 'ownTitle(') }),
);
probe('the share silently does nothing when it fails', SCREEN, SCREEN, () =>
  readerSharesThroughThePlatform({ screen: SCREEN.replace('SCORE_SHARE_FAILED_HINT', 'null'), device: SHARE_DEVICE, pure: SHARE }),
);
probe('the device share stops using the platform sheet', SHARE_DEVICE, SHARE_DEVICE, () =>
  readerSharesThroughThePlatform({ screen: SCREEN, device: SHARE_DEVICE.replace('Share.share(', 'sendEmail('), pure: SHARE }),
);
probe('the editor stops labelling samples', EDITOR, EDITOR, () =>
  readerLabelsASample({ screen: SCREEN, editor: EDITOR.replace('sampleExcerptLabel(', 'noLabel(') }),
);
assertEq(
  readerHasOneTitleBuilder({
    editor: EDITOR + '\nconst title = `${selected.title} (${keyLabels.to} · ${offset})`;',
    screen: SCREEN,
  }),
  false,
  'MUTATION FAILS THE GUARD — an inline title template reappears in a surface',
);
probe('the reader becomes a modal overlay', SCREEN, SCREEN, () =>
  readerIsARouteNotAModal(SCREEN + '\nconst x = <Modal visible={true} />;'),
);
probe('the reader loses its free/honest copy', SCREEN, SCREEN, () =>
  readerCopyConstantCount(SCREEN.replace('export const READER_FREE_NOTE', 'const READER_FREE_NOTE')) === 5,
);
// The BAND rule itself: shift the ceiling by a pixel and a whole work is clipped again.
const wrongBand = (measured: unknown): string => {
  const value = Math.round(Number(measured));
  if (!Number.isFinite(value) || value <= 0) return 'page';
  return value >= ABC_READER_MAX_HEIGHT ? 'self-scroll' : 'page';
};
assertEq(scoreReaderBand(ABC_READER_MAX_HEIGHT), 'page', 'the real rule is inclusive at the ceiling');
assertEq(wrongBand(ABC_READER_MAX_HEIGHT), 'self-scroll', 'MUTATION: an exclusive ceiling changes the band at the boundary');
assertEq(
  readerBandHandsOffInsteadOfClipping({ band: wrongBand, height: abcReaderContainerHeight, ceiling: ABC_READER_MAX_HEIGHT, floor: ABC_SCORE_MIN_HEIGHT }),
  false,
  'MUTATION FAILS THE GUARD — a boundary-shifted band rule',
);
const clippingHeight = (input: { measuredHeight: unknown; viewportHeight: unknown }): number =>
  Math.min(ABC_SCORE_MAX_HEIGHT, Math.max(ABC_SCORE_MIN_HEIGHT, Math.round(Number(input.measuredHeight)) || 0));
assertEq(clippingHeight({ measuredHeight: 9000, viewportHeight: 800 }), ABC_SCORE_MAX_HEIGHT, 'MUTATION: the old clip gives a 9000px work 4000px');
assertEq(
  readerBandHandsOffInsteadOfClipping({ band: scoreReaderBand, height: clippingHeight, ceiling: ABC_READER_MAX_HEIGHT, floor: ABC_SCORE_MIN_HEIGHT }),
  false,
  'MUTATION FAILS THE GUARD — a box rule that clips a whole work instead of handing off',
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
