/**
 * v45 SLICE 4 — THE SCAN BATCH: what the photo is, and whether the app may look
 * it up (owner-ratified 2026-10-26).
 *
 * THE TWO HALVES:
 *   • the PURE decision (services/scanClassify): a photo is a cover or a page of
 *     music, with the read's own quality and confidence, and the auto-search gate
 *     fires ONLY on a good cover read that names a piece we hold;
 *   • the LIVE structure (services/scanBatchContract): the scanner routes to the
 *     app's own search and never to a retailer, the lookup is explained and
 *     cancellable, the resolve page has ONE field and one CTA, and the framing
 *     guide is visuals only.
 *
 * Every guard is then mutated below, and each mutation must fail the guard it
 * targets — a green assertion nobody has seen fail is not evidence.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
import {
  SCAN_AUTO_SEARCH_DISMISS,
  SCAN_AUTO_SEARCH_PREFIX,
  SCAN_AUTO_SEARCH_SUFFIX,
  SCAN_CLASSIFY_NO_CANDIDATE_LINE,
  SCAN_CLASSIFY_READ_FAILED_LINE,
  SCAN_CLASSIFY_SCORE_PAGE_LINE,
  classifyScanPhoto,
  coverReadConfidence,
  scanAutoSearchHeadline,
  scanPhotoKindFor,
  scanPlanCarriesNoRetailerUrl,
  scorePageConfidence,
  type ScanPhotoClassification,
} from '../src/services/scanClassify';
import type { OcrBlock, OcrImageSize, OcrTitleCorpusEntry } from '../src/services/ocrTitleCandidates';
import {
  SCAN_BATCH_CLASSIFY_PATH,
  SCAN_BATCH_FIND_PATH,
  SCAN_BATCH_SCREEN_PATH,
  SCAN_BATCH_SECTION_PATH,
  autoSearchIsExplainedAndCancellable,
  framingGuideIsVisualOnly,
  scanAutoSearchFiresOnlyOnGoodCoverCandidates,
  scanPhotoKindComesFromTheVerdict,
  scanSearchIsSingleField,
  scorePageNeverFiresAResearch,
  scannerRoutesToInAppSearchOnly,
} from '../src/services/scanBatchContract';

declare const require: any;
declare const process: any;
let passes = 0;
let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
    passes += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}
function assertTrue(value: boolean, label: string): void {
  assertEq(value, true, label);
}
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

/** A page photo, in pixels (frames below are in these units). */
const IMAGE: OcrImageSize = { width: 1000, height: 1400 };
/** One recogniser block: a line of text, its box on the page, its letter height. */
function block(text: string, y: number, height: number, x = 60): OcrBlock {
  return {
    text,
    frame: { x, y, width: 800, height },
    lines: [
      {
        text,
        frame: { x, y, width: 800, height },
        elements: text
          .split(' ')
          .filter((token) => token.length > 0)
          .map((token, index) => ({
            text: token,
            frame: { x: x + index * 60, y, width: 50, height },
          })),
      },
    ],
  };
}

/** The live catalog, as the host hands it in (one piece we hold). */
const CATALOG: OcrTitleCorpusEntry[] = [
  { id: 'piece-moonlight', title: 'Moonlight Sonata', composer: 'Beethoven', source: 'catalog' },
];
/** The owner's real debris, from the v41 device pass. */
const OWNER_DEBRIS = '4ox 2Apx ors white Freddie Mer';

// ─── 1. a good cover read MAY look itself up ────────────────────────────────
console.log('\nv45 S4 — a good cover read that names a piece is looked up for you');
const goodRead = {
  text: 'Moonlight Sonata',
  failed: false,
  blocks: [block('Moonlight Sonata', 120, 96), block('Beethoven', 260, 30)],
  imageSize: IMAGE,
};
const good: ScanPhotoClassification = classifyScanPhoto(goodRead, CATALOG);
assertEq(good.verdict, 'cover', 'a title page is the COVER verdict');
assertEq(good.quality, 'good', 'the read is good');
assertEq(good.autoSearch.fire, true, 'THE HEADLINE: a good cover read that names a piece IS looked up');
assertEq(good.best?.id, 'piece-moonlight', 'the candidate is the catalog piece the read answers');
assertEq(good.autoSearch.query.length > 0, true, 'the plan carries a real query');
assertEq(
  good.autoSearch.headline,
  `${SCAN_AUTO_SEARCH_PREFIX} “${good.best?.title}” ${SCAN_AUTO_SEARCH_SUFFIX}`,
  'the headline says exactly what is being looked up',
);
assertEq(good.autoSearch.dismissLabel, SCAN_AUTO_SEARCH_DISMISS, 'and it comes with the one control that cancels it');
assertEq(good.autoSearch.holdLine, null, 'a fired lookup has nothing to explain away');
assertEq(scanPlanCarriesNoRetailerUrl(good.autoSearch), true, 'THE PLAN IS A QUERY, NEVER A LINK (no retailer, no URL)');
assertEq(scanAutoSearchHeadline('  '), '', 'an empty title makes no headline');
assertEq(good.confidence > 0 && good.confidence <= 1, true, 'the confidence is a real 0…1 measurement');
assertEq(good.confidence > 0.5, true, 'a good cover read is more confident than not');

