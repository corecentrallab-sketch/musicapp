/**
 * vc66 GUARDS (F1/F2/F3) — THE FULL-SCREEN SCORE WINDOW IS LAID OUT FOR THE WINDOW.
 *
 * The owner's v65 pass: the window removed the header and footer but "the page does
 * not fill the screen"; rotating the phone did nothing; and a saved library score
 * opened in the window as "a cut-off page, score unreadable". One root, three
 * symptoms — the renderer was handed the READER document, which is a FIXED four-bar
 * drawing that is measured once from constants and never re-measured for the box it
 * lands in.
 *
 * WHAT THIS SUITE PINS, in the order the fixes were made:
 *   1. THE DOCUMENT — inside the window the score is laid out for the window
 *      (wrapped: fit to the real width, then stack systems down the page), at no
 *      less than the reader's legibility floor.
 *   2. THE RE-MEASURE — that document redraws on `resize`, so a rotation re-lays it
 *      out instead of keeping the drawing it was built with.
 *   3. THE ORIENTATION — the window LOCKS to a both-ways lock rather than unlocking
 *      (an unlock hands the decision to the device's auto-rotate setting, which is
 *      off on a phone that has been locked upright, and the app locks phones to
 *      portrait itself at startup).
 *   4. THE WIRING — the window tells the renderer it is in the window, and the
 *      renderer's document choice actually consults that rule.
 *
 * Source-scan + pure-math, like the rest of this repo's UI contracts: the rules are
 * about which document is chosen and what the orientation plan is, because that is
 * where the defect lives.
 */
import {
  SCORE_WINDOW_ORIENTATION_LOCK,
  scoreWindowDocument,
  scoreWindowOrientationPlan,
  scoreWindowWrapScale,
} from '../src/services/scoreWindow';
import {
  READER_MIN_SCALE,
  WRAP_DEFAULT_SCALE,
  generateAbcWrappedHtml,
  generateAbcReaderHtml,
} from '../src/services/abcHtml';

// The tier1 tsconfig compiles with `types: []`, so there are no Node typings —
// same convention as the repo's other source-scan suites.
declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = process.cwd();
function read(rel: string): string {
  return String(fs.readFileSync(path.join(root, rel), 'utf8'));
}
/** Code only: a guard that matches its own explanatory comment guards nothing. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** A saved library piece: thirty-two bars of 4/4, the owner's "cut-off page". */
const longAbc = 'X:1\nT:long\nM:4/4\nL:1/8\nK:C\n' + 'CDEF GABc|'.repeat(32) + '\n';

// ─────────────────────────────────────────────────────────────────────────────
console.log('vc66/F1+F3 (1/4) — INSIDE THE WINDOW, THE SCORE IS LAID OUT FOR THE WINDOW');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: make `scoreWindowDocument` return the caller's choice inside the window
// (i.e. leave the reader document in place) — this fails, and the window is back to
// a fixed four-bar drawing that is wider than the phone and shorter than the screen.
ok(
  'a score in the window draws the wrapped document',
  scoreWindowDocument({ inWindow: true }) === 'wrapped',
  `got ${scoreWindowDocument({ inWindow: true })}`,
);
ok(
  'the window wins over a card that asked for nothing',
  scoreWindowDocument({ inWindow: true, wrapSystems: false, autoWrap: false }) === 'wrapped',
);
ok(
  'outside the window an untouched card keeps its own choice',
  scoreWindowDocument({ inWindow: false }) === 'as-given',
);
ok(
  'outside the window a take still asks for the wrap by name',
  scoreWindowDocument({ inWindow: false, wrapSystems: true }) === 'wrapped',
);
ok(
  'outside the window a long library card still wraps (D40b untouched)',
  scoreWindowDocument({ inWindow: false, autoWrap: true }) === 'wrapped',
);

