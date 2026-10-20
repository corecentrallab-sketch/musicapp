/**
 * v39FixContract.ts — LIVE-SOURCE GUARDS FOR THE THREE OWNER-REPORTED v38 BUGS
 * (owner 10-11; backlog: CAMERA SCAN-TO-LIBRARY FLOW, PRACTICE VIDEO START
 * BUTTON, HISTORY SAVED PRACTICE VIDEO).
 *
 * WHY THESE EXIST. There is no emulator here, so the tier1 gate is the only thing
 * between a fix and the owner's phone. Each of the three bugs was a property that
 * lived in the wiring rather than in a pure rule, so each fix gets a guard that
 * reads the REAL file and goes FALSE when the fix is undone:
 *
 *   FIX 1a  the scan writes every page into the library AS IT IS TAKEN, and picks
 *           an open scan back up — the pages can no longer live only in the
 *           screen's own state;
 *   FIX 1b  a scanned page reaches the app's ONE search (read the printed words,
 *           confirm them, open the find-a-piece surface) and builds no URL and no
 *           second search of its own — no note-reading claim anywhere in the copy;
 *   FIX 2   the record surface films only after an explicit Start press: the
 *           camera coming up is not a trigger, and the arming copy says so;
 *   FIX 3   a History row starts in the playback phase, and the watch surface is
 *           the tab's own body instead of a sibling laid out below the list.
 *
 * Comments are masked before every check, so a documented-but-absent call can
 * never satisfy a guard. PURE: no react, no react-native, no fs, no network.
 */
import { maskComments } from './modalBackContract';
// v42 fix D re-pointed FIX 1b's host half: the words a scan read are a proposal
// the user confirms, not a query the screen runs (services/uxrV42Contract.ts).
import { ocrPrefillIsExplicit } from './uxrV42Contract';

// ─── THE FILES THESE FIXES OWN ───────────────────────────────────────────────

export const V39_CONTRACT_PATH = 'src/services/v39FixContract.ts';
export const V39_SCAN_SCREEN_PATH = 'src/screens/ScanScoreScreen.tsx';
export const V39_SCANNED_VIEWER_PATH = 'src/screens/ScannedViewerScreen.tsx';
export const V39_SCAN_SECTION_PATH = 'src/components/ScanFindSection.tsx';
export const V39_SCAN_FIND_PATH = 'src/services/scanFind.ts';
export const V39_LIBRARY_STORE_PATH = 'src/services/libraryStore.ts';
export const V39_FIND_PIECE_PATH = 'src/screens/FindPieceScreen.tsx';

/**
 * The mount token the scan doors must pass to the one find-a-piece search.
 * Built by split/join so this contract file never contains the full
 * JSX-shaped mount sequence as contiguous text: the backExit live scan reads
 * every src file and would flag that literal itself as a mount with no onClose
 * (it is a string, not real JSX) — the same rule that keeps code-shaped tokens
 * out of comments.
 */
export const FIND_PIECE_MOUNT = ['<FindPiece', 'Screen initialQuery={findQuery}'].join('');
export const V39_VIDEO_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const V39_VIDEO_REF_PATH = 'src/services/practiceVideoRef.ts';
export const V39_HISTORY_PATH = 'src/screens/HistoryScreen.tsx';
export const V39_OCR_PATH = 'src/services/coverScanOcr.ts';

