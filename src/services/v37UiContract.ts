/**
 * v37UiContract.ts — THE LIVE-SOURCE GUARDS FOR THE v37 BATCH.
 *
 * WHY THIS MODULE EXISTS. The v34/v36 batches proved the pattern twice over: a
 * fix that "is in the source" and does not reach the owner failed because the
 * property being asserted was the WRONG property. This batch is the third owner
 * pass, and both of its items are structural, so both need a guard that reads the
 * real file (skill `musicapp-tier1-live-scan-suite`) and is PROVEN to bite by a
 * mutation of that file (skill `musicapp-guard-mutation-probes`).
 *
 *   ITEM 1 (backlog 3ff40fd1, owner FAIL #8): "the Correct Your Take page opened
 *   from a History row does not scroll". Everything checkable was already right —
 *   every WebView on the page is shielded, the drag layer shares the gesture — so
 *   what is left is a NATIVE scroller that entered a bad state and stayed in it.
 *   The page's ScrollView therefore carries NO `scrollEnabled` PROP AT ALL (no
 *   editor state can switch the page off; v36's constant-`true` flag was one
 *   stuck value away from freezing the page for a whole session) and is REMOUNTED
 *   on every open with a session `key` (`editor-page-${pageSession}`, bumped
 *   inside `if (opened)`), so a scroller that got stuck cannot follow the user
 *   into the next session. The History row also opens the editor OUT of the press
 *   event (`requestAnimationFrame`), because a modal mounted inside a touch
 *   handler is the other classic way a fresh native scroller arrives wedged.
 *
 *   ITEM 2 (backlog 9e71e467 + a3a6da0c, owner FAIL #3): "the transposed copy
 *   re-opens showing only ~4 bars". A non-interactive viewer cannot scroll
 *   itself, so it shows exactly as much score as its box is tall; the notation
 *   editor's box was a `minHeight` and nothing else, so a longer score was
 *   CLIPPED. The viewer's document now measures and reports its height
 *   (services/scoreHeight.ts), the viewer applies it (taking itself OFF the flex
 *   axis, or the `flexBasis: 0` of `flex: 1` wins and nothing grows), and the
 *   editor grows the box around it. The same item adds the way BACK: an
 *   always-visible "Revert to original" control that returns the offset to 0 AND
 *   restores the ABC the editor LOADED (never a recomputed approximation).
 *
 * PURE: no react, no react-native, no fs. The disk walk lives in
 * scripts/v37UiWiring.test.ts, which also mutates the real files in memory and
 * asserts every guard FAILS on the mutated text; the same mutations are applied
 * on disk with the failing lines captured in
 * /home/team/shared/v37-mutation-probes.txt.
 *
 * Comments are masked before every check, so a documented-but-absent prop can
 * never satisfy a guard.
 */
import { maskComments } from './modalBackContract';

/** The page scroller's own style — what makes it THE page scroller. */
export const PAGE_SCROLLER_STYLE = 'style={styles.page}';

/**
 * THE PAGE SCROLLER'S SESSION KEY (v37 item 1), verbatim. It is a React key, so
 * every bump REMOUNTS the native ScrollView: this is the whole mechanism by which
 * one bad native scroller cannot outlive the session it went bad in.
 */
export const EDITOR_PAGE_KEY = 'key={`editor-page-${pageSession}`}';

/** The statement that bumps the session — it must live inside `if (opened)`. */
export const EDITOR_PAGE_KEY_BUMP = 'setPageSession((session) => session + 1)';

function countOf(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * THE PAGE'S SCROLLER'S OPENING TAG (THE SHARED HELPER — v37 item 1).
 *
 * Four guards across three batches need to talk about THIS scroller and not the
 * two horizontal ones on the same page (the note lane and the chord rail), so the
 * way to find it lives here once: the first `<ScrollView` whose opening tag
 * carries `style={styles.page}`. Returns null when the page has no such scroller
 * — every caller treats that as a failure, never as "no opinion".
 */
export function pageScrollerTagOf(editorSource: string): string | null {
  const src = maskComments(editorSource);
  let from = 0;
  while (from < src.length) {
    const open = src.indexOf('<ScrollView', from);
    if (open < 0) return null;
    const to = src.indexOf('>', open);
    if (to < 0) return null;
    const tag = src.slice(open, to + 1);
    if (tag.indexOf(PAGE_SCROLLER_STYLE) >= 0) return tag;
    from = to + 1;
  }
  return null;
}

/**
 * 1a. THE PAGE'S SCROLLER CAN NEVER BE SWITCHED OFF (v37 item 1).
 *
 * The scroller carries NO `scrollEnabled` prop AT ALL, is a real bounded box
 * (`style={styles.page}`, `nestedScrollEnabled` for the horizontal lane inside
 * it) and carries the session key. A `scrollEnabled={true}` literal is a FAILURE
 * here on purpose: v36 shipped exactly that constant, and a constant is one
 * refactor away from being computed from editor state again — the only shape that
 * cannot regress is a prop that does not exist.
 */
export function editorPageScrollerIsNeverSwitchedOff(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 8000) return false;
  const tag = pageScrollerTagOf(src);
  if (tag === null) return false;
  if (tag.indexOf('scrollEnabled') >= 0) return false;
  if (tag.indexOf('nestedScrollEnabled') < 0) return false;
  if (tag.indexOf(EDITOR_PAGE_KEY) < 0) return false;
  return true;
}

