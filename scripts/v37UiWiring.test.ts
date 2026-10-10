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
  LIBRARY_STORE_PATH,
  PIECE_LIBRARY_SAVE_PATH,
  SAVE_TO_LIBRARY_COMPONENT_PATH,
  coverScanGetThisSongReachesTheMoneyPath,
  coverScanResultOffersTheWayForward,
  editorOpensAFreshPageScroller,
  editorPageScrollerIsNeverSwitchedOff,
  everyEditorScoreIsNonInteractive,
  historyDoorOpensTheEditorOutsideThePressEvent,
  midiExportIsValidatedBeforeSharing,
  notationEditorCanRevertToTheOriginalScore,
  notationEditorGrowsTheScoreBox,
  pageScrollerTagOf,
  pdResultCardOffersSaveToLibrary,
  piecePageOffersSaveToLibrary,
  saveToLibraryWritesThroughTheExistingStore,
  scoreViewerReportsItsOwnHeight,
  takeEditorCanSendTheTakeOffDevice,
} from '../src/services/v37UiContract';
// The pure halves of items 4–6 (v37 batch, owner 10-09).
import {
  SAVED_TO_LIBRARY_LABEL,
  SAVE_TO_LIBRARY_LABEL,
  isSaveableScoreUrl,
  libraryScoreFileName,
  saveToLibraryIsBusy,
  saveToLibraryLabel,
  scoreFileExtension,
} from '../src/services/librarySaveModel';
import { GET_THIS_SONG_CTA, coverScanResultActions } from '../src/services/coverScan';
import { MIDI_HEADER_BYTES, MIDI_EXPORT_LABEL, encodeMidiFile } from '../src/services/midiExport';
import { parseMidiStructure, validateMidiStructure } from '../src/services/midiStructure';
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
// Items 4–6 of the same batch read these real files.
const RESULT_SURFACE = 'src/components/RecognitionResultView.tsx';
const PIECE_PAGE = 'src/screens/PieceDetailScreen.tsx';
const SCAN_MODAL = 'src/components/CoverScanModal.tsx';
const FIND_PIECE = 'src/screens/FindPieceScreen.tsx';
const MIDI_DEVICE_EXPORT = 'src/services/captureMidiExport.ts';

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

// ══════════════════════════════════════════════════════════════════════════════
// ITEMS 4–6 OF THE v37 BATCH (owner-approved 10-09)
//   item 4 — PD save-to-library (d9d458bb)     item 5 — cover-scan result actions
//   (bce8f6f2)                                 item 6 — MIDI structure + share
//   (d2e9e2c5)
// Same rule as items 1–3: every guard reads the REAL file, and every guard is
// shown to BITE on a mutated copy of it.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nv37 items 4–6 — the live files');
const saveComponentSource = readAppFile(SAVE_TO_LIBRARY_COMPONENT_PATH);
const saveServiceSource = readAppFile(PIECE_LIBRARY_SAVE_PATH);
const libraryStoreSource = readAppFile(LIBRARY_STORE_PATH);
const resultSurfaceSource = readAppFile(RESULT_SURFACE);
const piecePageSource = readAppFile(PIECE_PAGE);
const scanModalSource = readAppFile(SCAN_MODAL);
const findPieceSource = readAppFile(FIND_PIECE);
const midiDeviceExportSource = readAppFile(MIDI_DEVICE_EXPORT);
assert(
  saveComponentSource.length > 1500,
  `read ${SAVE_TO_LIBRARY_COMPONENT_PATH} (${saveComponentSource.length} chars)`,
);
assert(
  saveServiceSource.length > 1000,
  `read ${PIECE_LIBRARY_SAVE_PATH} (${saveServiceSource.length} chars)`,
);
assert(
  libraryStoreSource.length > 3000,
  `read ${LIBRARY_STORE_PATH} (${libraryStoreSource.length} chars)`,
);
assert(resultSurfaceSource.length > 20000, `read ${RESULT_SURFACE}`);
assert(piecePageSource.length > 8000, `read ${PIECE_PAGE}`);
assert(scanModalSource.length > 3000, `read ${SCAN_MODAL}`);
assert(findPieceSource.length > 8000, `read ${FIND_PIECE}`);
assert(midiDeviceExportSource.length > 3000, `read ${MIDI_DEVICE_EXPORT}`);

