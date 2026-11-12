/**
 * vc53MediaControls.test.ts — THE SCRUB BAR MUST STAY INSIDE THE TRIM WINDOW
 * (vc53, item 4: "a draggable progress bar at the bottom of the video that seeks
 * forward and backward").
 *
 * WHAT THIS SUITE PROVES, in two halves:
 *
 *   1. THE MODEL, RUN FOR REAL (`services/videoScrub.ts`). The bar spans the whole
 *      recording, but a drag may only ever land INSIDE the row's clip window: a
 *      drag into a dimmed end snaps to that end, the end snap lands one tolerance
 *      inside it (so the player is not stopped the instant the user lets go), a
 *      broken ratio still snaps to the window rather than to the file's own start,
 *      and no window at all means the whole take is playable.
 *   2. THE WIRING, READ FROM THE REAL FILES. The model stays pure (no
 *      react-native, no player, no clock of its own); the bar draws the model's
 *      window and asks the model where a drag lands — never the raw pixel
 *      position; the screen routes every `onSeekMs` through the one clamped seek;
 *      and the module and this suite are both in the gate.
 *
 * Every guard is proven to BITE: a mutation of the real bytes in memory must turn
 * it false, or the probe itself fails.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  SCRUB_END_TOLERANCE_MS,
  scrubRatioForPosition,
  scrubSeekTargetMs,
  scrubTimeLine,
  scrubWindowFractions,
} from '../src/services/videoScrub';

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
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  assert(same, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ─── REPO FILE ACCESS (the guards read the REAL files, as text) ──────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function readRepoFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

/** Comments explain the rules in prose; a scan of the CODE must not read them. */
function maskComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlock
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      return at < 0 ? line : line.slice(0, at);
    })
    .join('\n');
}

const MODULE_PATH = 'src/services/videoScrub.ts';
const BAR_PATH = 'src/components/ScrubBar.tsx';
const SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
/** vc54 item 3: the component that owns the fullscreen label and the icon name. */
const COMPONENT_PATH = 'src/components/FullScreenVideo.tsx';
const SUITE_PATH = '/tmp/tier1-test/scripts/vc53MediaControls.test.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE WINDOW, AS FRACTIONS OF THE WHOLE RECORDING (the dimmed ends)
// ─────────────────────────────────────────────────────────────────────────────