// ─── 2. debris never fires ──────────────────────────────────────────────────
console.log('\nv45 S4 — the owner’s debris read is NEVER looked up');
const debris = classifyScanPhoto(
  { text: OWNER_DEBRIS, failed: false, blocks: [block(OWNER_DEBRIS, 120, 90)], imageSize: IMAGE },
  CATALOG,
);
assertEq(debris.autoSearch.fire, false, 'a debris read does not fire');
assertEq(debris.autoSearch.query, '', 'and carries no query at all');
assertEq(debris.quality, 'garbage', 'it is garbage');
assertEq(debris.confidence, 0, 'with zero confidence');
assertEq(typeof debris.autoSearch.holdLine === 'string', true, 'and an honest line saying why');

// ─── 3. a page of music never fires, and says why ───────────────────────────
console.log('\nv45 S4 — a page of music is the SCORE-PAGE verdict and is never looked up');
const notation = classifyScanPhoto(
  {
    text: '♪♫♩♬',
    failed: false,
    blocks: [
      block('♪♫♩♬', 200, 40),
      block('— — — —', 400, 40),
      block('♬♩♫♪', 600, 40),
      block('‖ ‖ ‖', 800, 40),
    ],
    imageSize: IMAGE,
  },
  CATALOG,
);
assertEq(notation.verdict, 'score-page', 'symbol blocks are a PAGE OF MUSIC');
assertEq(notation.autoSearch.fire, false, 'a page of music is never looked up');
assertEq(notation.autoSearch.holdLine, SCAN_CLASSIFY_SCORE_PAGE_LINE, 'the screen gets the honest page-of-music line');
assertEq(notation.confidence > 0 && notation.confidence <= 1, true, 'its confidence is measured from the symbol share');
// …and the verdict beats a corpus that WOULD have matched.
const notationWithATitle = classifyScanPhoto(
  {
    text: '♪♫♩♬',
    failed: false,
    blocks: [
      block('Moonlight Sonata', 120, 96),
      block('♪♫♩♬', 300, 40),
      block('— — — —', 420, 40),
      block('♬♩♫♪', 560, 40),
      block('‖ ‖ ‖', 700, 40),
    ],
    imageSize: IMAGE,
  },
  CATALOG,
);
assertEq(notationWithATitle.verdict, 'score-page', 'a title line on a page of music is still a page of music');
assertEq(notationWithATitle.autoSearch.fire, false, 'so it is still not looked up');

// ─── 4. a weak read never fires, even when it names something ───────────────
console.log('\nv45 S4 — a WEAK read always stays a proposal');
const weak = classifyScanPhoto(
  {
    text: 'Minuet in G minor',
    failed: false,
    blocks: [
      // A tall broken line (filtered from the candidates, but it sets the page's
      // tallest height) leaves the real line small and low on the page.
      block(OWNER_DEBRIS, 100, 500),
      block('Minuet in G minor', 1200, 60),
    ],
    imageSize: IMAGE,
  },
  [{ id: 'piece-minuet', title: 'Minuet in G minor', composer: 'Bach', source: 'catalog' }],
);
assertEq(weak.quality, 'weak', 'a small, low title line is only a WEAK read');
assertEq(weak.candidates.length > 0, true, 'it can still name the piece it answers');
assertEq(weak.autoSearch.fire, false, 'but a weak read is NEVER looked up — the user confirms it');
assertEq(weak.autoSearch.holdLine !== null, true, 'and it says so honestly');
assertEq(weak.confidence <= 0.5, true, 'a weak read never claims more than half confidence');

