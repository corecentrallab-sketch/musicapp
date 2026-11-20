/**
 * practiceFailure.ts — WHERE A PRACTICE-VIDEO FAILURE IS SAID (D38).
 *
 * THE DEFECT. The practice-video playback surface keeps one `errorLine` and
 * printed it at the very BOTTOM of a long scrolling page — after the staff, after
 * the Send-to button, after the delete button. A user who pressed "line the notes
 * up" three screens above the end of the page got no visible answer: the sentence
 * was real, it was simply said somewhere else. A failure belongs beside the thing
 * that failed.
 *
 * THE SHAPE. The surface names the ANCHOR it wants a failure shown at — the video
 * block, the alignment controls, the delete button — and each of those blocks asks
 * this module whether the failure on screen is its own. One failure is on screen
 * at a time, so at most one block may claim it. That is a rule about a value, not
 * about JSX, which is why it lives here where the gate can assert it.
 *
 * A failure with NO anchor (the record surface's own camera/start/keep failures)
 * belongs to no block on the playback page and is said by the record surface,
 * exactly as before.
 *
 * PURE: no react, no react-native, no expo.
 */

/** The places on the practice-video playback surface a failure can be said. */
export type FailureWhere = 'video' | 'align' | 'delete';

/** Every anchor, in the order the page lays them out (video → align → delete). */
export const FAILURE_WHERE: readonly FailureWhere[] = ['video', 'align', 'delete'];

function isFailureWhere(value: unknown): value is FailureWhere {
  return value === 'video' || value === 'align' || value === 'delete';
}

/**
 * THE ANCHOR TO HOLD FOR A FAILURE — or `null` when there is no failure, which
 * CLEARS the anchor. A cleared line must never leave a stale anchor behind, or a
 * block would later print an empty sentence where nothing failed. A line that is
 * only whitespace is not a failure either: it would draw an empty red row. A
 * failure with no anchor (`where` not one of the three) is a record-surface
 * failure and claims no block.
 */
export function failureWhereForLine(
  line: unknown,
  where: FailureWhere | null | undefined,
): FailureWhere | null {
  if (typeof line !== 'string' || line.trim().length === 0) return null;
  return isFailureWhere(where) ? where : null;
}

/**
 * WHETHER THIS BLOCK IS THE ONE THAT SAYS IT. False for a null/undefined anchor
 * and false for any block that is not the anchor, so a failure can never be
 * printed twice or in a place that did not fail.
 */
export function failureIsShownAt(
  where: FailureWhere | null | undefined,
  anchor: FailureWhere,
): boolean {
  return where === anchor;
}
