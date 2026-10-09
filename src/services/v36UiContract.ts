/**
 * v36UiContract.ts — the live-source GUARDS for the v36 batch (owner device pass
 * #2 on v35: the four FAILs).
 *
 * WHY THIS MODULE EXISTS. Every v34/v35 fix that "was in the source" and did NOT
 * reach the owner failed in the same way: the property being asserted was the
 * wrong one (v34 fixed the drag layer's claim rules and the page STILL did not
 * scroll), or the code existed and nothing called it. So each guard here names
 * the SHIPPED structure it needs, reads the real file, and is proven to bite by
 * the mutation probes in scripts/v36Fixes.test.ts (skill
 * `musicapp-guard-mutation-probes`).
 *
 * THE FOUR FIXES, AND WHAT IS ACTUALLY PROVABLE FROM SOURCE:
 *   1. THE PAGE SCROLLS (P0). The staff is the biggest surface on the page and it
 *      is drawn in a WebView — a native view outside RN's responder system. v34
 *      tried `pointerEvents="none"` on its wrapper and the owner's page still did
 *      not scroll. v36 adds the thing that cannot be doubted: a transparent RN
 *      TOUCH SHIELD on top of the WebView that claims the touch and immediately
 *      lets the page's scroller take it back (`onShouldBlockNativeResponder` →
 *      false), so the WebView is never the hit target at all. The scroller itself
 *      is also never disabled by editor state (v36 changed
 *      `pageScrollEnabledDuringDrag` to a constant TRUE).
 *   2. ORIGINAL / CORRECTED (backlog #43) — the editor reuses the capture page's
 *      own two-score card (`TakeStaffCard`) behind a display-only switch.
 *   3. THE TRANSPOSED COPY OPENS — the notation editor's score was the one
 *      `AbcScoreView` with no box of its own; a `flex: 1` renderer inside an
 *      auto-height card lays out at ZERO height, so the score card opened with no
 *      score in it. Both the call site (a real box) and the component (a
 *      min-height floor) are asserted.
 *   4. THE COVER SCAN READS — an on-device reader actually runs and its text is
 *      the only thing that may pre-fill the search field; a failed read is said
 *      out loud; the photo never leaves the device.
 *
 * PURE: no react, no react-native, no fs. Asserted by scripts/v36Fixes.test.ts
 * (which also applies the same mutations in memory) and by the on-disk probe run
 * /home/team/shared/v36-mutation-probes.txt.
 */
import { maskComments } from './modalBackContract';
import { editorPageScrollerIsNeverSwitchedOff } from './v37UiContract';