/** Is `needle` inside an `if (opened) …` statement of this source? */
function insideIfOpened(source: string, needle: string): boolean {
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('if (opened)', from);
    if (at < 0) return false;
    let cursor = at + 'if (opened)'.length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    let end: number;
    if (source[cursor] === '{') {
      let depth = 0;
      end = -1;
      for (let i = cursor; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) return false;
    } else {
      const semi = source.indexOf(';', cursor);
      end = semi < 0 ? source.length : semi;
    }
    if (source.slice(cursor, end).indexOf(needle) >= 0) return true;
    from = end + 1;
  }
  return false;
}

/**
 * 1b. EVERY OPEN GETS A FRESH NATIVE SCROLLER (v37 item 1) — the mechanism, as
 * three facts that must hold together: the scroller is keyed on the session, the
 * session is state, and the bump happens on the open edge (`if (opened)`, which
 * is the same edge that resets the view — a bump on every render would remount the
 * page (and drop its scroll position) continuously).
 */
export function editorOpensAFreshPageScroller(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 8000) return false;
  const tag = pageScrollerTagOf(src);
  if (tag === null) return false;
  if (tag.indexOf(EDITOR_PAGE_KEY) < 0) return false;
  if (src.indexOf('const [pageSession, setPageSession] = useState(0)') < 0) return false;
  return insideIfOpened(src, EDITOR_PAGE_KEY_BUMP);
}

/**
 * 1c. EVERY SCORE ON THE PAGE IS DECORATION (v37 item 1, the v36 fix that must
 * not be undone while fixing the scroller): a WebView is a native view outside
 * RN's responder system, so a score left interactive takes the page's scroll
 * gesture. EVERY `<AbcScoreView>` and every `<TakeStaffCard>` in the editor must
 * say `interactive={false}`, and each must appear at least once (a guard that
 * passes because the tag is gone is vacuous).
 */
export function everyEditorScoreIsNonInteractive(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 8000) return false;
  let covered = 0;
  for (const name of ['<AbcScoreView', '<TakeStaffCard']) {
    let from = 0;
    let seen = 0;
    while (true) {
      const open = src.indexOf(name, from);
      if (open < 0) break;
      const close = src.indexOf('/>', open);
      if (close < 0) return false;
      const tag = src.slice(open, close + 2);
      if (tag.indexOf('interactive={false}') < 0) return false;
      seen += 1;
      from = close + 2;
    }
    if (seen === 0) return false;
    covered += seen;
  }
  return covered >= 2;
}

/**
 * 1d. THE HISTORY DOOR OPENS THE EDITOR OUT OF THE PRESS EVENT (v37 item 1).
 * `historySource` is src/screens/HistoryScreen.tsx.
 *
 * The owner's door is the row's Correct-Notes button. A modal mounted INSIDE a
 * touch handler is the other classic way a fresh native scroller arrives wedged
 * (the gesture that opened it is still being delivered), so the open is deferred
 * one frame. The editor must still be given the ROW's take and the ROW's id — a
 * deferred open that loses either would open an empty or incorrect editor — and
 * the inline `onPress={() => setEditTake(item)}` shape must NOT be there.
 */
