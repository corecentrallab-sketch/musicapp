/**
 * uxr2-scan-viewport.test.ts — THE GATE FOR UX ROUND 2 STEP 1 (owner green-lit
 * 2026-10-18, owner item C): the Scan Score screen's EDGE-TO-EDGE RELAYOUT.
 *
 * WHY THIS SUITE EXISTS. The owner's report was visual — "the heavy bottom white
 * bar STILL obscures the camera/Done/Bin controls" — and there is no emulator here,
 * so nothing on this box can LOOK at the screen. What can be proved is the thing
 * that actually went wrong twice (v40 bounded the panel and the owner still saw it
 * hiding the preview and the controls): the LAYOUT STRUCTURE of the real screen
 * file. So this suite reads `src/screens/ScanScoreScreen.tsx` as text and asserts
 * the owner's three requirements as properties:
 *
 *   • the preview fills the window (all four edges, no height of its own, the
 *     navigator's own header switched off by the screen);
 *   • one semi-transparent floating pill carries the shutter, the flash toggle,
 *     Undo and Done — and each of those controls exists exactly once, inside it;
 *   • nothing sits on top of them: the pill is the last layer, no opaque container
 *     spans the width behind it, and no scroller can move it.
 *
 * …and, because this is a RELAYOUT and not a feature, that the capture flow, its
 * enablement rules, the honest copy and the words→find-a-piece money path are the
 * same ones `services/v39FixContract` already pins. Those two guards are re-run
 * HERE against the relaid-out screen, so "the redesign quietly dropped something"
 * fails in this suite instead of inside a suite whose name says v39.
 *
 * HOW IT IS BUILT. The team's usual three layers: pure logic over the model
 * (`services/scanViewport`), live-source guards over the real files (comments
 * masked first — a commented-out layout is not a layout), and MUTATION PROBES that
 * must fail a guard, so a guard that cannot bite is visible here rather than on the
 * owner's phone. Every probe mutates an in-memory string: no file on disk is
 * touched, so no probe can leave the tree dirty.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  DEFAULT_SCAN_FLASH_MODE,
  SCAN_CHIP_TRANSLUCENT,
  SCAN_DOCK_MIN_BOTTOM,
  SCAN_EMPTY_HINT,
  SCAN_FILMSTRIP_HEIGHT,
  SCAN_FIND_SHEET_MAX,
  SCAN_FIND_SHEET_MIN,
  SCAN_FLASH_ORDER,
  SCAN_PILL_RADIUS,
  SCAN_SHUTTER_SIZE,
  SCAN_SURFACE_TRANSLUCENT,
  SCAN_TOUCH_MIN,
  nextScanFlashMode,
  scanControlState,
  scanDockBottomInset,
  scanFindPanel,
  scanFindSheetMaxHeight,
  scanFlashControlLabel,
  scanFlashIcon,
  scanFlashLabel,
  scanFlashShortLabel,
  scanOverlayInsets,
  scanPageCountLabel,
  scanTopChipInset,
} from '../src/services/scanViewport';
import {
  UXR2_PACKAGE_PATH,
  UXR2_PURE_MODEL_PATH,
  UXR2_SCAN_SCREEN_PATH,
  UXR2_SUITE_PATH,
  UXR2_TIER1_CONFIG_PATH,
  absoluteStyleNames,
  scanCameraFillsTheScreen,
  scanDeclutterStaysCollapsedByDefault,
  scanHasNoOpaqueFullWidthBar,
  scanKeepsTheCaptureFlow,
  scanKeepsTheControlRules,
  scanKeepsTheHonestCopy,
  scanNothingCoversTheControls,
  scanOverlaysClearSystemBars,
  scanPillHostsTheControls,
  scanTier1ListsTheViewportWork,
  styleBlock,
} from '../src/services/uxr2ScanViewportContract';
import {
  scanFindOpensTheOneSearch,
  scanFindCopyClaimsNoNoteReading,
  scanSavesEveryPageAsItIsTaken,
  V39_FIND_PIECE_PATH,
  V39_SCAN_FIND_PATH,
  V39_SCAN_SECTION_PATH,
  V39_SCANNED_VIEWER_PATH,
} from '../src/services/v39FixContract';
import {
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
function mutate(source: string, needle: string, replacement: string): string {
  return source.split(needle).join(replacement);
}
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}
/** The chain guard against the REAL model of this build. */
function overlaysHold(): boolean {
  return scanOverlaysClearSystemBars({
    top: scanTopChipInset,
    bottom: scanDockBottomInset,
    state: scanControlState,
    flashCycle: nextScanFlashMode,
  });
}