// ─── 5. degenerate input is not a lookup ────────────────────────────────────
console.log('\nv45 S4 — a good read that names NOTHING we hold is not looked up either');
const noMatch = classifyScanPhoto(
  {
    text: 'Moonlight Sonata',
    failed: false,
    blocks: [block('Moonlight Sonata', 120, 96)],
    imageSize: IMAGE,
  },
  [{ id: 'other', title: 'Zzzz Quintet', composer: 'Nobody', source: 'catalog' }],
);
assertEq(noMatch.quality, 'good', 'the read itself is good');
assertEq(noMatch.candidates.length, 0, 'but it answers no piece in this corpus');
assertEq(noMatch.autoSearch.fire, false, 'so nothing is looked up on the user’s behalf');
assertEq(noMatch.autoSearch.holdLine, SCAN_CLASSIFY_NO_CANDIDATE_LINE, 'and the honest line says exactly that');

console.log('\nv45 S4 — failed, blank and geometry-less reads are honest, never lookups');
const failedRead = classifyScanPhoto({ text: '', failed: true, blocks: [], imageSize: null }, CATALOG);
assertEq(failedRead.autoSearch.fire, false, 'a failed read does not fire');
assertEq(failedRead.autoSearch.holdLine, SCAN_CLASSIFY_READ_FAILED_LINE, 'it gets the failed-read line');
assertEq(failedRead.verdict, 'cover', 'and keeps the cover door (it says nothing about the photo)');
const noGeometry = classifyScanPhoto({ text: 'Moonlight Sonata', failed: false, blocks: [] }, CATALOG);
assertEq(noGeometry.autoSearch.fire, false, 'a read with NO geometry never fires — geometry is the evidence');
assertEq(noGeometry.quality, 'weak', 'it is at best a weak read');
const blank = classifyScanPhoto({ text: '', failed: false, blocks: [] }, CATALOG);
assertEq(blank.quality, 'garbage', 'a blank read is garbage');
assertEq(blank.autoSearch.fire, false, 'and never fires');
const nothing = classifyScanPhoto(null, CATALOG);
assertEq(nothing.autoSearch.fire, false, 'no read at all never fires');
assertEq(nothing.candidates.length, 0, 'and suggests nothing');

// ─── 6. the door comes from the verdict ─────────────────────────────────────
console.log('\nv45 S4 — the resolve page’s door comes from the verdict');
assertEq(scanPhotoKindFor(good, 'page'), 'cover', 'a cover verdict is the cover door');
assertEq(scanPhotoKindFor(notation, 'cover'), 'page', 'a score-page verdict is the page door');
assertEq(scanPhotoKindFor(null, 'page'), 'page', 'no verdict yet keeps the fallback (later pages)');
assertEq(scanPhotoKindFor(null, 'cover'), 'cover', 'no verdict yet keeps the fallback (first photo)');
assertEq(scanPhotoKindFor(undefined), 'cover', 'and an unset fallback is the cover door');

// ─── 7. the confidence measurements are real ────────────────────────────────
console.log('\nv45 S4 — the confidence is measured, not a constant');
assertEq(coverReadConfidence(0), 0, 'no title score is no confidence');
assertEq(coverReadConfidence(-2), 0, 'a negative score is no confidence');
assertEq(coverReadConfidence(100) <= 1, true, 'confidence is capped at 1');
assertEq(coverReadConfidence(2.4) < coverReadConfidence(3.6), true, 'a stronger title score is more confident');
assertEq(scorePageConfidence([]), 0, 'no blocks is no score-page confidence');
assertEq(scorePageConfidence([block('♪♫♩♬', 100, 40)]) > 0, true, 'a symbol page scores above zero');

// ════════════════════════════════════════════════════════════════════════════
// THE LIVE STRUCTURE — the real files, read as text (no emulator needed)
// ════════════════════════════════════════════════════════════════════════════
console.log('\nv45 S4 — the real sources');
const SCREEN = read(SCAN_BATCH_SCREEN_PATH);
const SECTION = read(SCAN_BATCH_SECTION_PATH);
const FIND = read(SCAN_BATCH_FIND_PATH);
const CLASSIFY = read(SCAN_BATCH_CLASSIFY_PATH);
assertEq(SCREEN.length > 8000, true, `read ${SCAN_BATCH_SCREEN_PATH} (${SCREEN.length} chars)`);
assertEq(SECTION.length > 4000, true, `read ${SCAN_BATCH_SECTION_PATH} (${SECTION.length} chars)`);
assertEq(FIND.length > 8000, true, `read ${SCAN_BATCH_FIND_PATH} (${FIND.length} chars)`);
assertEq(CLASSIFY.length > 2000, true, `read ${SCAN_BATCH_CLASSIFY_PATH} (${CLASSIFY.length} chars)`);

