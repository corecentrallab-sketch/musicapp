/**
 * editorGestures.ts — HOW THE TAKE-CORRECTION EDITOR SHARES TOUCHES WITH THE
 * PAGE'S SCROLL (v34, owner device pass 10-06: "The Correct Your Take page also
 * freezes and will not scroll up").
 *
 * THE CAUSE. Every note block in the editor's drag lane installed a PanResponder
 * that claimed the touch the instant a finger landed
 * (`onStartShouldSetPanResponder: () => true`) and the boundary handles claimed
 * every move (`onMoveShouldSetPanResponder: () => true`). The lane is a full-width
 * band in the middle of a page rendered inside a vertical ScrollView, so any
 * scroll gesture that STARTED on the lane was owned by the lane and the page
 * never moved — the user reads that as the page freezing, and on a tall page you
 * cannot reach the controls below without scrolling.
 *
 * THE RULE. A drag layer inside a scroller may only take a gesture it can
 * actually USE:
 *   • never claim on touch-down (the scroller keeps its chance to start);
 *   • claim a PITCH drag only for a clearly vertical move (up/down);
 *   • claim a TIMING (edge) drag only for a clearly horizontal move (left/right);
 *   • leave everything else to the page.
 * PURE: no react, no react-native. Asserted by scripts/v34Fixes.test.ts, and the
 * live scan in scripts/v34UiWiring.test.ts proves the editor uses these helpers
 * (a guard that only sees healthy source proves nothing — see the mutation
 * probes).
 */

/** How far a finger must travel before either drag may claim it (dp). */
export const EDITOR_DRAG_MIN_PX = 8;
/**
 * How much more the dominant axis must dominate: 1.2 means "at least 20% more
 * vertical than horizontal" for a pitch drag (and the mirror for timing).
 */
export const EDITOR_DRAG_AXIS_RATIO = 1.2;

/**
 * FALSE, always. The drag layer must never become the responder on touch-down —
 * doing that is what froze the page's scroll. Kept as a named function so the
 * live scan can assert the editor installs THIS and not `() => true`.
 */
export function shouldStartEditorDrag(): boolean {
  return false;
}

/** A pitch drag: vertical intent, past the activation threshold. */
export function shouldCapturePitchDrag(dx: number, dy: number): boolean {
  const x = Math.abs(Number(dx) || 0);
  const y = Math.abs(Number(dy) || 0);
  if (y < EDITOR_DRAG_MIN_PX) return false;
  return y >= x * EDITOR_DRAG_AXIS_RATIO;
}

/** A timing (edge) drag: horizontal intent, past the activation threshold. */
export function shouldCaptureEdgeDrag(dx: number, dy: number): boolean {
  const x = Math.abs(Number(dx) || 0);
  const y = Math.abs(Number(dy) || 0);
  if (x < EDITOR_DRAG_MIN_PX) return false;
  return x >= y * EDITOR_DRAG_AXIS_RATIO;
}

/**
 * Whether the page underneath may scroll while a drag is in flight (v36 fix 1).
 *
 * IT IS NOW ALWAYS TRUE, AND THAT IS THE FIX. v34 answered "no while a drag is in
 * flight", and the page's ScrollView followed this value. The owner then reported
 * on v35: "Again page does not scroll down". The flag was never the whole cause
 * (v33 had no flag and the page did not scroll either — see the staff WebView's
 * touch shield in AbcScoreView), but leaving a scroller switched off by editor
 * state is a second, independent way to lose scrolling for good: one stuck
 * `dragging` value and the page is dead for the rest of the session, with no user
 * action able to recover it.
 *
 * Nothing is lost by never freezing the page: a drag the model actually claims
 * already blocks native scrolling itself, on the responder
 * (`onShouldBlockNativeResponder` → true, asserted by v36UiContract), so an edit
 * can never be stolen mid-gesture — while a touch the drag layer does NOT want
 * (the pitch/timing intent rules above) always reaches the page.
 */
export function pageScrollEnabledDuringDrag(_dragging: boolean): boolean {
  return true;
}

/**
 * The drag layer's OWN claim on the gesture (v36 fix 1): a drag the model accepts
 * must not be handed to the native scroller halfway through, because that is how a
 * correction becomes a scroll. This is the mechanism that replaced the page-wide
 * freeze, and it is asserted in the live source by v36UiContract (twice — one per
 * responder: the pitch drag and the timing handles).
 */
export function editorDragBlocksNativeScroll(): boolean {
  return true;
}