const SCREEN = readAppFile(UXR2_SCAN_SCREEN_PATH);
const MODEL = readAppFile(UXR2_PURE_MODEL_PATH);
const TSCONFIG = readAppFile(UXR2_TIER1_CONFIG_PATH);
const PACKAGE = readAppFile(UXR2_PACKAGE_PATH);
const SECTION = readAppFile(V39_SCAN_SECTION_PATH);
const VIEWER = readAppFile(V39_SCANNED_VIEWER_PATH);
const FIND_PIECE = readAppFile(V39_FIND_PIECE_PATH);
const SCAN_FIND = readAppFile(V39_SCAN_FIND_PATH);

console.log('\nuxr2 step 1 — the screen the guards read is the real, full screen');
assert(SCREEN.length > 8000, `the scan screen really was read (${SCREEN.length} chars)`);
assert(
  SCREEN.indexOf('export const ScanScoreScreen') >= 0,
  'and it is the scan screen, not a truncated or stubbed file',
);
assert(MODEL.length > 800, `the pure layout model was read too (${MODEL.length} chars)`);
assertEq(v39ModuleStaysPure(MODEL), true, 'the layout model is pure (no react-native, no fs)');
assertEq(v39HasNoNetwork([MODEL]), true, 'and it can never reach the network');
assertEq(v39IsFreeAndUnpaywalled([MODEL]), true, 'and it carries no paywall code');

console.log('\nuxr2 step 1 — the floating layers clear the system UI (pure)');
assertEq(scanDockBottomInset(0), SCAN_DOCK_MIN_BOTTOM, 'a device reporting no inset still gets a floor under the pill');
assert(scanDockBottomInset(48) > 48, 'a real gesture bar pushes the pill clear of it');
assert(
  scanDockBottomInset(0) > 0 && scanDockBottomInset(24) >= scanDockBottomInset(20),
  'and the offset never shrinks as the inset grows',
);
assertEq(scanTopChipInset(0), 8, 'the top chip has a floor of its own');
assertEq(scanTopChipInset(24), 32, 'and starts below the status bar when there is one');
assertEq(scanOverlayInsets({ top: 24, bottom: 48 }).top, 32, 'one measurement drives both floating layers');
assertEq(scanOverlayInsets({ top: 24, bottom: 48 }).bottom, 60, 'and both are returned by the same call');
assertEq(overlaysHold(), true, 'THE LAYOUT RULE: the controls clear the status bar and the gesture bar');

console.log('\nuxr2 step 1 — the flash toggle is a camera setting, spelled once');
assertEq(DEFAULT_SCAN_FLASH_MODE, 'off', 'a scan opens with the flash off');
assertEq(SCAN_FLASH_ORDER.join('→'), 'off→auto→on', 'the cycle is off, auto, on');
assertEq(nextScanFlashMode('off'), 'auto', 'one tap from off is auto');
assertEq(nextScanFlashMode('auto'), 'on', 'one tap from auto is on');
assertEq(nextScanFlashMode('on'), 'off', 'and it wraps back to off');
assertEq(nextScanFlashMode(undefined), 'off', 'an unknown mode lands on the default, never on undefined');
assertEq(scanFlashLabel('auto'), 'Flash auto', 'the toggle says which mode it is in');
assertEq(scanFlashShortLabel('on'), 'On', 'and the caption is one word');
assertEq(scanFlashIcon('on'), 'flash', 'each mode has its own icon');
assertEq(scanFlashIcon('off'), 'flash-off-outline', 'including off');
assertEq(scanFlashIcon('auto'), 'flash-outline', 'and auto');
assert(
  scanFlashControlLabel('off').indexOf('Flash off') >= 0 &&
    scanFlashControlLabel('off').indexOf('tap to change') > 0,
  'the accessible name says the mode and that tapping changes it',
);

