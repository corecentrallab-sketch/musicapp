/**
 * v33UiWiring.test.ts — tier1 gate for the v33 UI SLICES' WIRING.
 *
 * The v33 model layers are asserted by scripts/v33TakeEditor.test.ts; this suite
 * asserts the screens and components that USE them, by reading the real sources
 * (no emulator exists in this gate — the `musicapp-tier1-live-scan-suite`
 * pattern). Every scanner it calls is also run against a PRE-FIX fixture that
 * MUST fail, so a scanner that cannot fail cannot pass.
 *
 * slice B — the capture page is capture-only (no Save button, no match card, the
 *           ratified action bar, the miss behind its own explicit step).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  abcViewHasInkSeam,
  capturePageIsCaptureOnly,
  correctedTakeIsWhatExports,
  editorReachedFromBothDoors,
  editorSurfaceCorrectsEveryFact,
  editorWritesThroughOneSeam,
  humIsTheHerosSiblingCard,
  matchResultsAreOffThePage,
  previewEngineNeverRewritesTheTake,
  previewIsDockedInTheEditor,
  searchHasItsOwnDiscoverBand,
  staffCardDrawsBothRows,
  staffIsTheUsersOwnTake,
  takeActionBarWired,
} from '../src/services/v33UiContract';
import {
  CAPTURE_ONLY_CHIP_LABEL,
  CAPTURE_ONLY_LINE,
  CORRECT_TAKE_CTA,
  DONE_CTA,
  FIND_THIS_MELODY_CTA,
  RECORD_ANOTHER_CTA,
  SAVED_CHIP_LABEL,
  WHEN_YOU_STOP_ITEMS,
} from '../src/services/melodyCapture';
import { MIDI_EXPORT_LABEL } from '../src/services/midiExport';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
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

const WINDOW = 'src/components/MelodyCaptureWindow.tsx';
const FLOW = 'src/screens/HumSearchScreen.tsx';

const windowSource = readAppFile(WINDOW);
const flowSource = readAppFile(FLOW);

console.log('\nslice B — the capture page is CAPTURE-ONLY');
assert(windowSource.length > 8000, `read ${WINDOW} (${windowSource.length} chars)`);
assert(flowSource.length > 8000, `read ${FLOW} (${flowSource.length} chars)`);
assertEq(
  capturePageIsCaptureOnly(windowSource),
  true,
  'the real capture window is capture-only: chip, "When you stop", no Save button, the saved chip',
);
assertEq(
  takeActionBarWired(windowSource),
  true,
  'the real page carries the ratified action bar, in order, each control wired',
);
assertEq(
  matchResultsAreOffThePage(windowSource, flowSource),
  true,
  'no match surface renders on the page; the miss lives behind the explicit step',
);

// The copy itself: the capture-only rule is facts, not a promise.
assert(CAPTURE_ONLY_CHIP_LABEL.indexOf('CAPTURE') >= 0, 'the chip names the capture-only rule');
assert(
  /nothing is matched here/i.test(CAPTURE_ONLY_LINE),
  'the capture-only line says nothing is matched on this page',
);
assert(
  WHEN_YOU_STOP_ITEMS.some((line) => /saved to your history/i.test(line)),
  '"When you stop" states the auto-save (the chip is not the only place it is said)',
);
assert(
  WHEN_YOU_STOP_ITEMS.some((line) => /nothing is matched/i.test(line)),
  '"When you stop" states the no-matching rule',
);
assert(
  WHEN_YOU_STOP_ITEMS.every((line) => !/transcri/i.test(line) || /never a studio/i.test(line)),
  'no "When you stop" line claims a transcription',
);
assert(
  SAVED_CHIP_LABEL.toLowerCase().indexOf('history') >= 0,
  'the saved chip names where the take went (the user has to be told)',
);
assert(
  MIDI_EXPORT_LABEL.length > 0 && FIND_THIS_MELODY_CTA.length > 0 && DONE_CTA.length > 0,
  'the action bar copy exists in the modules the page renders',
);
assert(
  CORRECT_TAKE_CTA.indexOf('pitch') >= 0,
  'the editor door names what it corrects (pitch), not a vague "edit"',
);
assert(RECORD_ANOTHER_CTA.indexOf('Record another') >= 0, 'record-again stays (owner-confirmed)');

// ── MUTATION 1: the v32 page with its Save button and match card ──
const preFixPage = `onSave={handleSave} matchLine={matchLine} onOpenMatch={handlers}
  <Text>{SAVE_MELODY_CTA}</Text><Text>{matchLine}</Text>`;
assertEq(
  capturePageIsCaptureOnly(preFixPage),
  false,
  'MUTATION: the v32 page (Save button, match line) FAILS capturePageIsCaptureOnly',
);
// ── MUTATION 2: the half-fix — the chip is added but Save stays ──
const halfFix = windowSource.replace(
  'export type MelodyWindowPhase',
  'const SAVE_MELODY_CTA = "Save melody";\nexport type MelodyWindowPhase',
);
assert(halfFix !== windowSource, 'the half-fix mutation changed the real source');
assertEq(
  capturePageIsCaptureOnly(halfFix),
  false,
  'MUTATION: adding the chip while keeping Save FAILS capturePageIsCaptureOnly',
);
// ── MUTATION 3: the find button renders but is not wired (the dead CTA) ──
const deadFind = windowSource.replace('onPress={onFindMelody}', 'onPress={undefined}');
assert(deadFind !== windowSource, 'the dead-find mutation changed the real source');
assertEq(
  takeActionBarWired(deadFind),
  false,
  'MUTATION: a "Find this melody" control with no handler FAILS takeActionBarWired',
);
// ── MUTATION 4: the action bar order is shuffled (Done before record-again) ──
const outOfOrder = `<Text>{MIDI_EXPORT_LABEL}</Text><Text>{FIND_THIS_MELODY_CTA}</Text>
  <Text>{DONE_CTA}</Text><Text>{RECORD_ANOTHER_CTA}</Text>
  onPress={onExportMidi} onPress={onFindMelody} onPress={onRecordAgain} onPress={onClose}`;
assertEq(
  takeActionBarWired(outOfOrder),
  false,
  'MUTATION: an action bar with Done before record-again FAILS takeActionBarWired',
);
// ── MUTATION 4b: the bar loses a control entirely (Done deleted) ──
const missingDone = windowSource.split('DONE_CTA').join('RECORD_ANOTHER_CTA');
assert(missingDone !== windowSource, 'the missing-control mutation changed the real source');
assertEq(
  takeActionBarWired(missingDone),
  false,
  'MUTATION: an action bar missing Done FAILS takeActionBarWired',
);
// ── MUTATION 5: the match card comes back onto the page ──
const backOnPage = windowSource.replace(
  'export type MelodyWindowPhase',
  'const matchLine = "x";\nexport type MelodyWindowPhase',
);
assertEq(
  matchResultsAreOffThePage(backOnPage, flowSource),
  false,
  'MUTATION: a match line back on the window FAILS matchResultsAreOffThePage',
);
// ── MUTATION 6: the miss overlay loses its gate (it would show for everyone) ──
const ungated = flowSource.replace('visible={findOpen}', 'visible');
assert(ungated !== flowSource, 'the gate mutation changed the real source');
assertEq(
  matchResultsAreOffThePage(windowSource, ungated),
  false,
  'MUTATION: an ungated miss overlay FAILS matchResultsAreOffThePage',
);
// ── MUTATION 7: the miss card escapes back onto the capture page (outside the
//    Modal — exactly the v32 layout the owner rejected) ──
const escapedCard = flowSource
  .replace('stage === \'no-match\' && outcome && (', 'stage === \'review\' && outcome && (')
  .replace("if (stage === 'no-match') {\n      setFindOpen(true);", 'if (false) {\n      setFindOpen(true);');
assert(escapedCard !== flowSource, 'the page-leak mutation changed the real source');
assertEq(
  matchResultsAreOffThePage(windowSource, escapedCard),
  false,
  'MUTATION: a miss card not reachable through the explicit step FAILS the contract',
);

// ─────────────────── slice C — the take drawn as a staff ───────────────────
const STAFF_CARD = 'src/components/TakeStaffCard.tsx';
const ABC_VIEW = 'src/components/AbcScoreView.tsx';

const staffConflict = (() => {
  try {
    return readAppFile(STAFF_CARD);
  } catch {
    return '';
  }
})();
const abcViewSource = readAppFile(ABC_VIEW);

console.log('\nslice C — the take as notation (dimmed raw + crisp auto-cleaned)');
assert(staffConflict.length > 1500, `read ${STAFF_CARD} (${staffConflict.length} chars)`);
assertEq(
  staffCardDrawsBothRows(staffConflict),
  true,
  'the staff card draws BOTH rows: dimmed raw ink, the auto-clean ✦ divider, the teal cleaned line',
);
assertEq(
  staffIsTheUsersOwnTake(flowSource, windowSource),
  true,
  'the staff is built from the decoded take and handed in through the window slot',
);
assertEq(
  abcViewHasInkSeam(abcViewSource),
  true,
  'the one renderer grew the ink seam (foregroundColor + CSS + reload key)',
);

// MUTATION 8: the two rows collapse into one ink (no before/after reading).
const sameInk = staffConflict.replace(
  'ink={TAKE_STAFF_CLEANED_INK}',
  'ink={TAKE_STAFF_RAW_INK}',
);
assert(sameInk !== staffConflict, 'the same-ink mutation changed the real card');
assertEq(
  staffCardDrawsBothRows(sameInk),
  false,
  'MUTATION: one ink for both rows FAILS staffCardDrawsBothRows',
);
// MUTATION 9: the second render disappears (only the raw trace is drawn).
const singleRow = staffConflict.replace(/<AbcScoreView[\s\S]*?\/>/, '');
assert(singleRow !== staffConflict, 'the single-row mutation changed the real card');
assertEq(
  staffCardDrawsBothRows(singleRow),
  false,
  'MUTATION: a card that draws only one row FAILS staffCardDrawsBothRows',
);
// MUTATION 10: the divider is hard-coded in the view instead of coming from the
// model (the label could then drift from AUTO_CLEAN_DIVIDER_LABEL).
const hardcodedDivider = staffConflict.replace('{rows.dividerLabel}', "{'auto-clean' + ' ✦'}");
assert(hardcodedDivider !== staffConflict, 'the divider mutation changed the real card');
assertEq(
  staffCardDrawsBothRows(hardcodedDivider),
  false,
  'MUTATION: a hard-coded divider label FAILS staffCardDrawsBothRows',
);
// MUTATION 11: the card stops using the app's cleaning pass (its own notes).
const ownNotes = staffConflict.replace('autoCleanTake(', 'myOwnClean(');
assert(ownNotes !== staffConflict, 'the own-cleaning mutation changed the real card');
assertEq(
  staffCardDrawsBothRows(ownNotes),
  false,
  'MUTATION: a card that cleans the take itself FAILS staffCardDrawsBothRows',
);
// MUTATION 12: the ink seam is dropped from the renderer (the raw/cleaned
// distinction would silently become one colour).
const noOption = abcViewSource.replace('foregroundColor: ink', 'foregroundColor: "#000000"');
assert(noOption !== abcViewSource, 'the ink-option mutation changed the real renderer');
assertEq(
  abcViewHasInkSeam(noOption),
  false,
  'MUTATION: a renderer that ignores the ink FAILS abcViewHasInkSeam',
);
assertEq(
  abcViewHasInkSeam('<div>export function generateAbcHtml(abc: string) { return abc; }</div>'),
  false,
  'MUTATION: the pre-v33 renderer signature FAILS abcViewHasInkSeam',
);
// MUTATION 13: the flow stops passing the card through the window slot.
const notPassed = flowSource.replace('staff={staffCard}', 'staffVisible');
assert(notPassed !== flowSource, 'the unpassed-staff mutation changed the real flow');
assertEq(
  staffIsTheUsersOwnTake(notPassed, windowSource),
  false,
  'MUTATION: a card built but never handed to the window FAILS staffIsTheUsersOwnTake',
);

// ────────────── slice D — the take-correction editor ──────────────
const EDITOR = 'src/components/TakeCorrectionEditor.tsx';
const CORRECTED_STORE = 'src/services/correctedTakeStore.ts';
const HISTORY = 'src/screens/HistoryScreen.tsx';

const editorSource = readAppFile(EDITOR);
const correctedStoreSource = readAppFile(CORRECTED_STORE);
const historySource = readAppFile(HISTORY);

console.log('\nslice D — the take-correction editor (no drift paths)');
assert(editorSource.length > 8000, `read ${EDITOR} (${editorSource.length} chars)`);
assertEq(
  editorSurfaceCorrectsEveryFact(editorSource),
  true,
  'the editor routes every correction (pitch + audible verify, drag boundaries, add/remove/rest, chords, undo/redo/reset) in ≥44dp targets',
);
assertEq(
  editorWritesThroughOneSeam(correctedStoreSource, editorSource),
  true,
  'both save actions write through ONE seam and the corrected take stays a plain note list',
);
assertEq(
  editorReachedFromBothDoors(flowSource, historySource),
  true,
  'the editor is reachable from the capture window AND from a History melody row',
);
assertEq(
  correctedTakeIsWhatExports(flowSource),
  true,
  'the take the page shows is the take that gets exported (no re-decode over the corrections)',
);

// MUTATION 14: the rail stops playing the pitch it sets (no audible verify).
const silentRail = editorSource.replace(
  '(stateRef.current, selected.id, midi), midi)',
  '(stateRef.current, selected.id, midi))',
);
assert(silentRail !== editorSource, 'the silent-rail mutation changed the real editor');
assertEq(
  editorSurfaceCorrectsEveryFact(silentRail),
  false,
  'MUTATION: a semitone rail that does NOT play the pitch FAILS editorSurfaceCorrectsEveryFact',
);
// MUTATION 15: the drag layer disappears (tap-only editing).
const noDrag = editorSource.split('PanResponder.create').join('PanResponderGone.create');
assert(noDrag !== editorSource, 'the no-drag mutation changed the real editor');
assertEq(
  editorSurfaceCorrectsEveryFact(noDrag),
  false,
  'MUTATION: an editor with no drag gestures FAILS editorSurfaceCorrectsEveryFact',
);
// MUTATION 16: the boundary handles go (timing can no longer be dragged).
const noHandles = editorSource.replace("boundaryPan('end')", "boundaryPan('start')");
assert(noHandles !== editorSource, 'the no-handles mutation changed the real editor');
assertEq(
  editorSurfaceCorrectsEveryFact(noHandles),
  false,
  'MUTATION: an editor with only one boundary handle FAILS editorSurfaceCorrectsEveryFact',
);
// MUTATION 17: "Save a copy" quietly becomes a second "Save & update".
const noCopy = editorSource.replace("void doSave('copy')", "void doSave('update')");
assert(noCopy !== editorSource, 'the no-copy mutation changed the real editor');
assertEq(
  editorSurfaceCorrectsEveryFact(noCopy),
  false,
  'MUTATION: one save action instead of two FAILS editorSurfaceCorrectsEveryFact',
);
// MUTATION 18: the 44dp targets shrink to thumb-hostile ones.
const tinyTargets = editorSource.split('minHeight: 44').join('minHeight: 32');
assert(tinyTargets !== editorSource, 'the tiny-target mutation changed the real editor');
assertEq(
  editorSurfaceCorrectsEveryFact(tinyTargets),
  false,
  'MUTATION: sub-44dp targets FAIL editorSurfaceCorrectsEveryFact',
);
// MUTATION 19: the copy path stops writing the take through the row seam.
const copyBypass = correctedStoreSource.replace(
  'ok = await updatePersonalMelodyTake(row.id, take);',
  'ok = true;',
);
assert(copyBypass !== correctedStoreSource, 'the copy-bypass mutation changed the real store');
assertEq(
  editorWritesThroughOneSeam(copyBypass, editorSource),
  false,
  'MUTATION: a copy written outside the seam FAILS editorWritesThroughOneSeam',
);
// MUTATION 20: the corrected take stops being written onto the row it came from.
const orphanSave = correctedStoreSource.replace(
  'ok = await updatePersonalMelodyTake(input.rowId, take);',
  'ok = false;',
);
assert(orphanSave !== correctedStoreSource, 'the orphan-save mutation changed the real store');
assertEq(
  editorWritesThroughOneSeam(orphanSave, editorSource),
  false,
  'MUTATION: an update path that writes nothing FAILS editorWritesThroughOneSeam',
);
// MUTATION 21: the History row's editor door is dropped (one door only).
const oneDoor = historySource.replace('rowId={editTake.id}', 'rowId={null}');
assert(oneDoor !== historySource, 'the one-door mutation changed the real History screen');
assertEq(
  editorReachedFromBothDoors(flowSource, oneDoor),
  false,
  'MUTATION: a History row that cannot open the editor FAILS editorReachedFromBothDoors',
);
// MUTATION 22: the flow stops passing the take it saves (the editor would open empty).
const noTakeProp = historySource.replace('take={editTake.capture ?? null}', 'take={null}');
assert(noTakeProp !== historySource, 'the no-take mutation changed the real History screen');
assertEq(
  editorReachedFromBothDoors(flowSource, noTakeProp),
  false,
  'MUTATION: an editor opened without the row take FAILS editorReachedFromBothDoors',
);
// MUTATION 23: the export goes back to re-decoding the recording first (the
// pre-fix drift path: corrections exported as the raw take).
const driftExport = flowSource.replace(
  'exportCaptureMidiFromTake(take, { title: analysis?.rowTitle });',
  'exportCaptureMidiFromTake(preEditTake, { title: analysis?.rowTitle });',
);
assert(driftExport !== flowSource, 'the drift-export mutation changed the real flow');
assertEq(
  correctedTakeIsWhatExports(driftExport),
  false,
  'MUTATION: an export that ignores the corrected take FAILS correctedTakeIsWhatExports',
);

// ────────── slice G — the docked Hum-Along preview ──────────
const PREVIEW_SECTION = 'src/components/TakePreviewSection.tsx';
const PREVIEW_HOOK = 'src/hooks/useNotePreview.ts';

const previewSectionSource = readAppFile(PREVIEW_SECTION);
const previewHookSource = readAppFile(PREVIEW_HOOK);

console.log('\nslice G — the preview is DOCKED in the editor (owner 10-04 option 4)');
assert(
  previewSectionSource.length > 1500,
  `read ${PREVIEW_SECTION} (${previewSectionSource.length} chars)`,
);
assertEq(
  previewIsDockedInTheEditor(editorSource, previewSectionSource),
  true,
  'the control row (play/pause, loop, prev/next, preview-only tempo, instruments, captions) is docked above the save bar',
);
assertEq(
  previewEngineNeverRewritesTheTake(previewHookSource),
  true,
  'the engine reads the take only: timeline + JS clock + tone bank, no writing operation anywhere',
);

// MUTATION 24: a SEPARATE preview screen (a second Modal) — the treatment the
// owner rejected on 10-04.
const secondScreen = editorSource.replace(
  '<TakePreviewSection preview={preview} />',
  '<Modal visible={false}><TakePreviewSection preview={preview} /></Modal>',
);
assert(secondScreen !== editorSource, 'the second-screen mutation changed the real editor');
assertEq(
  previewIsDockedInTheEditor(secondScreen, previewSectionSource),
  false,
  'MUTATION: a separate preview screen FAILS previewIsDockedInTheEditor',
);
// MUTATION 25: the preview section disappears from the editor.
const undocked = editorSource.replace('<TakePreviewSection preview={preview} />', '');
assert(undocked !== editorSource, 'the undocked mutation changed the real editor');
assertEq(
  previewIsDockedInTheEditor(undocked, previewSectionSource),
  false,
  'MUTATION: an editor with no docked preview FAILS previewIsDockedInTheEditor',
);
// MUTATION 26: the "preview only" honesty caption is dropped from the surface.
const noCaption = previewSectionSource
  .split('PREVIEW_ONLY_CAPTION')
  .join('PREVIEW_HONESTY_LINE_MISSING');
assert(noCaption !== previewSectionSource, 'the no-caption mutation changed the real section');
assertEq(
  previewIsDockedInTheEditor(editorSource, noCaption),
  false,
  'MUTATION: a preview with no "preview only" caption FAILS previewIsDockedInTheEditor',
);
// MUTATION 27: the tempo rail stops being preview-only (the hook gains a take
// writer — exactly the drift the brief forbids).
const rewritingTempo = previewHookSource.replace(
  'const [tempoPct, setTempoState]',
  'setNoteBoundary(null as never, "", "end", 0);\n  const [tempoPct, setTempoState]',
);
assert(rewritingTempo !== previewHookSource, 'the rewriting-tempo mutation changed the real hook');
assertEq(
  previewEngineNeverRewritesTheTake(rewritingTempo),
  false,
  'MUTATION: a preview engine that can write note times FAILS previewEngineNeverRewritesTheTake',
);
// MUTATION 28: the JS clock goes (the preview would rely on something else).
const noClock = previewHookSource.replace('setInterval(', 'fakeClock(');
assert(noClock !== previewHookSource, 'the no-clock mutation changed the real hook');
assertEq(
  previewEngineNeverRewritesTheTake(noClock),
  false,
  'MUTATION: a preview with no clock FAILS previewEngineNeverRewritesTheTake',
);


// ────────── slice E — the hum SIBLING CARD + the Discover band ──────────
const HOME = 'src/screens/HomeScreen.tsx';
const homeSource = readAppFile(HOME);

console.log('\nslice E — Listen hero + the hum sibling card, search in its own band');
assert(homeSource.length > 20000, `read ${HOME} (${homeSource.length} chars)`);
assertEq(
  humIsTheHerosSiblingCard(homeSource),
  true,
  'the hum entry is a full-width teal sibling CARD under the hero, with its own title + body + the split line',
);
assertEq(
  searchHasItsOwnDiscoverBand(homeSource),
  true,
  'the "Find any song" field left the Listen/Hum block for its own Discover band, wired to the search',
);

// MUTATION 29: the hum card is demoted back to the v32 quiet text row.
const textRow = homeSource.replace(
  "humEntryBtn: {\n    alignSelf: 'stretch',\n    width: '100%',\n    alignItems: 'center',\n    justifyContent: 'center',\n    backgroundColor: '#16213e',\n    borderRadius: 16,\n    borderWidth: 2,\n    borderColor: '#4ecdc4',\n    paddingVertical: 16,\n    paddingHorizontal: 18,\n    marginBottom: 8,\n  },",
  "humEntryBtn: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    justifyContent: 'center',\n    paddingVertical: 10,\n    paddingHorizontal: 8,\n    textDecorationLine: 'underline',\n  },",
);
assert(textRow !== homeSource, 'the text-row mutation changed the real Home screen');
assertEq(
  humIsTheHerosSiblingCard(textRow),
  false,
  'MUTATION: the v32 underlined hum text row FAILS humIsTheHerosSiblingCard',
);
// MUTATION 30: the hum card renders as the search CHIP instead of its own card.
const chipHum = homeSource.replace(
  '<TouchableOpacity\n          style={styles.humEntryBtn}',
  '<TouchableOpacity\n          style={styles.findAnySongChip}',
);
assert(chipHum !== homeSource, 'the chip-hum mutation changed the real Home screen');
assertEq(
  humIsTheHerosSiblingCard(chipHum),
  false,
  'MUTATION: a hum CHIP fails humIsTheHerosSiblingCard (it must be a card)',
);
// MUTATION 31: the hum entry loses its wiring (the dead-CTA class).
const deadHum = homeSource.replace('onPress={handleHumEntry}', 'onPress={undefined}');
assert(deadHum !== homeSource, 'the dead-hum mutation changed the real Home screen');
assertEq(
  humIsTheHerosSiblingCard(deadHum),
  false,
  'MUTATION: a hum card that opens nothing FAILS humIsTheHerosSiblingCard',
);
// MUTATION 32: the search field slips back into the Listen/Hum block.
const chipBackInBandA = homeSource.replace(
  '<Text style={styles.tier1BetaNote}>',
  '<TouchableOpacity style={styles.findAnySongChip}></TouchableOpacity>\n          <Text style={styles.tier1BetaNote}>',
);
assert(chipBackInBandA !== homeSource, 'the chip-back mutation changed the real Home screen');
assertEq(
  searchHasItsOwnDiscoverBand(chipBackInBandA),
  false,
  'MUTATION: the search chip back inside band A FAILS searchHasItsOwnDiscoverBand',
);
// MUTATION 33: the Discover band keeps its shell but loses the search entry.
const emptyDiscover = homeSource.replace(
  'style={styles.findAnySongChip}\n            onPress={handleFindAnySong}',
  'style={styles.bandChip}\n            onPress={handleFindAnySong}',
);
assert(emptyDiscover !== homeSource, 'the empty-discover mutation changed the real Home screen');
assertEq(
  searchHasItsOwnDiscoverBand(emptyDiscover),
  false,
  'MUTATION: a Discover band with no search entry FAILS searchHasItsOwnDiscoverBand',
);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);