/**
 * D40 GUARDS — THE TAKE'S SCORE WRAPS (owner 2026-11-21).
 *
 * The owner, with screenshots: a 32-bar take was drawn as ONE unbroken system —
 * "a single strip of marks about 4 px tall across the full width", with the rest
 * of the screen empty. Both the card and the full-screen reader did it.
 *
 * MEASURED, in a real headless render at a 393 px phone width, before this fix:
 * the card document laid the whole 32 bars out at abcjs's 740 px default and CSS
 * shrank it into the card — the entire take came back **6 px tall**. After it:
 * **1548 px tall, 16 systems of 2 bars, noteheads 16 px** — and 5142 px at the
 * reader's 1.8 scale with noteheads 26 px.
 *
 * FIVE RULES, and one guard each. Every guard here was made to FAIL before it was
 * trusted: each block names the edit that breaks it, and those edits were run
 * against the real files (see the delivery note).
 *
 * Source-scan + pure-math style, like the rest of this repo's UI contracts: the
 * rules are about the SHAPE of the document abcjs is handed and about which call
 * site asks for what, because that is where D40 lives.
 */
import {
  generateAbcHtml,
  generateAbcWrappedHtml,
  READER_BARS_PER_SYSTEM,
  READER_MIN_SCALE,
  READER_SCALE,
  WRAP_MAX_BARS_PER_SYSTEM,
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

const abc = 'X:1\nM:4/4\nL:1/8\nK:C\nCDEF GABc|CDEF GABc|CDEF GABc|CDEF GABc|\n';

/** The options WE hand `renderAbc` (the document also carries the whole abcjs
 *  bundle inline, so a naive `includes` would match the renderer, not us). */
function renderOptions(document: string): string {
  const start = document.indexOf("renderAbc('paper', abc, {");
  if (start < 0) return '';
  const end = document.indexOf('});', start);
  return end < 0 ? '' : document.slice(start, end);
}

const wrapped = generateAbcWrappedHtml(abc);
const wrappedReader = generateAbcWrappedHtml(abc, undefined, undefined, undefined, READER_SCALE);
const wrappedOptions = renderOptions(wrapped);
const wrappedReaderOptions = renderOptions(wrappedReader);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40 (1/5) — the document asks abcjs to WRAP');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: delete the `wrap: { preferredMeasuresPerLine: ... }` line from
// `wrapRenderCall` and the second assertion fails — abcjs then lays the tune out
// on one line again (`calcLineWraps` only runs when `wrap` AND `staffwidth` are
// both present).
ok('the wrapped document passes a staffwidth', /staffwidth:\s*staffwidth/.test(wrappedOptions));
ok(
  'the wrapped document asks for a fixed bars-per-system',
  /wrap:\s*\{\s*preferredMeasuresPerLine:\s*bars\s*\}/.test(wrappedOptions),
  wrappedOptions,
);
ok(
  'the wrapped document is NOT responsive: resize (it lays out at 740 px and drops scale)',
  !wrappedOptions.includes("responsive: 'resize'"),
);
ok(
  'the bars per system is computed from the width, not fixed at one',
  wrapped.includes('Math.min(MAX_BARS, Math.floor(layoutWidth / MIN_BAR))'),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40 (2/5) — FIT means fit-to-width, never shrink-to-one-line');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: drop the `var factor = width / drawn;` / transform / paper-height
// block and these fail — the drawing is then whatever width abcjs chose, which is
// how a long take ends up smaller than the box it is in.
ok(
  'the finished drawing is fitted to the paper width',
  wrapped.includes('var factor = width / drawn;') && wrapped.includes('svg.style.transform'),
);
ok(
  'the stretched height is recorded on the paper (so the height probe tells the truth)',
  wrapped.includes('paper.style.height = Math.ceil(svg.getBoundingClientRect().height)'),
);
ok(
  'the drawing is re-fitted when the paper changes width (rotation, reader zoom)',
  wrapped.includes('window.addEventListener("resize"'),
);
ok(
  'the wrapped document renders at abcjs scale 1 (its scale is a CSS transform that overflows)',
  /scale:\s*1\s*,/.test(wrappedOptions),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40 (3/5) — a bar is never squeezed: one..four bars, and room for each');
// ─────────────────────────────────────────────────────────────────────────────

let floorHeld = true;
let ceilingHeld = true;
let roomHeld = true;
let fitHeld = true;
const widths = [200, 240, 280, 320, 360, 377, 393, 420, 480, 600, 768, 1024, 1280];
const scales = [1, 1.25, 1.5, 1.8, 2];
for (const width of widths) {
  for (const scale of scales) {
    const layout = wrapLayout(width, scale);
    if (layout.barsPerSystem < 1) floorHeld = false;
    if (layout.barsPerSystem > 4) ceilingHeld = false;
    // Every bar on the system keeps at least the floor's worth of layout room.
    if (layout.layoutWidthPx < layout.barsPerSystem * WRAP_MIN_BAR_WIDTH_PX) roomHeld = false;
    // …and the drawing is the width of the box, not wider (nothing to pan to).
    if (Math.abs(layout.systemWidthPx - width) > 1) fitHeld = false;
  }
}
// MUTATION: raise WRAP_MAX_BARS_PER_SYSTEM above four (or drop the Math.min) and
// the ceiling guard fails at a 1280 px width — the D27 spec's four-bar ceiling.
ok('a system never holds fewer than one bar', floorHeld);
ok(`a system never holds more than four bars (${WRAP_MAX_BARS_PER_SYSTEM})`, ceilingHeld);
ok('every bar keeps its minimum room, so more bars never means smaller marks', roomHeld);
ok('the fitted drawing is exactly the width it was given', fitHeld);
ok('the four-bar ceiling is the D27 ceiling', WRAP_MAX_BARS_PER_SYSTEM === READER_BARS_PER_SYSTEM);
// A phone-sized card wraps into systems of a few bars — not one, not thirty-two.
ok(
  'a 377 px phone card holds more than one bar and fewer than five',
  wrapLayout(377, 1).barsPerSystem > 1 && wrapLayout(377, 1).barsPerSystem <= 4,
  `saw ${wrapLayout(377, 1).barsPerSystem}`,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40 (4/5) — the D27 legibility floor still holds');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: accept a scale below the floor in `wrapLayout` (drop the
// `>= WRAP_SCALE_FLOOR` test) and this fails.
ok('a scale below the floor is refused', wrapLayout(377, 0.4).scale >= 1);
ok(
  'a bigger scale is laid out in a narrower layout width (bigger marks, fewer bars)',
  wrapLayout(377, READER_SCALE).layoutWidthPx < wrapLayout(377, 1).layoutWidthPx &&
    wrapLayout(377, READER_SCALE).barsPerSystem <= wrapLayout(377, 1).barsPerSystem,
);
const view = read('src/components/AbcScoreView.tsx');
ok(
  'a wrapped READER is still drawn at no less than the D27 floor',
  view.includes('Math.max(READER_MIN_SCALE, readerScale)') &&
    // v66: the scale goes through the window's own floor rule (`scoreWindowWrapScale`
    // clamps to READER_MIN_SCALE), so the guarantee is the same one, enforced once.
    view.includes('scoreWindowWrapScale(readerScaleValue)'),
);
ok(`the D27 floor is still ${READER_MIN_SCALE}`, READER_MIN_SCALE >= 1.5);

// ─────────────────────────────────────────────────────────────────────────────
console.log('D40 (5/5) — every take surface asks for the wrap');
// ─────────────────────────────────────────────────────────────────────────────

// MUTATION: delete `wrapSystems` from any one of these and its assertion fails —
// that surface goes back to the one-strip document.
const staffCard = read('src/components/TakeStaffCard.tsx');
ok(
  'the take card wraps BOTH of its staves (raw and auto-cleaned)',
  staffCard.split('wrapSystems').length - 1 >= 2,
);
ok('the full-screen notation reader (Fit) wraps', read('src/components/TakeNotationReader.tsx').includes('wrapSystems'));
const editor = read('src/components/TakeCorrectionEditor.tsx');
ok('the take editor and its full-screen staff wrap', editor.split('wrapSystems').length - 1 >= 2);
ok(
  'the viewer chooses the wrapped document when asked',
  // v66: the choice is `scoreWindowDocument(...)` — `wrapSystems` still asks for the
  // wrap by name, and the full-screen window now asks for it too.
  view.includes('scoreWindowDocument({ inWindow: inScoreWindow, wrapSystems, autoWrap })') &&
    view.includes('generateAbcWrappedHtml('),
);
// The library's own scores are NOT silently re-laid out: the card document is
// unchanged, which is what the D27 guards also assert.
ok(
  'the plain card document is untouched (the published scores keep their layout)',
  generateAbcHtml(abc).includes("responsive: 'resize'"),
);

if (failures > 0) {
  console.log(`\nD40: ${failures} guard(s) failed`);
  process.exit(1);
}
console.log('\nD40: all guards passed');