console.log('\nv37 item 4 — PD save-to-library, through the EXISTING store');
assertEq(
  saveToLibraryWritesThroughTheExistingStore(saveComponentSource, saveServiceSource),
  true,
  'the save action is wired and writes through the existing library store',
);
assertEq(
  pdResultCardOffersSaveToLibrary(resultSurfaceSource),
  true,
  'the PD result card renders the save action with the hosted score',
);
assertEq(
  piecePageOffersSaveToLibrary(piecePageSource),
  true,
  'the PD piece page renders the save action with the hosted score',
);
// The store's own write path is what the save uses — the same call the picker's
// import screen makes, now carrying the piece id.
assert(
  libraryStoreSource.indexOf('export async function importDocumentAsset(') >= 0,
  'the store still exposes the one import write path the save reuses',
);
assert(
  libraryStoreSource.indexOf('sourcePieceId: meta.sourcePieceId') >= 0,
  'the store records the catalog piece id on a saved row',
);
assert(
  libraryStoreSource.indexOf('viewerSheetUrl') < 0 &&
    libraryStoreSource.indexOf('export async function createScannedScore(') >= 0,
  'the scan write path item 5 reuses is still in the same store',
);

console.log('\nv37 item 5 — the scan result always has a way forward');
assertEq(
  coverScanResultOffersTheWayForward(scanModalSource),
  true,
  'the cover-scan result offers save + Get this Song',
);
assertEq(
  coverScanGetThisSongReachesTheMoneyPath(findPieceSource),
  true,
  'Get this Song reaches the existing affiliate builder and in-app shell',
);

console.log('\nv37 item 6 — the .mid is validated, and it can leave the device');
assertEq(
  midiExportIsValidatedBeforeSharing(midiDeviceExportSource),
  true,
  'the device export structurally validates the file before it writes/shares',
);
assertEq(
  takeEditorCanSendTheTakeOffDevice(editorSource),
  true,
  'Correct-your-Take sends the corrected take to the system share sheet',
);

console.log('\nv37 items 4–6 — the pure rules');
assertEq(
  saveToLibraryLabel('idle'),
  SAVE_TO_LIBRARY_LABEL,
  'the save label is the explicit action by default',
);
assertEq(
  saveToLibraryLabel('saved'),
  SAVED_TO_LIBRARY_LABEL,
  'the saved state has its own label (no fake idle)',
);
assertEq(saveToLibraryLabel(undefined), SAVE_TO_LIBRARY_LABEL, 'a missing state is the idle label');
assertEq(saveToLibraryIsBusy('saving'), true, 'a running save cannot fire twice');
assertEq(saveToLibraryIsBusy('saved'), true, 'a saved piece cannot be saved twice');
assertEq(saveToLibraryIsBusy('error'), false, 'a failed save stays actionable');
assertEq(
  libraryScoreFileName('Für Elise', 'Ludwig van Beethoven', 'https://x/api/sheets/9'),
  'Für Elise - Ludwig van Beethoven.pdf',
  'the saved file is titled after the piece and keeps a real extension',
);
assertEq(libraryScoreFileName('', null, null), 'notesnap-score.pdf', 'a blank title never names nothing');
assertEq(scoreFileExtension('https://x/scores/a.musicxml?v=2'), 'musicxml', 'the extension comes from the path');
assertEq(scoreFileExtension('https://x/api/sheets/9'), 'pdf', 'a proxied score with no extension is a PDF');
assertEq(scoreFileExtension(null), 'pdf', 'no URL still yields a saveable extension');
assertEq(isSaveableScoreUrl(''), false, 'an empty URL is not saveable');
assertEq(isSaveableScoreUrl('not-a-url'), false, 'a non-URL is not saveable');
assertEq(isSaveableScoreUrl('https://site.example/api/sheets/9'), true, 'a hosted score is saveable');

