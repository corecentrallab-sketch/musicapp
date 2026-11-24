/**
 * D40b GUARDS — THE LIBRARY CARD WRAPS A SCORE THAT NO LONGER FITS IT.
 *
 * THE DEFECT (the same one the owner reported as D40, on the surface D40 left
 * alone). D40 wrapped every surface that draws the user's TAKE. The card that
 * draws a SAVED library score — the notation editor's in-page staff — kept the
 * plain card document, and the card document has no `wrap`: `responsive: 'resize'`
 * re-flows the whole tune onto ONE system at the card's width. Four bars read
 * fine; thirty-two bars are drawn at a quarter of the size, which is the owner's
 * "strip of marks about four pixels tall".
 *
 * THE RULE THIS SUITE PINS, in two halves:
 *
 *   1. A SHORT SCORE KEEPS ITS CARD DOCUMENT. Nothing about a four-bar excerpt
 *      changes — that is what the D27 guards pin, and they still must.
 *   2. A LONG SCORE WRAPS, AND NOTHING IS EVER DRAWN BELOW THE FLOOR. The card
 *      keeps its own document only while a bar still gets `CARD_MIN_BAR_WIDTH_PX`
 *      of room; below that the score wraps into systems drawn at natural size.
 *
 * Source-scan + pure-math style, like the rest of this repo's UI contracts: the
 * rules are about which document a card chooses and what the maths guarantees,
 * because that is where this defect lives.
 */
