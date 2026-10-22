/**
 * scoreLength.test.ts — the honest length line (v43 slice 2, item A2).
 *
 * The owner's "it only shows 4 bars" was DATA (a 4-bar bundled sample) read as a
 * broken renderer. These assertions pin the words that make the difference
 * visible, and pin them to the SCORE: the number is always the ABC's own bar
 * count, never a typed constant.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  SCORE_LENGTH_TAG,
  isExcerptScore,
  scoreLengthAccessibilityLabel,
  scoreLengthLine,
} from '../src/services/scoreLength';
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';
import { countAbcBars, SAMPLE_EXCERPT_MAX_BARS } from '../src/services/transposedScore';

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

const ENS = '\u2013'; // en dash, the owner's wording
const MID = '\u00b7';

function fourBarExcerpt(): string {
  const score = PUBLIC_DOMAIN_ABC_SCORES.find((s) => s.id === 'canon-in-d');
  return score ? score.abc : '';
}

/** A synthetic score of `bars` bars (4/4, quarter notes). */
function abcWithBars(bars: number): string {
  return ['X:1', 'T:synthetic', 'M:4/4', 'L:1/4', 'K:C', 'C D E F |'.repeat(bars).trim()].join('\n');
}

function main(): void {
  console.log('\n=== the honest length line ===');
  assert(SCORE_LENGTH_TAG === 'score-length', 'the length line has ONE testID');

  // ── the owner's exact wording ────────────────────────────────
  const fourBar = fourBarExcerpt();
  assertEq(countAbcBars(fourBar), 4, 'the Canon in D sample really is 4 bars');
  assertEq(
    scoreLengthLine(fourBar),
    `Bars 1${ENS}4 of 4`,
    'a 4-bar sample reads "Bars 1–4 of 4" (the diagnosis\' exact wording)',
  );
  assert(isExcerptScore(fourBar), 'a 4-bar sample is an excerpt');

  // ── edge cases ──────────────────────────────────────────────
  assertEq(scoreLengthLine(''), null, 'no music → no line (never "Bars 1–0 of 0")');
  assertEq(scoreLengthLine('not abc at all'), null, 'prose is not a score');
  assertEq(scoreLengthLine(null), null, 'null is not a score');
  assertEq(scoreLengthLine(abcWithBars(1)), `Bars 1${ENS}1 of 1`, 'a one-bar score reads "Bars 1–1 of 1"');
  assertEq(
    scoreLengthLine(abcWithBars(SAMPLE_EXCERPT_MAX_BARS)),
    `Bars 1${ENS}${SAMPLE_EXCERPT_MAX_BARS} of ${SAMPLE_EXCERPT_MAX_BARS}`,
    'the last bar that still counts as a sample says so',
  );
  assertEq(
    scoreLengthLine(abcWithBars(SAMPLE_EXCERPT_MAX_BARS + 1)),
    `${SAMPLE_EXCERPT_MAX_BARS + 1} bars`,
    'one bar past the sample ceiling is a plain length, not an excerpt claim',
  );
  assertEq(scoreLengthLine(abcWithBars(120)), '120 bars', 'a long work reads its true count');

  // ── the line can never claim a length the score does not have ──
  for (const score of PUBLIC_DOMAIN_ABC_SCORES) {
    const bars = countAbcBars(score.abc);
    const line = scoreLengthLine(score.abc);
    assert(line !== null, `${score.id}: the line is present (${String(line)})`);
    assert(
      line !== null && line.includes(String(bars)),
      `${score.id}: the line carries the score's own bar count (${bars})`,
    );
  }

  // ── the accessibility line says the caveat out loud ─────────
  assertEq(
    scoreLengthAccessibilityLabel(fourBar),
    `Bars 1${ENS}4 of 4 \u2014 a bundled sample, not the full work`,
    'a screen reader hears that a sample is a sample',
  );
  assertEq(
    scoreLengthAccessibilityLabel(abcWithBars(16)),
    '16 bars in this score',
    'a longer score says only what it is',
  );
  assertEq(scoreLengthAccessibilityLabel(''), null, 'no music → nothing announced');

  // ── the picker/services style separator is the owner's middle dot ──
  assert(MID === '\u00b7', 'the middle dot used elsewhere is U+00B7 (sanity)');

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