console.log('\nv45 S4 — the gate, the door and the money path');
assertEq(
  scanAutoSearchFiresOnlyOnGoodCoverCandidates(CLASSIFY),
  true,
  'the auto-fire condition carries EVERY clause of the honest rule, with no alternation',
);
assertEq(scorePageNeverFiresAResearch(CLASSIFY), true, 'the score-page branch returns a hold plan before the gate');
assertEq(scannerRoutesToInAppSearchOnly(SCREEN), true, 'the scanner hands a QUERY to the app’s own search — no URL, no retailer');
assertEq(
  autoSearchIsExplainedAndCancellable(SCREEN, FIND),
  true,
  'the lookup is explained (“Looking up … for you”) and cancellable (“Not now”)',
);
assertEq(scanPhotoKindComesFromTheVerdict(SCREEN), true, 'the scanner’s photo door comes from the classification');
assertEq(framingGuideIsVisualOnly([SCREEN, SECTION, CLASSIFY]), true, 'the framing guide claims no crop, no alignment, no auto-detect');
assertEq(scanSearchIsSingleField(SECTION), true, 'THE MERGE: ONE field and ONE CTA on the resolve page');
assertEq(
  (SECTION.match(/<TextInput/g) ?? []).length,
  1,
  'counted independently: exactly one TextInput in the resolve page',
);
assertEq(
  SECTION.indexOf('SCAN_FIND_TYPED_SEARCH_CTA') >= 0 && SECTION.indexOf('SCAN_FIND_SEARCH_WORDS_CTA') >= 0,
  true,
  'and its one CTA keeps both wordings (the read’s words / the user’s own title)',
);
// The scanner still opens the resolve page with the words, the piece and the retake.
assertEq(
  SCREEN.indexOf('onSearch={setFindQuery}') >= 0 &&
    SCREEN.indexOf('onOpenPiece={openSuggestedPiece}') >= 0,
  true,
  'the money path is still the ONE search: query out, piece out',
);

// ════════════════════════════════════════════════════════════════════════════
// THE MUTATIONS — each one removes a property a guard above pins
// ════════════════════════════════════════════════════════════════════════════
console.log('\nv45 S4 — mutations (each one MUST fail its guard)');

// (a) the gate weakened to fire on a weak/garbage read
const weakenedGate = CLASSIFY.replace(
  "    result.quality === 'good' &&",
  "    result.quality !== 'garbage' &&",
);
assert(weakenedGate !== CLASSIFY, 'mutation (a) weakened the quality clause');
assertEq(
  scanAutoSearchFiresOnlyOnGoodCoverCandidates(weakenedGate),
  false,
  'MUTATION (a): a gate that fires on a weak read FAILS scanAutoSearchFiresOnlyOnGoodCoverCandidates',
);
// (a2) the gate made to fire with no candidate at all
const noCandidate = CLASSIFY.replace(
  '    result.candidates.length > 0 &&',
  '    result.candidates.length >= 0 &&',
);
assert(noCandidate !== CLASSIFY, 'mutation (a2) loosened the candidate clause');
assertEq(
  scanAutoSearchFiresOnlyOnGoodCoverCandidates(noCandidate),
  false,
  'MUTATION (a2): a gate that fires without a candidate FAILS the same guard',
);
// (a3) an alternative short-circuits the clauses
const alternation = CLASSIFY.replace(
  "    verdict === 'cover' &&",
  "    (verdict === 'cover' || true) &&",
);
assert(alternation !== CLASSIFY, 'mutation (a3) put an alternative in the gate');
assertEq(
  scanAutoSearchFiresOnlyOnGoodCoverCandidates(alternation),
  false,
  'MUTATION (a3): an `||` in the gate FAILS the guard — no clause may stand in for another',
);

// (b) the score-page branch falls through to a lookup
const pageFiresAnyway = CLASSIFY.replace(
  "  if (verdict === 'score-page') {",
  "  if (verdict === 'nothing-at-all') {",
);
assert(pageFiresAnyway !== CLASSIFY, 'mutation (b) removed the score-page branch');
assertEq(
  scorePageNeverFiresAResearch(pageFiresAnyway),
  false,
  'MUTATION (b): a classifier that lets a page of music reach the gate FAILS scorePageNeverFiresAResearch',
);

