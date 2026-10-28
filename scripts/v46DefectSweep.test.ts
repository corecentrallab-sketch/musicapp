/**
 * Tests for THE v46 DEFECT SWEEP — src/services/v46DefectSweep.ts against the
 * REAL sources:
 *   A. src/components/MelodyCaptureWindow.tsx + the copy module + the hum flow +
 *      the recorder hook (the STOP that could not be reached);
 *   B. src/screens/FindPieceScreen.tsx + src/components/FamilyScreen.tsx +
 *      src/screens/HomeScreen.tsx (the free-scores lever that opened the personal
 *      Library).
 *
 * Both defects shipped green because every existing suite asked the wrong
 * question:
 *   A — "does the window receive onStop?" It always did; the control was simply
 *       under the fold, so `melodyCapture.test.ts` (copy) and `v33UiWiring.test.ts`
 *       (flow) could not see it.
 *   B — "is the row wired?" It was; the DESTINATION came from the host two files
 *       away, so every wiring guard passed while the tap landed on the wrong
 *       screen.
 * These guards ask the questions those could not: is the stop OUTSIDE the
 * scroller, on the recording face only, with the recorder chain behind it intact —
 * and is the lever's destination decided INSIDE the surface, with nothing left for
 * a host to re-point.
 *
 * Every guard is proven here against the real bytes (in-line mutation probes), and
 * the on-disk probes in the PR body mutate the same real files with no recompile.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  CAPTURE_COPY_FILE,
  CAPTURE_WINDOW_FILE,
  DOOR_FILE,
  FAMILY_SCREEN_FILE,
  FREE_LEVER_FILE,
  FREE_LIST_TEST_ID,
  HUM_FLOW_FILE,
  RECORDER_HOOK_FILE,
  STOP_TEST_ID,
  familyFreeRowCallsItsOwnProp,
  freeScoresLeverIsSelfContained,
  humStopChainReleasesTheMic,
  humStopHintIsFactualAndDocked,
  humStopIsDockedOnTheRecordingFace,
  theDoorCannotRepointTheFreeScoresLever,
} from '../src/services/v46DefectSweep';
import { maskSource } from '../src/services/genreFamilies';

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
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
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
  console.log('\nthe guards name the real files');
  assertEq(CAPTURE_WINDOW_FILE, 'src/components/MelodyCaptureWindow.tsx', 'the stop is guarded on the capture window');
  assertEq(CAPTURE_COPY_FILE, 'src/services/melodyCapture.ts', 'its line is guarded in the copy module');
  assertEq(HUM_FLOW_FILE, 'src/screens/HumSearchScreen.tsx', 'the recorder chain is guarded in the hum flow');
  assertEq(RECORDER_HOOK_FILE, 'src/hooks/useAudioRecorder.ts', 'the release is guarded in the recorder hook');
  assertEq(FREE_LEVER_FILE, 'src/screens/FindPieceScreen.tsx', 'the lever is guarded where Discover lives');
  assertEq(FAMILY_SCREEN_FILE, 'src/components/FamilyScreen.tsx', 'the family row is guarded on its component');
  assertEq(DOOR_FILE, 'src/screens/HomeScreen.tsx', 'the host that must not re-point it is the door');
  // The two ids the QA pass aims at are the ones the guards pin.
  assertEq(STOP_TEST_ID, 'capture-window-stop', 'the stop keeps its testID');
  assertEq(FREE_LIST_TEST_ID, 'free-scores-list', 'the free list keeps its testID');
  // …and the ids are really IN the sources (a renamed id fails here first).
  assert(readAppFile(CAPTURE_WINDOW_FILE).indexOf(`testID="${STOP_TEST_ID}"`) >= 0, 'the window renders the stop testID');
  assert(readAppFile(FREE_LEVER_FILE).indexOf(`testID="${FREE_LIST_TEST_ID}"`) >= 0, 'the Discover surface renders the free-list testID');
}

// ─── 2. floors: a broken read must not pass ────────────────────

function floorTests(): void {
  console.log('\nfloors — an empty or truncated read fails every guard');
  assertEq(humStopIsDockedOnTheRecordingFace(''), false, 'A: no window source → fails');
  assertEq(humStopIsDockedOnTheRecordingFace('const x = 1;'), false, 'A: a tiny window source → fails');
  assertEq(humStopHintIsFactualAndDocked('', ''), false, 'A: empty copy + empty window → fails');
  assertEq(humStopChainReleasesTheMic('', ''), false, 'A: empty flow + empty recorder → fails');
  assertEq(freeScoresLeverIsSelfContained(''), false, 'B: no Discover source → fails');
  assertEq(familyFreeRowCallsItsOwnProp(''), false, 'B: no family source → fails');
  assertEq(theDoorCannotRepointTheFreeScoresLever(''), false, 'B: no door source → fails');
  assertEq(
    theDoorCannotRepointTheFreeScoresLever('x'.repeat(20001)),
    false,
    'B: a long source that is not the door → fails (the mount is required)',
  );
  assertEq(
    freeScoresLeverIsSelfContained('x'.repeat(5001)),
    false,
    'B: a long source without the search field → fails',
  );
}

// ─── 3. the live scan against the real sources ─────────────────

function liveScanTests(): void {
  console.log('\nlive scan — the real sources carry both fixes');

  const windowSrc = readAppFile(CAPTURE_WINDOW_FILE);
  const copySrc = readAppFile(CAPTURE_COPY_FILE);
  const flowSrc = readAppFile(HUM_FLOW_FILE);
  const recorderSrc = readAppFile(RECORDER_HOOK_FILE);
  const findPieceSrc = readAppFile(FREE_LEVER_FILE);
  const familySrc = readAppFile(FAMILY_SCREEN_FILE);
  const homeSrc = readAppFile(DOOR_FILE);

  // Floors on the reads themselves: a truncated file must not pass vacuously.
  assert(windowSrc.length > 20000, 'the capture window really read (a big file)');
  assert(flowSrc.length > 10000, 'the hum flow really read');
  assert(homeSrc.length > 20000, 'the door really read');

  // ── A ──
  assertEq(
    humStopIsDockedOnTheRecordingFace(windowSrc),
    true,
    'A: the stop is docked on the recording face (outside the scroller, wired to onStop)',
  );
  assertEq(
    humStopHintIsFactualAndDocked(windowSrc, copySrc),
    true,
    'A: the dock carries STOP_CTA_HINT, and the line still names the mic and the kept take',
  );
  assertEq(
    humStopChainReleasesTheMic(flowSrc, recorderSrc),
    true,
    'A: onStop → await stopRecording → metering cleared, recorder released, playback mode restored',
  );

  // ── B ──
  assertEq(
    freeScoresLeverIsSelfContained(findPieceSrc),
    true,
    'B: the free-scores lever is self-contained (no onBrowseLibrary, one local handler)',
  );
  assertEq(
    familyFreeRowCallsItsOwnProp(familySrc),
    true,
    'B: the family free row calls its own prop; the money row still opens the retailer',
  );
  assertEq(
    theDoorCannotRepointTheFreeScoresLever(homeSrc),
    true,
    'B: the door cannot re-point the lever (no handler, no prop on the mount)',
  );

  // ── the masking must be doing real work, not luck ──
  // Both files EXPLAIN the removed prop in comments. If masking were broken, the
  // guards above would fail; if the code had the prop back, masking would hide it
  // from nobody. Assert both halves so the reader can see the distinction.
  assert(
    windowSrc.indexOf('stopDock') >= 0 && maskSource(windowSrc).indexOf('styles.stopDock') >= 0,
    'the dock is CODE, not a comment (it survives masking)',
  );
  assert(
    maskSource(findPieceSrc).indexOf('onBrowseLibrary') < 0,
    'B: no onBrowseLibrary survives masking in the Discover surface',
  );
  assert(
    maskSource(homeSrc).indexOf('handleBrowseLibraryFromDiscover') < 0,
    'B: no handleBrowseLibraryFromDiscover survives masking in the door',
  );
}

// ─── 4. the pre-fix shape, derived from the real bytes ────────

/**
 * The pre-fix stop, rebuilt from the CURRENT window by the two moves that were the
 * defect: the control carried no testID (it was a bare TouchableOpacity at the end
 * of the scroller) and the scroller closed AFTER it, i.e. the stop scrolled.
 * Deriving it from the real file keeps the fixture honest — it is the shipped
 * source with the fix taken out, not a hand-typed approximation.
 */
