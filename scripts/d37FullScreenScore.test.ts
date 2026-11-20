/**
 * D37 / D38 GUARDS — the practice-video full-screen score, readable.
 *
 * The owner, 2026-11-17: *"I am unable to read the score as the print is so
 * compressed. There needs to be a full screen option… This really needs a fix."*
 * Four things had to change, and this suite proves each one separately:
 *
 *   1. PINCH-TO-ZOOM AND PAN — a reader can be pinched, and the document is as
 *      wide as the drawing so there is something to pan to.
 *   2. LANDSCAPE RENDERS THE SCORE — a rotation is a NEW document drawn for the
 *      new window, and the window itself is allowed to be presented sideways.
 *   3. NO CLIPPED TEXT — neither the window's own header nor the score's own
 *      drawing may be cut off at the edge.
 *   4. THE FAILURE IS SAID WHERE IT HAPPENED — not at the bottom of the page.
 *
 * EVERY GUARD HERE IS PROVED TO BITE: each block names the exact edit that makes
 * it fail, and those edits were run against the real files before delivery.
 *
 * Source-scan style, like the rest of this repo's UI contracts: the assertions
 * are about the SHAPE of the two documents and about which call site asks for
 * what, because that is where D37/D38 actually live.
 */
import { generateAbcHtml, generateAbcReaderHtml } from '../src/services/abcHtml';
import { READER_MAX_ZOOM, readerViewportKey, readerZoomProps } from '../src/services/scoreReaderViewport';
import {
  FAILURE_WHERE,
  failureIsShownAt,
  failureWhereForLine,
} from '../src/services/practiceFailure';

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

// The gate compiles this file to /tmp/tier1-test/scripts, so `__dirname` is not
// the repo: the source-scan reads resolve against the working directory, like
// every other UI contract suite in this repo (the gate runs from the repo root).
const root = process.cwd();
function read(rel: string): string {
  return String(fs.readFileSync(path.join(root, rel), 'utf8'));
}

const abc = 'X:1\nT:t\nM:4/4\nL:1/8\nK:C\nCDEF GABc|\n';
const card = generateAbcHtml(abc);
const reader = generateAbcReaderHtml(abc);

const VIEW = read('src/components/AbcScoreView.tsx');
const WINDOW = read('src/components/FullScreenScore.tsx');
const PRACTICE = read('src/screens/PracticeVideoScreen.tsx');

/** How many times `needle` occurs in `haystack` (no regex, no surprises). */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('D37 (1/4) — pinch-to-zoom and pan');
// ─────────────────────────────────────────────────────────────────────────────

// The WebView switches, as data. MUTATION: return `{}` for a reader and the
// first two assertions fail (a pinch is ignored and the drawing cannot be
// enlarged).
const readerZoom = readerZoomProps(true);
ok('a reader turns the WebView built-in zoom ON', readerZoom.setBuiltInZoomControls === true);
ok('a reader hides the +/− widget (the gesture is the control)', readerZoom.setDisplayZoomControls === false);
// MUTATION: return the same object for a card and the card starts zooming under
// a page that scrolls.
const cardZoom = readerZoomProps(false);
ok('a card gets NO zoom switches at all', Object.keys(cardZoom).length === 0);

// The document has always declared the zoom it permits; the ceiling has to be a
// real zoom, not 1.0. MUTATION: drop `user-scalable=yes` from the shell and this
// fails (Android then refuses the pinch however the WebView is configured).
ok('the document declares user-scalable=yes', /user-scalable=yes/.test(reader));
const maxScale = Number((reader.match(/maximum-scale=([\d.]+)/) || [])[1]);
ok(
  `the document permits at least ${READER_MAX_ZOOM}x zoom`,
  Number.isFinite(maxScale) && maxScale >= READER_MAX_ZOOM,
  `saw maximum-scale=${(reader.match(/maximum-scale=([\d.]+)/) || [])[1]}`,
);

// WIRED, not merely available. MUTATION: delete `{...zoomProps}` from the
// WebView and the assertion below fails while the pure rules above stay green —
// which is exactly the "a control that renders and does nothing" class.
ok('AbcScoreView computes the reader zoom switches', VIEW.includes('readerZoomProps(reader)'));
ok('AbcScoreView spreads them on the WebView', VIEW.includes('{...zoomProps}'));

// PAN: the reader is always the self-scroll band, so the WebView takes the drag.
// MUTATION: `const viewerInteractive = reader ? false : …` and the last bar can
// never be reached.
ok(
  'a reader always hands the drag to the WebView (it pans)',
  VIEW.includes('const viewerInteractive = reader ? true :'),
);
ok('the WebView is scrollable while a reader is open', VIEW.includes('scrollEnabled={viewerInteractive}'));

