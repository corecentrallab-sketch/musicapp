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
 * Whether the page underneath may scroll while a drag is in flight. The page is
 * frozen ONLY while the user is really dragging a note (so an edit is never
 * stolen mid-gesture) and unfrozen the moment the finger lifts.
 */
export function pageScrollEnabledDuringDrag(dragging: boolean): boolean {
  return !dragging;
}