// The no-dead-end rule, as a pure property of every scan state: with the photo in
// hand there is ALWAYS something to do (which is exactly what the owner could not
// do after a read that came back with nothing usable).
for (const status of ['ready', 'no-text', 'no-ocr', 'ocr-failed'] as const) {
  const empty = coverScanResultActions({ status, query: '', hasPhoto: true });
  assert(empty.hasWayForward, `a ${status} scan with nothing read is never a dead end`);
  assert(empty.canSave, `a ${status} scan can always be saved to the library`);
}
assertEq(
  coverScanResultActions({ status: 'ready', query: 'Für Elise', hasPhoto: true }).canGetThisSong,
  true,
  'a read title reaches the money path',
);
assertEq(
  coverScanResultActions({ status: 'ready', query: 'Für Elise' }).getThisSongLabel,
  GET_THIS_SONG_CTA,
  'the money CTA is labelled from the model',
);
assertEq(
  coverScanResultActions({ status: 'ready', query: 'x', canGetThisSong: false }).getThisSongLabel,
  null,
  'a host with no retailer route gets no money CTA',
);
assertEq(
  coverScanResultActions({ status: 'no-text', query: '' }).canSearch,
  false,
  'the dead-end state really is the state the fix targets (nothing readable)',
);
// Null-safe: a mutated caller must not be able to crash the suite.
assertEq(coverScanResultActions(undefined).hasWayForward, true, 'a missing input is still resolvable');
assertEq(coverScanResultActions(null).canSave, true, 'a null input is still resolvable');

console.log('\nv37 item 6 — the encoder’s OWN output parses (structural)');
const takeBytes =
  encodeMidiFile({
    notes: [
      { midi: 60, startSec: 0, durationSec: 0.5, velocity: 90 },
      { midi: 64, startSec: 0.5, durationSec: 0.5, velocity: 90 },
      { midi: 67, startSec: 1, durationSec: 0.5, velocity: 90 },
    ],
    title: 'Structural test take',
  }) ?? new Uint8Array(0);
assert(takeBytes.length > MIDI_HEADER_BYTES, 'the encoder wrote a file with a header and tracks');
const structure = parseMidiStructure(takeBytes);
assert(structure.ok, `the exported .mid parses cleanly (${structure.errors.join('; ')})`);
assertEq(structure.format, 1, 'the file is a Type 1 (multi-track) SMF');
assertEq(structure.tracks.length, 3, 'conductor + melody + reserved chord track are all there');
assertEq(structure.declaredTrackCount, structure.tracks.length, 'the header count matches the chunks');
assertEq(structure.ticksPerQuarter, 480, 'the division is the app’s own ticks-per-quarter');
assertEq(structure.tracks[1].noteOns, 3, 'every note of the take got a note-on');
assertEq(structure.tracks[1].noteOffs, 3, 'every note of the take got a note-off');
assertEq(structure.tracks[1].unpairedNotes, 0, 'no note is left hanging (a stuck note in every DAW)');
assert(
  structure.tracks.every((track) => track.hasEndOfTrack),
  'every track ends with the end-of-track event',
);
assertEq(structure.consumedBytes, takeBytes.length, 'the walk consumed exactly the file');
assertEq(validateMidiStructure(takeBytes).ok, true, 'validateMidiStructure agrees with the parse');