// SOMETHING TO PAN TO. A drawing wider than a body pinned to `width: 100%` is
// clipped at the right edge and no amount of dragging reaches it — the owner's
// "text cut off". MUTATION: remove the two rules below and both assertions fail.
ok('the reader document is as wide as its drawing', /html\s*\{\s*width:\s*max-content;/.test(reader));
ok('the reader body is never narrower than the screen', /body\s*\{[^}]*min-width:\s*100vw/.test(reader));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nD37 (2/4) — landscape actually renders the score');
// ─────────────────────────────────────────────────────────────────────────────

// THE VIEWPORT IS PART OF THE DOCUMENT'S IDENTITY. MUTATION: return '' always
// and a rotation keeps the document laid out for the old width — the score then
// shows nothing where the new window expects music.
const portrait = readerViewportKey(360, 800);
const landscape = readerViewportKey(800, 360);
ok('a rotated window produces a DIFFERENT viewport key', portrait !== landscape, `${portrait} vs ${landscape}`);
ok('the same window produces the SAME key', readerViewportKey(360, 800) === portrait);
// MUTATION: drop the guards and a 0-height window mid-rotation churns the key on
// every frame (a WebView reload storm instead of a score).
ok('a junk or zero size produces NO key part', readerViewportKey(0, 800) === '' && readerViewportKey('junk', 360) === '');
ok('a negative size produces NO key part', readerViewportKey(-1, 800) === '');

// WIRED: the key the WebView reloads on carries it. MUTATION: remove
// `${reader ? viewportKey : ''}` from the key and this fails.
ok('the reader key carries the window size', VIEW.includes('readerViewportKey(window.width, window.height)'));
ok('the WebView key includes it', /\$\{reader \? viewportKey : ''\}/.test(VIEW));

// THE WINDOW MAY BE PRESENTED SIDEWAYS AT ALL. MUTATION: delete
// `supportedOrientations` and this fails; a modal that is not told otherwise
// stays in the orientation it opened in.
ok(
  'the full-screen window is presentable in both orientations',
  WINDOW.includes("supportedOrientations={['portrait', 'landscape']}"),
);

// THE READER'S BOX IS THE VISIBLE AREA, not the raw window height (which in
// landscape is taller than the body the modal gives it). MUTATION: delete
// `viewportHeight={expandBoxHeight}` and this fails.
ok(
  'the practice-video reader is handed the visible box',
  PRACTICE.includes('viewportHeight={expandBoxHeight}'),
);
ok(
  'and it is the reader call site that gets it',
  count(PRACTICE, 'readerScale={READER_SCALE}') === 1 && count(PRACTICE, 'viewportHeight={expandBoxHeight}') === 1,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nD37 (3/4) — no clipped text');
// ─────────────────────────────────────────────────────────────────────────────

// THE WINDOW'S OWN HEADER. It was pinned to one line in both places, so a work's
// name plus the key chip was ellipsised/cut on a phone. MUTATION: put
// `numberOfLines={1}` back on the title and the first assertion fails.
ok('the header title may wrap to two lines', WINDOW.includes('numberOfLines={2}'));
ok('the header truncates nothing else', !WINDOW.includes('numberOfLines={1}'));
ok('the key chip is not truncated', !/chipText[\s\S]{0,120}numberOfLines/.test(WINDOW));

// THE CARD IS UNTOUCHED. The width fix belongs to the reader document only: a
// card still reflows and still caps its drawing at the card width. MUTATION:
// hoist `width: max-content` into the shared shell and both of these fail.
ok('the card document does not carry the reader width rules', !card.includes('max-content'));
ok('the card still fits its card width', card.includes('max-width: 100%'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nD38 (4/4) — the failure is said beside the thing that failed');
// ─────────────────────────────────────────────────────────────────────────────

// THE RULE, as values. MUTATION: make `failureWhereForLine` return its `where`
// unconditionally and the "clears" assertions fail — a cleared line would leave
// a stale anchor behind and print an empty red row.
ok('a failure keeps the anchor it was given', failureWhereForLine('boom', 'align') === 'align');
ok('a cleared line clears the anchor', failureWhereForLine(null, 'align') === null);
ok('an empty/whitespace line is not a failure', failureWhereForLine('   ', 'delete') === null);
ok('an unanchored failure claims no block', failureWhereForLine('boom', null) === null);
for (const anchor of FAILURE_WHERE) {
  ok(`  '${anchor}' is shown at itself`, failureIsShownAt(anchor, anchor) === true);
  const others = FAILURE_WHERE.filter((other) => other !== anchor);
  ok(
    `  '${anchor}' is not shown at ${others.join('/')}`,
    others.every((other) => failureIsShownAt(anchor, other) === false),
  );
}
ok('no failure at all is shown nowhere', FAILURE_WHERE.every((anchor) => failureIsShownAt(null, anchor) === false));

// WIRED: the three blocks that can fail each ask, and each failure is set with
// its own anchor. MUTATION: delete a block's render (or send an anchor to the
// wrong block) and one of these fails.
for (const anchor of FAILURE_WHERE) {
  ok(
    `the ${anchor} block renders its own failure`,
    PRACTICE.includes(`failureIsShownAt(errorWhere, '${anchor}')`),
  );
}
ok('a missing video is anchored to the video block', PRACTICE.includes("fail(VIDEO_MISSING_LINE, 'video')"));
ok('a gone file is anchored to the video block', PRACTICE.includes("fail(PRACTICE_VIDEO_FILE_GONE_LINE, 'video')"));
ok(
  'a take with nothing to line up is anchored to the alignment controls',
  PRACTICE.includes("fail('There are no notes in this take to line up yet.', 'align')"),
);
ok(
  'a delete that did not happen is anchored to the delete button',
  PRACTICE.includes("fail(DELETE_PRACTICE_VIDEO_FAILED_LINE, 'delete')"),
);
ok('every failure is set through the one setter', count(PRACTICE, 'setErrorLine(') === 1);

// THE DEFECT ITSELF. The bottom-of-page render is what D38 named. MUTATION:
// restore it and the count below becomes 2.
ok(
  'the bottom-of-page failure line is GONE from the playback surface',
  count(PRACTICE, '{errorLine ? <Text style={styles.error}>{errorLine}</Text> : null}') === 1,
  `saw ${count(PRACTICE, '{errorLine ? <Text style={styles.error}>{errorLine}</Text> : null}')} (the record surface keeps its own)`,
);

if (failures > 0) {
  console.log(`\nD37/D38: ${failures} guard(s) failed`);
  process.exit(1);
}
console.log('\nD37/D38: all guards passed');
