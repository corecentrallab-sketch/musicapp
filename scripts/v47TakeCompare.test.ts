/**
 * v47TakeCompare.test.ts — ITEM 1 (A/B SIDE-BY-SIDE TAKE COMPARISON): the model
 * suite AND the live-source guard suite, in one run (v47 part B).
 *
 * TWO HALVES, ON PURPOSE:
 *
 *   • THE MODEL — `compareColumns` at a 390dp phone and at a narrow one, the
 *     one-take state, a take whose file is gone, takes of different lengths, the
 *     shared clock's seek target, and the honesty lines themselves.
 *   • THE GUARDS — asserted on the REAL files (the screen, the surface, the model)
 *     and then MUTATION-PROVEN in memory: each guard is fed a deliberately broken
 *     copy of the source it protects and must FAIL on it. A guard that passes
 *     against a broken build is a failed deliverable, so every probe asserts both
 *     directions (real bytes pass, mutated bytes fail).
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  COMPARE_DIFFERENT_LENGTHS_LINE,
  COMPARE_MIN_COLUMN_DP,
  COMPARE_MISSING_LINE,
  COMPARE_OFFLINE_LINE,
  COMPARE_ONE_TAKE_LINE,
  COMPARE_SAME_LENGTH_LINE,
  compareClockMs,
  compareColumns,
  compareLengthLine,
  compareLongestSec,
  comparePair,
  compareSeekTarget,
  compareSide,
  compareSideState,
  type CompareSide,
} from '../src/services/videoCompare';
import {
  COMPARE_MODEL_PATH,
  COMPARE_SURFACE_PATH,
  PARTB_SCREEN_PATH,
  compareCopyNeverJudges,
  compareEdgeCasesAreOnTheSurface,
  comparePathIsOffline,
  compareSurfaceIsHosted,
} from '../src/services/v47PartBContract';
import type { SavedCaptureTake } from '../src/services/midiExport';
import type { PracticeVideoRef } from '../src/services/practiceVideoRef';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

// ─── fixtures ────────────────────────────────────────────────────────────────

function take(notes: Array<{ midi: number; startSec: number; durationSec: number }>): SavedCaptureTake {
  return { notes, tempoBpm: 90, durationSec: 40, key: null, capturedAt: '2026-10-30T00:00:00.000Z' };
}

function ref(uri: string, durationSec: number, audioOffsetMs = 0): PracticeVideoRef {
  return {
    uri,
    durationSec,
    audioOffsetMs,
    measuredOffsetMs: audioOffsetMs,
    filmedAt: '2026-10-30T00:00:00.000Z',
  };
}

const NOTES = [
  { midi: 60, startSec: 1, durationSec: 0.5 },
  { midi: 62, startSec: 2, durationSec: 0.5 },
  { midi: 64, startSec: 3, durationSec: 0.5 },
];

// ─── THE MODEL ───────────────────────────────────────────────────────────────
console.log('\nv47 item 1 — the layout is honest at a 390dp phone and stacks when narrow');

const atPhone = compareColumns(390 - 32);
assertEq(atPhone.columns, 2, 'at 390dp (minus the page padding) the two takes sit SIDE BY SIDE');
assert(atPhone.columnWidth >= 150, `each column is still readable (${atPhone.columnWidth}dp ≥ 150)`);
assert(atPhone.columnWidth * 2 + atPhone.gap <= 358, 'the two columns plus the gap fit the content width');
const atNarrow = compareColumns(240);
assertEq(atNarrow.columns, 1, 'at 240dp the takes STACK instead of being squeezed into strips');
assertEq(atNarrow.columnWidth, 240, 'a stacked column uses the whole width');
assertEq(compareColumns(0).columns, 1, 'a zero width stacks (never a negative column)');
assertEq(compareColumns(Number.NaN).columns, 1, 'a NaN width stacks');
assert(COMPARE_MIN_COLUMN_DP > 100, 'the minimum column width is a real, readable width');

console.log('\nv47 item 1 — the sides carry the row’s own data, on their own clocks');

const sideA = compareSide({ label: 'A', ref: ref('file:///a.mp4', 40), take: take(NOTES), note: 'bars 12–16' });
assertEq(sideA.state, 'ready', 'a take with a local file is ready to play');
assertEq(sideA.uri, 'file:///a.mp4', 'the side opens the user’s own local file');
assertEq(sideA.clockLabel, '0:40', 'the side states its own length');
assertEq(sideA.cues.length, 3, 'the take’s notes are on this video’s clock (the existing mapping)');
assertEq(sideA.noteLine, 'Note: bars 12–16', 'the take’s own label travels to the side');
const offsetSide = compareSide({
  label: 'B',
  ref: ref('file:///b.mp4', 40, 500),
  take: take(NOTES),
});
assertEq(offsetSide.cues[0].startSec, 1.5, 'a measured offset moves the cues on THAT side only');
assertEq(sideA.cues[0].startSec, 1, '…and the other side keeps its own offset');
assertEq(compareSideState(null), 'empty', 'no ref at all is the empty state');
assertEq(compareSideState(ref('', 10)), 'missing', 'a ref with no file is MISSING, not ready');
assertEq(compareSide({ label: 'x', ref: ref('', 10), take: take(NOTES) }).cues.length, 0, 'a missing file draws no cues');
assertEq(compareSide({ label: 'x', ref: ref('file:///x.mp4', 10), take: null }).noteCount, 0, 'a take with no notes is counted honestly');

console.log('\nv47 item 1 — the edge cases the owner named');

const oneTake = comparePair({ left: { label: 'A', ref: ref('file:///a.mp4', 40), take: take(NOTES) }, right: null, widthDp: 358 });
assertEq(oneTake.oneTake, true, 'one take only: the pair says so');
assertEq(oneTake.sides.length, 1, '…and renders one side, not an empty column');
assert(COMPARE_ONE_TAKE_LINE.indexOf('second take') > 0, 'the one-take line points at filming a SECOND take (no dead end)');

const twoTakes = comparePair({
  left: { label: 'A', ref: ref('file:///a.mp4', 40), take: take(NOTES) },
  right: { label: 'B', ref: ref('file:///b.mp4', 52), take: take(NOTES) },
  widthDp: 358,
});
assertEq(twoTakes.oneTake, false, 'two takes: no one-take line');
assertEq(twoTakes.readyCount, 2, 'both sides can play');
assertEq(twoTakes.lengthLine, COMPARE_DIFFERENT_LENGTHS_LINE, 'different lengths are said plainly');
assertEq(twoTakes.longestSec, 52, 'the shared clock is bounded by the longer take');

const sameLength = comparePair({
  left: { label: 'A', ref: ref('file:///a.mp4', 40), take: take(NOTES) },
  right: { label: 'B', ref: ref('file:///b.mp4', 40), take: take(NOTES) },
  widthDp: 358,
});
assertEq(sameLength.lengthLine, COMPARE_SAME_LENGTH_LINE, 'equal lengths say so too');

const missingSide = comparePair({
  left: { label: 'A', ref: ref('file:///a.mp4', 40), take: take(NOTES) },
  right: { label: 'B', ref: ref('', 40), take: take(NOTES) },
  widthDp: 358,
});
assertEq(missingSide.sides[1].state, 'missing', 'a take whose file is gone is the MISSING state');
assertEq(missingSide.readyCount, 1, 'the other take still plays — the surface is not a dead end');
assert(missingSide.lengthLine === null, 'a missing side is not measured, so no length claim is made');
assert(COMPARE_MISSING_LINE.indexOf('other take still plays') > 0, 'the missing line says the other take still plays');

console.log('\nv47 item 1 — the shared clock');

assertEq(compareSeekTarget(0, 1000, 40), 1000, 'the clock moves forward a second');
assertEq(compareSeekTarget(500, -1000, 40), 0, '…and never goes negative');
assertEq(compareSeekTarget(39000, 5000, 40), 40000, '…and never passes the longest take');
assertEq(compareSeekTarget(Number.NaN, Number.NaN, 40), 0, 'garbage in, zero out');
assertEq(compareClockMs([1000, 4000]), 4000, 'the readout is the later of the two positions');
assertEq(compareClockMs([]), 0, 'no positions, no clock');
assertEq(compareLongestSec([]), 0, 'no sides, no bound');
const lengthA = compareSide({ label: 'A', ref: ref('file:///a.mp4', 40), take: take(NOTES) }) as CompareSide;
assertEq(compareLengthLine(lengthA, lengthA), COMPARE_SAME_LENGTH_LINE, 'a take compared with itself is the same length');

console.log('\nv47 item 1 — the copy describes, and never judges');

assert(COMPARE_OFFLINE_LINE.indexOf('airplane mode') > 0, 'the surface states the airplane-mode fact');
assert(COMPARE_ONE_TAKE_LINE.indexOf('beside this one') > 0, 'the one-take line describes the layout, not the playing');
assert(
  twoTakes.honesty.indexOf('yours to weigh') > 0,
  'the honesty line leaves the weighing to the user',
);
assert(
  !/better|best|worse|score|grade|improve|rating|rank/i.test(twoTakes.honesty + twoTakes.clockLine),
  'neither line carries a verdict word',
);

// ─── THE GUARDS, ON THE REAL FILES ───────────────────────────────────────────
console.log('\nv47 item 1 — the guards hold on the real bytes');

const SCREEN = readAppFile(PARTB_SCREEN_PATH);
const SURFACE = readAppFile(COMPARE_SURFACE_PATH);
const MODEL = readAppFile(COMPARE_MODEL_PATH);

assertEq(
  compareSurfaceIsHosted(SCREEN, SURFACE),
  true,
  'the comparison is MOUNTED in the playback branch and handed this row’s take + a second take from History',
);
assertEq(comparePathIsOffline([SURFACE, MODEL]), true, 'neither the surface nor its model can reach a network');
assertEq(compareCopyNeverJudges([SURFACE, MODEL]), true, 'no verdict language on the surface or in its model');
assertEq(
  compareEdgeCasesAreOnTheSurface(SURFACE, MODEL),
  true,
  'one take / missing file / different lengths are RENDERED, not only modelled',
);
assertEq(compareCopyNeverJudges([]), false, 'an empty source set is not clean-by-omission');
assertEq(comparePathIsOffline(['']), false, 'a stub source is not offline-by-omission');

// ─── MUTATION PROBES (in memory): every guard must BITE ──────────────────────
console.log('\nv47 item 1 — mutation probes: each guard fails on the real bytes it protects');

const noMount = SCREEN.replace('<PracticeVideoCompare', '<SomethingElse');
assertEq(
  compareSurfaceIsHosted(noMount, SURFACE),
  false,
  'PROBE 1: the surface imported but NOT mounted → the hosting guard FAILS',
);
const mountedInRecord = SCREEN.replace(
  '<PracticeVideoCompare',
  '<PracticeVideoCompare /* moved */',
).replace('if (phase === \'playback\') {', 'if (phase === \'playback\') { /* x */');
assertEq(
  compareSurfaceIsHosted(mountedInRecord, SURFACE),
  true,
  'PROBE 1 (control): the same screen with a comment added still passes',
);
const noOther = SCREEN.replace('right={otherSide}', 'right={null}');
assertEq(
  compareSurfaceIsHosted(noOther, SURFACE),
  false,
  'PROBE 2: the second take no longer handed in → the hosting guard FAILS',
);
const noLoader = SCREEN.replace('listPracticeVideoRows(row?.rowId ?? null)', 'Promise.resolve([])');
assertEq(
  compareSurfaceIsHosted(noLoader, SURFACE),
  false,
  'PROBE 3: the second take no longer read from History → the hosting guard FAILS',
);
const judgement = SURFACE.replace(
  '<Text style={styles.subtitle}>{COMPARE_SUBTITLE}</Text>',
  '<Text style={styles.subtitle}>{COMPARE_SUBTITLE} — the better take is obvious</Text>',
);
assertEq(
  compareCopyNeverJudges([judgement, MODEL]),
  false,
  'PROBE 4: “the better take” added to the surface → the honest-copy guard FAILS',
);
const graded = MODEL.replace('export const COMPARE_SAME_LENGTH_LINE', "export const TAKE_GRADE_LINE = 'Grade: 8/10';\nexport const COMPARE_SAME_LENGTH_LINE");
assertEq(
  compareCopyNeverJudges([SURFACE, graded]),
  false,
  'PROBE 5: a grade added to the model → the honest-copy guard FAILS',
);
const networked = SURFACE.replace(
  'const pair = useMemo(',
  "const beacon = () => fetch('https://example.com/compare');\n  const pair = useMemo(",
);
assertEq(
  comparePathIsOffline([networked, MODEL]),
  false,
  'PROBE 6: a fetch added to the comparison → the offline guard FAILS',
);
const noOneTake = SURFACE.replace('{COMPARE_ONE_TAKE_LINE}', '');
assertEq(
  compareEdgeCasesAreOnTheSurface(noOneTake, MODEL),
  false,
  'PROBE 7: the one-take line removed from the surface → the edge-case guard FAILS',
);
const noMissing = MODEL.replace("export const COMPARE_MISSING_LINE =", 'const COMPARE_MISSING_LINE_GONE =');
assertEq(
  compareEdgeCasesAreOnTheSurface(SURFACE, noMissing),
  false,
  'PROBE 8: the missing-file line removed from the model → the edge-case guard FAILS',
);

// ─── the real bytes are untouched by the probes (they ran in memory) ─────────
console.log('\nv47 item 1 — the real files are unchanged by the probes');
assertEq(readAppFile(PARTB_SCREEN_PATH).length, SCREEN.length, 'the screen on disk is byte-for-byte what was read');
assertEq(readAppFile(COMPARE_SURFACE_PATH).length, SURFACE.length, 'the surface on disk is unchanged');
assertEq(compareSurfaceIsHosted(SCREEN, SURFACE), true, '…and the guards still pass on it');

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