function countOf(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 1. THE PAGE SCROLLS FROM EVERY SURFACE (P0, owner "Again page does not scroll
 * down"). `editorSource` is src/components/TakeCorrectionEditor.tsx.
 *
 * FOUR properties, each one a way the page was (or could be) frozen:
 *   a. the staff sits in a BOX of its own (a WebView needs a real box);
 *   b. the staff is rendered as NON-INTERACTIVE (`interactive={false}`), which is
 *      what mounts the touch shield asserted by
 *      `staffWebviewCannotTakeTheGesture` below;
 *   c. the page's scroller is bounded (`style={styles.page}`) and is NEVER given
 *      a literal `scrollEnabled={false}`;
 *   d. both drag responders install `shouldStartEditorDrag` (never a touch-down
 *      claim) and BLOCK native scrolling while a real drag is in flight, which is
 *      what lets the page stay scrollable unconditionally.
 * Plus the reachability property the owner needs: the chords row, the docked
 * preview and the sticky save bar are all INSIDE the one vertical scroller.
 */
export function editorPageScrollsFromEverySurface(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 8000) return false;

  // a. a real box for the staff.
  if (src.indexOf('styles.staffBox') < 0) return false;
  if (!/staffBox:\s*\{[^}]*height:\s*\d+/.test(src)) return false;

  // b. the staff renderer is non-interactive (⇒ the viewer's shield is mounted).
  if (src.indexOf('interactive={false}') < 0) return false;

  // c. a bounded scroller, never disabled by a literal.
  if (src.indexOf('style={styles.page}') < 0) return false;
  if (!/page:\s*\{[^}]*flex:\s*1/.test(src)) return false;
  if (src.indexOf('scrollEnabled={false}') >= 0) return false;

  // d. the drag layer shares the gesture honestly.
  if (countOf(src, 'onStartShouldSetPanResponder: shouldStartEditorDrag') < 2) return false;
  if (countOf(src, 'onShouldBlockNativeResponder: () => true') < 2) return false;
  // v37 item 1 REPLACED the v36 property here. v36 asserted a CONSTANT
  // (`scrollEnabled={pageScrollEnabledDuringDrag(dragging)}`, `=== true`); the
  // owner's FAIL #8 (opened from a History row, no scroll) showed that a value —
  // even a constant — is still a value a later refactor can compute from editor
  // state, and one stuck value freezes the page for a whole session. The page
  // scroller now carries NO `scrollEnabled` prop at all and is remounted every
  // session (`key={\`editor-page-${pageSession}\`}`), which is what
  // `editorPageScrollerIsNeverSwitchedOff` requires (src/services/v37UiContract.ts).
  if (!editorPageScrollerIsNeverSwitchedOff(src)) return false;

  // The owner's own words: the chords, the export/preview and the save bar are
  // reachable — every one of them is inside the single vertical scroller.
  const scrollOpen = src.indexOf('<ScrollView');
  const scrollClose = src.indexOf('</ScrollView>', scrollOpen);
  if (scrollOpen < 0 || scrollClose < 0) return false;
  const chords = src.indexOf('EDITOR_CHORD_LABEL', scrollOpen);
  const preview = src.indexOf('<TakePreviewSection', scrollOpen);
  const saveBar = src.indexOf('styles.saveBar');
  if (chords < 0 || chords > scrollClose) return false;
  if (preview < 0 || preview > scrollClose) return false;
  if (saveBar < 0 || saveBar < scrollClose) return false;
  return true;
}

/**
 * THE STAFF CANNOT TAKE THE GESTURE (v36 fix 1, the mechanism). `abcViewSource`
 * is src/components/AbcScoreView.tsx.
 *
 * A WebView is a native view outside RN's responder system, so while it is
 * touchable the page it sits in does not scroll from over it — the owner's
 * "page does not scroll down", which v34's wrapper `pointerEvents="none"` did not
 * cure. The structure that cannot be doubted: the WebView is drawn non-scrollable
 * and untouchable, and a SHIELD is declared AFTER it in the same box (later
 * sibling = above it in z-order = the only hit target there), claiming the touch
 * with `onShouldBlockNativeResponder` false so the page's scroller can take the
 * gesture back. Plus the min-height floor that stops the whole viewer collapsing
 * to zero height inside an auto-height parent (fix 3's root cause).
 */
export function staffWebviewCannotTakeTheGesture(abcViewSource: string): boolean {
  const src = maskComments(abcViewSource);
  if (src.length < 2000) return false;
  if (src.indexOf('export const ABC_MIN_HEIGHT = ') < 0) return false;
  if (!/minHeight:\s*ABC_MIN_HEIGHT/.test(src)) return false;
  if (src.indexOf('scrollEnabled={interactive}') < 0) return false;

  const webviews = src.indexOf('<WebView');
  const shield = src.indexOf('styles.shield', webviews);
  if (webviews < 0 || shield < 0) return false;
  // The shield claims the touch as a Pressable (Pressability reports
  // blockNativeResponder: false, so the native scroller keeps the gesture) — a
  // plain View responder would block the scroller instead, which is the bug.
  const shieldBlock = src.slice(shield, shield + 400);
  if (shieldBlock.indexOf('<Pressable') < 0) return false;
  if (shieldBlock.indexOf('onPress=') < 0) return false;
  // The shield may only be mounted for a NON-interactive score: an interactive
  // score (if one ever exists) must stay reachable.
  return /!\s*interactive\s*&&[\s\S]{0,400}?styles\.shield/.test(src);
}


/**
 * 2. THE ORIGINAL / CORRECTED SWITCH (backlog #43), and it must be the capture
 * page's OWN two-score display, not a second invention. `editorSource` is
 * src/components/TakeCorrectionEditor.tsx.
 *
 * The switch is DISPLAY ONLY: it may not rebuild the model (an in-flight edit
 * must survive a peek at the original), the corrected view must stay the default,
 * and the editable surface must hang off `editorViewIsEditable(view)` rather than
 * off any other condition.
 */
export function editorShowsOriginalAndCorrected(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 8000) return false;

  if (src.indexOf("from '../services/editorTakeViews'") < 0) return false;
  for (const token of [
    'EDITOR_VIEW_ORIGINAL',
    'EDITOR_VIEW_DEFAULT',
    'editorViewIsEditable(',
    'editorViewSegmentLabel(',
    'editorViewTarget(',
    'editorViewNote(',
  ]) {
    if (src.indexOf(token) < 0) return false;
  }
  // The REUSE: the editor renders the capture page's own card for the original.
  if (src.indexOf("from './TakeStaffCard'") < 0) return false;
  if (!/<TakeStaffCard[\s\S]{0,400}?interactive=\{false\}/.test(src)) return false;
  // The switch resets to the corrected view on every open (a stale "original"
  // view on the next take would show the previous take's baseline).
  if (!/setView\(EDITOR_VIEW_DEFAULT\)/.test(src)) return false;
  // Display only: a switch may never rebuild the editor model.
  if (/editorViewTarget\([^)]*\)[\s\S]{0,80}?createEditorState\(/.test(src)) return false;
  // The corrected take stays the source of truth for the save path.
  return src.indexOf('derived.take') >= 0 && src.indexOf('saveCorrectedTake({') >= 0;
}