export function historyDoorOpensTheEditorOutsideThePressEvent(historySource: string): boolean {
  const src = maskComments(historySource);
  if (src.length < 20000) return false;
  if (src.indexOf('requestAnimationFrame(() => setEditTake(item))') < 0) return false;
  if (src.indexOf('take={editTake.capture ?? null}') < 0) return false;
  if (src.indexOf('rowId={editTake.id}') < 0) return false;
  return !/onPress=\{\(\) => setEditTake\(/.test(src);
}

/**
 * 2a. THE VIEWER MEASURES AND REPORTS ITS OWN DOCUMENT (v37 item 2).
 * `abcViewSource` is src/components/AbcScoreView.tsx.
 *
 * Four facts, each one a silent way for the fix to be inert:
 *   • the probe is actually INJECTED into the document (`abcHeightProbeScript()`);
 *   • the message is READ through the pure parser (`abcHeightFromMessage(` over
 *     the event's own data — not a guessed string), and the WebView has an
 *     `onMessage` at all;
 *   • the applied height goes through `abcScoreContainerHeight`, so an
 *     interactive viewer keeps its caller's box;
 *   • the applied style takes the container OFF the flex axis — `flex: 1` means
 *     `flexBasis: 0`, which WINS over a `height` on the main axis, so a fix that
 *     set only `height` would change nothing at all.
 */
export function scoreViewerReportsItsOwnHeight(abcViewSource: string): boolean {
  const src = maskComments(abcViewSource);
  if (src.length < 2000) return false;
  if (src.indexOf("from '../services/scoreHeight'") < 0) return false;
  if (src.indexOf('abcHeightProbeScript()') < 0) return false;
  if (src.indexOf('onMessage={') < 0) return false;
  if (src.indexOf('abcHeightFromMessage(event.nativeEvent.data)') < 0) return false;
  if (
    src.indexOf('abcScoreContainerHeight({ interactive, measuredHeight: measured.height })') < 0
  ) {
    return false;
  }
  return src.indexOf('{ flex: 0, height: appliedHeight }') >= 0;
}

/**
 * 2b. THE NOTATION EDITOR'S SCORE BOX GROWS TO THE SCORE (v37 item 2).
 * `notationSource` is src/screens/NotationEditorScreen.tsx.
 *
 * The call site must hand the viewer the measurement (`onDocumentHeight={`) while
 * keeping it non-interactive, the measurement must be clamped through the same
 * pure rule (`setScoreHeight(abcScoreContainerHeight(`), and it must actually
 * reach the box the score sits in — as a growing `minHeight`, so the v36 floor
 * still stands and a long score can no longer be clipped.
 */
export function notationEditorGrowsTheScoreBox(notationSource: string): boolean {
  const src = maskComments(notationSource);
  if (src.length < 5000) return false;
  const open = src.indexOf('<AbcScoreView');
  if (open < 0) return false;
  const close = src.indexOf('/>', open);
  if (close < 0) return false;
  const tag = src.slice(open, close + 2);
  if (tag.indexOf('interactive={false}') < 0) return false;
  if (tag.indexOf('onDocumentHeight={') < 0) return false;
  if (src.indexOf('setScoreHeight(abcScoreContainerHeight({') < 0) return false;
  if (src.indexOf('styles.scoreStaffBox') < 0) return false;
  return /minHeight:\s*Math\.max\(/.test(src);
}

/**
 * 2c. THE EDITOR CAN PUT THE LOADED SCORE BACK (v37 item 2, backlog a3a6da0c).
 *
 * The ABC that was LOADED is the one thing that cannot be re-derived, so it must
 * be held in state and set at EVERY load point (the library read, the requested
 * piece, the bundled default — three of them), the plan must come from the pure
 * rule (`originalScorePlan(`), the control must exist (`REVERT_ORIGINAL_LABEL`),
 * and applying it must restore the score itself (`abc: plan.abc`) — not just the
 * offset, which would leave a transposed body under an original key.
 */
export function notationEditorCanRevertToTheOriginalScore(notationSource: string): boolean {
  const src = maskComments(notationSource);
  if (src.length < 5000) return false;
  if (src.indexOf('REVERT_ORIGINAL_LABEL') < 0) return false;
  if (src.indexOf('originalScorePlan(') < 0) return false;
  if (countOf(src, 'setSourceAbc(') < 3) return false;
  if (src.indexOf('const [sourceAbc, setSourceAbc] = useState(') < 0) return false;
  return src.indexOf('abc: plan.abc') >= 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEMS 4–6 OF THE SAME BATCH (owner-approved 8-item v37 batch, 10-09)
//
// Item 4 — PD save-to-library (d9d458bb, owner ask 9). Item 5 — cover-scan result
// actions (bce8f6f2, owner ask 10). Item 6 — MIDI structural validation + share
// path (d2e9e2c5, owner ask 6).
//
// Same discipline as items 1–3 above: every guard reads the REAL file, comments are
// masked first, and each one is proven to BITE by an in-suite mutation (and, for
// the three headline guards, by an on-disk mutation run captured in
// /home/team/shared/v37b-mutation-probes.txt).
// ═══════════════════════════════════════════════════════════════════════════════

/** The shared save component (item 4). */
export const SAVE_TO_LIBRARY_COMPONENT_PATH = 'src/components/SaveToLibraryButton.tsx';
/** The device-side save service (item 4). */
export const PIECE_LIBRARY_SAVE_PATH = 'src/services/pieceLibrarySave.ts';
/** The existing store both save paths write through. */
export const LIBRARY_STORE_PATH = 'src/services/libraryStore.ts';

/**
 * 4a. THE SAVE ACTION WRITES THROUGH THE EXISTING LIBRARY STORE (v37 item 4).
 *
 * THE THING THIS GUARD EXISTS FOR: "Save to library" must not become a SECOND
 * library. The on-device library already has a store (`services/libraryStore.ts`,
 * registry in AsyncStorage + files in the app's documents) with rename, share,
 * sync and delete built on it; a save path that wrote its own registry would
 * produce rows the Library screen cannot open. So, on the real sources:
 *
 *   • `pieceLibrarySave.ts` downloads (staging only) and then calls
 *     `importDocumentAsset(` — the PICKER's own write path — carrying the piece id
 *     as `sourcePieceId`, so the row is idempotent and the saved state is read
 *     back from the same registry (`findSavedPieceCopy`);
 *   • NOR the service NOR the component touches AsyncStorage directly (no second
 *     registry), and the component does not call `setItem`-style storage itself;
 *   • the component renders its label from the pure model and gates on
 *     `isSaveableScoreUrl(` (no score → no button at all).
 */
export function saveToLibraryWritesThroughTheExistingStore(
  componentSource: string,
  serviceSource: string,
): boolean {
  const component = maskComments(componentSource);
  const service = maskComments(serviceSource);
  if (component.length < 1500 || service.length < 1000) return false;

  // The device half: download → the existing import path, tagged with the piece id.
  if (service.indexOf('importDocumentAsset(') < 0) return false;
  if (service.indexOf('downloadAsync(') < 0) return false;
  if (service.indexOf("from './libraryStore'") < 0) return false;
  if (service.indexOf('sourcePieceId') < 0) return false;
  if (service.indexOf('findSavedPieceCopy(') < 0) return false;
  if (service.indexOf('AsyncStorage') >= 0) return false;
  // The idempotence clause: an already-saved piece returns its existing row.
  if (service.indexOf('if (existing) return existing;') < 0) return false;

  // The UI half: the shared honest labels, the pure gate, no fake success.
  if (component.indexOf('saveToLibraryLabel(') < 0) return false;
  if (component.indexOf('saveToLibraryIsBusy(') < 0) return false;
  if (component.indexOf('isSaveableScoreUrl(') < 0) return false;
  if (component.indexOf('savePieceScoreToLibrary(') < 0) return false;
  if (component.indexOf('AsyncStorage') >= 0) return false;
  // …and it really renders a press wired to the save, not just an import.
  if (!/onPress=\{\(\) => void save\(\)\}/.test(component)) return false;
  return /if \(!isSaveableScoreUrl\(scoreUrl\)\) return null;/.test(component);
}

/**
 * 4b. THE PD RESULT CARD OFFERS THE SAVE ACTION (v37 item 4).
 * `surfaceSource` is src/components/RecognitionResultView.tsx — the ONE shared
 * result surface every recognition lands on.
 *
 * Three facts together, because any one alone can be inert: the shared component
 * is rendered, it is handed the HOSTED PD SCORE the card is already offering
 * (`scoreUrl={inlineSheetUrl}`), and it sits inside the library-kind gate
 * (`isLibraryKind(kind)`) so a modern/copyrighted match — where we host nothing —
 * shows no save button at all.
 */
export function pdResultCardOffersSaveToLibrary(surfaceSource: string): boolean {
  const src = maskComments(surfaceSource);
  if (src.length < 20000) return false;
  const open = src.indexOf('<SaveToLibraryButton');
  if (open < 0) return false;
  const close = src.indexOf('/>', open);
  if (close < 0) return false;
  const tag = src.slice(open, close + 2);
  if (tag.indexOf('scoreUrl={inlineSheetUrl}') < 0) return false;
  if (tag.indexOf('pieceId={topMatch.piece_id}') < 0) return false;
  const gate = src.lastIndexOf('isLibraryKind(kind) && inlineSheetUrl', open);
  return gate >= 0;
}

/**
 * 4c. THE PD PIECE PAGE OFFERS THE SAVE ACTION (v37 item 4).
 * `pieceSource` is src/screens/PieceDetailScreen.tsx.
 *
 * The page's own hosted score is `piece.sheetMusicUrl` — the SAME field the
 * "View Sheet Music" button opens — so the saved copy is the score the user was
 * looking at, and a piece without one renders nothing.
 */
export function piecePageOffersSaveToLibrary(pieceSource: string): boolean {
  const src = maskComments(pieceSource);
  if (src.length < 8000) return false;
  const open = src.indexOf('<SaveToLibraryButton');
  if (open < 0) return false;
  const close = src.indexOf('/>', open);
  if (close < 0) return false;
  const tag = src.slice(open, close + 2);
  if (tag.indexOf('scoreUrl={piece.sheetMusicUrl ?? null}') < 0) return false;
  return tag.indexOf('pieceId={piece.id}') >= 0;
}

/**
 * 5a. THE SCAN'S RESULT SURFACE ALWAYS HAS A WAY FORWARD (v37 item 5).
 * `modalSource` is src/components/CoverScanModal.tsx.
 *
 * The owner's finding (item 10): with nothing readable in the field the search
 * button is disabled and the result was a dead end. This guard asserts the two
 * actions that resolve it are really there:
 *   • SAVE — the captured photo goes into the library through the EXISTING scan
 *     write path (`createScannedScore(`), with the honest label/state from the
 *     shared model and a failure line that can be shown;
 *   • GET THIS SONG — the money path for a title we do not hold, decided by the
 *     pure model (`coverScanResultActions(`) and wired to the host's own handler
 *     (`onGetThisSong`) — this modal never builds a URL.
 */
export function coverScanResultOffersTheWayForward(modalSource: string): boolean {
  const src = maskComments(modalSource);
  if (src.length < 3000) return false;
  // The pure decision is what the surface renders from.
  if (src.indexOf('coverScanResultActions(') < 0) return false;
  if (src.indexOf('resultActions.canSave') < 0) return false;
  if (src.indexOf('resultActions.canGetThisSong') < 0) return false;
  // SAVE: the existing store's scan write path + honest state.
  if (src.indexOf('createScannedScore(') < 0) return false;
  if (src.indexOf('async () => {') < 0) return false;
  if (src.indexOf('COVER_SCAN_SAVE_CTA') < 0) return false;
  if (src.indexOf('saveToLibraryLabel(scanSave)') < 0) return false;
  if (src.indexOf('saveToLibraryIsBusy(scanSave)') < 0) return false;
  if (src.indexOf('COVER_SCAN_SAVED_LINE') < 0) return false;
  if (src.indexOf('COVER_SCAN_SAVE_FAILED_LINE') < 0) return false;
  // GET THIS SONG: labelled from the model and wired to the host's handler.
  if (src.indexOf('GET_THIS_SONG_CTA') < 0) return false;
  if (src.indexOf('onPress={getThisSong}') < 0) return false;
  if (src.indexOf('onGetThisSong(text)') < 0) return false;
  // …and the modal itself builds no retailer URL (it cannot invent one).
  return src.indexOf('https://') < 0;
}

/**
 * 5b. THE "GET THIS SONG" CTA REACHES THE EXISTING MONEY PATH (v37 item 5).
 * `searchSource` is src/screens/FindPieceScreen.tsx — the host of the camera
 * surface, and the screen that already owns the in-app retailer shell.
 *
 * The CTA must resolve through the ONE affiliate URL builder
 * (`sheetMusicDirectSearchUrl` — SMD, affiliate id 67650) and open it in the SAME
 * shell every other purchase path on this screen uses (`handleOpenRetailer`, whose
 * only writer is a tap), never a hand-written URL and never a second checkout. A
 * URL literal in the handler is a failure here, on purpose.
 */
export function coverScanGetThisSongReachesTheMoneyPath(searchSource: string): boolean {
  const src = maskComments(searchSource);
  if (src.length < 8000) return false;
  if (src.indexOf('onGetThisSong={handleCoverGetThisSong}') < 0) return false;
  const at = src.indexOf('const handleCoverGetThisSong = useCallback(');
  if (at < 0) return false;
  const body = src.slice(at, at + 700);
  if (body.indexOf('sheetMusicDirectSearchUrl(text)') < 0) return false;
  if (body.indexOf('handleOpenRetailer(url)') < 0) return false;
  if (/https?:\/\//.test(body)) return false;
  // …and the shell it opens is the one already on the screen.
  return src.indexOf('<PurchaseWebView') >= 0 && src.indexOf('setRetailerUrl(') >= 0;
}

/**
 * 6a. THE EXPORTED .mid IS STRUCTURALLY VALIDATED BEFORE IT IS SHARED
 * (v37 item 6). `exportSource` is src/services/captureMidiExport.ts.
 *
 * The owner has no MIDI hardware, so a malformed file is only discovered on a
 * desktop. The device export therefore parses the EXACT bytes it is about to write
 * (`validateMidiStructure(bytes)`) and refuses to share a file that does not
 * parse — and the check has to run BEFORE the write/share call, or it guards
 * nothing.
 */
export function midiExportIsValidatedBeforeSharing(exportSource: string): boolean {
  const src = maskComments(exportSource);
  if (src.length < 3000) return false;
  const check = src.indexOf('validateMidiStructure(bytes)');
  if (check < 0) return false;
  if (src.indexOf('MIDI_STRUCTURE_INVALID_MESSAGE') < 0) return false;
  if (src.indexOf("from './midiStructure'") < 0) return false;
  // The check precedes the first write/share seam.
  const write = src.indexOf('const write = opts.deps?.writeFile ?? writeMidiFile;');
  if (write < 0) return false;
  if (check > write) return false;
  // The invalid branch really returns, and it returns ON THE VERDICT (`if
  // (!structure.ok)`) — a check whose result nobody branches on would share the
  // file anyway.
  const after = src.slice(check, check + 400);
  if (after.indexOf('if (!structure.ok)') < 0) return false;
  return after.indexOf("status: 'failed'") >= 0;
}

/**
 * 6b. THE CORRECT-YOUR-TAKE PAGE CAN SEND THE TAKE OFF THE DEVICE (v37 item 6).
 * `editorSource` is src/components/TakeCorrectionEditor.tsx.
 *
 * The owner needs the file on a desktop. The page must (i) call the EXISTING
 * export — the same encode → write → share path the result card and the History
 * row use — on the take it has just corrected (`derived.take`), (ii) label the
 * control from the shared model, (iii) render it only when the take has notes, and
 * (iv) render its outcome (a swallowed outcome is a dead button).
 */
export function takeEditorCanSendTheTakeOffDevice(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 20000) return false;
  if (src.indexOf('exportCaptureMidiFromTake(derived.take,') < 0) return false;
  if (!/onPress=\{\(\) => void shareTakeAsMidi\(\)\}/.test(src)) return false;
  if (src.indexOf('MIDI_EXPORT_LABEL') < 0) return false;
  if (src.indexOf('MIDI_EXPORT_BUSY_LABEL') < 0) return false;
  // Rendered only for a take that can be written out…
  if (src.indexOf('derived.take && derived.take.notes.length > 0') < 0) return false;
  const outcome = src.indexOf('{midiLine ?');
  if (outcome < 0) return false;
  // …and its outcome is set from the export's own result.
  return src.indexOf('setMidiLine(result.message)') >= 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ITEMS 7–8 OF THE SAME BATCH (owner-approved 8-item v37 batch, 10-09)
//
// Item 7 — Send-to / export on Correct-your-Take (baa39e66): the take as a PDF
// (free through launch, rev 38), to the user's own email through the SYSTEM share
// sheet, and the MIDI export that already exists. Item 8 — the Tabs button
// (ee3a6e13): guitar tablature of the same take, at the owner's placement (under
// the tap-a-note lane, just above the Chords section), with the piano notation
// left exactly as it is.
//
// Same discipline as every other item in this module: these guards read the REAL
// files, comments are masked first, and each one is proven to BITE by a mutation
// (in-suite in scripts/v37UiWiring.test.ts, on disk in
// /home/team/shared/v37c-mutation-probes.txt).
// ═══════════════════════════════════════════════════════════════════════════════

/** The guitar-tab page (item 8). */
export const TAKE_TABS_COMPONENT_PATH = 'src/components/TakeTabsView.tsx';
/** The Send-to surface (item 7). */
export const TAKE_SEND_SHEET_PATH = 'src/components/TakeSendToSheet.tsx';
/** The device half of Send-to: the system share sheet, and nothing else. */
export const TAKE_SEND_DEVICE_PATH = 'src/services/takeSendDevice.ts';
/** The PDF notation engine (item 7a). */
export const TAKE_PDF_SERVICE_PATH = 'src/services/takeNotationPdf.ts';
/** The guitar-tab model (item 8). */
export const GUITAR_TAB_SERVICE_PATH = 'src/services/guitarTab.ts';

/**
 * 8a. THE TABS BUTTON IS WHERE THE OWNER PUT IT (v37 item 8).
 * `editorSource` is src/components/TakeCorrectionEditor.tsx.
 *
 * The placement is the requirement, so the placement is the guard: the button's
 * press handler must appear AFTER the tap-a-note lane's label and BEFORE the
 * Chords section's title — the owner's "just above the Chords section and
 * underneath the tap-a-note lane" (re-confirmed 10-09), measured on the real file
 * rather than trusted to a comment. It must also be labelled from the tab model
 * (`{TAB_LABEL}`), really open the tab page (`setTabsOpen(true)`), and the tab page
 * must be bound to the editor being open.
 */
export function tabsButtonSitsUnderTheLaneAndAboveTheChords(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 20000) return false;
  const tabs = src.indexOf('onPress={() => setTabsOpen(true)}');
  if (tabs < 0) return false;
  const lane = src.indexOf('{EDITOR_LANE_LABEL}');
  if (lane < 0) return false;
  const chords = src.indexOf('{EDITOR_CHORD_LABEL}');
  if (chords < 0) return false;
  // UNDERNEATH the lane, ABOVE the chords — both halves, or the placement is wrong.
  if (!(lane < tabs && tabs < chords)) return false;
  if (src.indexOf('{TAB_LABEL}') < 0) return false;
  return src.indexOf('visible={visible && tabsOpen}') >= 0;
}

/**
 * 8b. THE PIANO NOTATION SURVIVES THE TABS BUTTON (v37 item 8).
 * `editorSource` is src/components/TakeCorrectionEditor.tsx.
 *
 * Owner, 10-09: "The piano notation is correct and needs to remain". Tabs is
 * ADDITIVE, so the staff must still be drawn on the page — the same
 * non-interactive `<AbcScoreView>` the scroller depends on — while the tab page is
 * a separate surface that renders its own component.
 */
export function tabsNeverReplaceThePianoNotation(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 20000) return false;
  const staff = src.indexOf('<AbcScoreView');
  if (staff < 0) return false;
  const close = src.indexOf('/>', staff);
  if (close < 0) return false;
  const tag = src.slice(staff, close + 2);
  if (tag.indexOf('interactive={false}') < 0) return false;
  if (tag.indexOf('abc={staffAbc}') < 0) return false;
  // The tab page is its OWN component, rendered as a surface — the notation is
  // never replaced by the tab grid inside the staff box.
  if (src.indexOf('<TakeTabsView') < 0) return false;
  return src.indexOf('buildGuitarTab(') < 0;
}

/**
 * 8c. THE TAB PAGE IS HONEST ABOUT WHAT IT IS (v37 item 8).
 * `tabsSource` is src/components/TakeTabsView.tsx.
 *
 * The tab is auto-generated from the user's OWN take: there is no official edition
 * of a hummed melody, so the page must carry the model's honest line
 * (`TAB_HONEST_LINE`), the empty state's line, the layout's own honest line
 * (`tabHonestyLine`) and the note readout — and it must not claim officialness in
 * its own words, re-type the tuning instead of reading the model, or talk to a
 * network (it is a view of a take that is already on the device).
 */
export function takeTabsPageRendersTheTakeHonestly(tabsSource: string): boolean {
  const src = maskComments(tabsSource);
  if (src.length < 1500) return false;
  if (src.indexOf('buildGuitarTab(') < 0) return false;
  if (src.indexOf('tabLines(') < 0) return false;
  if (src.indexOf('TAB_HONEST_LINE') < 0) return false;
  if (src.indexOf('TAB_EMPTY_LINE') < 0) return false;
  if (src.indexOf('tabHonestyLine(') < 0) return false;
  if (src.indexOf('tabNoteReadout(') < 0) return false;
  if (src.indexOf('TAB_TUNING_LINE') < 0) return false;
  if (src.indexOf('STANDARD_TUNING_LABELS') >= 0) return false;
  if (/official/i.test(src)) return false;
  if (/https?:\/\//.test(src)) return false;
  return src.indexOf('fetch(') < 0;
}

/**
 * 8d. THE TAB MODEL KEEPS EVERY NOTE PLAYABLE AND IS DETERMINISTIC (v37 item 8).
 * `tabSource` is src/services/guitarTab.ts — the pure model, guarded at the source
 * level so a later edit cannot quietly drop the octave-folding or introduce a
 * random choice (the tier1 suite pins the behaviour of all three).
 */
export function guitarTabModelKeepsNotesPlayable(tabSource: string): boolean {
  const src = maskComments(tabSource);
  if (src.length < 3000) return false;
  if (src.indexOf('STANDARD_TUNING') < 0) return false;
  if (src.indexOf('MAX_TAB_FRET') < 0) return false;
  if (src.indexOf('HAND_SPAN') < 0) return false;
  if (src.indexOf('tabForMidi(') < 0) return false;
  if (src.indexOf('bestTakePosition(') < 0) return false;
  if (src.indexOf('TAB_HONEST_LINE') < 0) return false;
  return src.indexOf('Math.random') < 0;
}

/**
 * 7a. THE EDITOR OFFERS SEND-TO, AND THERE IS STILL ONLY ONE MIDI PATH
 * (v37 item 7).
 * `editorSource` is src/components/TakeCorrectionEditor.tsx.
 *
 * Three facts: the action exists and is labelled from the model (`{SEND_TO_CTA}`);
 * it sits INSIDE the take-has-notes gate (a Send-to offered for a take with no
 * notes can only fail — the release gate forbids that dead area); and the surface
 * is handed THIS page's own MIDI export (`onSendMidi={shareTakeAsMidi}`), so the
 * editor still calls the encoder exactly ONCE. A second call would be a second
 * MIDI path, and this guard counts them.
 */
export function takeEditorOffersSendTo(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 20000) return false;
  const send = src.indexOf('onPress={() => setSendOpen(true)}');
  if (send < 0) return false;
  if (src.indexOf('{SEND_TO_CTA}') < 0) return false;
  const gate = src.lastIndexOf('derived.take && derived.take.notes.length > 0', send);
  if (gate < 0 || gate > send) return false;
  if (src.indexOf('onSendMidi={shareTakeAsMidi}') < 0) return false;
  if (countOf(src, 'exportCaptureMidiFromTake(') !== 1) return false;
  return src.indexOf('visible={visible && sendOpen}') >= 0;
}

/**
 * 7b. THE SEND-TO SURFACE RENDERS THE MODEL AND SHOWS EVERY OUTCOME
 * (v37 item 7). `sheetSource` is src/components/TakeSendToSheet.tsx.
 *
 * The destinations come from the pure model (`sendToActions`), the honest line is
 * on the surface, the two device destinations call the device service, and the
 * MIDI destination calls the handler it was GIVEN (`onSendMidi`) — the surface
 * must not import or call the encoder itself (that would be the second MIDI path
 * this batch exists to avoid). It also has no network of any kind: the share sheet
 * is the route, so a fetch or a URL in this file is a failure.
 */
export function takeSendToSurfaceIsHonest(sheetSource: string): boolean {
  const src = maskComments(sheetSource);
  if (src.length < 1500) return false;
  if (src.indexOf('sendToActions(') < 0) return false;
  if (src.indexOf('SEND_TO_HONESTY') < 0) return false;
  if (src.indexOf('exportTakePdfFromTake(') < 0) return false;
  if (src.indexOf('sendTakeToEmail(') < 0) return false;
  if (src.indexOf('onSendMidi') < 0) return false;
  if (src.indexOf('exportCaptureMidiFromTake') >= 0) return false;
  if (src.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(src)) return false;
  // The outcome of every attempt is rendered, never swallowed.
  return src.indexOf('{line ?') >= 0;
}

/**
 * 7c. THE TAKE LEAVES THROUGH THE SYSTEM SHARE SHEET, AFTER ITS OWN STRUCTURE
 * CHECK (v37 item 7). `sendSource` is src/services/takeSendDevice.ts.
 *
 * The route is the platform's: a FILE through expo-sharing, TEXT through React
 * Native's Share — both are the system sheet, and there is nothing else in this
 * file that can move data (no fetch, no URL, no mail library), which is what makes
 * "we never email anything server-side" a property of the code rather than a
 * promise. The PDF's bytes are parsed back by `validateTakePdf` BEFORE the
 * write/share seam (`if (!structure.ok)` really returns), and the file is handed
 * to exactly one carrier. The MIDI export is NOT re-implemented here.
 */
export function sendToUsesTheSystemShareSheetOnly(sendSource: string): boolean {
  const src = maskComments(sendSource);
  if (src.length < 3000) return false;
  if (src.indexOf("from 'expo-sharing'") < 0) return false;
  if (src.indexOf('Sharing.shareAsync(') < 0) return false;
  if (src.indexOf('Share.share(') < 0) return false;
  if (src.indexOf('sendToPlan(') < 0) return false;
  if (src.indexOf('takeSummaryText(') < 0) return false;
  if (src.indexOf('exportCaptureMidiFromTake') >= 0) return false;
  // THE GATE: parse the exact bytes, then branch on the verdict, before the write.
  const check = src.indexOf('validateTakePdf(bytes)');
  const write = src.indexOf('const write = deps.writeFile ?? writeTakeFile;');
  if (check < 0 || write < 0 || check > write) return false;
  if (src.indexOf('if (!structure.ok)') < 0) return false;
  if (src.indexOf('TAKE_PDF_STRUCTURE_INVALID_MESSAGE') < 0) return false;
  // NOTHING HERE CAN EMAIL ANYTHING: no endpoint, no SMTP, no mail service.
  if (src.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(src)) return false;
  return !/nodemailer|smtp|sendgrid|mailgun/i.test(src);
}

/**
 * 7d. THE PDF IS THE EXISTING NOTATION ENGINE'S OUTPUT, AND IT STAYS FREE
 * (v37 item 7a). `pdfSource` is src/services/takeNotationPdf.ts.
 *
 * The page the user prints must be the notation the app already draws, so the
 * builder is driven by `takeStaff.ts` (the key signature, the duration grid) and
 * prints the same ABC the screen draws. It also validates its own bytes
 * (`parseTakePdfStructure` / `validateTakePdf`) — the v37 item 6 rule extended to
 * this file — and it carries NO paywall/Pro gating: rev 38 keeps PDF export free
 * through launch.
 */
export function takePdfUsesTheExistingNotationEngine(pdfSource: string): boolean {
  const src = maskComments(pdfSource);
  if (src.length < 3000) return false;
  if (src.indexOf("from './takeStaff'") < 0) return false;
  if (src.indexOf('staffKeySignature(') < 0) return false;
  if (src.indexOf('durationUnits(') < 0) return false;
  if (src.indexOf('takeToAbc(') < 0) return false;
  if (src.indexOf('parseTakePdfStructure(') < 0) return false;
  if (src.indexOf('TAKE_PDF_CAPTION') < 0) return false;
  if (src.indexOf('validateTakePdf(') < 0) return false;
  // The export path carries no paywall/Pro gate (recognition and the user's own
  // data are never paywalled — owner 10-08).
  return !/paywall|isPro|proTier|subscription/i.test(src);
}