/** The modules and suites the tier1 gate must compile and run (v39 additions). */
export const V39_TIER1_MODULES: readonly string[] = [
  'src/services/scanFind.ts',
  'src/services/v39FixContract.ts',
  'scripts/v39Fixes.test.ts',
];
export const V39_TIER1_SUITES: readonly string[] = ['scripts/v39Fixes.test.ts'];

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1a — THE SCAN SAVES AS IT GOES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG. Every page lived in the scan screen's own React state and the score
 * was written once, at the end: the reported teardown ("the app minimises itself
 * back to the menu") therefore lost the whole capture — no photo, no library row.
 *
 * THE PROPERTY. A capture writes through the store IMMEDIATELY: the first page
 * opens the session (`startScanSession`), later pages are appended
 * (`appendScanSessionPage`), both AFTER the shutter call in this file (so they are
 * the capture's own write, not an end-of-flow save), the screen reads an unfinished
 * scan back on mount (`getOpenScanSession`), and the retired one-shot writer
 * (`createScannedScore`) is no longer called from this screen at all — because a
 * one-shot write at the end is exactly what lost the pages.
 */
export function scanSavesEveryPageAsItIsTaken(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 4000) return false;
  const shutter = src.indexOf('takePictureAsync(');
  const open = src.indexOf('startScanSession(');
  const append = src.indexOf('appendScanSessionPage(');
  if (shutter < 0 || open < 0 || append < 0) return false;
  // The write belongs to the capture that follows the shutter, not to a save at
  // the end of the flow.
  if (open < shutter || append < shutter) return false;
  if (src.indexOf('getOpenScanSession(') < 0) return false;
  if (src.indexOf('createScannedScore(') >= 0) return false;
  // The strip is fed by what the store returned, never by a re-derived list.
  if (src.indexOf('saved.pageUris') < 0) return false;
  // …and the finish action closes the session before leaving the screen.
  const close = src.indexOf('endScanSession(');
  const back = src.indexOf('navigation.goBack()');
  if (close < 0 || back < 0 || close > back) return false;
  // A scanned page never leaves the device: this path makes no network call.
  return src.indexOf('fetch(') < 0;
}

/**
 * The store half: the file is copied into app storage BEFORE the registry write
 * that names it (the cache-eviction trap), the open-session marker is a field on
 * the item itself (so it survives a restart), and the undo removes BOTH the file
 * and its registry entry — a strip that disagrees with the disk is how a page goes
 * missing again.
 */
export function scanStorePersistsBeforeItNamesThePage(storeSource: string): boolean {
  const src = maskComments(storeSource);
  if (src.length < 4000) return false;
  if (src.indexOf('export async function startScanSession(') < 0) return false;
  if (src.indexOf('export async function appendScanSessionPage(') < 0) return false;
  if (src.indexOf('export async function getOpenScanSession(') < 0) return false;
  if (src.indexOf('export async function endScanSession(') < 0) return false;
  if (src.indexOf('export async function removeScanSessionPage(') < 0) return false;
  if (src.indexOf('FileSystem.documentDirectory') < 0) return false;
  const append = src.indexOf('export async function appendScanSessionPage(');
  const body = src.slice(append, append + 1400);
  const copy = body.indexOf('copyAsync(');
  const write = body.indexOf('persistLibrary(');
  if (copy < 0 || write < 0 || copy > write) return false;
  const open = src.indexOf('export async function startScanSession(');
  const openBody = src.slice(open, open + 1400);
  if (openBody.indexOf('copyAsync(') < 0) return false;
  if (openBody.indexOf('persistLibrary(') < 0) return false;
  if (openBody.indexOf('scanSessionOpen: true') < 0) return false;
  // The undo deletes the file as well as dropping the entry.
  const undo = src.indexOf('export async function removeScanSessionPage(');
  const undoBody = src.slice(undo, undo + 1600);
  return undoBody.indexOf('deleteAsync(') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1b — THE SCANNED SCORE REACHES THE ONE SEARCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The money path, read from the two hosts and the shared section: the page goes
 * through the app's existing on-device reader, the read decides what may be
 * searched, the confirmed words are handed to the host, and the host opens the
 * EXISTING find-a-piece surface with them. Nothing here builds a retailer URL or
 * a second search: this path is a reader plus the one search the app already has.
 */
export function scanFindOpensTheOneSearch(sources: {
  scanScreen: string;
  viewer: string;
  section: string;
  host: string;
}): boolean {
  const screen = maskComments(sources?.scanScreen ?? '');
  const viewer = maskComments(sources?.viewer ?? '');
  const section = maskComments(sources?.section ?? '');
  const host = maskComments(sources?.host ?? '');
  if (screen.length < 4000 || viewer.length < 2000) return false;
  if (section.length < 1500 || host.length < 2000) return false;
  // The section: the ONE reader, the ONE decision, and the confirmed query out.
  if (section.indexOf('readCoverText(') < 0) return false;
  if (section.indexOf('scanFindView(') < 0) return false;
  if (section.indexOf('onSearch(') < 0) return false;
  // RE-POINTED by v43 item C: the one resolve page has SEVERAL `onSearch(`
  // call sites (a candidate's own title, the typed title, the read words), so a
  // bare `onSearch(` check no longer proves the READ reaches the search — it
  // stayed true with the read's own hand-off deleted, and the v39 mutation probe
  // ("the read never reaches the search") caught exactly that. The confirmed read
  // must be one of those call sites.
  if (section.indexOf('onSearch(confirmed)') < 0) return false;
  if (section.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(section)) return false;
  // Both doors render it and hand the query on.
  if (screen.indexOf('<ScanFindSection') < 0) return false;
  if (viewer.indexOf('<ScanFindSection') < 0) return false;
  if (viewer.indexOf('onSearch={setFindQuery}') < 0) return false;
  // …and the host is the existing search, opened with those words.
  // (Built by split/join so this contract file never contains a contiguous
  // `<FindPieceScreen …` token — the backExit live scan reads every src file
  // and would otherwise flag this literal itself as a mount without onClose.)
  if (screen.indexOf(FIND_PIECE_MOUNT) < 0) return false;
  if (viewer.indexOf(FIND_PIECE_MOUNT) < 0) return false;
  if (host.indexOf('initialQuery?: string') < 0) return false;
  // RE-POINTED by v42 fix D (owner, v41 device pass 10-20): the words a scan read
  // are a PROPOSAL, not a query. The host still takes them (`initialQuery`), but
  // it seeds a VISIBLE, EDITABLE prefill the user confirms — it must not seed the
  // debounced search (that made a photo's words an invisible auto-query), and the
  // one control that turns the proposal into a search must be rendered. That half
  // is asserted by `ocrPrefillIsExplicit` (services/uxrV42Contract.ts).
  if (!ocrPrefillIsExplicit(sources.host ?? '')) return false;
  // The scan path itself never builds a retailer link (the host owns the money
  // path): no affiliate/search URL tokens in the two scan surfaces.
  for (const src of [screen, viewer, section]) {
    if (src.indexOf('sheetMusicDirectSearchUrl') >= 0) return false;
    if (/https?:\/\//.test(src)) return false;
  }
  return true;
}

/**
 * WHAT THIS PATH MAY CLAIM. It reads printed WORDS to search for a piece. It does
 * not read the printed notes, is not OMR, and claims no edition — so none of those
 * words may appear in the flow's user-facing sources (comments are masked, so a
 * comment may discuss the rule).
 */
export const SCAN_BANNED_CLAIMS: readonly string[] = [
  'omr',
  'optical music recognition',
  'transcription',
  'transcribed',
  'transcribe',
  'note extraction',
];

export function scanFindCopyClaimsNoNoteReading(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 400) return false;
    for (const claim of SCAN_BANNED_CLAIMS) {
      const pattern = new RegExp(claim.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      if (pattern.test(src)) return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 — THE RECORD SURFACE WAITS FOR START
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner, 10-11): "it starts recording immediately — users will need to
 * manually press start to operate and turn the phone around".
 *
 * THE PROPERTY. Two facts, both in the real file: what the camera-ready callback
 * does (it may arm the control — it may NOT start either capture), and what the
 * Start control does (one press, both captures, through the handler the screen
 * already used). The start call moved out of the ready path, so the record flow
 * cannot begin on its own.
 */
export function practiceVideoFilmsOnlyAfterAPress(screenSource: string, refSource: string): boolean {
  const src = maskComments(screenSource);
  const ref = maskComments(refSource);
  if (src.length < 4000 || ref.length < 2000) return false;
  // The camera-ready handler must not start either capture.
  const ready = src.indexOf('const handleCameraReady = useCallback(');
  if (ready < 0) return false;
  const readyBody = src.slice(ready, ready + 400);
  if (readyBody.indexOf('startBothCaptures(') >= 0) return false;
  if (readyBody.indexOf('setCameraReady(true)') < 0) return false;
  // The Start control: its own handler, wired to the one start seam.
  const start = src.indexOf('const handleStart = useCallback(');
  if (start < 0) return false;
  const startBody = src.slice(start, start + 600);
  if (startBody.indexOf('startBothCaptures()') < 0) return false;
  if (startBody.indexOf('PRACTICE_VIDEO_CAMERA_NOT_READY_LINE') < 0) return false;
  if (src.indexOf('onPress={handleStart}') < 0) return false;
  if (src.indexOf('{PRACTICE_VIDEO_START_CTA}') < 0) return false;
  if (src.indexOf('onCameraReady={handleCameraReady}') < 0) return false;
  // …and the arming copy tells the truth about who starts it.
  if (ref.indexOf('export const PRACTICE_VIDEO_START_CTA') < 0) return false;
  const arming = ref.indexOf('PRACTICE_VIDEO_ARMING_LINE');
  if (arming < 0) return false;
  const armingLine = ref.slice(arming, ref.indexOf('\n', arming));
  if (armingLine.indexOf('Start') < 0) return false;
  return armingLine.indexOf('on its own') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3 — A SAVED PRACTICE VIDEO PLAYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner, 10-11): tapping a History row with a practice video "opens the
 * screen but playback never shows".
 *
 * THE PROPERTY, in two halves:
 *   • the SCREEN states its mode in the phase machine — a row is requested, so the
 *     phase STARTS at playback and the record body (and its camera) is unreachable
 *     from there. The retired second flag is gone: one decision, not two;
 *   • the HOST renders the watch surface as its own body, ABOVE the list it used to
 *     sit under. A sibling after a full-height list is laid out below the fold —
 *     mounted, correct, invisible — which is exactly what the owner saw.
 */
export function historyPracticeVideoStartsInPlayback(
  screenSource: string,
  historySource: string,
): boolean {
  const src = maskComments(screenSource);
  const history = maskComments(historySource);
  if (src.length < 4000 || history.length < 20000) return false;
  // The phase union carries playback, and the phase STARTS there for a named row.
  if (src.indexOf("| 'playback'") < 0) return false;
  const phaseState = src.indexOf('useState<PracticeVideoPhase>(');
  if (phaseState < 0) return false;
  const initial = src.slice(phaseState, phaseState + 160);
  if (initial.indexOf("'playback'") < 0 || initial.indexOf("'permissions'") < 0) return false;
  if (initial.indexOf('watchMode') < 0) return false;
  // One mode test, and the record body (with the camera) sits after it.
  const playbackBranch = src.indexOf("if (phase === 'playback')");
  // The JSX mount is the multiline idiom `<CameraView\n ref=…`; the type usage
  // `useRef<CameraView>` ends in `>` and must not count as the record body.
  const camera = src.search(/<CameraView[^>]/);
  if (playbackBranch < 0 || camera < 0) return false;
  if (playbackBranch > camera) return false;
  if (src.indexOf('<Video') < 0) return false;
  // The retired second flag would let the two decisions drift apart again.
  if (src.indexOf('setPlaying(') >= 0) return false;
  // The host: the watch surface is the body, reached BEFORE the list renders…
  const surface = history.indexOf('<PracticeVideoScreen');
  const list = history.indexOf('<FlatList');
  if (surface < 0 || list < 0) return false;
  if (surface > list) return false;
  // …it is a body replacement, not an appended sibling…
  const gate = history.indexOf('if (watchVideoId)');
  if (gate < 0 || gate > surface) return false;
  const gateSlice = history.slice(gate, surface);
  if (gateSlice.indexOf('return (') < 0) return false;
  if (gateSlice.indexOf('</View>') >= 0) return false;
  // …and it opens out of the press event (the v37 lesson): mounting a player in
  // the middle of the gesture is how the list's own scrolling breaks.
  return history.indexOf('requestAnimationFrame(() => setWatchVideoId(') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GATE ITSELF
// ─────────────────────────────────────────────────────────────────────────────

/** Both tier1 lists must name this round's new module and suite, or nothing above runs. */
export function tier1ListsTheV39Fixes(tsconfigSource: string, packageSource: string): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  if (tsconfigSource.length < 2000 || packageSource.length < 500) return false;
  for (const module of V39_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${module}"`) < 0) return false;
  }
  for (const suite of V39_TIER1_SUITES) {
    const compiled = suite.replace(/\.ts$/, '.js');
    if (packageSource.indexOf(`/tmp/tier1-test/${compiled}`) < 0) return false;
  }
  return true;
}
