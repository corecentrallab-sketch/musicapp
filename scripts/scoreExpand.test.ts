/**
 * scoreExpand.test.ts — the full-screen score expander (v43 fix batch, slice 3,
 * item E).
 *
 * Two halves, both needed:
 *
 *   1. THE NUMBERS (pure). `fullScreenScoreBox` is the viewport the modal hands
 *      the renderer. It must always be a USABLE box — never below the score
 *      floor (a collapsed staff is the bug this app has fixed four times), never
 *      above the reader's ceiling — and junk input (a 0-height window during an
 *      orientation change, a missing inset) must fall back to the floor rather
 *      than to nothing. `canExpandScore` says when the affordance may exist at
 *      all, and it includes IMAGE pages: a scanned or PDF page is where full
 *      screen helps most. `scoreExpandSubtitle` builds the header's honest
 *      second line, or nothing.
 *
 *   2. THE WIRING (source scan). Every surface the spec names still offers the
 *      expander, the window still closes on the platform BACK gesture, and the
 *      window is still presentation-only. These read the REAL files at runtime,
 *      so a source edit fails here with no recompile, and each is paired with an
 *      in-memory mutation that must make it fail — a guard nobody has seen fail
 *      is not evidence.
 *
 * Plain Node. Run with: npm run test:tier1
 */
const fs = require('fs');
const path = require('path');
import {
  ABC_READER_MAX_HEIGHT,
  ABC_SCORE_MIN_HEIGHT,
} from '../src/services/scoreHeight';
import {
  SCORE_EXPAND_CLOSE_LABEL,
  SCORE_EXPAND_DOT,
  SCORE_EXPAND_HEADER_HEIGHT,
  SCORE_EXPAND_LABEL,
  SCORE_EXPAND_READONLY_LABEL,
  canExpandScore,
  fullScreenScoreBox,
  scoreExpandSubtitle,
} from '../src/services/scoreExpand';
import {
  SCORE_EXPAND_SURFACES,
  SCORE_EXPAND_WINDOW_PATH,
  expandableSurfaces,
  expanderIsPresentationOnly,
  formatScoreExpandFailures,
  fullScreenScoreHandlesBack,
  lineOf,
  maskSourceComments,
} from '../src/services/scoreExpandContract';
import { IMMERSIVE_ENTER_LABEL } from '../src/services/sheetViewerFit';