/**
 * 3. THE TRANSPOSED COPY'S SHEET OPENS. `notationSource` is
 * src/screens/NotationEditorScreen.tsx, `abcViewSource` is
 * src/components/AbcScoreView.tsx.
 *
 * THE ROOT CAUSE: AbcScoreView's own container is `flex: 1` and its WebView is
 * `flex: 1`. Every other call site wraps it in a box with a real height
 * (TakeStaffCard: 132; the take editor: 150). The notation editor's score card has
 * NO height, so a `flex: 1` child in an auto-height column lays out at ZERO — the
 * card opened with a title, a composer line and no score. Fixed on both sides: the
 * call site gets a real box, and the component gets a min-height floor so no
 * future call site can silently collapse it again.
 */
export function transposedCopyShowsTheSheet(
  notationSource: string,
  abcViewSource: string,
): boolean {
  const notation = maskComments(notationSource);
  const abcView = maskComments(abcViewSource);
  if (notation.length < 5000) return false;
  if (abcView.length < 2000) return false;

  // The call site: a box with a real height around the score, non-interactive.
  const open = notation.indexOf('<AbcScoreView');
  if (open < 0) return false;
  if (!/scoreStaffBox:\s*\{[^}]*minHeight:\s*\d+/.test(notation)) return false;
  const before = notation.slice(0, open);
  if (before.lastIndexOf('styles.scoreStaffBox') < 0) return false;
  if (notation.indexOf('interactive={false}') < 0) return false;

  // The component: a floor, so flex: 1 inside an auto-height parent cannot be 0.
  if (!/export const ABC_MIN_HEIGHT = [1-9]\d*/.test(abcView)) return false;
  if (!/minHeight:\s*ABC_MIN_HEIGHT/.test(abcView)) return false;
  return true;
}

