/**
 * D27 GUARDS — the full-screen reader draws notation the owner can read, and the
 * CARD is untouched.
 *
 * Every guard here is proved to bite by mutation (see the run recorded in the
 * PR): break the property it names and it fails.
 *
 * Source-scan style, like the rest of this repo's UI contracts: the assertions
 * are about the SHAPE of the two documents and about which call sites ask for
 * the reader, because that is where D27 actually lives.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateAbcHtml, generateAbcReaderHtml, readerLayout, READER_MIN_SCALE, READER_SCALE } from '../src/services/abcHtml';

let failures = 0;
function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = join(__dirname, '..');
function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

const abc = 'X:1\nT:t\nM:4/4\nL:1/8\nK:C\nCDEF GABc|\n';
const card = generateAbcHtml(abc);
const reader = generateAbcReaderHtml(abc);

/**
 * THE RENDER CALL'S OWN OPTIONS. The documents also carry the whole abcjs
 * bundle inline, so a naive `includes('scale')` would match the RENDERER and
 * pass (or fail) for a reason that has nothing to do with us. Every assertion
 * below looks only at what we hand `renderAbc`.
 */
function renderOptions(document: string): string {
  const start = document.indexOf("renderAbc('paper', abc, {");
  if (start < 0) return '';
  const end = document.indexOf('});', start);
  return end < 0 ? '' : document.slice(start, end);
}

const cardOptions = renderOptions(card);
const readerOptions = renderOptions(reader);

console.log('D27 — reader scale and card invariance');

// ── 1. THE READER DOCUMENT IS DRAWN BIGGER, AND NOT RESPONSIVE. ─────────────
ok('reader document passes a scale', /scale:\s*[\d.]+/.test(readerOptions));
ok(
  'reader scale is at least the floor that failed vc61',
  Number((readerOptions.match(/scale:\s*([\d.]+)/) || [])[1]) >= READER_MIN_SCALE,
  `saw ${(readerOptions.match(/scale:\s*([\d.]+)/) || [])[1]}`,
);
ok('reader document has NO responsive resize (it would discard scale)', !readerOptions.includes("responsive: 'resize'"));
ok('reader document lifts the width cap', reader.includes('max-width: none'));
ok('reader document fixes a staffwidth (bars per system)', /staffwidth:\s*\d+/.test(readerOptions));
ok('reader document caps measures per line at four', /preferredMeasuresPerLine:\s*4/.test(readerOptions));
ok('reader document still renders from the bundled renderer (no CDN)', !/src=["']https?:/.test(reader) && reader.length > 10000);

// ── 2. THE CARD IS UNCHANGED. ───────────────────────────────────────────────
ok('card document still reflows to fit', cardOptions.includes("responsive: 'resize'"));
ok('card document still caps the drawing at the card width', card.includes('max-width: 100%'));
ok('card document passes NO scale', !/scale:\s*[\d.]/.test(cardOptions));
ok('card document passes NO staffwidth', !/staffwidth:/.test(cardOptions));

// ── 3. THE SCALE → WIDTH MATH. ──────────────────────────────────────────────
const layout = readerLayout(READER_SCALE);
ok('four bars per system', layout.barsPerSystem === 4);
ok('a reader system is wider than a 360 dp phone (something to pan to)', layout.systemWidthPx > 360, `saw ${layout.systemWidthPx}`);
ok('a scale below the floor is refused', readerLayout(0.5).scale >= READER_MIN_SCALE);
ok('the staffwidth is the layout width abcjs needs', layout.staffwidth === Math.round((4 * 80) / 1.33));

// ── 4. THE READER IS WIRED ONLY AT THE READER CALL SITES. ───────────────────
const view = read('src/components/AbcScoreView.tsx');
ok('AbcScoreView owns the scale (never FullScreenScore)', view.includes('readerScale?: number'));
const fullScreen = read('src/components/FullScreenScore.tsx');
ok('FullScreenScore stays presentation only (no scale, no state)', !fullScreen.includes('readerScale') && !fullScreen.includes('useState'));
for (const path of [
  'src/screens/TransposedScoreReaderScreen.tsx',
  'src/components/TakeCorrectionEditor.tsx',
  'src/screens/NotationEditorScreen.tsx',
  'src/screens/PracticeVideoScreen.tsx',
]) {
  ok(`${path} asks for the reader scale`, read(path).includes('READER_SCALE'));
}

// ── 5. THE CARD'S OWN CALL SITES DO NOT. ────────────────────────────────────
const staffCard = read('src/components/TakeStaffCard.tsx');
ok(
  'TakeStaffCard only forwards a readerScale it is given',
  staffCard.includes('readerScale={readerScale}') && !staffCard.includes('READER_SCALE'),
);
ok(
  'the in-card staff (HumSearch result card) passes no reader scale',
  !read('src/screens/HumSearchScreen.tsx').includes('READER_SCALE'),
);

if (failures > 0) {
  console.log(`\nD27: ${failures} guard(s) failed`);
  process.exit(1);
}
console.log('\nD27: all guards passed');
