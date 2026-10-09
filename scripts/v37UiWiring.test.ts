/**
 * v37UiWiring.test.ts — LIVE-SOURCE GUARDS + PURE RULES for the v37 batch.
 *
 * ITEM 1 (backlog 3ff40fd1, owner FAIL #8): the Correct Your Take page opened
 * from a History row did not scroll, while the same component opened from the
 * capture window scrolled fine. The page's scroller now carries NO `scrollEnabled`
 * prop AT ALL and is remounted every session (`key`), and the History door opens
 * the editor one frame out of the press event. Guards here read the REAL
 * TakeCorrectionEditor.tsx / HistoryScreen.tsx.
 *
 * ITEM 2 (backlog 9e71e467 + a3a6da0c, owner FAIL #3): the transposed copy
 * re-opened showing ~4 bars — a non-interactive viewer clips to its box. The
 * viewer now measures its document and reports it, the editor grows the box, and
 * an always-visible "Revert to original" control puts the LOADED ABC back. Guards
 * read the REAL AbcScoreView.tsx / NotationEditorScreen.tsx, and the pure rules
 * (services/scoreHeight.ts, services/abcTranspose.ts) are pinned directly.
 *
 * EVERY guard is fed a PRE-FIX FIXTURE (the v36 shape, derived from the real file
 * by reversing the fix) and must return FALSE — a guard that only ever sees
 * healthy source proves nothing (skill `musicapp-guard-mutation-probes`). The same
 * mutations are applied to the files on disk with the failing lines captured in
 * /home/team/shared/v37-mutation-probes.txt.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  ABC_HEIGHT_MESSAGE_TYPE,
  ABC_SCORE_MAX_HEIGHT,
  ABC_SCORE_MIN_HEIGHT,
  abcHeightFromMessage,
  abcHeightProbeScript,
  abcScoreContainerHeight,
  clampScoreHeight,
} from '../src/services/scoreHeight';
import {
  REVERT_ORIGINAL_LABEL,
  originalScorePlan,
} from '../src/services/abcTranspose';
import {
  EDITOR_PAGE_KEY,
  editorOpensAFreshPageScroller,
  editorPageScrollerIsNeverSwitchedOff,
  everyEditorScoreIsNonInteractive,
  historyDoorOpensTheEditorOutsideThePressEvent,
  notationEditorCanRevertToTheOriginalScore,
  notationEditorGrowsTheScoreBox,
  pageScrollerTagOf,
  scoreViewerReportsItsOwnHeight,
} from '../src/services/v37UiContract';
import { editorDragLayerSharesScroll } from '../src/services/v34UiContract';
import { editorPageScrollsFromEverySurface } from '../src/services/v36UiContract';

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

const EDITOR = 'src/components/TakeCorrectionEditor.tsx';
const HISTORY = 'src/screens/HistoryScreen.tsx';
const NOTATION = 'src/screens/NotationEditorScreen.tsx';
const ABC_VIEW = 'src/components/AbcScoreView.tsx';

const editorSource = readAppFile(EDITOR);
const historySource = readAppFile(HISTORY);
const notationSource = readAppFile(NOTATION);
const abcViewSource = readAppFile(ABC_VIEW);

// ── the floors: the walk saw the real files ─────────────────────
console.log('\nv37 — the live-source walk (floors first)');
assert(editorSource.length > 20000, `read ${EDITOR} (${editorSource.length} chars)`);
assert(historySource.length > 20000, `read ${HISTORY} (${historySource.length} chars)`);
assert(notationSource.length > 8000, `read ${NOTATION} (${notationSource.length} chars)`);
assert(abcViewSource.length > 3000, `read ${ABC_VIEW} (${abcViewSource.length} chars)`);

// ── the shared helper and the guards pass on the real source ────
console.log('\nv37 item 1 — the page can never be switched off, and every open is fresh');
const pageTag = pageScrollerTagOf(editorSource);
assert(pageTag !== null, 'the editor HAS a page scroller (style={styles.page})');
assert(
  pageTag !== null && pageTag.indexOf('scrollEnabled') < 0,
  'the page scroller carries no scrollEnabled prop at all',
);
assertEq(
  editorPageScrollerIsNeverSwitchedOff(editorSource),
  true,
  'the page scroller is a bounded, nested-scroll box with the session key and no scroll flag',
);
assertEq(
  editorOpensAFreshPageScroller(editorSource),
  true,
  `the page is keyed on ${EDITOR_PAGE_KEY} and the session is bumped inside if (opened)`,
);
assertEq(
  everyEditorScoreIsNonInteractive(editorSource),
  true,
  'every <AbcScoreView> and <TakeStaffCard> in the editor says interactive={false}',
);
assertEq(
  historyDoorOpensTheEditorOutsideThePressEvent(historySource),
  true,
  'the History row opens the editor in requestAnimationFrame and still passes the row take + id',
);
// The re-pointed older guard must be green on the new contract, or the v34
// suite fails for a reason that is not a regression. (Its v36 twin
// `editorPageScrollsFromEverySurface` is re-pointed to the same shared helper but
// has an UNRELATED stale check of its own — it asserts a `styles.staffBox` with a
// numeric height that the editor no longer has — and no suite covers it; see the
// mutation probe notes, and the PR body.)
assertEq(
  editorDragLayerSharesScroll(editorSource),
  true,
  'v34 editorDragLayerSharesScroll passes on the v37 scroller contract (re-pointed)',
);

console.log('\nv37 item 2 — the score measures itself, the box grows, and the original comes back');
assertEq(
  scoreViewerReportsItsOwnHeight(abcViewSource),
  true,
  'AbcScoreView injects the probe, reads the message, and applies the height off the flex axis',
);
assertEq(
  notationEditorGrowsTheScoreBox(notationSource),
  true,
  'the notation editor passes onDocumentHeight, clamps through abcScoreContainerHeight and grows the box',
);
assertEq(
  notationEditorCanRevertToTheOriginalScore(notationSource),
  true,
  'the editor holds the loaded ABC at every load point and offers REVERT_ORIGINAL_LABEL',
);

// ── the pure rules ──────────────────────────────────────────────
console.log('\nv37 item 2 — scoreHeight (pure)');
assertEq(clampScoreHeight(0), null, 'a zero height is not a height');
assertEq(clampScoreHeight(-4), null, 'a negative height is not a height');
assertEq(clampScoreHeight('tall'), null, 'junk is not a height');
assertEq(clampScoreHeight(NaN), null, 'NaN is not a height');
assertEq(clampScoreHeight(12), ABC_SCORE_MIN_HEIGHT, 'a tiny document clamps UP to the floor');
assertEq(clampScoreHeight(300.6), 301, 'a real height is rounded, not truncated');
assertEq(clampScoreHeight(99999), ABC_SCORE_MAX_HEIGHT, 'a runaway document clamps to the ceiling');

assertEq(abcHeightFromMessage(''), null, 'an empty message is not a height report');
assertEq(abcHeightFromMessage('not json'), null, 'a non-JSON message is not a height report');
assertEq(
  abcHeightFromMessage(JSON.stringify({ type: 'something-else', height: 300 })),
  null,
  'a foreign message type is ignored',
);
assertEq(
  abcHeightFromMessage(JSON.stringify({ type: ABC_HEIGHT_MESSAGE_TYPE, height: 'tall' })),
  null,
  'a height report with a non-numeric height is ignored',
);
assertEq(
  abcHeightFromMessage(JSON.stringify({ type: ABC_HEIGHT_MESSAGE_TYPE })),
  null,
  'a height report with no height is ignored',
);
assertEq(
  abcHeightFromMessage(JSON.stringify({ type: ABC_HEIGHT_MESSAGE_TYPE, height: 0 })),
  null,
  'a zero height is not applied',
);
assertEq(
  abcHeightFromMessage(JSON.stringify({ type: ABC_HEIGHT_MESSAGE_TYPE, height: 480 })),
  480,
  'a real height report is read',
);
assertEq(
  abcHeightFromMessage(JSON.stringify({ type: ABC_HEIGHT_MESSAGE_TYPE, height: 99999 })),
  ABC_SCORE_MAX_HEIGHT,
  'a runaway reported height is clamped before it can grow the page',
);
assertEq(
  abcHeightFromMessage('x'.repeat(401)),
  null,
  'an absurdly long message is refused unparsed',
);

assertEq(
  abcScoreContainerHeight({ interactive: true, measuredHeight: 800 }),
  null,
  'an INTERACTIVE viewer keeps the box its caller gave it',
);
assertEq(
  abcScoreContainerHeight({ interactive: false, measuredHeight: null }),
  null,
  'a viewer that has not reported yet keeps its current layout',
);
assertEq(
  abcScoreContainerHeight({ interactive: false, measuredHeight: 512 }),
  512,
  'a decorative viewer takes the measured height',
);
assertEq(
  abcScoreContainerHeight({ interactive: false, measuredHeight: 5 }),
  ABC_SCORE_MIN_HEIGHT,
  'a decorative viewer never collapses below the floor',
);

const probe = abcHeightProbeScript();
assert(probe.indexOf(ABC_HEIGHT_MESSAGE_TYPE) >= 0, 'the probe posts the height message type');
assert(probe.indexOf('ReactNativeWebView.postMessage') >= 0, 'the probe posts through the WebView bridge');
assert(probe.indexOf('ResizeObserver') >= 0, 'the probe re-measures when the document resizes');
assert(probe.indexOf('${') < 0, 'the probe itself contains no template expression (it is embedded verbatim)');

console.log('\nv37 item 2 — originalScorePlan (pure)');
assertEq(REVERT_ORIGINAL_LABEL.length > 3, true, `the revert control is labelled "${REVERT_ORIGINAL_LABEL}"`);
assert(REVERT_ORIGINAL_LABEL.indexOf('!') < 0, 'the revert label uses no urgency punctuation');

const untouched = originalScorePlan('X:1\nK:C\nC D E F|', 'X:1\nK:C\nC D E F|', 0);
assertEq(untouched.canRevert, false, 'nothing has changed → reverting is inert');
assertEq(untouched.offset, 0, 'an inert plan still names offset 0');
assertEq(untouched.abc, 'X:1\nK:C\nC D E F|', 'an inert plan still names the loaded ABC');

const transposed = originalScorePlan('X:1\nK:C\nC D E F|', 'X:1\nK:D\nD E F# G|', 2);
assertEq(transposed.canRevert, true, 'a transposed score can be reverted');
assertEq(transposed.offset, 0, 'reverting returns the offset to 0');
assertEq(transposed.abc, 'X:1\nK:C\nC D E F|', 'reverting returns the LOADED ABC verbatim');

const revertedTwice = originalScorePlan('X:1\nK:C\nC D E F|', 'X:1\nK:C\nC D E F|', 5);
assertEq(revertedTwice.canRevert, true, 'a changed offset alone is enough to revert');
assertEq(revertedTwice.abc, 'X:1\nK:C\nC D E F|', 'reverting restores the loaded ABC, not the transposed one');

const nothingLoaded = originalScorePlan('', '', 0);
assertEq(nothingLoaded.canRevert, false, 'with nothing loaded there is nothing to revert to');
assertEq(nothingLoaded.abc, '', 'with nothing loaded the plan cannot invent an ABC');

const emptySource = originalScorePlan('', 'X:1\nK:G\nG A B c|', 3);
assertEq(emptySource.canRevert, true, 'a changed offset with no held source is still revertible');
assertEq(
  emptySource.abc,
  'X:1\nK:G\nG A B c|',
  'a missing held source falls back to the shown ABC — reverting can never blank the staff',
);
assertEq(emptySource.offset, 0, 'the fallback still returns the offset to 0');

// ── PRE-FIX FIXTURES: every guard must return FALSE on the old shape ──
console.log('\nv37 — the pre-fix fixtures (the v36 shapes) are refused');
const v36Scroller = editorSource.replace(
  EDITOR_PAGE_KEY,
  'scrollEnabled={pageScrollEnabledDuringDrag(dragging)}',
);
assert(v36Scroller !== editorSource, 'the v36-scroller fixture changed the real editor');
assertEq(
  editorPageScrollerIsNeverSwitchedOff(v36Scroller),
  false,
  'PRE-FIX: the v36 flag on the page scroller FAILS editorPageScrollerIsNeverSwitchedOff',
);
assertEq(
  editorOpensAFreshPageScroller(v36Scroller),
  false,
  'PRE-FIX: a scroller with no session key FAILS editorOpensAFreshPageScroller',
);
assertEq(
  editorDragLayerSharesScroll(v36Scroller),
  false,
  'PRE-FIX: the same shape FAILS the re-pointed v34 editorDragLayerSharesScroll',
);
assertEq(
  editorPageScrollsFromEverySurface(v36Scroller),
  false,
  'PRE-FIX: the same shape FAILS the re-pointed v36 editorPageScrollsFromEverySurface',
);

const interactiveScore = editorSource.replace(
  pageScrollerTagOf(editorSource) as string,
  'PLACEHOLDER',
);
assert(interactiveScore !== editorSource, 'the placeholder fixture changed the real editor');
assertEq(
  editorPageScrollerIsNeverSwitchedOff(interactiveScore),
  false,
  'PRE-FIX: an editor with no page scroller at all FAILS (never vacuously true)',
);

const v36HistoryDoor = historySource.replace(
  'requestAnimationFrame(() => setEditTake(item))',
  'setEditTake(item)',
);
assert(v36HistoryDoor !== historySource, 'the v36-door fixture changed the real History screen');
assertEq(
  historyDoorOpensTheEditorOutsideThePressEvent(v36HistoryDoor),
  false,
  'PRE-FIX: the inline onPress(() => setEditTake(item)) door FAILS historyDoorOpensTheEditorOutsideThePressEvent',
);

const v36Viewer = abcViewSource
  .replace("from '../services/scoreHeight'", "from '../services/scoreWhatever'")
  .replace('${abcHeightProbeScript()}', '')
  .replace('        onMessage={handleMessage}', '');
assert(v36Viewer !== abcViewSource, 'the v36-viewer fixture changed the real score view');
assertEq(
  scoreViewerReportsItsOwnHeight(v36Viewer),
  false,
  'PRE-FIX: a viewer that neither injects the probe nor reads a message FAILS scoreViewerReportsItsOwnHeight',
);

const v36Notation = notationSource
  .replace(' onDocumentHeight={handleDocumentHeight}', '')
  .replace(/scoreHeight !== null && \{[\s\S]*?\},/, '');
assert(v36Notation !== notationSource, 'the v36-notation fixture changed the real notation editor');
assertEq(
  notationEditorGrowsTheScoreBox(v36Notation),
  false,
  'PRE-FIX: a notation editor that ignores the measurement FAILS notationEditorGrowsTheScoreBox',
);

const v36Revert = notationSource
  .replace(/setSourceAbc\(/g, 'setLoadedAbc(')
  .replace('abc: plan.abc', 'abc: current.abc');
assert(v36Revert !== notationSource, 'the v36-revert fixture changed the real notation editor');
assertEq(
  notationEditorCanRevertToTheOriginalScore(v36Revert),
  false,
  'PRE-FIX: an editor with no held ABC and no restore FAILS notationEditorCanRevertToTheOriginalScore',
);

// ── MUTATIONS: each guard must FAIL on the mutated real source ──
console.log('\nv37 — MUTATION PROBES (each guard must bite)');

// MUTATION 1: the page scroller gets a scroll flag back (v36's constant shape).
const flagBack = editorSource.replace(
  pageScrollerTagOf(editorSource) as string,
  (pageScrollerTagOf(editorSource) as string).replace(
    '<ScrollView',
    '<ScrollView\n          scrollEnabled={pageScrollEnabledDuringDrag(dragging)}',
  ),
);
assert(flagBack !== editorSource, 'mutation 1 changed the real editor');
assertEq(
  editorPageScrollerIsNeverSwitchedOff(flagBack),
  false,
  'MUTATION: a scroll flag on the page scroller FAILS editorPageScrollerIsNeverSwitchedOff',
);

// MUTATION 2: the session key goes (the scroller is reused across sessions).
const noKey = editorSource.replace(EDITOR_PAGE_KEY, 'key="editor-page"');
assert(noKey !== editorSource, 'mutation 2 changed the real editor');
assertEq(
  editorOpensAFreshPageScroller(noKey),
  false,
  'MUTATION: a page scroller that is NOT remounted per session FAILS editorOpensAFreshPageScroller',
);

// MUTATION 3: the session is bumped somewhere other than the open edge.
const offEdgeBump = editorSource.replace(
  'if (opened) setPageSession((session) => session + 1);',
  'setPageSession((session) => session + 1);',
);
assert(offEdgeBump !== editorSource, 'mutation 3 changed the real editor');
assertEq(
  editorOpensAFreshPageScroller(offEdgeBump),
  false,
  'MUTATION: a session bumped on EVERY render FAILS editorOpensAFreshPageScroller',
);

// MUTATION 4: the staff goes back to taking the page's scroll gesture.
const scoreOpen = editorSource.indexOf('<AbcScoreView');
const scoreTag = editorSource.slice(scoreOpen, editorSource.indexOf('/>', scoreOpen) + 2);
const interactiveAgain = editorSource.replace(
  scoreTag,
  scoreTag.replace('interactive={false}', 'interactive'),
);
assert(interactiveAgain !== editorSource, 'mutation 4 changed the real editor');
assertEq(
  everyEditorScoreIsNonInteractive(interactiveAgain),
  false,
  'MUTATION: an interactive <AbcScoreView> in the editor FAILS everyEditorScoreIsNonInteractive',
);

// MUTATION 5: the History door opens the editor inside the press event again.
const inlineDoor = historySource.replace(
  'requestAnimationFrame(() => setEditTake(item))',
  'setEditTake(item)',
);
assert(inlineDoor !== historySource, 'mutation 5 changed the real History screen');
assertEq(
  historyDoorOpensTheEditorOutsideThePressEvent(inlineDoor),
  false,
  'MUTATION: an editor opened inside the press event FAILS historyDoorOpensTheEditorOutsideThePressEvent',
);

// MUTATION 6: the History door defers, but forgets which row it opened.
const anonymousDoor = historySource.replace('rowId={editTake.id}', 'rowId={null}');
assert(anonymousDoor !== historySource, 'mutation 6 changed the real History screen');
assertEq(
  historyDoorOpensTheEditorOutsideThePressEvent(anonymousDoor),
  false,
  'MUTATION: a deferred open that loses the row id FAILS historyDoorOpensTheEditorOutsideThePressEvent',
);

// MUTATION 7: the viewer stops injecting the measuring probe.
const noProbe = abcViewSource.replace('${abcHeightProbeScript()}', '');
assert(noProbe !== abcViewSource, 'mutation 7 changed the real score view');
assertEq(
  scoreViewerReportsItsOwnHeight(noProbe),
  false,
  'MUTATION: a viewer whose document never measures itself FAILS scoreViewerReportsItsOwnHeight',
);

// MUTATION 8: the viewer applies a height but stays on the flex axis (nothing grows).
const stillFlexed = abcViewSource.replace(
  '{ flex: 0, height: appliedHeight }',
  '{ height: appliedHeight }',
);
assert(stillFlexed !== abcViewSource, 'mutation 8 changed the real score view');
assertEq(
  scoreViewerReportsItsOwnHeight(stillFlexed),
  false,
  'MUTATION: a height applied without leaving the flex axis FAILS scoreViewerReportsItsOwnHeight',
);

// MUTATION 9: the viewer guesses at the message instead of parsing it.
const guessed = abcViewSource.replace(
  'abcHeightFromMessage(event.nativeEvent.data)',
  'Number(event.nativeEvent.data)',
);
assert(guessed !== abcViewSource, 'mutation 9 changed the real score view');
assertEq(
  scoreViewerReportsItsOwnHeight(guessed),
  false,
  'MUTATION: a viewer that parses the message inline FAILS scoreViewerReportsItsOwnHeight',
);

// MUTATION 10: the editor ignores the measurement (the box stays a fixed floor).
const deafNotation = notationSource.replace(' onDocumentHeight={handleDocumentHeight}', '');
assert(deafNotation !== notationSource, 'mutation 10 changed the real notation editor');
assertEq(
  notationEditorGrowsTheScoreBox(deafNotation),
  false,
  'MUTATION: an editor that never receives the height FAILS notationEditorGrowsTheScoreBox',
);

// MUTATION 11: the editor stops growing the box (minHeight override goes).
const fixedBox = notationSource.replace(/minHeight:\s*Math\.max\([^)]*\)/, 'minHeight: 240');
assert(fixedBox !== notationSource, 'mutation 11 changed the real notation editor');
assertEq(
  notationEditorGrowsTheScoreBox(fixedBox),
  false,
  'MUTATION: a fixed-height score box (the ~4-bar shape) FAILS notationEditorGrowsTheScoreBox',
);

// MUTATION 12: the score element goes (a guard that passes because the tag is
// missing would be vacuous).
const noScoreElement = notationSource.replace(/<AbcScoreView[\s\S]*?\/>/, '<View />');
assert(noScoreElement !== notationSource, 'mutation 12 changed the real notation editor');
assertEq(
  notationEditorGrowsTheScoreBox(noScoreElement),
  false,
  'MUTATION: a notation editor with no score element FAILS notationEditorGrowsTheScoreBox',
);

// MUTATION 13: revert restores the OFFSET but not the SCORE (the dishonest half).
const offsetOnly = notationSource.replace('abc: plan.abc', 'abc: current.abc');
assert(offsetOnly !== notationSource, 'mutation 13 changed the real notation editor');
assertEq(
  notationEditorCanRevertToTheOriginalScore(offsetOnly),
  false,
  'MUTATION: a revert that does not restore the loaded ABC FAILS notationEditorCanRevertToTheOriginalScore',
);

// MUTATION 14: two load points forget to hold the ABC they loaded (the picker
// path and the requested-piece path) — reverting would then reach the wrong text.
const missingLoadPoint = notationSource
  .replace('setSourceAbc(found.abc);', '')
  .replace('setSourceAbc(p.abc);', '');
assert(missingLoadPoint !== notationSource, 'mutation 14 changed the real notation editor');
assertEq(
  notationEditorCanRevertToTheOriginalScore(missingLoadPoint),
  false,
  'MUTATION: an editor that holds the ABC at only two of three load points FAILS notationEditorCanRevertToTheOriginalScore',
);

// ── the guards are not vacuous ──────────────────────────────────
console.log('\nv37 — the guards are not vacuous');
assertEq(pageScrollerTagOf(''), null, 'an empty source has no page scroller');
assertEq(editorPageScrollerIsNeverSwitchedOff(''), false, 'an empty editor switches nothing off');
assertEq(editorPageScrollerIsNeverSwitchedOff('const x = 1;'), false, 'a tiny source has no scroller');
assertEq(editorOpensAFreshPageScroller(''), false, 'an empty editor remounts nothing');
assertEq(everyEditorScoreIsNonInteractive(''), false, 'an empty editor has no score to shield');
assertEq(
  historyDoorOpensTheEditorOutsideThePressEvent(''),
  false,
  'an empty History screen opens no editor',
);
assertEq(scoreViewerReportsItsOwnHeight(''), false, 'an empty viewer reports no height');
assertEq(notationEditorGrowsTheScoreBox(''), false, 'an empty notation editor grows no box');
assertEq(
  notationEditorCanRevertToTheOriginalScore(''),
  false,
  'an empty notation editor reverts nothing',
);

// The v34/v36 guards must still refuse their own old shapes (their suites do the
// same thing, but a re-point that made them vacuous would otherwise pass twice).
assertEq(
  editorDragLayerSharesScroll(''),
  false,
  'the re-pointed v34 guard still refuses an empty editor',
);
assertEq(
  editorPageScrollsFromEverySurface(''),
  false,
  'the re-pointed v36 guard still refuses an empty editor',
);

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