// …and the validator BITES on real structural damage (the whole point: a broken
// export would otherwise cost the owner a round trip to a desktop).
const badMagic = Uint8Array.from(takeBytes);
badMagic[0] = 0x58;
assertEq(validateMidiStructure(badMagic).ok, false, 'a header that is not "MThd" fails the check');
const truncated = takeBytes.slice(0, 30);
assertEq(validateMidiStructure(truncated).ok, false, 'a truncated file fails the check');
const overrun = Uint8Array.from(takeBytes);
overrun[18] = 0xff;
overrun[19] = 0xff;
overrun[20] = 0xff;
overrun[21] = 0xff;
assertEq(validateMidiStructure(overrun).ok, false, 'a track that overruns the file fails the check');
// A hand-built track whose note-on never gets a note-off: the pairing rule, on
// bytes no encoder of ours would produce.
const unpairedNote = Uint8Array.from([
  0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
  0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x08,
  0x00, 0x90, 0x3c, 0x40,
  0x00, 0xff, 0x2f, 0x00,
]);
const unpairedReport = parseMidiStructure(unpairedNote);
assertEq(unpairedReport.ok, false, 'a file with a note-on and no note-off fails the check');
assertEq(unpairedReport.tracks[0].unpairedNotes, 1, 'the unpaired note is the one that is reported');
assertEq(validateMidiStructure(null).ok, false, 'a null file is a failure, not a crash');
assertEq(validateMidiStructure(new Uint8Array(0)).ok, false, 'an empty file is a failure, not a crash');

console.log('\nv37 items 4–6 — MUTATION PROBES (each guard must bite)');

// MUTATION 15 (item 4): the save component stops refusing a piece with no score —
// it would render a button that can only fail.
const noUrlGate = saveComponentSource.replace(
  'if (!isSaveableScoreUrl(scoreUrl)) return null;',
  'if (false) return null;',
);
assert(noUrlGate !== saveComponentSource, 'mutation 15 changed the save component');
assertEq(
  saveToLibraryWritesThroughTheExistingStore(noUrlGate, saveServiceSource),
  false,
  'MUTATION: a save action with no URL gate FAILS saveToLibraryWritesThroughTheExistingStore',
);

// MUTATION 16 (item 4): the save writes its OWN registry (a second library).
const ownRegistry = saveServiceSource.replace(
  "import * as FileSystem from 'expo-file-system';",
  "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport * as FileSystem from 'expo-file-system';",
);
assert(ownRegistry !== saveServiceSource, 'mutation 16 changed the save service');
assertEq(
  saveToLibraryWritesThroughTheExistingStore(saveComponentSource, ownRegistry),
  false,
  'MUTATION: a save that keeps its own registry FAILS saveToLibraryWritesThroughTheExistingStore',
);

// MUTATION 17 (item 4): the save stops going through the store's write path.
const ownWrite = saveServiceSource.replace('importDocumentAsset(', 'persistOwnCopy(');
assert(ownWrite !== saveServiceSource, 'mutation 17 changed the save service');
assertEq(
  saveToLibraryWritesThroughTheExistingStore(saveComponentSource, ownWrite),
  false,
  'MUTATION: a save that bypasses importDocumentAsset FAILS saveToLibraryWritesThroughTheExistingStore',
);

// MUTATION 18 (item 4): the PD result card loses the action entirely.
const cardWithoutSave = resultSurfaceSource.replace('<SaveToLibraryButton', '<ScoreAction');
assert(cardWithoutSave !== resultSurfaceSource, 'mutation 18 changed the result surface');
assertEq(
  pdResultCardOffersSaveToLibrary(cardWithoutSave),
  false,
  'MUTATION: a result card with no save action FAILS pdResultCardOffersSaveToLibrary',
);

// MUTATION 19 (item 4): the card saves nothing (it is handed no hosted score).
const cardWithoutScore = resultSurfaceSource.replace(
  'scoreUrl={inlineSheetUrl}',
  'scoreUrl={null}',
);
assert(cardWithoutScore !== resultSurfaceSource, 'mutation 19 changed the result surface');
assertEq(
  pdResultCardOffersSaveToLibrary(cardWithoutScore),
  false,
  'MUTATION: a result card that saves no score FAILS pdResultCardOffersSaveToLibrary',
);

