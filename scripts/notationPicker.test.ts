/**
 * notationPicker.test.ts — "Choose a piece · 8" (v43 slice 2, item D).
 *
 * The owner reported "only Für Elise and Ode to Joy". All eight pieces were in
 * the list; the picker was a horizontal scroller with no count, so two fit on
 * screen and nothing said the rest existed. The label now states the count, and
 * the count is derived from the array.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  NOTATION_PICKER_COLUMNS,
  NOTATION_PICKER_TAG,
  choosePieceLabel,
  notationPickerRows,
} from '../src/services/notationPicker';
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';

declare const process: { exit(code: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  }
}

function main(): void {
  console.log('\n=== the piece picker shows all eight ===');
  assertEq(choosePieceLabel(8), 'Choose a piece \u00b7 8', 'the label is "Choose a piece · 8"');
  assertEq(choosePieceLabel(0), 'Choose a piece \u00b7 0', 'an empty list says 0, it does not hide');
  assertEq(choosePieceLabel(9), 'Choose a piece \u00b7 9', 'a ninth piece reads 9 with no string edit');
  assertEq(choosePieceLabel(Number.NaN), 'Choose a piece \u00b7 0', 'NaN degrades to 0, never to "NaN"');
  assertEq(choosePieceLabel(-3), 'Choose a piece \u00b7 0', 'a negative count clamps to 0');
  assertEq(choosePieceLabel(7.8), 'Choose a piece \u00b7 7', 'the count is an integer');

  // ── the label matches the real bundled list ─────────────────
  const count = PUBLIC_DOMAIN_ABC_SCORES.length;
  assert(count === 8, `the bundled score list holds all 8 pieces (has ${count})`);
  assertEq(choosePieceLabel(count), 'Choose a piece \u00b7 8', 'the label matches the real array length');
  assert(
    new Set(PUBLIC_DOMAIN_ABC_SCORES.map((s) => s.id)).size === count,
    'every piece id is unique (no chip can hide behind another key)',
  );
  assert(
    PUBLIC_DOMAIN_ABC_SCORES.every((s) => s.title.trim().length > 0 && s.abc.trim().length > 0),
    'every pickable piece has a title and a score',
  );

  // ── the grid geometry ────────────────────────────────────────
  assertEq(NOTATION_PICKER_COLUMNS, 2, 'the grid is two chips wide');
  assertEq(notationPickerRows(8), 4, 'eight pieces make four rows');
  assertEq(notationPickerRows(9), 5, 'a ninth piece makes a fifth row');
  assertEq(notationPickerRows(0), 0, 'no pieces, no rows');
  assertEq(NOTATION_PICKER_TAG, 'notation-picker', 'the picker has ONE testID');

  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