/**
 * 4. THE COVER SCAN READS THE PHOTO (owner: "camera opens, snap and save works,
 * but does not scan"). `modalSource` is src/components/CoverScanModal.tsx,
 * `readerSource` is src/components/CoverOcrReader.tsx.
 *
 * THE ROOT CAUSE: v33 shipped capture → confirm with `COVER_SCAN_OCR_AVAILABLE =
 * false` — there was no recogniser in the flow at all, so the confirm field was
 * always empty and the user had to type the title they had just photographed.
 * v36 wires a real on-device reader (a WebView-hosted recogniser: the photo is
 * read on the phone and never uploaded).
 *
 * The honesty rules that survive: the field may only be prefilled with text the
 * reader ACTUALLY returned (never a literal, never a guess), a failed read is
 * shown as an honest error, and an empty field runs nothing.
 */
export function coverScanReadsTheCover(modalSource: string, readerSource: string): boolean {
  // NOT SHIPPED IN THIS PR (v36 fix 4). The owner's finding is real — the v33
  // build has NO recogniser in the flow (`COVER_SCAN_OCR_AVAILABLE = false`), so a
  // photographed cover never prefills the search and the user must type the title
  // they just photographed. Reading a photo on-device needs a text recogniser, and
  // this build has no OCR dependency of any kind (checked: no mlkit / ml-kit /
  // text-recognition / tesseract package in package.json) — so it cannot be done
  // with the libraries on the box. The guard is therefore deliberately INERT and
  // returns false: it asserts nothing until the reader described below exists, so
  // it can never be read as a claim that the cover scan works.
  //
  // The design to implement (kept here so the next pass does not start from zero):
  // capture → read the photo as a LOCAL base64 data URL (expo-file-system, no
  // upload) → a hidden WebView that hosts a WASM recogniser (tesseract.js from a
  // pinned CDN) → the recognised text is the ONLY thing that may prefill the
  // confirm field (raw-query honesty, no edition claims), the empty field runs
  // nothing, a failed read shows COVER_SCAN_OCR_FAILED_LINE, and the typed
  // fallback always stays available.
  void modalSource;
  void readerSource;
  return false;
}

/** Unused until fix 4 ships; kept so the not-yet-written reader's contract is clear. */
export const COVER_OCR_READER_NOT_SHIPPED = true;

const _unshippedCoverOcrGuard = (
  modalSource: string,
  readerSource: string,
): boolean => {
  const modal = maskComments(modalSource);
  const reader = maskComments(readerSource);
  if (modal.length < 3000) return false;
  if (reader.length < 800) return false;

  // a. the reader is mounted and driven from the modal.
  if (modal.indexOf("from './CoverOcrReader'") < 0) return false;
  if (modal.indexOf('<CoverOcrReader') < 0) return false;
  if (modal.indexOf('onText=') < 0) return false;
  // b. the photo is read on the device and handed to the reader.
  if (modal.indexOf('EncodingType.Base64') < 0) return false;
  if (modal.indexOf('readAsStringAsync(') < 0) return false;
  // c. the field is filled ONLY from the reader's own text.
  if (!/setConfirmText\((?!'')[\s\S]{0,120}?ocrQuery/.test(modal)) return false;
  if (/ocrText:\s*'/.test(modal)) return false;
  // d. a failed read is said out loud, and the typed fallback stays.
  if (modal.indexOf('COVER_SCAN_OCR_FAILED_LINE') < 0) return false;
  if (!/if \(!text\) return;/.test(modal)) return false;
  // e. the photo never leaves the device: no upload, no network call here.
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'FormData', 'upload']) {
    if (modal.indexOf(forbidden) >= 0) return false;
  }
  // f. the reader itself is a local recogniser: it loads the engine on the device
  //    and posts the recognized text back — it never POSTs the photo anywhere.
  if (reader.indexOf('<WebView') < 0) return false;
  if (reader.indexOf('postMessage') < 0) return false;
  if (reader.indexOf('onMessage') < 0) return false;
  return true;
};

/**
 * The unshipped guard above, exposed only so a future test can prove it bites once
 * fix 4 lands. Nothing in the app calls it.
 */
export function unshippedCoverScanReadsTheCover(
  modalSource: string,
  readerSource: string,
): boolean {
  return _unshippedCoverOcrGuard(modalSource, readerSource);
}
