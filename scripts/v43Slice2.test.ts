/**
 * v43Slice2.test.ts — the source-scan + DATA guards for v43 slice 2.
 *
 * Two families:
 *
 *   1. THE FIX IS ON THE SURFACES (source scans, via services/v43Slice2Contract.ts):
 *      the honest length line is rendered by BOTH notation screens, the picker is
 *      a wrapping grid under a derived count label, and AbcScoreView carries no
 *      remote renderer — abcjs ships inside the app.
 *   2. THE HEADLINERS ARE FULL-LENGTH *AND* METRICALLY REAL (data checks): five
 *      famous pieces now carry a whole melody, each longer than the sample
 *      ceiling, and every bar of them adds up to its printed meter. That last
 *      check is the hand-check on the transcription: a mistyped note value shows
 *      up as a bar that does not fill its meter.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  pickerLabelIsDerived,
  pickerWraps,
  rendererIsBundled,
  surfacesShowScoreLength,
} from '../src/services/v43Slice2Contract';
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';
import { SAMPLE_EXCERPT_MAX_BARS, countAbcBars, isSampleScore } from '../src/services/transposedScore';
import { scoreLengthLine } from '../src/services/scoreLength';
import { choosePieceLabel } from '../src/services/notationPicker';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
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

// ─── file access (no fs import: tsconfig.tier1 has types: []) ────
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
function readSource(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  const full = path.join(repoRoot(), rel);
  return fs.existsSync(full) ? (fs.readFileSync(full, 'utf8') as string) : '';
}

const EDITOR = 'src/screens/NotationEditorScreen.tsx';
const READER = 'src/screens/TransposedScoreReaderScreen.tsx';
const LENGTH_COMPONENT = 'src/components/ScoreLengthLine.tsx';
const ABC_VIEW = 'src/components/AbcScoreView.tsx';
const ABC_ASSET = 'src/assets/abcjsBasic.ts';

// ─── 1. the honest length line is on both surfaces ──────────────
function lengthLineTests(): void {
  console.log('\nthe honest length line is rendered by both notation screens');
  const input = {
    editorSource: readSource(EDITOR),
    readerSource: readSource(READER),
    componentSource: readSource(LENGTH_COMPONENT),
  };
  assert(input.componentSource.length > 0, `${LENGTH_COMPONENT} exists`);
  assert(
    readSource(LENGTH_COMPONENT).includes('scoreLengthLine') &&
      readSource(LENGTH_COMPONENT).includes('scoreLengthAccessibilityLabel'),
    'the component derives its words from services/scoreLength (never a passed string)',
  );
  assert(surfacesShowScoreLength(input), 'the editor AND the reader render <ScoreLengthLine');
  assert(
    !/<ScoreLengthLine[^>]*label=/.test(input.editorSource + input.readerSource),
    'neither screen passes a hand-written label into the length line',
  );
  // The detector itself, on the pre-fix shape, so an edit to the scanner cannot
  // silently stop detecting it.
  assert(
    surfacesShowScoreLength({
      editorSource: '<View />',
      readerSource: '<ScoreLengthLine abc={abc} />',
      componentSource: input.componentSource,
    }) === false,
    'a screen with no length line is reported as missing one',
  );
}

// ─── 2. the picker shows all eight ──────────────────────────────
function pickerTests(): void {
  console.log('\nthe piece picker shows all eight pieces');
  const editor = readSource(EDITOR);
  assert(pickerLabelIsDerived(editor), 'the label is choosePieceLabel(PUBLIC_DOMAIN_ABC_SCORES.length)');
  assert(!/>\s*Choose a piece\s*</.test(editor), 'no hand-typed "Choose a piece" label survives');
  assert(pickerWraps(editor), 'the chips sit in a wrapping 2-column grid (not a horizontal scroller)');
  assert(
    editor.includes('testID={NOTATION_PICKER_TAG}'),
    'the picker container carries the shared testID',
  );
  // Mutation probes: the guards bite on the pre-fix source shapes.
  assert(!pickerLabelIsDerived('<Text>Choose a piece</Text>'), 'a typed label fails the guard');
  assert(
    !pickerWraps('const styles = { pickerGrid: { flexDirection: \'row\' } };'),
    'a non-wrapping grid fails the guard',
  );
  assert(
    pickerWraps('const styles = { pickerGrid: { flexDirection: \'row\', flexWrap: \'wrap\' } };'),
    'a wrapping row passes the guard',
  );
}

// ─── 3. abcjs is bundled, not fetched ───────────────────────────
function bundledRendererTests(): void {
  console.log('\nthe score renderer ships inside the app (offline)');
  const view = readSource(ABC_VIEW);
  const asset = readSource(ABC_ASSET);
  assert(asset.length > 100000, `${ABC_ASSET} carries the whole abcjs bundle (${asset.length} chars)`);
  assert(
    rendererIsBundled({ viewSource: view, assetSource: asset }),
    'AbcScoreView inlines the bundled abcjs and carries no CDN host',
  );
  assert(
    !/cdn\.jsdelivr\.net/.test(view),
    'the jsdelivr script tag is gone from AbcScoreView',
  );
  assert(
    /rendererScript: string = ABCJS_BASIC_MIN_JS/.test(view),
    'generateAbcHtml inlines the renderer by default (synchronous, no asset fetch)',
  );
  assert(
    (view.match(/window\.ABCJS/g) ?? []).length > 0 && view.includes('did not load in this build'),
    'a missing renderer now says so on screen instead of showing an empty staff',
  );
  // Mutation probes.
  assert(
    !rendererIsBundled({
      viewSource: '<script src="https://cdn.jsdelivr.net/npm/abcjs@6.2.3/dist/abcjs-basic-min.js"></script>',
      assetSource: asset,
    }),
    'a CDN script tag fails the guard',
  );
  assert(
    !rendererIsBundled({ viewSource: view, assetSource: 'export const ABCJS_BASIC_MIN_JS = "x";' }),
    'an empty bundle fails the guard',
  );

  // NO file under src/ may fetch the renderer at runtime again.
  const fs = require('fs');
  const path = require('path');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith('abcjsBasic.ts')) {
        const text = fs.readFileSync(full, 'utf8') as string;
        if (text.includes('cdn.jsdelivr.net')) offenders.push(path.relative(repoRoot(), full));
      }
    }
  };
  walk(path.join(repoRoot(), 'src'));
  assertEq(offenders.length, 0, `no src/ file references cdn.jsdelivr.net (found: ${offenders.join(', ') || 'none'})`);
}

// ─── 4. the headliners are full-length AND metrically real ──────
const HEADLINERS = ['fur-elise', 'ode-to-joy', 'twinkle', 'greensleeves', 'jingle-bells'];

/** Parse `n/d` (abc fractions: 4/4, 6/8, 1/8, 3/2, /2, 3). */
function parseLength(text: string): number | null {
  const t = text.trim();
  if (t.length === 0) return null;
  if (/^\d+\/\d+$/.test(t)) {
    const [n, d] = t.split('/').map(Number);
    return d === 0 ? null : n / d;
  }
  if (/^\/+$/.test(t)) return 1 / Math.pow(2, t.length);
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d+\/+$/.test(t)) return Number(t.replace(/\/+$/, '')) / Math.pow(2, (t.match(/\//g) ?? []).length);
  if (/^\/+\d+$/.test(t)) return 1 / Number(t.replace(/^\/+/, ''));
  return null;
}

/** The duration of one ABC note/rest token, in whole notes (null = not music). */
function tokenDuration(token: string, defaultLength: number): number | null {
  const notePattern = /(\^|_|=|)([A-Ga-g]|[zxZX])([,']*)(\d*(?:\/\d*)?)/g;
  let total: number | null = null;
  let match = notePattern.exec(token);
  while (match) {
    const mult = match[4].length === 0 ? 1 : parseLength(match[4]);
    if (mult === null) return null;
    total = (total ?? 0) + defaultLength * mult;
    match = notePattern.exec(token);
  }
  return total;
}

/** Every bar's length in whole notes, plus the meter and the default length. */
function measureBars(abc: string): { bars: number[]; meter: number | null; defaultLength: number } {
  let meter: number | null = null;
  let defaultLength = 1 / 8;
  const body: string[] = [];
  for (const rawLine of abc.split('\n')) {
    const line = rawLine.trim();
    const field = /^([A-Za-z]):(.*)$/.exec(line);
    if (field) {
      if (field[1] === 'M') meter = parseLength(field[2]);
      if (field[1] === 'L') defaultLength = parseLength(field[2]) ?? defaultLength;
      continue;
    }
    if (line.length > 0) body.push(line);
  }
  const bars: number[] = [];
  for (const line of body) {
    for (const rawToken of line.replace(/"[^"]*"/g, ' ').split('|')) {
      const token = rawToken.trim();
      if (token.length === 0) continue;
      const duration = tokenDuration(token, defaultLength);
      if (duration === null) continue;
      bars.push(duration);
    }
  }
  return { bars, meter, defaultLength };
}

function headlinerTests(): void {
  console.log('\nthe five headliners are full-length and every bar fills its meter');
  const byId = new Map(PUBLIC_DOMAIN_ABC_SCORES.map((s) => [s.id, s]));
  assertEq(PUBLIC_DOMAIN_ABC_SCORES.length, 8, 'the bundle still holds all eight pieces');

  for (const id of HEADLINERS) {
    const score = byId.get(id);
    if (!score) {
      assert(false, `${id} is still in the bundle`);
      continue;
    }
    const bars = countAbcBars(score.abc);
    assert(
      bars > SAMPLE_EXCERPT_MAX_BARS,
      `${id}: ${bars} bars — longer than the ${SAMPLE_EXCERPT_MAX_BARS}-bar sample ceiling`,
    );
    assert(!isSampleScore(score.abc), `${id}: no longer flagged as a sample`);
    assertEq(scoreLengthLine(score.abc), `${bars} bars`, `${id}: the UI prints its true length`);
    assert(
      typeof score.scope === 'string' && score.scope.length > 10,
      `${id}: carries an honest scope line ("${score.scope}")`,
    );

    // The hand-check: every bar adds up to the printed meter.
    const measured = measureBars(score.abc);
    assert(measured.meter !== null, `${id}: declares a meter`);
    const meter = measured.meter ?? 0;
    const short = measured.bars
      .map((duration, index) => ({ duration, index }))
      .filter((bar) => Math.abs(bar.duration - meter) > 1e-9);
    assert(
      measured.bars.length > 0 && short.length === 0,
      `${id}: all ${measured.bars.length} bars fill ${meter} whole note(s)` +
        (short.length > 0
          ? ` — bar ${short[0].index + 1} is ${short[0].duration}`
          : ''),
    );
  }

  // The remaining three entries are still samples and are labelled as such.
  for (const id of ['canon-in-d', 'happy-birthday', 'ode-anvil-chorus']) {
    const score = byId.get(id);
    assert(score !== undefined, `${id} is still in the bundle`);
    if (!score) continue;
    assert(isSampleScore(score.abc), `${id}: is honestly still a sample`);
    assert(
      (scoreLengthLine(score.abc) ?? '').startsWith('Bars 1'),
      `${id}: the UI says "Bars 1–N of N" ("${String(scoreLengthLine(score.abc))}")`,
    );
  }

  // One label authority for a count of eight.
  assertEq(choosePieceLabel(PUBLIC_DOMAIN_ABC_SCORES.length), 'Choose a piece \u00b7 8', 'the picker label counts them');
}

// ─── run ────────────────────────────────────────────────────────
function main(): void {
  console.log('\n=== v43 slice 2: full-length scores + offline renderer + picker ===');
  lengthLineTests();
  pickerTests();
  bundledRendererTests();
  headlinerTests();
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
