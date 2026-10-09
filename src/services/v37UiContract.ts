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