// MUTATION: return WRAP_DEFAULT_SCALE unconditionally — this fails, and the window
// draws the music at the size that made the owner call it unreadable.
ok(
  'the window never draws below the reader floor',
  scoreWindowWrapScale(1.8) === 1.8 && scoreWindowWrapScale(0.4) === READER_MIN_SCALE,
  `1.8 -> ${scoreWindowWrapScale(1.8)}, 0.4 -> ${scoreWindowWrapScale(0.4)}`,
);
ok(
  'a surface that named no scale gets the wrapped document\'s own size',
  scoreWindowWrapScale(null) === WRAP_DEFAULT_SCALE,
  `null -> ${scoreWindowWrapScale(null)}`,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('vc66/F2 (2/4) — THE WINDOW\'S DOCUMENT RE-MEASURES ON A ROTATION');
// ─────────────────────────────────────────────────────────────────────────────

const wrappedHtml = generateAbcWrappedHtml(longAbc, '#0b1220', '#ffffff', undefined, 1.8);
const readerHtml = generateAbcReaderHtml(longAbc, '#0b1220', '#ffffff', undefined, 1.8);

// EVERY DOCUMENT INLINES THE WHOLE abcjs LIBRARY, so a bare word like
// `responsive` or `preferredMeasuresPerLine` matches the library's own source and a
// guard built on it is green whatever the app does. These four assertions match the
// WRAP SCRIPT the document itself emits instead — `var staffwidth = ` (measured from
// the paper's real width at draw time), `preferredMeasuresPerLine: bars` (the wrapped
// form, not a fixed bar count) and the resize handler — and the reader's own fixed
// `staffwidth: <number>,` render call. Only the wrapped document has the first three;
// only the reader has the last.
const WRAP_MEASURES_ITSELF = 'var staffwidth = ';
const WRAP_SYSTEMS = 'wrap: { preferredMeasuresPerLine: bars }';
const WRAP_REDRAWS =
  'window.addEventListener("resize", function () { setTimeout(draw, 60); })';

// MUTATION: hand the window the reader document instead — this fails, and the
// drawing keeps the width it was built at when the phone is turned.
ok(
  'the window document redraws when its box changes size',
  wrappedHtml.indexOf(WRAP_REDRAWS) >= 0,
);
ok(
  'the window document wraps into systems instead of one fixed-width line',
  wrappedHtml.indexOf(WRAP_SYSTEMS) >= 0,
);
// The measured-once failure itself: the reader document carries a FIXED staffwidth,
// which is exactly what makes it the same drawing in every box.
ok(
  'the reader document is the fixed-width one (why it could not fill a window)',
  /staffwidth: \d+,/.test(readerHtml) && readerHtml.indexOf(WRAP_MEASURES_ITSELF) < 0,
  'the reader document no longer carries a fixed staffwidth — re-check F1/F3',
);
ok(
  'the window document is NOT the reader document',
  wrappedHtml !== readerHtml &&
    wrappedHtml.indexOf(WRAP_MEASURES_ITSELF) >= 0 &&
    readerHtml.indexOf(WRAP_MEASURES_ITSELF) < 0,
  'the window document does not measure its own width — it is a fixed drawing',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('vc66/F2 (3/4) — THE WINDOW LOCKS BOTH WAYS INSTEAD OF UNLOCKING');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: plan.open = 'UNLOCK' (i.e. unlockAsync, what the old code did) — this
// fails, and the window is back to depending on the device's auto-rotate setting.
ok(
  'the window takes a real lock, not an unlock',
  scoreWindowOrientationPlan(null).open === SCORE_WINDOW_ORIENTATION_LOCK &&
    scoreWindowOrientationPlan(null).open === 'ALL_BUT_UPSIDE_DOWN',
  `got ${scoreWindowOrientationPlan(null).open}`,
);
ok(
  'the lock allows both portrait and landscape (never a forced flip)',
  SCORE_WINDOW_ORIENTATION_LOCK === 'ALL_BUT_UPSIDE_DOWN',
);
ok(
  'the lock found on open is put back on close',
  scoreWindowOrientationPlan('PORTRAIT_UP').close === 'PORTRAIT_UP',
  `got ${scoreWindowOrientationPlan('PORTRAIT_UP').close}`,
);
ok(
  'an unreadable prior lock restores as "nothing claimed"',
  scoreWindowOrientationPlan(null).close === null && scoreWindowOrientationPlan({}).close === null,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('vc66/F1+F2+F3 (4/4) — THE WIRING');
// ─────────────────────────────────────────────────────────────────────────────

const windowSrc = code(read('src/components/FullScreenScore.tsx'));
const viewSrc = code(read('src/components/AbcScoreView.tsx'));

// MUTATION: delete the provider — this fails, and the renderer cannot know it is in
// the window, so it falls back to the card's fixed-width drawing.
ok(
  'the window tells the renderer it is in the window',
  windowSrc.indexOf('ScoreWindowContext.Provider') >= 0,
  'FullScreenScore no longer provides the window context',
);
// MUTATION: go back to `await ScreenOrientation.unlockAsync()` on open — this fails.
ok(
  'the window asks for the both-ways lock on open',
  windowSrc.indexOf('scoreWindowOrientationPlan(') >= 0 &&
    windowSrc.indexOf('lockAsync(') >= 0,
  'FullScreenScore does not use the orientation plan',
);
// MUTATION: put the unlock back on the OPEN path (the old `unlockAsync()` beside the
// lock read) — this fails, and an unreadable previous lock silently cancels the lock
// the window needs.
const unlockCalls = windowSrc.split('await ScreenOrientation.unlockAsync();').length - 1;
ok(
  'the unlock survives only as the "nothing was readable" restore path',
  unlockCalls === 1,
  `found ${unlockCalls} unlock calls (the open path must take the lock instead)`,
);
// MUTATION: restore `const wrapped = wrapSystems === true || autoWrap;` — this fails.
ok(
  'the renderer consults the window rule when it chooses its document',
  viewSrc.indexOf('useFullScreenScoreWindow()') >= 0 &&
    viewSrc.indexOf('scoreWindowDocument(') >= 0,
  'AbcScoreView does not consult the window rule',
);
ok(
  'the renderer no longer chooses its document without the window',
  viewSrc.indexOf('const wrapped = wrapSystems === true || autoWrap;') < 0,
);

if (failures > 0) {
  console.log(`\nvc66ScoreWindow: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nvc66ScoreWindow: all passed');
