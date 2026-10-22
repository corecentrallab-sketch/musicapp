/**
 * notationPicker.ts — the "Choose a piece" picker's label and shape.
 *
 * WHY IT EXISTS (v43 slice 2, owner 10-22). The notation editor's picker was a
 * HORIZONTAL chip scroller with no scroll indicator and no count. It held all
 * eight pieces, but two fit on screen and nothing said the others existed, so
 * the owner reported "there are only Für Elise and Ode to Joy". The list was
 * never the bug; the SURFACE was.
 *
 * The fix is one label ("Choose a piece · 8", the count DERIVED from the array
 * so it can never drift) plus a wrapping 2-column grid that lays all eight out
 * at once. This module owns the words and the geometry constants so the screen
 * and the gate cannot disagree about them.
 *
 * Pure logic, no react-native / expo imports (plain Node tests).
 */

/** testID the picker's container renders with. */
export const NOTATION_PICKER_TAG = 'notation-picker';
/** Two chips per row: eight pieces = four short rows, no scrolling needed. */
export const NOTATION_PICKER_COLUMNS = 2;

/**
 * "Choose a piece · 8" — the count is the array length the caller passes, so a
 * ninth piece makes the label read 9 without anyone editing a string.
 */
export function choosePieceLabel(count: number): string {
  const raw = Number(count);
  const n = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  return `Choose a piece \u00b7 ${n}`;
}

/** How many rows a wrapping grid of `count` chips needs (rests on the last row). */
export function notationPickerRows(count: number): number {
  const raw = Number(count);
  const n = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  return Math.ceil(n / NOTATION_PICKER_COLUMNS);
}