// MUTATION 20 (item 4): the piece page loses the action.
const pageWithoutSave = piecePageSource.replace('<SaveToLibraryButton', '<ScoreAction');
assert(pageWithoutSave !== piecePageSource, 'mutation 20 changed the piece page');
assertEq(
  piecePageOffersSaveToLibrary(pageWithoutSave),
  false,
  'MUTATION: a piece page with no save action FAILS piecePageOffersSaveToLibrary',
);

// MUTATION 21 (item 5): the scan result loses the save action (the dead end is back).
const scanWithoutSave = scanModalSource.replace(/resultActions\.canSave/g, 'false');
assert(scanWithoutSave !== scanModalSource, 'mutation 21 changed the scan modal');
assertEq(
  coverScanResultOffersTheWayForward(scanWithoutSave),
  false,
  'MUTATION: a scan result with no save action FAILS coverScanResultOffersTheWayForward',
);

// MUTATION 22 (item 5): the scan result loses the money CTA.
const scanWithoutMoney = scanModalSource.replace(
  /resultActions\.canGetThisSong/g,
  'false',
);
assert(scanWithoutMoney !== scanModalSource, 'mutation 22 changed the scan modal');
assertEq(
  coverScanResultOffersTheWayForward(scanWithoutMoney),
  false,
  'MUTATION: a scan result with no Get-this-Song FAILS coverScanResultOffersTheWayForward',
);

// MUTATION 23 (item 5): the save stops using the library store's scan path.
const scanOwnStore = scanModalSource.replace('createScannedScore(', 'keepThisScanLocally(');
assert(scanOwnStore !== scanModalSource, 'mutation 23 changed the scan modal');
assertEq(
  coverScanResultOffersTheWayForward(scanOwnStore),
  false,
  'MUTATION: a scan save that bypasses the library store FAILS coverScanResultOffersTheWayForward',
);

// MUTATION 24 (item 5): the modal starts building its own retailer URL.
const scanOwnUrl = scanModalSource.replace(
  'const getThisSong = useCallback(() => {',
  "const getThisSong = useCallback(() => {\n    const own = 'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=x';\n    void own;",
);
assert(scanOwnUrl !== scanModalSource, 'mutation 24 changed the scan modal');
assertEq(
  coverScanResultOffersTheWayForward(scanOwnUrl),
  false,
  'MUTATION: a scan surface hand-writing a retailer URL FAILS coverScanResultOffersTheWayForward',
);

// MUTATION 25 (item 5): the host hand-writes the affiliate URL instead of using
// the ONE builder.
const handWrittenUrl = findPieceSource.replace(
  'sheetMusicDirectSearchUrl(text)',
  "'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=' + text",
);
assert(handWrittenUrl !== findPieceSource, 'mutation 25 changed the find-a-piece screen');
assertEq(
  coverScanGetThisSongReachesTheMoneyPath(handWrittenUrl),
  false,
  'MUTATION: a hand-written affiliate URL FAILS coverScanGetThisSongReachesTheMoneyPath',
);

// MUTATION 26 (item 5): the money path opens outside the app shell.
const outsideShell = findPieceSource.replace(
  'handleOpenRetailer(url)',
  'Linking.openURL(url)',
);
assert(outsideShell !== findPieceSource, 'mutation 26 changed the find-a-piece screen');
assertEq(
  coverScanGetThisSongReachesTheMoneyPath(outsideShell),
  false,
  'MUTATION: a Get-this-Song that leaves the in-app shell FAILS coverScanGetThisSongReachesTheMoneyPath',
);

// MUTATION 27 (item 5): the CTA is never handed to the modal (an unwired button).
const unwiredCta = findPieceSource.replace(
  'onGetThisSong={handleCoverGetThisSong}',
  'onGetThisSong={handleSomethingElse}',
);
assert(unwiredCta !== findPieceSource, 'mutation 27 changed the find-a-piece screen');
assertEq(
  coverScanGetThisSongReachesTheMoneyPath(unwiredCta),
  false,
  'MUTATION: an unwired Get-this-Song FAILS coverScanGetThisSongReachesTheMoneyPath',
);