function preFixHumWindow(src: string): string {
  let out = src.split(`            testID="${STOP_TEST_ID}"\n`).join('');
  const closeTag = '</ScrollView>';
  const dockAt = out.indexOf('styles.stopDock');
  if (dockAt < 0) return out;
  const closeAt = out.lastIndexOf(closeTag, dockAt);
  const armEnd = out.indexOf(') : (', dockAt);
  if (closeAt < 0 || armEnd < 0) return out;
  return (
    out.slice(0, closeAt) +
    out.slice(closeAt + closeTag.length, armEnd) +
    closeTag +
    out.slice(armEnd)
  );
}

function fixtureTests(): void {
  console.log('\nthe pre-fix shapes FAIL (derived from the shipped sources)');

  const windowSrc = readAppFile(CAPTURE_WINDOW_FILE);
  const preFix = preFixHumWindow(windowSrc);
  assert(preFix !== windowSrc, 'the pre-fix window differs from the shipped one');
  assertEq(
    humStopIsDockedOnTheRecordingFace(preFix),
    false,
    'PRE-FIX: the stop at the end of the scroller FAILS the dock guard',
  );
  assertEq(
    humStopIsDockedOnTheRecordingFace(windowSrc),
    true,
    'and the shipped window still passes (the guard tested the fixture, not a broken read)',
  );

  // B's pre-fix shape: the lever's destination handed in by the host. Re-introduce
  // exactly that — a caller-injected handler in the surface's own code.
  const findPieceSrc = readAppFile(FREE_LEVER_FILE);
  const preFixLever = findPieceSrc.replace(
    '  const handleBrowseFreeScores = useCallback',
    '  const onBrowseLibrary = () => {};\n  const handleBrowseFreeScores = useCallback',
  );
  assert(preFixLever !== findPieceSrc, 'the pre-fix lever differs from the shipped one');
  assertEq(
    freeScoresLeverIsSelfContained(preFixLever),
    false,
    'PRE-FIX: a caller-injected destination back in the surface FAILS the lever guard',
  );

  const homeSrc = readAppFile(DOOR_FILE);
  const mount = '<FindPieceScreen onClose={() => setShowFindPiece(false)} />';
  assert(homeSrc.indexOf(mount) >= 0, 'the door mounts the Discover surface without a destination prop');
  const preFixMount = homeSrc.replace(
    mount,
    '<FindPieceScreen onClose={() => setShowFindPiece(false)} onBrowseLibrary={() => {}} />',
  );
  assert(preFixMount !== homeSrc, 'the pre-fix mount differs from the shipped one');
  assertEq(
    theDoorCannotRepointTheFreeScoresLever(preFixMount),
    false,
    'PRE-FIX: the door handing a destination back to the surface FAILS the host guard',
  );
}