function testWindowFractions(): void {
  console.log('\n— the dimmed ends: the clip window as fractions of the whole take —');
  const DURATION = 40_000;

  assertEq(scrubWindowFractions(null, DURATION), { startFraction: 0, endFraction: 1 },
    'no clip window means the whole take is playable');
  assertEq(scrubWindowFractions(undefined, DURATION), { startFraction: 0, endFraction: 1 },
    'a missing window is the whole take, not an empty bar');
  assertEq(scrubWindowFractions({ startSec: 10, endSec: 25 }, DURATION),
    { startFraction: 0.25, endFraction: 0.625 },
    'a 0:10–0:25 clip of a 0:40 take is drawn from a quarter to five-eighths');

  // A window written backwards is the same window, never an inverted bar.
  assertEq(scrubWindowFractions({ startSec: 25, endSec: 10 }, DURATION),
    { startFraction: 0.25, endFraction: 0.625 },
    'a reversed window is normalised, never inverted');
  // A window that runs past the end stops at the bar's own edge.
  const past = scrubWindowFractions({ startSec: 30, endSec: 999 }, DURATION);
  assertEq(past.endFraction, 1, 'a window past the end stops at the right edge');
  assert(past.startFraction <= past.endFraction, 'the window never inverts on the bar');
  // A negative start cannot draw a dimmed sliver off the left of the bar.
  assertEq(scrubWindowFractions({ startSec: -5, endSec: 20 }, DURATION).startFraction, 0,
    'a negative start is pinned to the left edge');
  // Unusable numbers are the whole take, never NaN pixels.
  assertEq(scrubWindowFractions({ startSec: Number.NaN, endSec: 10 }, DURATION),
    { startFraction: 0, endFraction: 1 }, 'a NaN window falls back to the whole take');
  assertEq(scrubWindowFractions({ startSec: 10, endSec: 25 }, 0),
    { startFraction: 0, endFraction: 1 }, 'a take with no length draws no dimmed end');
  assertEq(scrubWindowFractions({ startSec: 10, endSec: 25 }, Number.NaN),
    { startFraction: 0, endFraction: 1 }, 'a NaN length draws no dimmed end');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE PLAYHEAD (where the thumb sits)
// ─────────────────────────────────────────────────────────────────────────────

function testPlayheadRatio(): void {
  console.log('\n— the playhead: the player position as a fraction of the whole take —');
  assertEq(scrubRatioForPosition(0, 40_000), 0, 'the start of the take is the left edge');
  assertEq(scrubRatioForPosition(20_000, 40_000), 0.5, 'half way through the take is half way along the bar');
  assertEq(scrubRatioForPosition(40_000, 40_000), 1, 'the end of the take is the right edge');
  assertEq(scrubRatioForPosition(-1_000, 40_000), 0, 'a negative position never leaves the bar');
  assertEq(scrubRatioForPosition(999_000, 40_000), 1, 'a position past the end never leaves the bar');
  assertEq(scrubRatioForPosition(Number.NaN, 40_000), 0, 'a broken position is the left edge, never NaN');
  assertEq(scrubRatioForPosition(1_000, 0), 0, 'a take with no length has no playhead');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WHERE A DRAG LANDS — THE CLAMP (the owner's rule)
// ─────────────────────────────────────────────────────────────────────────────

function testSeekIsClampedToTheWindow(): void {
  console.log('\n— a drag may only ever land INSIDE the clip window —');
  const DURATION = 40_000;
  const span = { startSec: 10, endSec: 25 };
  const startMs = 10_000;
  const endMs = 25_000 - SCRUB_END_TOLERANCE_MS;

  // The whole bar is the recording; the window is 0:10–0:25 of it.
  assertEq(scrubSeekTargetMs(0.5, DURATION, span), 20_000,
    'a drag in the middle of the window seeks there');
  assertEq(scrubSeekTargetMs(0, DURATION, span), startMs,
    'a drag at the far left (a dimmed end) snaps to the window START, never to 0:00');
  assertEq(scrubSeekTargetMs(0.1, DURATION, span), startMs,
    'a drag inside the left dimmed end snaps forward to the window start');
  assertEq(scrubSeekTargetMs(0.9, DURATION, span), endMs,
    'a drag inside the right dimmed end snaps back to the window end');
  assertEq(scrubSeekTargetMs(1, DURATION, span), endMs,
    'a drag at the far right stops one tolerance inside the window');
  assertEq(scrubSeekTargetMs(1e9, DURATION, span), endMs,
    'a nonsense-high ratio still lands inside the window');
  assertEq(scrubSeekTargetMs(-5, DURATION, span), startMs,
    'a nonsense-low ratio still lands inside the window');

  // THE TOLERANCE ITSELF: the end snap leaves the last frame playable, so the
  // player is not stopped the instant the user lets go.
  assert(SCRUB_END_TOLERANCE_MS > 0, 'the end tolerance is a real margin');
  assert(scrubSeekTargetMs(1, DURATION, span) < 25_000,
    'the end snap lands INSIDE the window, not on its edge');

  // THE SWEEP: every drag from one edge of the bar to the other stays inside the
  // window, never goes backwards, and never lands in a dimmed end.
  let previous = -1;
  let inside = true;
  let monotone = true;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let step = 0; step <= 200; step += 1) {
    const target = scrubSeekTargetMs(step / 200, DURATION, span);
    if (target < startMs || target > endMs) inside = false;
    if (target < previous) monotone = false;
    previous = target;
    low = Math.min(low, target);
    high = Math.max(high, target);
  }
  assert(inside, 'all 201 drag positions land inside the window');
  assert(monotone, 'the bar never seeks backwards as the drag moves forwards');
  assertEq(low, startMs, 'the leftmost drag lands on the window start');
  assertEq(high, endMs, 'the rightmost drag lands on the window end (inside the tolerance)');

  // A reversed window is the same window for the seek too.
  assertEq(scrubSeekTargetMs(0, DURATION, { startSec: 25, endSec: 10 }), startMs,
    'a reversed window clamps to the same start');

  // NO WINDOW: the whole take is playable, still bounded by the file.
  assertEq(scrubSeekTargetMs(0.5, DURATION, null), 20_000, 'with no clip the whole take plays');
  assertEq(scrubSeekTargetMs(2, DURATION, null), DURATION, 'with no clip a drag stops at the file end');
  assertEq(scrubSeekTargetMs(-2, DURATION, null), 0, 'with no clip a drag stops at the file start');

  // DEGENERATE INPUT: still the window, never 0:00 and never NaN.
  assertEq(scrubSeekTargetMs(Number.NaN, DURATION, span), startMs,
    'a broken ratio snaps to the window start, never to the file start');
  assertEq(scrubSeekTargetMs(0.5, 0, span), 0, 'a take with no length seeks nowhere');
  assertEq(scrubSeekTargetMs(0.5, Number.NaN, span), 0, 'a NaN length seeks nowhere');
  assertEq(scrubSeekTargetMs(0.5, DURATION, { startSec: Number.NaN, endSec: 25 }), 20_000,
    'a NaN window is no window: the drag is still bounded by the file');
  // A window that starts past the file's end can never seek backwards into it.
  const pastWindow = scrubSeekTargetMs(0.1, DURATION, { startSec: 35, endSec: 999 });
  assert(pastWindow >= 35_000, 'a window past the end never seeks before its own start');

  // Every result is a whole millisecond: the player is handed an integer.
  for (const ratio of [0.13, 0.37, 0.61, 0.88]) {
    const target = scrubSeekTargetMs(ratio, DURATION, span);
    assertEq(target, Math.round(target), `a seek at ${ratio} is a whole millisecond`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE READOUT
// ─────────────────────────────────────────────────────────────────────────────

function testReadout(): void {
  console.log('\n— the readout names the position against the WHOLE take —');
  assertEq(scrubTimeLine(12_000, 38_000), '0:12 / 0:38', 'the readout is the position against the length');
  assertEq(scrubTimeLine(0, 40_000), '0:00 / 0:40', 'the start reads 0:00');
  assertEq(scrubTimeLine(999_999, 40_000), '0:40 / 0:40', 'a position past the end reads the end');
  assertEq(scrubTimeLine(Number.NaN, 40_000), '0:00 / 0:40', 'a broken position reads 0:00, never NaN');
  assertEq(scrubTimeLine(1_000, 0), '0:00 / 0:00',
    'a take with no length reads 0:00 against 0:00 — the position is bounded by the length');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE SOURCE GUARDS, ON THE REAL FILES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GUARD 1 — the model stays PURE. `videoScrub` is what makes the clamp assertable
 * without a device: no react-native, no Expo module, no player, no network, and no
 * clock of its own (a `Date.now()` in here would make the same drag land in two
 * places).
 */
function scrubModelStaysPure(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 1500) return false;
  if (/from\s+['"]react-native['"]/.test(src)) return false;
  if (/['"]expo-[a-z-]+['"]/.test(src)) return false;
  if (src.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(src)) return false;
  if (src.indexOf('Date.now(') >= 0) return false;
  // …and it is the module we think it is: the clamp and the window live here.
  if (src.indexOf('export function scrubSeekTargetMs') < 0) return false;
  return src.indexOf("from './videoTakeSync'") >= 0;
}

/**
 * GUARD 2 — THE CLAMP IS IN THE MODEL. The bar spans the whole recording, so the
 * only thing that keeps playback inside the clip is this function: the ratio is
 * clamped to the bar, the window is read from the row's own span, and a target in
 * either dimmed end snaps to that edge — the right edge one tolerance inside.
 */
function scrubStaysInsideTheTrimWindow(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 1500) return false;
  if (src.indexOf('export function scrubWindowFractions') < 0) return false;
  if (src.indexOf('export function scrubRatioForPosition') < 0) return false;
  if (src.indexOf('export function scrubSeekTargetMs') < 0) return false;
  // the drag is read against the bar, never trusted as given
  if (src.indexOf('const wanted = Math.round(clamp01(ratio) * duration);') < 0) return false;
  // the window's own end, minus the tolerance that keeps the last frame playable
  if (src.indexOf('const endMs = Math.max(startMs, rawEndMs - SCRUB_END_TOLERANCE_MS);') < 0) return false;
  // …and the two snaps, which are the whole point
  if (src.indexOf('if (wanted <= startMs) return Math.round(startMs);') < 0) return false;
  return src.indexOf('if (wanted >= endMs) return Math.round(endMs);') >= 0;
}

/**
 * GUARD 3 — the bar DRAWS the model and never seeks by itself. The dimmed ends
 * come from `scrubWindowFractions`, the thumb from `scrubRatioForPosition`, and
 * every seek target comes out of `scrubSeekTargetMs` — a raw `x / box` handed to
 * `onSeekMs` is the defect this guard exists for (the drag would play the audio
 * the user trimmed out).
 */
function scrubBarSeeksThroughTheModel(barSource: string): boolean {
  const src = maskComments(barSource);
  if (src.length < 1500) return false;
  if (src.indexOf("from '../services/videoScrub'") < 0) return false;
  if (src.indexOf('onSeekMs(scrubSeekTargetMs(') < 0) return false;
  if (src.indexOf('scrubWindowFractions(') < 0) return false;
  if (src.indexOf('scrubRatioForPosition(') < 0) return false;
  if (src.indexOf('scrubTimeLine(') < 0) return false;
  // the dimmed ends are RENDERED, not merely computed
  if (src.indexOf('styles.dimmed') < 0) return false;
  if (src.indexOf('window.startFraction') < 0) return false;
  if (src.indexOf('window.endFraction') < 0) return false;
  // the bar is a viewer: it holds no player and can move nothing itself
  return src.indexOf('setPositionAsync') < 0;
}

/**
 * GUARD 4 — the screen routes EVERY drag through the one clamped seek. Both
 * players (the page's and the full-screen one) move through `seekPlayerTo`, which
 * is the only place `scrubSeekTargetMs` is applied; a second handler that seeks
 * straight to the dragged millisecond is the defect.
 */
function everyScrubRoutesThroughTheClampedSeek(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  if (src.indexOf("from '../components/ScrubBar'") < 0) return false;
  if (src.indexOf("from '../services/videoScrub'") < 0) return false;
  if (src.indexOf('<ScrubBar') < 0) return false;
  const seekAt = src.indexOf('const seekPlayerTo = useCallback(');
  if (seekAt < 0) return false;
  const body = src.slice(seekAt, seekAt + 900);
  if (body.indexOf('scrubSeekTargetMs(') < 0) return false;
  if (body.indexOf('setPositionAsync(') < 0) return false;
  const handlers = src.split('onSeekMs={').length - 1;
  const routed = src.split('onSeekMs={(ms) => seekPlayerTo(').length - 1;
  if (handlers === 0) return false;
  return handlers === routed;
}

/** GUARD 5 — the module and this suite are in BOTH lists. */
function theScrubIsGated(tsconfig: string, pkg: string): boolean {
  if (tsconfig.indexOf('"src/services/videoScrub.ts"') < 0) return false;
  if (tsconfig.indexOf('"scripts/vc53MediaControls.test.ts"') < 0) return false;
  return pkg.indexOf(SUITE_PATH) >= 0;
}

function testGuardsOnRealFiles(): void {
  console.log('\n— THE LIVE GUARDS, on the real repo files —');
  const module = readRepoFile(MODULE_PATH);
  const bar = readRepoFile(BAR_PATH);
  const screen = readRepoFile(SCREEN_PATH);
  const pkg = readRepoFile('package.json');
  const tsconfig = readRepoFile('tsconfig.tier1.json');

  assert(module.length > 1500, 'the scrub model is the real file');
  assert(bar.length > 1500, 'the scrub bar is the real file');
  assert(screen.length > 40000, 'the practice-video screen is the real file');
  assert(scrubModelStaysPure(module), 'GUARD 1: the scrub model stays pure');
  assert(scrubStaysInsideTheTrimWindow(module), 'GUARD 2: the model clamps a drag to the trim window');
  assert(scrubBarSeeksThroughTheModel(bar), 'GUARD 3: the bar draws the model and never seeks by itself');
  assert(everyScrubRoutesThroughTheClampedSeek(screen),
    'GUARD 4: every drag in the screen goes through the one clamped seek');
  assert(theScrubIsGated(tsconfig, pkg), 'GUARD 5: the module and this suite are in the gate');

  // NOT VACUOUS: an empty or stub source passes nothing.
  assertEq(scrubModelStaysPure(''), false, 'an empty module is not pure-by-omission');
  assertEq(scrubStaysInsideTheTrimWindow(''), false, 'an empty module clamps nothing');
  assertEq(scrubBarSeeksThroughTheModel(''), false, 'an empty bar draws nothing');
  assertEq(everyScrubRoutesThroughTheClampedSeek(''), false, 'an empty screen routes nothing');
  assertEq(theScrubIsGated('', ''), false, 'empty lists do not gate the scrub');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. MUTATION PROBES — every guard must BITE on the defect it names
// ─────────────────────────────────────────────────────────────────────────────

function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}

function testMutations(): void {
  console.log('\n— MUTATION PROBES: each guard must fail on its own defect —');
  const module = readRepoFile(MODULE_PATH);
  const bar = readRepoFile(BAR_PATH);
  const screen = readRepoFile(SCREEN_PATH);
  const pkg = readRepoFile('package.json');
  const tsconfig = readRepoFile('tsconfig.tier1.json');

  // GUARD 1 — the model stops being pure.
  const nativeImport = `import { Platform } from 'react-native';\n${module}`;
  probe('guard 1: the model imports react-native',
    nativeImport, module, () => scrubModelStaysPure(nativeImport));
  const ownClock = module.replace(
    'const value = Number(durationMs);',
    'const value = Number(durationMs) + Date.now() * 0;',
  );
  probe('guard 1: the model reads its own clock',
    ownClock, module, () => scrubModelStaysPure(ownClock));
  const socket = module.replace(
    "from './videoTakeSync';",
    "from './videoTakeSync';\nconst SYNC = fetch('http' + 's://notesnap.app/scrub');",
  );
  probe('guard 1: the model opens a socket',
    socket, module, () => scrubModelStaysPure(socket));

  // GUARD 2 — the clamp is removed from the model, one rule at a time.
  const noStartSnap = module.replace('  if (wanted <= startMs) return Math.round(startMs);\n', '');
  probe('guard 2: the start snap is gone (a drag plays the trimmed-out start)',
    noStartSnap, module, () => scrubStaysInsideTheTrimWindow(noStartSnap));
  const noEndSnap = module.replace('  if (wanted >= endMs) return Math.round(endMs);\n', '');
  probe('guard 2: the end snap is gone (a drag plays the trimmed-out end)',
    noEndSnap, module, () => scrubStaysInsideTheTrimWindow(noEndSnap));
  const noTolerance = module.replace('rawEndMs - SCRUB_END_TOLERANCE_MS', 'rawEndMs');
  probe('guard 2: the end snap lands on the edge and stops the player',
    noTolerance, module, () => scrubStaysInsideTheTrimWindow(noTolerance));
  const unclampedRatio = module.replace(
    'const wanted = Math.round(clamp01(ratio) * duration);',
    'const wanted = Math.round(ratio * duration);',
  );
  probe('guard 2: the ratio is trusted as given',
    unclampedRatio, module, () => scrubStaysInsideTheTrimWindow(unclampedRatio));

  // GUARD 3 — the bar seeks to the raw pixel position, or grows a player.
  const rawSeek = bar.replace(
    'live.current.onSeekMs(scrubSeekTargetMs(x / box, live.current.durationMs, live.current.span));',
    'live.current.onSeekMs((x / box) * live.current.durationMs);',
  );
  probe('guard 3: the drag seeks to the raw position, ignoring the clip',
    rawSeek, bar, () => scrubBarSeeksThroughTheModel(rawSeek));
  const noDimmed = bar.split('styles.dimmed').join('styles.nothing');
  probe('guard 3: the dimmed ends are no longer drawn',
    noDimmed, bar, () => scrubBarSeeksThroughTheModel(noDimmed));
  const barOwnsAPlayer = bar.replace(
    'const seekFromX = (x: number): void => {',
    'const seekFromX = (x: number): void => {\n    void (globalThis as any).player?.setPositionAsync(0);',
  );
  probe('guard 3: the bar moves a player itself',
    barOwnsAPlayer, bar, () => scrubBarSeeksThroughTheModel(barOwnsAPlayer));

  // GUARD 4 — one drag bypasses the clamped seek, or the seek stops clamping.
  const oneRawHandler = screen.replace(
    'onSeekMs={(ms) => seekPlayerTo(videoRef.current, ms)}',
    'onSeekMs={(ms) => { void videoRef.current?.setPositionAsync(ms); }}',
  );
  probe('guard 4: one scrub handler seeks straight to the dragged millisecond',
    oneRawHandler, screen, () => everyScrubRoutesThroughTheClampedSeek(oneRawHandler));
  const noClampInSeek = screen.split('scrubSeekTargetMs(').join('rawSeekTarget(');
  probe('guard 4: the shared seek stops clamping',
    noClampInSeek, screen, () => everyScrubRoutesThroughTheClampedSeek(noClampInSeek));
  const noBar = screen.split('<ScrubBar').join('<ProgressBar');
  probe('guard 4: the scrub bar is no longer rendered',
    noBar, screen, () => everyScrubRoutesThroughTheClampedSeek(noBar));

  // GUARD 5 — the gate itself.
  const ungated = pkg.split(SUITE_PATH).join('');
  probe('guard 5: this suite dropped from test:tier1',
    ungated, pkg, () => theScrubIsGated(tsconfig, ungated));
  const moduleUngated = tsconfig.replace('"src/services/videoScrub.ts"', '');
  probe('guard 5: the module dropped from tsconfig.tier1.json',
    moduleUngated, tsconfig, () => theScrubIsGated(moduleUngated, pkg));
}

// ─────────────────────────────────────────────────────────────────────────────
// vc54 ITEM 3 — THE FULLSCREEN ICON SITS ON THE VIDEO, THE LABEL STAYS UNDER IT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GUARD 6 — THE ICON IS ON THE VIDEO, AND IT OPENS THE WINDOW.
 *
 * The owner: "icon on the video next build". Each clause is the bug it exists for:
 *   • the icon is drawn INSIDE the frame that holds the player, so it is on the
 *     video's own corner and not floating somewhere on the page;
 *   • it is a real control — `onPress={openFullScreen}` — and `openFullScreen` is
 *     the action that opens the full-screen window (a decorative glyph is exactly
 *     the v51 defect: the native fullscreen icon the owner pressed and nothing
 *     happened);
 *   • it is 44 pt (the smallest comfortable touch target) and pinned to the TOP of
 *     the video, never the bottom, so it can never cover the scrub bar or the notes
 *     playhead — both of which sit UNDER the video.
 */
function fullScreenIconSitsOnTheVideo(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 40000) return false;
  /**
   * the one action really opens the window. The SHAPE is not the guard: vc56 put
   * a press stamp and two pauses in front of `setVideoFullOpen(true)`, and a
   * guard pinned to the old one-liner failed on a correct fix (defect class 12).
   * What must hold is that the action's own body opens the window.
   */
  const actionAt = src.indexOf('const openFullScreen = useCallback(');
  if (actionAt < 0) return false;
  const actionEnd = src.indexOf('}, []);', actionAt);
  if (actionEnd < 0) return false;
  if (src.slice(actionAt, actionEnd).indexOf('setVideoFullOpen(true)') < 0) return false;
  // the icon itself: the corner style, its own label, the one action
  const iconAt = src.indexOf('const renderFullScreenIcon = () => (');
  if (iconAt < 0) return false;
  const icon = src.slice(iconAt, iconAt + 700);
  if (icon.indexOf('style={styles.videoFullIcon}') < 0) return false;
  if (icon.indexOf('onPress={openFullScreen}') < 0) return false;
  if (icon.indexOf('accessibilityLabel={FULL_SCREEN_VIDEO_ICON_LABEL}') < 0) return false;
  // every player is in a frame, and every frame carries the video AND the icon
  const frames = src.split('<View style={styles.videoFrame}>').slice(1);
  if (frames.length < 2) return false;
  const everyFrameHasBoth = frames.every((segment) => {
    const body = segment.slice(0, segment.indexOf('</View>'));
    return body.indexOf('<Video') >= 0 && body.indexOf('{renderFullScreenIcon()}') >= 0;
  });
  if (!everyFrameHasBoth) return false;
  // 44 pt, absolute, TOP corner — never bottom-anchored
  const styleAt = src.indexOf('videoFullIcon: {');
  if (styleAt < 0) return false;
  const style = src.slice(styleAt, src.indexOf('}', styleAt));
  if (style.indexOf("position: 'absolute'") < 0) return false;
  if (style.indexOf('top:') < 0) return false;
  if (style.indexOf('bottom:') >= 0) return false;
  const width = /width:\s*(\d+)/.exec(style);
  const height = /height:\s*(\d+)/.exec(style);
  if (!width || !height) return false;
  return Number(width[1]) >= 44 && Number(height[1]) >= 44;
}

/**
 * GUARD 7 — THE LABELLED CONTROL UNDER THE VIDEO STAYS.
 *
 * The owner's answer follows the lead's recommendation: the icon is for the hand,
 * the label is for the screen reader and for a first-time user who does not know
 * the corner glyph. Both open the same window. Dropping the labelled button (or
 * unwiring it) leaves the only readable route to full screen as a glyph, and the
 * guard fails.
 */
function labelledFullScreenControlStays(screenSource: string, componentSource: string): boolean {
  const src = maskComments(screenSource);
  const component = maskComments(componentSource);
  if (src.length < 40000 || component.length < 1000) return false;
  // the words live in the component that owns them, and both are exported
  if (component.indexOf('export const FULL_SCREEN_VIDEO_CTA') < 0) return false;
  if (component.indexOf('export const FULL_SCREEN_VIDEO_ICON_LABEL') < 0) return false;
  // …and the label is rendered on BOTH surfaces, each wired to the same action
  let labelled = 0;
  let wired = 0;
  let from = 0;
  for (;;) {
    const at = src.indexOf('{FULL_SCREEN_VIDEO_CTA}', from);
    if (at < 0) break;
    labelled += 1;
    if (src.slice(Math.max(0, at - 400), at).indexOf('onPress={openFullScreen}') >= 0) wired += 1;
    from = at + 1;
  }
  return labelled >= 2 && wired === labelled;
}

function testItem3Guards(): void {
  console.log('\n— vc54 ITEM 3: the fullscreen icon on the video, and the label under it —');
  const screen = readRepoFile(SCREEN_PATH);
  const component = readRepoFile(COMPONENT_PATH);
  assert(component.length > 1000, 'the full-screen component is the real file');
  assert(fullScreenIconSitsOnTheVideo(screen), 'GUARD 6: the icon sits on the video and opens the window');
  assert(labelledFullScreenControlStays(screen, component),
    'GUARD 7: the labelled fullscreen control under the video is still there and still wired');
  // NOT VACUOUS
  assertEq(fullScreenIconSitsOnTheVideo(''), false, 'an empty screen has no icon on its video');
  assertEq(labelledFullScreenControlStays('', ''), false, 'empty files keep no label');
}

function testItem3Mutations(): void {
  console.log('\n— vc54 ITEM 3 MUTATION PROBES: the icon and the label must both bite —');
  const screen = readRepoFile(SCREEN_PATH);
  const component = readRepoFile(COMPONENT_PATH);

  // GUARD 6 — the icon is unwired, off the video, not opening anything, too small.
  const unwiredIcon = screen.replace('onPress={openFullScreen}', 'onPress={() => undefined}');
  probe('item 3: the on-video icon is unwired (press does nothing)',
    unwiredIcon, screen, () => fullScreenIconSitsOnTheVideo(unwiredIcon));
  const iconOffTheVideo = screen.replace('{renderFullScreenIcon()}', '{null}');
  probe('item 3: the icon is no longer drawn on the video',
    iconOffTheVideo, screen, () => fullScreenIconSitsOnTheVideo(iconOffTheVideo));
  const deadAction = screen.replace(
    '    setVideoFullOpen(true);',
    '    setVideoFullOpen(false);',
  );
  probe('item 3: the fullscreen action opens nothing',
    deadAction, screen, () => fullScreenIconSitsOnTheVideo(deadAction));
  const tinyTarget = screen.replace(
    "  videoFullIcon: {\n    position: 'absolute',\n    top: 8,\n    right: 8,\n    width: 44,",
    "  videoFullIcon: {\n    position: 'absolute',\n    top: 8,\n    right: 8,\n    width: 24,",
  );
  probe('item 3: the icon is too small to hit',
    tinyTarget, screen, () => fullScreenIconSitsOnTheVideo(tinyTarget));

  // GUARD 7 — the labelled control is removed, or loses its wiring.
  const labelGone = screen.replace('{FULL_SCREEN_VIDEO_CTA}', "{'Full screen'}");
  probe('item 3: the labelled control is removed from one surface',
    labelGone, screen, () => labelledFullScreenControlStays(labelGone, component));
  const labelUnwired = screen.split('onPress={openFullScreen}').join('onPress={() => undefined}');
  probe('item 3: the labelled control no longer opens the window',
    labelUnwired, screen, () => labelledFullScreenControlStays(labelUnwired, component));
  const labelRenamed = component.replace('export const FULL_SCREEN_VIDEO_CTA', 'const FULL_SCREEN_CTA_RENAMED');
  probe('item 3: the label constant disappears from the component',
    labelRenamed, component, () => labelledFullScreenControlStays(screen, labelRenamed));
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

console.log('vc53 item 4 — the scrub bar stays inside the trim window');
testWindowFractions();
testPlayheadRatio();
testSeekIsClampedToTheWindow();
testReadout();
testGuardsOnRealFiles();
testMutations();
testItem3Guards();
testItem3Mutations();

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