import {
  CARD_DOCUMENT_INSET_PX,
  CARD_MIN_BAR_WIDTH_PX,
  cardDocumentChoice,
  generateAbcHtml,
  generateAbcWrappedHtml,
  READER_MIN_SCALE,
  WRAP_DEFAULT_SCALE,
  WRAP_MIN_BAR_WIDTH_PX,
  wrapLayout,
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

/** A bundled-style excerpt: four bars of 4/4. */
const shortAbc = 'X:1\nT:short\nM:4/4\nL:1/8\nK:C\nCDEF GABc|CDEF GABc|CDEF GABc|CDEF GABc|\n';
/** A real library piece: thirty-two bars of 4/4 on one line, like a saved score. */
const longAbc =
  'X:1\nT:long\nM:4/4\nL:1/8\nK:C\n' + 'CDEF GABc|'.repeat(32) + '\n';
/** A 393 px phone: the width the D27/D40 measurements were taken at. */
const PHONE_PX = 393;
const cardWidth = PHONE_PX - CARD_DOCUMENT_INSET_PX;

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40b (1/5) — a SHORT score keeps the card document');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: drop the `barWidthPx >= CARD_MIN_BAR_WIDTH_PX` test and return
// 'wrapped' unconditionally — this fails, and every four-bar library card would
// be re-laid out for no reason.
const shortChoice = cardDocumentChoice(shortAbc, cardWidth);
ok(
  'a four-bar excerpt is drawn with the plain card document',
  shortChoice.document === 'card',
  `saw ${shortChoice.document} at ${shortChoice.barWidthPx} px/bar`,
);
ok('its bar count is read from the score itself', shortChoice.bars === 4, `saw ${shortChoice.bars}`);
// A score with no readable music has nothing to wrap: the card's empty state shows.
ok(
  'a score with no readable music keeps the card document',
  cardDocumentChoice('X:1\nT:empty\nM:4/4\nL:1/8\nK:C\n', cardWidth).document === 'card',
);
ok(
  'an unreadable width falls back instead of throwing',
  cardDocumentChoice(shortAbc, undefined).document === 'card' &&
    cardDocumentChoice(shortAbc, 'wide').document === 'card',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40b (2/5) — a LONG score wraps');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: return 'card' unconditionally (the shipped bug) and this fails.
const longChoice = cardDocumentChoice(longAbc, cardWidth);
ok(
  'a 32-bar library score wraps instead of being shrunk onto one line',
  longChoice.document === 'wrapped',
  `saw ${longChoice.document} at ${longChoice.barWidthPx} px/bar`,
);
ok('its bar count is read from the score itself', longChoice.bars === 32, `saw ${longChoice.bars}`);
// The same score in a wider box still fits: the decision is width-aware, not a
// hard-coded bar limit (a tablet card must not wrap a score that fits it).
ok(
  'the same score on a wide card keeps the card document',
  cardDocumentChoice(longAbc, 4000).document === 'card',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40b (3/5) — the D27 legibility floor is never crossed');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: lower CARD_MIN_BAR_WIDTH_PX (e.g. to 40) and the "no card is ever
// drawn below the floor" guard fails — the card would shrink marks the wrapped
// document draws at full size.
ok(
  'the card floor is the wrapped document\'s own per-bar room',
  CARD_MIN_BAR_WIDTH_PX === WRAP_MIN_BAR_WIDTH_PX,
);
let cardFloorHeld = true;
let wrapFloorHeld = true;
let decisionCovered = true;
const widths = [200, 240, 280, 320, 345, 377, 393, 420, 480, 600, 768, 1024, 1280];
for (const width of widths) {
  for (let bars = 1; bars <= 40; bars++) {
    const abc = 'X:1\nM:4/4\nL:1/8\nK:C\n' + 'CDEF GABc|'.repeat(bars) + '\n';
    const choice = cardDocumentChoice(abc, width);
    if (choice.bars !== bars) decisionCovered = false;
    if (choice.document === 'card' && choice.barWidthPx < CARD_MIN_BAR_WIDTH_PX) cardFloorHeld = false;
    if (choice.document === 'wrapped') {
      // A wrapped score is laid out at natural size: every bar keeps its room,
      // one..four to a system, and the drawing is the width it was given.
      const layout = wrapLayout(width, WRAP_DEFAULT_SCALE);
      if (layout.layoutWidthPx < layout.barsPerSystem * WRAP_MIN_BAR_WIDTH_PX) wrapFloorHeld = false;
      if (layout.scale < 1) wrapFloorHeld = false;
    }
  }
}
ok('every bar count is read from the score (1..40 over 13 widths)', decisionCovered);
ok('no card is ever drawn with a bar below the floor', cardFloorHeld);
ok('every wrapped card keeps its room per bar at natural scale', wrapFloorHeld);
ok(`the D27 reader floor is untouched (${READER_MIN_SCALE})`, READER_MIN_SCALE >= 1.5);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40b (4/5) — the card document is unchanged for the scores that keep it');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: add `wrap`/`staffwidth` to `generateAbcHtml` (i.e. "fix" it in place
// instead of choosing a document) and these fail — the D27 guards pin this
// document byte for byte.
const cardDocument = generateAbcHtml(shortAbc);
/** What WE hand `renderAbc` — the documents also carry the whole abcjs bundle
 *  inline, so a naive `includes` would match the renderer, not our options. */
function renderOptions(document: string): string {
  const start = document.indexOf("renderAbc('paper', abc, {");
  if (start < 0) return '';
  const end = document.indexOf('});', start);
  return end < 0 ? '' : document.slice(start, end);
}
const cardOptions = renderOptions(cardDocument);
ok('the card document still reflows to fit', cardOptions.includes("responsive: 'resize'"));
ok('the card document still caps the drawing at the card width', cardDocument.includes('max-width: 100%'));
ok('the card document still passes no staffwidth', !/staffwidth:/.test(cardOptions));
ok('the card document still passes no scale', !/scale:\s*[\d.]/.test(cardOptions));
const wrappedDocument = generateAbcWrappedHtml(longAbc);
ok(
  'the document a long card gets is the D40 wrapped one',
  wrappedDocument.includes('wrap: { preferredMeasuresPerLine: bars }') &&
    wrappedDocument.includes('staffwidth: staffwidth'),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40b (5/5) — the viewer chooses, and the reader is not touched');
// ─────────────────────────────────────────────────────────────────────────────

const view = code(read('src/components/AbcScoreView.tsx'));
// MUTATION: delete the `autoWrap` memo (or its `wrapped` term) and this fails —
// the library card goes back to the one-strip document.
ok(
  'the viewer asks which document a card should draw',
  view.includes('cardDocumentChoice(abc, window.width - CARD_DOCUMENT_INSET_PX)'),
);
ok(
  'the wrap is chosen for a card that must wrap',
  // v66: the card's own decision is still `autoWrap`, now read through the one document
  // rule (`scoreWindowDocument`), which the window overrides for itself.
  view.includes('autoWrap }) === \'wrapped\'') && view.includes('autoWrap = useMemo('),
);
ok(
  'the reader documents are never auto-wrapped (D27 pins them)',
  view.includes('!reader &&') && view.includes('cardDocumentChoice('),
);
// The short-score path still hands the card document to the WebView.
ok(
  'the plain card document is still the fallback (the D27/v33 seam)',
  view.includes('generateAbcHtml(abc, ink, background)'),
);
ok(
  'the wrapped document is the one a long card draws',
  view.includes('generateAbcWrappedHtml(abc, ink, background, undefined, wrapScale)'),
);
// The card's own width is the phone's minus the padding both sides; a hard-coded
// phone width would be wrong on every device that is not that phone.
const html = code(read('src/services/abcHtml.ts'));
ok(
  'the card width is the screen width minus the documented padding',
  html.includes('export const CARD_DOCUMENT_INSET_PX = 48'),
);

if (failures > 0) {
  console.log(`\nD40b: ${failures} guard(s) failed`);
  process.exit(1);
}
console.log('\nD40b: all guards passed');