// MUTATION 28 (item 6): the export skips the structural check.
const unvalidated = midiDeviceExportSource.replace(
  'const structure = validateMidiStructure(bytes);',
  'const structure = { ok: true, errors: [] };',
);
assert(unvalidated !== midiDeviceExportSource, 'mutation 28 changed the device export');
assertEq(
  midiExportIsValidatedBeforeSharing(unvalidated),
  false,
  'MUTATION: an export that never validates its bytes FAILS midiExportIsValidatedBeforeSharing',
);

// MUTATION 29 (item 6): the check is swallowed (an invalid file is shared anyway).
const swallowedCheck = midiDeviceExportSource.replace(
  'if (!structure.ok) {',
  'if (false) {',
);
assert(swallowedCheck !== midiDeviceExportSource, 'mutation 29 changed the device export');
assertEq(
  midiExportIsValidatedBeforeSharing(swallowedCheck),
  false,
  'MUTATION: an export that ignores its own verdict FAILS midiExportIsValidatedBeforeSharing',
);

// MUTATION 30 (item 6): Correct-your-Take loses the send-off.
const editorWithoutSend = editorSource.replace(
  'onPress={() => void shareTakeAsMidi()}',
  'onPress={() => undefined}',
);
assert(editorWithoutSend !== editorSource, 'mutation 30 changed the take editor');
assertEq(
  takeEditorCanSendTheTakeOffDevice(editorWithoutSend),
  false,
  'MUTATION: an editor with no send action FAILS takeEditorCanSendTheTakeOffDevice',
);

// MUTATION 31 (item 6): the editor sends something other than the corrected take.
const wrongTake = editorSource.replace(
  'exportCaptureMidiFromTake(derived.take,',
  'exportCaptureMidiFromTake(take ?? null,',
);
assert(wrongTake !== editorSource, 'mutation 31 changed the take editor');
assertEq(
  takeEditorCanSendTheTakeOffDevice(wrongTake),
  false,
  'MUTATION: an editor that exports the wrong take FAILS takeEditorCanSendTheTakeOffDevice',
);

// MUTATION 32 (item 6): the outcome is swallowed (the export reads as a dead button).
const swallowedOutcome = editorSource.replace('{midiLine ?', '{null ?');
assert(swallowedOutcome !== editorSource, 'mutation 32 changed the take editor');
assertEq(
  takeEditorCanSendTheTakeOffDevice(swallowedOutcome),
  false,
  'MUTATION: an editor that never shows the export outcome FAILS takeEditorCanSendTheTakeOffDevice',
);

// MUTATION 33 (item 6): the button is offered for a take that has no notes.
const ungatedSend = editorSource.replace(
  'derived.take && derived.take.notes.length > 0',
  'true',
);
assert(ungatedSend !== editorSource, 'mutation 33 changed the take editor');
assertEq(
  takeEditorCanSendTheTakeOffDevice(ungatedSend),
  false,
  'MUTATION: a send action that is not gated on the take FAILS takeEditorCanSendTheTakeOffDevice',
);

// ── the items 4–6 guards are not vacuous ────────────────────────
console.log('\nv37 items 4–6 — the guards are not vacuous');
assertEq(
  saveToLibraryWritesThroughTheExistingStore('', ''),
  false,
  'an empty pair of sources satisfies no save guard',
);
assertEq(pdResultCardOffersSaveToLibrary(''), false, 'an empty result surface offers no save');
assertEq(piecePageOffersSaveToLibrary(''), false, 'an empty piece page offers no save');
assertEq(coverScanResultOffersTheWayForward(''), false, 'an empty scan modal offers nothing');
assertEq(coverScanGetThisSongReachesTheMoneyPath(''), false, 'an empty search screen has no money path');
assertEq(midiExportIsValidatedBeforeSharing(''), false, 'an empty export validates nothing');
assertEq(takeEditorCanSendTheTakeOffDevice(''), false, 'an empty editor sends nothing');

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
