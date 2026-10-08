/**
 * editorTakeViews.ts — THE ORIGINAL / CORRECTED VIEW SWITCH of the take-correction
 * editor (v36, owner device pass #2 backlog #43).
 *
 * WHAT IT IS. The editor is reached from History with a take that is already the
 * user's CORRECTED take, and until v36 it could only ever show one score, labelled
 * "Your corrected take". The owner cannot then answer the obvious question — "what
 * did the app hear, and what did I change?" — and the capture window, which DOES
 * show both (the dimmed raw trace, then the auto-cleaned line: TakeStaffCard), was
 * the flow the owner confirmed as correct. So the editor gets the SAME two views
 * the capture page already has, as ONE display switch:
 *
 *   • `original`  — the take exactly as it was auto-detected: READ-ONLY. Rendered
 *     with the capture page's own card (TakeStaffCard: raw trace dimmed, the
 *     auto-clean divider, the crisp cleaned line) so the reader sees the same
 *     "before → cleaned" pair they already passed. Nothing on this view edits.
 *   • `corrected` — the editable take (the lane, the semitone rail, the chords,
 *     the batch fixes, the docked preview). This is the DEFAULT, and it is what
 *     History, the MIDI export and playback read: the switch is DISPLAY ONLY.
 *
 * The original view's baseline is the editor model's own `detected` take (what
 * "Reset to detected" restores) — the same seam takeEditor.resetToDetected uses,
 * so the two can never disagree about what "as detected" means.
 *
 * PURE: no react, no react-native. Asserted by scripts/v36Fixes.test.ts and the
 * live-scan guards in src/services/v36UiContract.ts.
 */

/** The editable take — the single source of truth for every consumer. */
export const EDITOR_VIEW_CORRECTED = 'corrected';
/** The take as it was auto-detected — display only, never editable here. */
export const EDITOR_VIEW_ORIGINAL = 'original';

export type EditorTakeView = typeof EDITOR_VIEW_CORRECTED | typeof EDITOR_VIEW_ORIGINAL;

/** The view the editor opens on: the user's own corrected take. */
export const EDITOR_VIEW_DEFAULT: EditorTakeView = EDITOR_VIEW_CORRECTED;

/** The switch's own heading (it is a view control, not a tab of the app). */
export const EDITOR_VIEW_LABEL = 'View';
/** The two segment labels. Short enough for one row on a small phone. */
export const EDITOR_VIEW_CORRECTED_CTA = 'Your corrected take';
export const EDITOR_VIEW_ORIGINAL_CTA = 'Original (auto-detected)';
/** The line under the switch while the ORIGINAL view is up. */
export const EDITOR_ORIGINAL_READ_ONLY_LINE =
  'Read-only: this is the take exactly as it was auto-detected. Switch back to change anything.';
/** The line that keeps the single-source-of-truth promise visible on BOTH views. */
export const EDITOR_VIEW_SOURCE_OF_TRUTH_LINE =
  'Your corrected take is what History, the MIDI export and the preview use.';
/** The title the original take is drawn under (it is the user's own take). */
export const EDITOR_ORIGINAL_TITLE = 'Original take (auto-detected)';

/** The view the switch shows after a tap on a segment (its own target). */
export function editorViewTarget(view: EditorTakeView): EditorTakeView {
  return view === EDITOR_VIEW_ORIGINAL ? EDITOR_VIEW_CORRECTED : EDITOR_VIEW_ORIGINAL;
}

/** True only on the editable view — the lane and every edit control hang off this. */
export function editorViewIsEditable(view: EditorTakeView): boolean {
  return view === EDITOR_VIEW_CORRECTED;
}

/** The segment label for a view. */
export function editorViewSegmentLabel(view: EditorTakeView): string {
  return view === EDITOR_VIEW_ORIGINAL ? EDITOR_VIEW_ORIGINAL_CTA : EDITOR_VIEW_CORRECTED_CTA;
}

/**
 * The honest line for a view: the read-only warning on the original, and the
 * source-of-truth line on the corrected view. Never empty (a switch with no
 * explanation is what leaves a user unsure which score they are looking at).
 */
export function editorViewNote(view: EditorTakeView): string {
  return view === EDITOR_VIEW_ORIGINAL
    ? EDITOR_ORIGINAL_READ_ONLY_LINE
    : EDITOR_VIEW_SOURCE_OF_TRUTH_LINE;
}

/**
 * Whether a switch to `view` must reset the model. FALSE, always: switching the
 * view is a DISPLAY change. Rebuilding the model on a switch would throw away the
 * user's in-flight edits (and re-tag every note), which is the one thing the
 * corrected take must never suffer.
 */
export function editorViewSwitchRebuildsModel(_view: EditorTakeView): boolean {
  return false;
}