declare const require: any;
declare const process: any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;
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
    console.error(
      `  ✗ FAILED: ${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    );
  }
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function read(relative: string): string {
  return fs.readFileSync(path.join(repoRoot(), relative), 'utf8');
}

function main(): void {
  // ── 1. THE VIEWPORT BOX ───────────────────────────────────────────────────
  console.log('\nfullScreenScoreBox — the window the modal hands the renderer');
  assert(
    ABC_SCORE_MIN_HEIGHT > 0 && ABC_READER_MAX_HEIGHT > ABC_SCORE_MIN_HEIGHT,
    'the band is real (floor < ceiling) — the clamp below means something',
  );

  // A tall phone: 844 minus 47/34 insets minus the 56 header leaves 707 — inside
  // the band, so the box is exactly the usable rectangle.
  assertEq(
    fullScreenScoreBox({ windowHeight: 844, topInset: 47, bottomInset: 34 }),
    707,
    'a tall phone gets window − insets − header',
  );
  assertEq(SCORE_EXPAND_HEADER_HEIGHT, 56, 'the header the box subtracts is 56');

  // 9000 − 56 = 8944, which is ABOVE the reader ceiling (a 2400pt window is not:
  // it leaves 2344, still inside [120, 4000], so it is the usable rectangle).
  const tall = fullScreenScoreBox({ windowHeight: 9000, topInset: 0, bottomInset: 0 });
  assertEq(tall, ABC_READER_MAX_HEIGHT, 'an absurdly tall window clamps to the reader ceiling');
  assert(tall <= ABC_READER_MAX_HEIGHT, 'never above ABC_READER_MAX_HEIGHT');

  const tiny = fullScreenScoreBox({ windowHeight: 120, topInset: 47, bottomInset: 34 });
  assertEq(tiny, ABC_SCORE_MIN_HEIGHT, 'a window too small for a staff clamps to the score floor');
  assert(tiny >= ABC_SCORE_MIN_HEIGHT, 'never below ABC_SCORE_MIN_HEIGHT');

  // JUNK AND ZERO: a headless render, a 0-height window mid-rotation, a missing
  // inset. Every one of them must land on the FLOOR — a visible staff, not a
  // collapsed one and not NaN.
  for (const junk of [0, -100, NaN, Infinity, undefined, null, {}]) {
    const box = fullScreenScoreBox({ windowHeight: junk as unknown });
    assertEq(box, ABC_SCORE_MIN_HEIGHT, `junk window ${String(junk)} → the score floor`);
  }
  // A NUMERIC STRING is not junk: `px()` reads it as the number it spells (a native
  // measure can hand us "844"), so the box is 844 − 56, not the floor.
  assertEq(
    fullScreenScoreBox({ windowHeight: '844' as unknown }),
    788,
    'a numeric string window reads as that number, not as junk',
  );
  assertEq(
    fullScreenScoreBox({ windowHeight: 900 }),
    fullScreenScoreBox({ windowHeight: 900, topInset: 0, bottomInset: 0 }),
    'missing insets read as 0, not as NaN',
  );
  assertEq(
    fullScreenScoreBox({ windowHeight: 900, topInset: 'junk', bottomInset: -5 }),
    fullScreenScoreBox({ windowHeight: 900 }),
    'junk or negative insets are ignored',
  );
  const clamped = fullScreenScoreBox({ windowHeight: 900, topInset: 20, bottomInset: 20 });
  assert(
    clamped >= ABC_SCORE_MIN_HEIGHT && clamped <= ABC_READER_MAX_HEIGHT,
    'every in-band window lands strictly inside [floor, ceiling]',
  );

  // ── 2. WHEN AN EXPANDER MAY EXIST AT ALL ─────────────────────────────────
  console.log('\ncanExpandScore — notation OR image pages');
  assert(canExpandScore({ hasAbc: 'X:1\nK:C\nCDEF' }), 'a rendered score can expand');
  assert(!canExpandScore({ hasAbc: '' }), 'an empty score cannot');
  assert(!canExpandScore({ hasAbc: '   ' }), 'a whitespace score cannot');
  assert(!canExpandScore({ hasAbc: null }), 'no score cannot');
  assert(!canExpandScore({}), 'an empty input cannot');
  // THE IMAGE RULE: a PDF/scanned page is where full screen helps most.
  assert(canExpandScore({ isImagePages: true }), 'image pages CAN expand (the rule, not an exception)');
  assert(!canExpandScore({ isImagePages: 'true' }), 'the image flag is a real boolean');
  assert(canExpandScore({ hasAbc: '', isImagePages: true }), 'images alone are enough');

  // ── 3. THE HEADER'S SECOND LINE ──────────────────────────────────────────
  console.log('\nscoreExpandSubtitle — derived, never typed');
  assertEq(
    scoreExpandSubtitle({ from: 'Am', to: 'Bm' }),
    'Transposed' + SCORE_EXPAND_DOT + 'Am \u2192 Bm',
    'a transposition says so, with the app\'s own dot and arrow',
  );
  assertEq(SCORE_EXPAND_DOT, ' \u00b7 ', 'the separator is the app\'s middle dot');
  assertEq(scoreExpandSubtitle({ from: 'Am', to: 'Am' }), null, 'the same key twice → no chip');
  assertEq(scoreExpandSubtitle({ from: 'Am' }), null, 'no target key → no chip');
  assertEq(scoreExpandSubtitle({}), null, 'nothing known → no chip');
  assertEq(
    scoreExpandSubtitle({ from: '  Am  ', to: ' Bm ' }),
    scoreExpandSubtitle({ from: 'Am', to: 'Bm' }),
    'the names are trimmed, so the line never shows stray spaces',
  );

  // ── 4. THE ONE WORD ──────────────────────────────────────────────────────
  console.log('\nthe shared copy');
  assertEq(SCORE_EXPAND_LABEL, 'Full screen', 'the affordance reads "Full screen"');
  assertEq(
    IMMERSIVE_ENTER_LABEL,
    SCORE_EXPAND_LABEL,
    'the reader\'s immersive toggle is the SAME word (one affordance, one name)',
  );
  assertEq(SCORE_EXPAND_READONLY_LABEL.indexOf(SCORE_EXPAND_LABEL), 0, 'the take editor\'s variant starts from the shared word');
  assert(SCORE_EXPAND_CLOSE_LABEL.length > 0, 'the close control is announced');

  // ── 5. THE WIRING, ON THE REAL FILES ─────────────────────────────────────
  console.log('\nexpandableSurfaces — every surface the spec names');
  const sources: Record<string, string> = {};
  for (const surface of SCORE_EXPAND_SURFACES) sources[surface.path] = read(surface.path);
  const wired = expandableSurfaces(sources);
  if (wired.length > 0) console.error(formatScoreExpandFailures(wired));
  assertEq(wired.length, 0, `every one of the ${SCORE_EXPAND_SURFACES.length} surfaces is wired`);

  // The surface table must actually cover the spec's items, and the two the spec
  // EXCLUDES (E2 reader, E13 camera) must stay out.
  const ids = SCORE_EXPAND_SURFACES.map((s) => s.id).join(',');
  for (const id of ['E1', 'E4', 'E5', 'E6', 'E7', 'E9', 'E10', 'E11', 'E12']) {
    assert(ids.indexOf(id) >= 0, `the table covers ${id}`);
  }
  assert(
    SCORE_EXPAND_SURFACES.every((s) => s.path.startsWith('src/')),
    'every surface path is a real source path',
  );

  // ── 6. THE MUTATIONS THAT PROVE THE GUARDS BITE ──────────────────────────
  console.log('\nmutation probes — a guard nobody has seen fail is not evidence');

  // 6a. The shared card loses its button. THREE surfaces inherit that card, so
  // this is the mutation that matters most; the probe is also the acceptance
  // probe for the slice.
  const cardPath = 'src/components/TakeStaffCard.tsx';
  const cardSource = sources[cardPath];
  const cardMutated = cardSource.split('<ExpandScoreButton').join('<' + 'View');
  assert(cardMutated !== cardSource, 'the TakeStaffCard mutation really changed the source');
  const cardFailures = expandableSurfaces({ ...sources, [cardPath]: cardMutated });
  assertEq(cardFailures.length, 1, 'removing the card\'s button fails exactly one surface');
  assertEq(cardFailures[0]?.id, 'E4', 'and that surface is E4 (the shared card)');
  assertEq(cardFailures[0]?.path, cardPath, 'the failure names the file');
  assert((cardFailures[0]?.line ?? 0) > 0, 'the failure names a LINE (path:line)');
  console.error(`  · probe report: ${formatScoreExpandFailures(cardFailures)}`);

  // 6b. A host stops handing the opener down (E5).
  const hostPath = 'src/screens/HumSearchScreen.tsx';
  const hostMutated = sources[hostPath].split('onExpand={').join('onOpen={');
  assert(hostMutated !== sources[hostPath], 'the capture-flow mutation really changed the source');
  const hostFailures = expandableSurfaces({ ...sources, [hostPath]: hostMutated });
  assertEq(hostFailures.length, 1, 'the flow that stops passing onExpand fails exactly one surface');
  assertEq(hostFailures[0]?.id, 'E5', 'and that surface is E5');

  // 6c. A deleted surface is a failure, not a pass.
  const deleted = expandableSurfaces({ ...sources, [cardPath]: null });
  assertEq(deleted.length, 1, 'a missing surface file fails the guard');

  // 6d. A COMMENT that names the button must not satisfy the guard.
  const commentOnly = [
    'export const TakeStaffCard = () => {',
    '  // <ExpandScoreButton onPress={nothing} />',
    '  /* <ExpandScoreButton /> */',
    '  return null;',
    '};',
  ].join('\n');
  const commentFailures = expandableSurfaces({ ...sources, [cardPath]: commentOnly });
  assertEq(commentFailures.length, 1, 'a comment naming the button does NOT satisfy the guard');
  assertEq(
    commentFailures[0]?.line,
    1,
    'the masked comment keeps line numbers true (the anchor is line 1)',
  );
  assertEq(
    maskSourceComments('a // b\nc').indexOf('//'),
    -1,
    'line comments are blanked',
  );
  assertEq(lineOf('a\nb\nc', 4), 3, 'lineOf counts 1-based lines');

  // ── 7. THE WINDOW ITSELF ─────────────────────────────────────────────────
  console.log('\nthe full-screen window');
  const windowSource = read(SCORE_EXPAND_WINDOW_PATH);
  assert(fullScreenScoreHandlesBack(windowSource), 'the window is a fullScreen Modal with onRequestClose');
  const noBack = windowSource.split('onRequestClose={onClose}').join('');
  assert(noBack !== windowSource, 'the BACK mutation really changed the source');
  assert(!fullScreenScoreHandlesBack(noBack), 'a window with no request-close handler FAILS (Android BACK trap)');
  const notFullScreen = windowSource.split('presentationStyle="fullScreen"').join('presentationStyle="pageSheet"');
  assert(!fullScreenScoreHandlesBack(notFullScreen), 'a sheet that only LOOKS full screen fails too');

  assert(expanderIsPresentationOnly(windowSource), 'the window is presentation-only (no state, no score prop)');
  const withState = windowSource.split('export const FullScreenScore').join('export const X = () => useState(false);\nexport const FullScreenScore');
  assert(withState !== windowSource, 'the state mutation really changed the source');
  assert(!expanderIsPresentationOnly(withState), 'a window that owns state FAILS');
  const withScoreProp = windowSource.split('children').join('abc={abc}');
  assert(withScoreProp !== windowSource, 'the score-prop mutation really changed the source');
  assert(!expanderIsPresentationOnly(withScoreProp), 'a window that takes the score itself FAILS');

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