// (c) the scanner opens a retailer instead of the app's search
const retailerInScanner = `${SCREEN}\nconst buy = 'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=x';\n`;
assert(retailerInScanner !== SCREEN, 'mutation (c) added a retailer URL to the scanner');
assertEq(
  scannerRoutesToInAppSearchOnly(retailerInScanner),
  false,
  'MUTATION (c): a scanner that can open a retailer FAILS scannerRoutesToInAppSearchOnly',
);
// (c2) …or opens the store directly
const opensStore = SCREEN.replace('onDismissAutoSearch=', 'onDismissAutoSearch={void Linking.openURL}x=');
assert(opensStore !== SCREEN, 'mutation (c2) wired Linking.openURL into the scanner');
assertEq(
  scannerRoutesToInAppSearchOnly(opensStore),
  false,
  'MUTATION (c2): Linking.openURL on the scanner FAILS scannerRoutesToInAppSearchOnly',
);

// (d) the lookup becomes silent, or cannot be cancelled
const silentLookup = FIND.replace('{autoSearchNotice.headline}', "{'Searching…'}");
assert(silentLookup !== FIND, 'mutation (d) hid the headline');
assertEq(
  autoSearchIsExplainedAndCancellable(SCREEN, silentLookup),
  false,
  'MUTATION (d): a lookup with no headline FAILS autoSearchIsExplainedAndCancellable',
);
const noWayOut = FIND.replace('onPress={onDismissAutoSearch}', 'onPress={onClose}');
assert(noWayOut !== FIND, 'mutation (d2) removed the dismiss control');
assertEq(
  autoSearchIsExplainedAndCancellable(SCREEN, noWayOut),
  false,
  'MUTATION (d2): a lookup the user cannot cancel FAILS the same guard',
);
const autoSearchSneaksThroughTheProposal = FIND.replace(
  'autoSearchNotice ? false : initialOcrPrefillState(',
  'initialOcrPrefillState(',
);
assert(autoSearchSneaksThroughTheProposal !== FIND, 'mutation (d3) let an auto-search skip the notice');
assertEq(
  autoSearchIsExplainedAndCancellable(SCREEN, autoSearchSneaksThroughTheProposal),
  false,
  'MUTATION (d3): an auto-search that skips the explained step FAILS the same guard',
);

// (e) the "Search these words" box comes back as a second field
const secondField = SECTION.replace(
  '          <Text style={styles.hint}>\n            {actions.showReadWords ? SCAN_FIND_CONFIRM_HINT : SCAN_FIND_TYPED_HINT}',
  '          <TextInput style={styles.field} value={typed} onChangeText={setTyped} />\n          <Text style={styles.hint}>\n            {actions.showReadWords ? SCAN_FIND_CONFIRM_HINT : SCAN_FIND_TYPED_HINT}',
);
assert(secondField !== SECTION, 'mutation (e) put a second field back on the resolve page');
assertEq(
  scanSearchIsSingleField(secondField),
  false,
  'MUTATION (e): a second input FAILS scanSearchIsSingleField — the merge is structural',
);
const noWordsInCta = SECTION.replace('styles.searchWordsBold', 'styles.fieldLabel');
assert(noWordsInCta !== SECTION, 'mutation (e2) stopped printing the words in the CTA');
assertEq(
  scanSearchIsSingleField(noWordsInCta),
  false,
  'MUTATION (e2): a CTA that does not say what it searches FAILS the same guard (v44 #59)',
);

// (f) the framing guide grows a sensor claim
const sensorClaim = `${SCREEN}\nconst claim = 'Aligned automatically — auto-crop finds the title.';\n`;
assert(sensorClaim !== SCREEN, 'mutation (f) gave the framing guide a crop claim');
assertEq(
  framingGuideIsVisualOnly([sensorClaim, SECTION, CLASSIFY]),
  false,
  'MUTATION (f): "auto-crop"/"Aligned" in the scanner FAILS framingGuideIsVisualOnly',
);

// (g) the photo door goes back to the page index only
const indexOnlyDoor = SCREEN.replace(
  'const photoDoor = scanPhotoKindFor(scanClassification, pageDoorFallback);',
  'const photoDoor = pageDoorFallback;',
);
assert(indexOnlyDoor !== SCREEN, 'mutation (g) dropped the classifier from the photo door');
assertEq(
  scanPhotoKindComesFromTheVerdict(indexOnlyDoor),
  false,
  'MUTATION (g): a door decided by page index alone FAILS scanPhotoKindComesFromTheVerdict',
);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