console.log('\nuxr2 step 1 — the pill is a pill, and it is translucent');
assert(SCAN_PILL_RADIUS >= 24, `the pill's radius is a pill's radius (${SCAN_PILL_RADIUS})`);
assert(SCAN_TOUCH_MIN >= 44, 'the smallest control in it still meets the touch-target floor');
assert(SCAN_SHUTTER_SIZE > SCAN_TOUCH_MIN, 'and the shutter is bigger than that floor');
assert(
  /^rgba\(/.test(SCAN_SURFACE_TRANSLUCENT) && /^rgba\(/.test(SCAN_CHIP_TRANSLUCENT),
  'the pill and the chips are translucent, never opaque',
);
assert(SCAN_FILMSTRIP_HEIGHT < 96, 'the filmstrip is a row, not the old 96pt block');

console.log('\nuxr2 step 1 — the detail panel opens closed and is bounded');
assertEq(scanFindPanel(false).collapsed, true, 'the find panel starts collapsed');
assertEq(scanFindPanel(false).open, false, 'so nothing dense covers the preview while framing a page');
assertEq(scanFindPanel(true).open, true, 'and one tap opens it');
assertEq(scanFindPanel(undefined).collapsed, true, 'an unset state is closed, not open');
assertEq(scanFindSheetMaxHeight(0), SCAN_FIND_SHEET_MIN, 'a nonsense window height still gets a usable panel');
assert(
  scanFindSheetMaxHeight(800) <= SCAN_FIND_SHEET_MAX,
  'the panel is capped, so it cannot grow over the controls again (the v40 failure)',
);
assert(
  scanFindSheetMaxHeight(800) > 0 && scanFindSheetMaxHeight(2000) <= SCAN_FIND_SHEET_MAX,
  'and no window height lets it take the screen',
);

console.log('\nuxr2 step 1 — the capture flow’s own rules, unchanged by the move');
const idle = scanControlState({ capturing: false, pageCount: 0 });
assertEq(idle.shoot, true, 'an idle screen has a live shutter');
assertEq(idle.undo, false, 'Undo with no page is inert (the pre-redesign rule)');
assertEq(idle.finish, false, 'and so is Done');
const busy = scanControlState({ capturing: true, pageCount: 2 });
assertEq(busy.shoot, false, 'the shutter is spent while a capture is in flight');
assertEq(busy.flash, false, 'and the flash setting is not changed mid-capture');
assertEq(busy.undo, true, 'but a captured page can still be undone');
assertEq(busy.finish, true, 'and a two-page scan can be finished');
assertEq(scanControlState({ capturing: false, pageCount: 3 }).finish, true, 'three pages can be finished');
assertEq(scanControlState({ capturing: false, pageCount: Number.NaN }).undo, false, 'a nonsense count is no pages');
assertEq(scanPageCountLabel(0), 'No pages yet', 'the top chip says an empty scan is empty');
assertEq(scanPageCountLabel(1), '1 page in this scan', 'one page reads in the singular');
assertEq(scanPageCountLabel(4), '4 pages in this scan', 'and four read in the plural');
assertEq(SCAN_EMPTY_HINT, 'Frame the page, then tap the shutter.', 'the empty state tells the user the one action');

console.log('\nuxr2 step 1 — the owner’s three requirements, on the real screen');
assertEq(
  scanCameraFillsTheScreen(SCREEN),
  true,
  'THE FIX: the preview is pinned to all four edges and the header is gone — edge to edge',
);
assertEq(
  scanPillHostsTheControls(SCREEN),
  true,
  'THE FIX: the shutter/done/bin live in a floating pill, not a full-width opaque bottom bar',
);
assertEq(
  scanHasNoOpaqueFullWidthBar(SCREEN),
  true,
  'THE FIX: no opaque container spans the full width behind the controls',
);
assertEq(
  scanNothingCoversTheControls(SCREEN),
  true,
  'THE FIX: no overlay covers the shutter — the pill is the last layer and no scroller holds it',
);
assertEq(scanKeepsTheControlRules(SCREEN), true, 'every control is still enabled by the flow’s own rules');
assertEq(
  scanDeclutterStaysCollapsedByDefault(SCREEN),
  true,
  'the dense copy is behind one tap, and the strip only exists once a page does',
);
assertEq(scanKeepsTheHonestCopy(SCREEN), true, 'the honest lines survive, and the flow claims nothing new');

console.log('\nuxr2 step 1 — the relayout did not break the guards that were already green');
assertEq(
  scanSavesEveryPageAsItIsTaken(SCREEN),
  true,
  'v39 1a still holds: the page is written into the library as it is taken',
);
assertEq(
  scanFindOpensTheOneSearch({
    scanScreen: SCREEN,
    viewer: VIEWER,
    section: SECTION,
    host: FIND_PIECE,
  }),
  true,
  'v39 1b still holds: the page’s words open the ONE find-a-piece surface',
);
assertEq(
  scanFindCopyClaimsNoNoteReading([SCREEN]),
  true,
  'and this screen still claims no note reading and no edition',
);
assertEq(
  SCREEN.indexOf('SCAN_FIND_CTA') >= 0,
  true,
  'the collapsed face is the shared find-this-music label, not a new one',
);
assertEq(
  styleBlock(SCREEN, 'controlPill').indexOf('SCAN_SURFACE_TRANSLUCENT') >= 0,
  true,
  'the pill’s fill is the model’s translucent token',
);
assertEq(
  absoluteStyleNames(SCREEN).join(','),
  'dock,topFloat',
  'only two things are absolutely placed: the top chip and the bottom dock',
);
assertEq(
  SCREEN.indexOf('styles.topFloat') >= 0 && SCREEN.indexOf('styles.dock') >= 0,
  true,
  'and both of those floating layers exist in the render',
);

console.log('\nuxr2 step 1 — the gate knows about the new module and this suite');
assertEq(
  scanTier1ListsTheViewportWork(TSCONFIG, PACKAGE),
  true,
  'tsconfig.tier1.json and package.json both list the model, the contract and this suite',
);
assertEq(`"${UXR2_SUITE_PATH}"`.length > 0, true, `the suite path is ${UXR2_SUITE_PATH}`);

console.log('\nuxr2 step 1 — mutation probes (each one MUST fail its guard)');
// 1. THE OLD LETTERBOX: a camera with a floor in a column.
const letterboxed = mutate(
  SCREEN,
  '    ...StyleSheet.absoluteFillObject,\n',
  '    flex: 1,\n    minHeight: 140,\n',
);
probe('the preview keeps a flex floor again (the letterboxed camera)', letterboxed, SCREEN, () =>
  scanCameraFillsTheScreen(letterboxed),
);
// 2. The navigator's own opaque header comes back over the preview.
const headerBack = mutate(
  SCREEN,
  'setOptions({ headerShown: false })',
  'setOptions({ headerShown: true })',
);
probe('the route keeps its opaque navigator header over the preview', headerBack, SCREEN, () =>
  scanCameraFillsTheScreen(headerBack),
);
// 3. The pill becomes an opaque bar — the owner's "heavy white bar".
const opaquePill = mutate(
  SCREEN,
  'backgroundColor: SCAN_SURFACE_TRANSLUCENT',
  "backgroundColor: '#16213e'",
);
probe('the pill turns opaque (the heavy bottom bar is back)', opaquePill, SCREEN, () =>
  scanPillHostsTheControls(opaquePill),
);
// 4. The pill is stretched edge to edge.
const fullWidthPill = mutate(SCREEN, "maxWidth: '96%',", "width: '100%',");
probe('the pill is stretched the full width of the screen', fullWidthPill, SCREEN, () =>
  scanPillHostsTheControls(fullWidthPill),
);
// 5. The pill is squared off into a bar.
const squarePill = mutate(SCREEN, 'borderRadius: SCAN_PILL_RADIUS,', 'borderRadius: 2,');
probe('the pill is squared off (a bar again)', squarePill, SCREEN, () =>
  scanPillHostsTheControls(squarePill),
);
// 6. A control leaves the pill.
const controlOutsideThePill = mutate(
  SCREEN,
  'onPress={() => void finish()}',
  'onPress={() => undefined}',
);
probe('the Done control stops finishing the scan', controlOutsideThePill, SCREEN, () =>
  scanPillHostsTheControls(controlOutsideThePill),
);
// 7. A control is rendered twice (one copy outside the pill).
const doneRenderedTwice = mutate(
  SCREEN,
  '        <View style={styles.controlPill}>',
  '        <Pressable onPress={() => void finish()} />\n        <View style={styles.controlPill}>',
);
probe('a second Done control is rendered outside the pill', doneRenderedTwice, SCREEN, () =>
  scanPillHostsTheControls(doneRenderedTwice),
);
// 8. The flash toggle stops toggling.
const deadFlash = mutate(
  SCREEN,
  'onPress={() => setFlash(nextScanFlashMode(flash))}',
  'onPress={() => undefined}',
);
probe('the flash toggle becomes a button that does nothing', deadFlash, SCREEN, () =>
  scanPillHostsTheControls(deadFlash),
);
// 9. The dock regains an opaque fill behind the controls.
const opaqueDock = mutate(
  SCREEN,
  "    bottom: 0,\n    alignItems: 'center',",
  "    bottom: 0,\n    backgroundColor: '#16213e',\n    alignItems: 'center',",
);
probe('an opaque container spans the full width behind the controls', opaqueDock, SCREEN, () =>
  scanHasNoOpaqueFullWidthBar(opaqueDock),
);
// 10. A new full-bleed overlay is slipped in above the camera.
const extraOverlay = mutate(
  SCREEN,
  '  centered: {',
  "  overlayBar: {\n    position: 'absolute',\n    left: 0,\n    right: 0,\n    bottom: 0,\n    height: 72,\n    backgroundColor: '#10101c',\n  },\n  centered: {",
);
probe('a new full-width overlay is placed over the preview', extraOverlay, SCREEN, () =>
  scanHasNoOpaqueFullWidthBar(extraOverlay),
);
// 11. The dock stops centring its layers (the pill stretches and meets the edge).
const dockStretched = mutate(SCREEN, "    bottom: 0,\n    alignItems: 'center',", '    bottom: 0,');
probe('the bottom stack stops centring the pill', dockStretched, SCREEN, () =>
  scanNothingCoversTheControls(dockStretched),
);
// 12. The detail panel is allowed to take the window (the v40 failure).
const unboundedPanel = mutate(
  SCREEN,
  'maxHeight: scanFindSheetMaxHeight(windowHeight)',
  'maxHeight: windowHeight',
);
probe('the detail panel may grow to the whole window', unboundedPanel, SCREEN, () =>
  scanNothingCoversTheControls(unboundedPanel),
);
// 13. The enablement rules stop coming from the pure model.
const hardcodedDisabled = mutate(SCREEN, 'disabled={!controls.undo}', 'disabled={false}');
probe('Undo is enabled by hand instead of by the flow’s rule', hardcodedDisabled, SCREEN, () =>
  scanKeepsTheControlRules(hardcodedDisabled),
);
// 14. The capture flow loses the shutter's write.
const noWrite = mutate(SCREEN, 'void capturePage()', 'void 0');
probe('the shutter stops capturing', noWrite, SCREEN, () => scanKeepsTheCaptureFlow(noWrite));
// 15. The words never reach the one search.
const noSearchHandoff = mutate(SCREEN, 'onSearch={setFindQuery}', 'onSearch={() => undefined}');
probe('the page’s words never reach the find-a-piece search', noSearchHandoff, SCREEN, () =>
  scanKeepsTheCaptureFlow(noSearchHandoff),
);
// 16. The find surface loses its way back to the scan.
const noClose = mutate(SCREEN, 'onClose={() => setFindQuery(null)}', 'onClose={() => undefined}');
probe('the find surface can no longer return to the scan', noClose, SCREEN, () =>
  scanKeepsTheCaptureFlow(noClose),
);
// 17. The reader is handed no page.
const noPage = mutate(SCREEN, 'pageUri={lastPageUri}', 'pageUri={null}');
probe('the device reader is handed no page to read', noPage, SCREEN, () =>
  scanKeepsTheCaptureFlow(noPage),
);
// 18. Done leaves before the session is closed.
const noCloseSession = mutate(SCREEN, 'endScanSession(sessionId)', 'void 0');
probe('Done leaves without closing the scan session', noCloseSession, SCREEN, () =>
  scanKeepsTheCaptureFlow(noCloseSession),
);
// 19. The honest durability line is dropped.
const noHonestLine = mutate(SCREEN, '{SCAN_SAVED_AS_YOU_GO_LINE}', '{null}');
probe('the "saved as you go" line disappears', noHonestLine, SCREEN, () =>
  scanKeepsTheHonestCopy(noHonestLine),
);
// 20. A note-reading claim creeps into the flow's copy.
const bannedClaim = mutate(
  SCREEN,
  'export const ScanScoreScreen',
  "const SCAN_CLAIM = 'transcription';\nexport const ScanScoreScreen",
);
probe('a note-reading claim is added to the scan screen', bannedClaim, SCREEN, () =>
  scanKeepsTheHonestCopy(bannedClaim),
);
// 21. The detail panel opens by default (dense again).
const openByDefault = mutate(
  SCREEN,
  'const [findOpen, setFindOpen] = useState(false)',
  'const [findOpen, setFindOpen] = useState(true)',
);
probe('the dense detail panel opens with the screen', openByDefault, SCREEN, () =>
  scanDeclutterStaysCollapsedByDefault(openByDefault),
);
// 22. The filmstrip goes back to an opaque block.
const opaqueStrip = mutate(SCREEN, 'height: SCAN_FILMSTRIP_HEIGHT,', 'maxHeight: 96,');
probe('the filmstrip is an opaque 96pt block again', opaqueStrip, SCREEN, () =>
  scanDeclutterStaysCollapsedByDefault(opaqueStrip),
);
// 23. The pure layout rule stops clearing the system bars.
probe('the pill sits at the screen edge under the gesture bar', 'zero-insets', 'real-insets', () =>
  scanOverlaysClearSystemBars({
    top: () => 0,
    bottom: () => 0,
    state: scanControlState,
    flashCycle: nextScanFlashMode,
  }),
);
const permissiveState = () => ({ shoot: true, undo: true, finish: true, flash: true });
probe('every control is enabled whatever the flow is doing', 'permissive', 'real', () =>
  scanOverlaysClearSystemBars({
    top: scanTopChipInset,
    bottom: scanDockBottomInset,
    state: permissiveState,
    flashCycle: nextScanFlashMode,
  }),
);
const stuckFlash = () => 'off';
probe('the flash toggle never leaves off', 'stuck', 'real', () =>
  scanOverlaysClearSystemBars({
    top: scanTopChipInset,
    bottom: scanDockBottomInset,
    state: scanControlState,
    flashCycle: stuckFlash,
  }),
);
// 24/25. The gate itself stops knowing about the work.
const unregisteredPackage = mutate(
  PACKAGE,
  `/tmp/tier1-test/${UXR2_SUITE_PATH.replace(/\.ts$/, '.js')}`,
  '/tmp/tier1-test/scripts/not-this-suite.test.js',
);
probe('the gate’s npm script forgets this suite', unregisteredPackage, PACKAGE, () =>
  scanTier1ListsTheViewportWork(TSCONFIG, unregisteredPackage),
);
const unregisteredTsconfig = mutate(TSCONFIG, `"${UXR2_PURE_MODEL_PATH}"`, '"src/services/elsewhere.ts"');
probe('the gate’s tsconfig forgets the layout model', unregisteredTsconfig, TSCONFIG, () =>
  scanTier1ListsTheViewportWork(unregisteredTsconfig, PACKAGE),
);
// 26. A stub screen satisfies nothing.
probe('the guards are read against an empty screen', 'empty', 'real', () =>
  scanCameraFillsTheScreen(''),
);
probe('and against an empty model list', 'empty', 'real', () => scanPillHostsTheControls(''));
probe('and the honesty sweep is not vacuous', 'empty', 'real', () =>
  scanKeepsTheHonestCopy(''),
);
// The section this screen hosts must still be the same shared section.
assertEq(SCAN_FIND.length > 1500, true, 'the shared find section was read (the money path’s half)');
assertEq(
  SECTION.indexOf('readCoverText(') >= 0,
  true,
  'and it still reads the page’s printed words on device',
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