// ─── 5. mutation probes on the real bytes ─────────────────────

function mutationProbes(): void {
  console.log('\nmutation probes — each guard bites on the real source');

  const windowSrc = readAppFile(CAPTURE_WINDOW_FILE);
  const copySrc = readAppFile(CAPTURE_COPY_FILE);
  const flowSrc = readAppFile(HUM_FLOW_FILE);
  const recorderSrc = readAppFile(RECORDER_HOOK_FILE);
  const findPieceSrc = readAppFile(FREE_LEVER_FILE);
  const familySrc = readAppFile(FAMILY_SCREEN_FILE);
  const homeSrc = readAppFile(DOOR_FILE);

  // ── A1: the stop loses its testID (unaddressable) ──
  const noId = windowSrc.split(`            testID="${STOP_TEST_ID}"\n`).join('');
  assert(noId !== windowSrc, 'A1: the testID mutation changed the real window');
  assertEq(humStopIsDockedOnTheRecordingFace(noId), false, 'MUTATION A1: a stop with no testID FAILS the dock guard');

  // ── A2: the stop is rendered and ends nothing ──
  const deadStop = windowSrc.replace('onPress={onStop}', 'onPress={() => undefined}');
  assert(deadStop !== windowSrc, 'A2: the dead-stop mutation changed the real window');
  assertEq(humStopIsDockedOnTheRecordingFace(deadStop), false, 'MUTATION A2: a stop wired to nothing FAILS (dead CTA)');

  // ── A3: the stop goes BACK inside the scroller (the shipped defect) ──
  const closeTag = '</ScrollView>';
  const dockAt = windowSrc.indexOf('styles.stopDock');
  const closeAt = windowSrc.lastIndexOf(closeTag, dockAt);
  const armEnd = windowSrc.indexOf(') : (', dockAt);
  const scrolledStop =
    windowSrc.slice(0, closeAt) +
    windowSrc.slice(closeAt + closeTag.length, armEnd) +
    closeTag +
    windowSrc.slice(armEnd);
  assert(scrolledStop !== windowSrc, 'A3: the scrolled-stop mutation changed the real window');
  assertEq(
    humStopIsDockedOnTheRecordingFace(scrolledStop),
    false,
    'MUTATION A3: the stop moving back INSIDE the scroller FAILS — the exact owner defect',
  );

  // ── A4: the dock stops being keyed to the recording face ──
  const alwaysShown = windowSrc.replace('{recording ? (', '{true ? (');
  assert(alwaysShown !== windowSrc, 'A4: the always-shown mutation changed the real window');
  assertEq(
    humStopIsDockedOnTheRecordingFace(alwaysShown),
    false,
    'MUTATION A4: a dock that renders on every face FAILS (layout regression on idle/preview)',
  );

  // ── A5: a second dock appears on another face ──
  const doubleDock = windowSrc.replace(') : (', ') : (\n          <View style={styles.stopDock} />');
  assert(doubleDock !== windowSrc, 'A5: the double-dock mutation changed the real window');
  assertEq(humStopIsDockedOnTheRecordingFace(doubleDock), false, 'MUTATION A5: a stray second dock FAILS');

  // ── A6: the dock loses its line ──
  const noHint = windowSrc.replace('<Text style={styles.stopHint}>{STOP_CTA_HINT}</Text>', '');
  assert(noHint !== windowSrc, 'A6: the no-hint mutation changed the real window');
  assertEq(
    humStopHintIsFactualAndDocked(noHint, copySrc),
    false,
    'MUTATION A6: a dock with no STOP_CTA_HINT line FAILS',
  );

  // ── A7: the copy stops naming the mic release ──
  const vagueCopy = copySrc.replace(
    'Ends the take and switches the microphone off. Your melody is kept.',
    'Stops the take.',
  );
  assert(vagueCopy !== copySrc, 'A7: the vague-copy mutation changed the real copy module');
  assertEq(
    humStopHintIsFactualAndDocked(windowSrc, vagueCopy),
    false,
    'MUTATION A7: copy that stops naming the microphone FAILS (never "pause", never a guess)',
  );

  // ── A8: the recorder stops clearing its metering interval ──
  const timerLeak = recorderSrc.replace(
    '      clearInterval(meteringTimerRef.current);\n      meteringTimerRef.current = null;',
    '      meteringTimerRef.current = null;',
  );
  assert(timerLeak !== recorderSrc, 'A8: the timer-leak mutation changed the real recorder hook');
  assertEq(
    humStopChainReleasesTheMic(flowSrc, timerLeak),
    false,
    'MUTATION A8: a stop that leaves the metering interval running FAILS (the meter keeps sampling)',
  );

  // ── A9: the recorder is never released ──
  const notReleased = recorderSrc.replace('await releaseRecording(recording);', 'void recording;');
  assert(notReleased !== recorderSrc, 'A9: the unreleased-recorder mutation changed the real hook');
  assertEq(
    humStopChainReleasesTheMic(flowSrc, notReleased),
    false,
    'MUTATION A9: a stop that never releases the recorder FAILS (the mic stays open)',
  );

  // ── A10: the playback audio mode is not restored ──
  const silentAfter = recorderSrc.replace('restorePlaybackAudioMode()', 'Promise.resolve()');
  assert(silentAfter !== recorderSrc, 'A10: the audio-mode mutation changed the real hook');
  assertEq(
    humStopChainReleasesTheMic(flowSrc, silentAfter),
    false,
    'MUTATION A10: a stop that leaves the record-mode session behind FAILS',
  );

  // ── A11: the flow swallows the stop ──
  const swallowed = flowSrc.replace('await recorder.stopRecording()', 'void recorder.stopRecording()');
  assert(swallowed !== flowSrc, 'A11: the swallowed-stop mutation changed the real flow');
  assertEq(humStopChainReleasesTheMic(swallowed, recorderSrc), false, 'MUTATION A11: a fire-and-forget stop FAILS');

  // ── B1: the row loses its binding ──
  const rowDead = findPieceSrc.replace('onPress={handleBrowseFreeScores}', 'onPress={undefined}');
  assert(rowDead !== findPieceSrc, 'B1: the row-dead mutation changed the real Discover surface');
  assertEq(freeScoresLeverIsSelfContained(rowDead), false, 'MUTATION B1: a free-scores row with no destination FAILS');

  // ── B2: the family mount stops handing the handler in ──
  const mountDead = findPieceSrc.replace(
    'onBrowseFreeScores={handleBrowseFreeScores}',
    'onBrowseFreeScores={undefined}',
  );
  assert(mountDead !== findPieceSrc, 'B2: the mount-dead mutation changed the real Discover surface');
  assertEq(freeScoresLeverIsSelfContained(mountDead), false, 'MUTATION B2: the family lever losing its handler FAILS');

  // ── B3: the list the lever scrolls to loses its id ──
  const noListId = findPieceSrc.replace(` testID="${FREE_LIST_TEST_ID}"`, '');
  assert(noListId !== findPieceSrc, 'B3: the no-list-id mutation changed the real Discover surface');
  assertEq(freeScoresLeverIsSelfContained(noListId), false, 'MUTATION B3: an unaddressable free list FAILS');

  // ── B4: the handler starts navigating again (the defect, in one line) ──
  const navigates = findPieceSrc.replace(
    '    pendingFreeListScrollRef.current = true;\n    setSelectedFamily(null);',
    '    pendingFreeListScrollRef.current = true;\n    navigation.navigate(\'Library\');\n    setSelectedFamily(null);',
  );
  assert(navigates !== findPieceSrc, 'B4: the navigate mutation changed the real Discover surface');
  assertEq(
    freeScoresLeverIsSelfContained(navigates),
    false,
    'MUTATION B4: a lever that navigates the user away FAILS — the exact defect',
  );

  // ── B5: the handler stops landing on the list ──
  const noScroll = findPieceSrc.split('scrollToFreeList()').join('void 0');
  assert(noScroll !== findPieceSrc, 'B5: the no-scroll mutation changed the real Discover surface');
  assertEq(
    freeScoresLeverIsSelfContained(noScroll),
    false,
    'MUTATION B5: a lever that never reaches the free list FAILS (a tap that lands nowhere)',
  );

  // ── B6: the family row goes back to the old prop ──
  const familyOld = familySrc.replace('onBrowseFreeScores()', 'onBrowseLibrary()');
  assert(familyOld !== familySrc, 'B6: the family-row mutation changed the real family screen');
  assertEq(
    familyFreeRowCallsItsOwnProp(familyOld),
    false,
    'MUTATION B6: the family free row calling the old prop FAILS',
  );

  // ── B7: the money row is collateral damage ──
  const moneyDead = familySrc.replace(
    'handleOpenRetailer(url) : onBrowseFreeScores()',
    'onBrowseFreeScores()',
  );
  assert(moneyDead !== familySrc, 'B7: the money-dead mutation changed the real family screen');
  assertEq(
    familyFreeRowCallsItsOwnProp(moneyDead),
    false,
    'MUTATION B7: the money row no longer opening the retailer FAILS (the sale path is guarded too)',
  );

  // ── B8: the door re-points the lever ──
  const repointed = homeSrc.replace(
    '<FindPieceScreen onClose={() => setShowFindPiece(false)} />',
    '<FindPieceScreen onClose={() => setShowFindPiece(false)} onBrowseLibrary={() => {}} />',
  );
  assert(repointed !== homeSrc, 'B8: the re-point mutation changed the real door');
  assertEq(
    theDoorCannotRepointTheFreeScoresLever(repointed),
    false,
    'MUTATION B8: the door handing a destination back to the surface FAILS',
  );

  // ── B9: the re-point handler comes back ──
  const handlerBack = homeSrc.replace(
    "  // From the modern interstitial: the find-a-song SEARCH",
    "  const handleBrowseLibraryFromDiscover = useCallback(() => {});\n  // From the modern interstitial: the find-a-song SEARCH",
  );
  assert(handlerBack !== homeSrc, 'B9: the handler-back mutation changed the real door');
  assertEq(
    theDoorCannotRepointTheFreeScoresLever(handlerBack),
    false,
    'MUTATION B9: the old library handler reappearing in the door FAILS',
  );

  // ── and the untouched sources still pass, so no probe above proved a broken fixture ──
  assertEq(humStopIsDockedOnTheRecordingFace(windowSrc), true, 'the real window still passes after every probe');
  assertEq(freeScoresLeverIsSelfContained(findPieceSrc), true, 'the real Discover surface still passes');
  assertEq(familyFreeRowCallsItsOwnProp(familySrc), true, 'the real family screen still passes');
  assertEq(theDoorCannotRepointTheFreeScoresLever(homeSrc), true, 'the real door still passes');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v46 defect sweep — the docked stop (A) and the self-contained free-scores lever (B)');
  fileMapTests();
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
