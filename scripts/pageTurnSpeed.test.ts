/**
 * pageTurnSpeed.test.ts — the PAGE-TURNER SPEED PRESETS gate (owner 10-10,
 * backlog 7f64272f).
 *
 * The owner asked for the page turner to be "modifiable/customised easier": a
 * player new to a piece turns pages slowly, a player who has practised it many
 * times turns them fast. The deliverable is one-tap skill profiles that change
 * BOTH numbers of the turn model, a memory per piece, and the existing
 * fine-grained steppers kept.
 *
 * This suite proves the three things that can silently not happen:
 *   1. the profiles really are a speed GRADIENT (12 → 4 → 1 s per page) and every
 *      one of them moves both numbers;
 *   2. the memory round-trips through the pure codec, is keyed per piece, and
 *      cannot put the engine outside the stepper bounds;
 *   3. the REAL files wire it: both viewers, the shared hook, the control that
 *      still has its steppers, and the engine applying a profile as ONE change.
 * Every guard is mutation-probed and checked for vacuity.
 *
 * Plain Node, no react-native, no storage, no timers. Run: npm run test:tier1
 */
import {
  activePageTurnPresetId,
  clampPageTurnProfile,
  decodePageTurnSpeedMap,
  describePageTurnSpeed,
  encodePageTurnSpeedMap,
  formatSecondsPerPage,
  isPageTurnProfileInRange,
  pageTurnPreset,
  pageTurnPresetChipLabel,
  pageTurnSecondsPerPage,
  pageTurnSpeedForPiece,
  withPageTurnSpeedForPiece,
  DEFAULT_PAGE_TURN_PROFILE,
  PAGE_TURN_BEATS_PER_PAGE_MAX,
  PAGE_TURN_BEATS_PER_PAGE_MIN,
  PAGE_TURN_BPM_MAX,
  PAGE_TURN_BPM_MIN,
  PAGE_TURN_PRESETS,
  PAGE_TURN_PRESETS_HINT,
  PAGE_TURN_PRESETS_LABEL,
  PAGE_TURN_REMEMBERED_LINE,
  PAGE_TURN_SPEED_KEY,
  type PageTurnPresetId,
} from '../src/services/pageTurnPresets';
import {
  pageTurnerBoundsMatchTheHook,
  pageTurnerKeepsTheSteppers,
  pageTurnerPresetTapChangesBothNumbers,
  pageTurnerRemembersPerPiece,
  pageTurnerViewersShareThePresets,
  tier1ListsTheV39Features,
  v39CopyAvoidsBannedClaims,
  v39HasNoNetwork,
  v39IsFreeAndUnpaywalled,
  v39ModuleStaysPure,
  V39_AUTOSCROLL_CONTROL_PATH,
  V39_AUTOSCROLL_HOOK_PATH,
  V39_PACKAGE_PATH,
  V39_PAGE_TURN_HOOK_PATH,
  V39_PAGE_TURN_PRESETS_PATH,
  V39_PAGE_TURN_STORE_PATH,
  V39_PDF_VIEWER_PATH,
  V39_SCANNED_VIEWER_PATH,
  V39_TIER1_CONFIG_PATH,
} from '../src/services/v39UiContract';

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

const PRESETS_SRC = readAppFile(V39_PAGE_TURN_PRESETS_PATH);
const STORE_SRC = readAppFile(V39_PAGE_TURN_STORE_PATH);
const HOOK_SRC = readAppFile(V39_PAGE_TURN_HOOK_PATH);
const CONTROL_SRC = readAppFile(V39_AUTOSCROLL_CONTROL_PATH);
const ENGINE_SRC = readAppFile(V39_AUTOSCROLL_HOOK_PATH);
const PDF_SRC = readAppFile(V39_PDF_VIEWER_PATH);
const SCANNED_SRC = readAppFile(V39_SCANNED_VIEWER_PATH);
const tsconfigSource = readAppFile(V39_TIER1_CONFIG_PATH);
const packageSource = readAppFile(V39_PACKAGE_PATH);

console.log('\npage-turner — the presets are a SPEED GRADIENT, not a tempo');
assertEq(PAGE_TURN_PRESETS.length, 3, 'three skill levels');
assertEq(PAGE_TURN_PRESETS.map((p) => p.id).join(','), 'beginner,intermediate,fast', 'slowest to fastest');
for (const preset of PAGE_TURN_PRESETS) {
  assert(preset.label.length > 2 && preset.cue.length > 2, `${preset.id} is labelled and has a cue`);
  assert(
    preset.bpm >= PAGE_TURN_BPM_MIN && preset.bpm <= PAGE_TURN_BPM_MAX,
    `${preset.id} BPM (${preset.bpm}) is inside the stepper bounds`,
  );
  assert(
    preset.beatsPerPage >= PAGE_TURN_BEATS_PER_PAGE_MIN &&
      preset.beatsPerPage <= PAGE_TURN_BEATS_PER_PAGE_MAX,
    `${preset.id} beats/page (${preset.beatsPerPage}) is inside the stepper bounds`,
  );
}
// Every rung moves BOTH numbers — a preset that only moved the BPM would be the
// half-fix the owner's ask rules out.
for (let i = 1; i < PAGE_TURN_PRESETS.length; i++) {
  const slow = PAGE_TURN_PRESETS[i - 1];
  const fast = PAGE_TURN_PRESETS[i];
  assert(slow.bpm !== fast.bpm, `${slow.id} → ${fast.id} changes the BPM`);
  assert(
    slow.beatsPerPage !== fast.beatsPerPage,
    `${slow.id} → ${fast.id} changes the beats per page too`,
  );
}
const beginner = pageTurnPreset('beginner');
const intermediate = pageTurnPreset('intermediate');
const fast = pageTurnPreset('fast');
assert(beginner !== null && intermediate !== null && fast !== null, 'all three presets resolve by id');
if (beginner && intermediate && fast) {
  assertEq(pageTurnSecondsPerPage(beginner), 12, 'Beginner is 12 s per page (40 BPM × 8 beats)');
  assertEq(pageTurnSecondsPerPage(intermediate), 4, 'Intermediate is 4 s per page (60 BPM × 4 beats)');
  assertEq(pageTurnSecondsPerPage(fast), 1, 'Fast is 1 s per page (120 BPM × 2 beats)');
  assert(
    pageTurnSecondsPerPage(beginner) > pageTurnSecondsPerPage(intermediate) &&
      pageTurnSecondsPerPage(intermediate) > pageTurnSecondsPerPage(fast),
    'the gradient runs slow → fast in order',
  );
  assert(
    pageTurnSecondsPerPage(intermediate) ===
      (60 / DEFAULT_PAGE_TURN_PROFILE.bpm) * DEFAULT_PAGE_TURN_PROFILE.beatsPerPage,
    'Intermediate IS the app’s pre-existing default pace',
  );
}
assertEq(pageTurnPreset('nope'), null, 'an unknown preset id resolves to nothing');
assertEq(pageTurnPreset(null), null, 'a null preset id resolves to nothing');
assertEq(pageTurnPreset(''), null, 'an empty preset id resolves to nothing');

console.log('\npage-turner — the preset the numbers ARE (derived, never stored)');
assertEq(activePageTurnPresetId({ bpm: 40, beatsPerPage: 8 }), 'beginner', 'the Beginner numbers are Beginner');
assertEq(activePageTurnPresetId({ bpm: 60, beatsPerPage: 4 }), 'intermediate', 'the Intermediate numbers are Intermediate');
assertEq(activePageTurnPresetId({ bpm: 120, beatsPerPage: 2 }), 'fast', 'the Fast numbers are Fast');
assertEq(activePageTurnPresetId({ bpm: 61, beatsPerPage: 4 }), null, 'a fine-tuned tempo highlights no preset');
assertEq(activePageTurnPresetId({ bpm: 40, beatsPerPage: 4 }), null, 'borrowing half a preset highlights no preset');
assertEq(activePageTurnPresetId(null), null, 'no profile means no preset');

console.log('\npage-turner — clamping and formatting');
assertEq(clampPageTurnProfile({ bpm: 500, beatsPerPage: 99 }).bpm, PAGE_TURN_BPM_MAX, 'a wild BPM clamps to the maximum');
assertEq(
  clampPageTurnProfile({ bpm: 500, beatsPerPage: 99 }).beatsPerPage,
  PAGE_TURN_BEATS_PER_PAGE_MAX,
  'a wild beats/page clamps to the maximum',
);
assertEq(clampPageTurnProfile({ bpm: 0, beatsPerPage: 0 }).bpm, PAGE_TURN_BPM_MIN, 'a zero BPM clamps to the minimum');
assertEq(
  clampPageTurnProfile({ bpm: 0, beatsPerPage: 0 }).beatsPerPage,
  PAGE_TURN_BEATS_PER_PAGE_MIN,
  'a zero beats/page clamps to the minimum',
);
assertEq(clampPageTurnProfile(null).bpm, DEFAULT_PAGE_TURN_PROFILE.bpm, 'a missing profile falls back to the default BPM');
assertEq(
  clampPageTurnProfile(undefined).beatsPerPage,
  DEFAULT_PAGE_TURN_PROFILE.beatsPerPage,
  'a missing profile falls back to the default beats/page',
);
assertEq(clampPageTurnProfile({ bpm: Number.NaN, beatsPerPage: 4 }).bpm, DEFAULT_PAGE_TURN_PROFILE.bpm, 'NaN falls back to the default');
assertEq(clampPageTurnProfile({ bpm: 59.6, beatsPerPage: 4 }).bpm, 60, 'a fractional BPM rounds to a whole one');
assertEq(isPageTurnProfileInRange({ bpm: 60, beatsPerPage: 4 }), true, 'the default profile is in range');
assertEq(isPageTurnProfileInRange({ bpm: 10, beatsPerPage: 4 }), false, 'below the minimum is out of range');
assertEq(isPageTurnProfileInRange({ bpm: 60, beatsPerPage: 0 }), false, 'zero beats/page is out of range');
assertEq(isPageTurnProfileInRange({ bpm: 60.5, beatsPerPage: 4 }), false, 'a fractional BPM is out of range');
assertEq(formatSecondsPerPage(12), '12 s/page', 'a whole number of seconds prints without decimals');
assertEq(formatSecondsPerPage(4), '4 s/page', '4 seconds prints as 4 s/page');
assertEq(formatSecondsPerPage(1.3333), '1.3 s/page', 'a fractional rate prints one decimal');
assertEq(formatSecondsPerPage(0), '— s/page', 'an impossible rate prints a dash, never a lie');
assertEq(describePageTurnSpeed({ bpm: 40, beatsPerPage: 8 }), '40 BPM · 8 beats/page · 12 s/page (Beginner)', 'the status line names the preset');
assert(describePageTurnSpeed({ bpm: 61, beatsPerPage: 4 }).indexOf('(custom)') > 0, 'a fine-tuned rate says custom');
assertEq(pageTurnPresetChipLabel(beginner as never), 'Beginner · 12 s/page', 'the chip label carries its own rate');
assertEq(PAGE_TURN_PRESETS_LABEL, 'Turn speed', 'the preset row is labelled');
assert(PAGE_TURN_PRESETS_HINT.indexOf('fine-tune') > 0, 'the hint says the steppers still fine-tune');
assert(PAGE_TURN_REMEMBERED_LINE.indexOf('piece') > 0, 'the memory line says it is per piece');

console.log('\npage-turner — the per-piece memory (pure codec)');
assertEq(PAGE_TURN_SPEED_KEY, 'notesnap:pageturner:speed:v1', 'the storage key is namespaced and versioned');
assertEq(Object.keys(decodePageTurnSpeedMap(null)).length, 0, 'no stored value decodes to an empty map');
assertEq(Object.keys(decodePageTurnSpeedMap('')).length, 0, 'an empty string decodes to an empty map');
assertEq(Object.keys(decodePageTurnSpeedMap('not json')).length, 0, 'garbage decodes to an empty map');
assertEq(Object.keys(decodePageTurnSpeedMap('[]')).length, 0, 'an array decodes to an empty map');
assertEq(Object.keys(decodePageTurnSpeedMap('"x"')).length, 0, 'a string decodes to an empty map');
const good = encodePageTurnSpeedMap({ pieceA: { bpm: 40, beatsPerPage: 8 }, pieceB: { bpm: 120, beatsPerPage: 2 } });
const goodMap = decodePageTurnSpeedMap(good);
assertEq(Object.keys(goodMap).length, 2, 'two pieces round-trip');
assertEq(pageTurnSpeedForPiece(goodMap, 'pieceA')?.bpm, 40, 'pieceA keeps its own tempo');
assertEq(pageTurnSpeedForPiece(goodMap, 'pieceB')?.beatsPerPage, 2, 'pieceB keeps its own beats/page');
assertEq(pageTurnSpeedForPiece(goodMap, 'pieceC'), null, 'a piece never read has no saved speed');
assertEq(pageTurnSpeedForPiece(goodMap, null), null, 'no piece id means no saved speed');
assertEq(pageTurnSpeedForPiece(goodMap, ''), null, 'an empty piece id means no saved speed');
const partial = decodePageTurnSpeedMap('{"pieceA":{"bpm":40},"pieceB":{"beatsPerPage":4},"pieceC":{"bpm":"x","beatsPerPage":4}}');
assertEq(Object.keys(partial).length, 0, 'an entry without both numbers is dropped, never guessed at');
const clipped = decodePageTurnSpeedMap('{"pieceA":{"bpm":900,"beatsPerPage":900}}');
assertEq(clipped.pieceA?.bpm, PAGE_TURN_BPM_MAX, 'a stored tempo the engine cannot run is clamped on read');
assertEq(clipped.pieceA?.beatsPerPage, PAGE_TURN_BEATS_PER_PAGE_MAX, 'a stored beats/page is clamped on read too');
const original = { pieceA: { bpm: 40, beatsPerPage: 8 } };
const updated = withPageTurnSpeedForPiece(original, 'pieceB', { bpm: 60, beatsPerPage: 4 });
assertEq(Object.keys(updated).length, 2, 'setting one piece keeps the other');
assertEq(original.pieceA?.bpm, 40, 'the map handed in is never mutated');
assert(updated !== original, 'a new map is returned');
assertEq(withPageTurnSpeedForPiece(original, '', { bpm: 60, beatsPerPage: 4 }) !== undefined, true, 'an empty piece id still returns a map');
assertEq(Object.keys(withPageTurnSpeedForPiece(original, '', { bpm: 60, beatsPerPage: 4 })).length, 1, 'but stores nothing for it');
assertEq(withPageTurnSpeedForPiece(null, 'pieceD', { bpm: 61, beatsPerPage: 3 }).pieceD?.bpm, 61, 'a custom fine-tuned rate is remembered exactly');
assertEq(
  encodePageTurnSpeedMap({ pieceA: { bpm: 45.7, beatsPerPage: 3.2 } }),
  encodePageTurnSpeedMap({ pieceA: { bpm: 46, beatsPerPage: 3 } }),
  'the encoder rounds before it stores',
);

console.log('\npage-turner — the live-source walk (floors first)');
assert(PRESETS_SRC.length > 5000, `read ${V39_PAGE_TURN_PRESETS_PATH} (${PRESETS_SRC.length} chars)`);
assert(STORE_SRC.length > 800, `read ${V39_PAGE_TURN_STORE_PATH} (${STORE_SRC.length} chars)`);
assert(HOOK_SRC.length > 2000, `read ${V39_PAGE_TURN_HOOK_PATH} (${HOOK_SRC.length} chars)`);
assert(CONTROL_SRC.length > 4000, `read ${V39_AUTOSCROLL_CONTROL_PATH} (${CONTROL_SRC.length} chars)`);
assert(ENGINE_SRC.length > 4000, `read ${V39_AUTOSCROLL_HOOK_PATH} (${ENGINE_SRC.length} chars)`);
assert(PDF_SRC.length > 6000, `read ${V39_PDF_VIEWER_PATH} (${PDF_SRC.length} chars)`);
assert(SCANNED_SRC.length > 6000, `read ${V39_SCANNED_VIEWER_PATH} (${SCANNED_SRC.length} chars)`);

console.log('\npage-turner guards');
assertEq(pageTurnerViewersShareThePresets(PDF_SRC, SCANNED_SRC, HOOK_SRC), true, 'the PDF reader keeps the presets and the scanned surface no longer offers the dead control');
assertEq(pageTurnerPresetTapChangesBothNumbers(PRESETS_SRC, ENGINE_SRC, CONTROL_SRC), true, 'one tap moves both numbers and the control wires it');
assertEq(pageTurnerKeepsTheSteppers(CONTROL_SRC), true, 'the BPM and beats/page steppers survive with their bounds');
assertEq(pageTurnerRemembersPerPiece(STORE_SRC, PRESETS_SRC), true, 'the device adapter owns the key and the pure module does not');
assertEq(pageTurnerBoundsMatchTheHook(PRESETS_SRC, ENGINE_SRC), true, 'the pure bounds are still the engine’s own bounds');
assertEq(v39ModuleStaysPure(PRESETS_SRC), true, 'services/pageTurnPresets.ts stays pure');
assertEq(v39HasNoNetwork([PRESETS_SRC, STORE_SRC, HOOK_SRC, CONTROL_SRC]), true, 'the page-turner path cannot reach the network');
assertEq(v39IsFreeAndUnpaywalled([PRESETS_SRC, STORE_SRC, HOOK_SRC, CONTROL_SRC]), true, 'the page turner carries no paywall token');
assertEq(v39CopyAvoidsBannedClaims([PRESETS_SRC, CONTROL_SRC]), true, 'no banned claim in the page-turner copy');
assertEq(tier1ListsTheV39Features(tsconfigSource, packageSource), true, 'the page-turner module and suite are in BOTH gate lists');

console.log('\npage-turner — the guards are not vacuous (empty input)');
assertEq(pageTurnerViewersShareThePresets('', '', ''), false, 'empty viewers share nothing');
assertEq(pageTurnerPresetTapChangesBothNumbers('', '', ''), false, 'an empty trio changes nothing');
assertEq(pageTurnerKeepsTheSteppers(''), false, 'an empty control has no steppers');
assertEq(pageTurnerRemembersPerPiece('', ''), false, 'an empty pair remembers nothing');
assertEq(pageTurnerBoundsMatchTheHook('', ''), false, 'empty sources prove no bound');
assertEq(v39ModuleStaysPure(''), false, 'an empty module is not pure-by-omission');

console.log('\npage-turner — MUTATION PROBES (each guard must bite)');
function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}
const pdfUnwired = PDF_SRC.replace('usePageTurnSpeed(itemId, autoScroll)', 'useAutoScroll(itemId)');
probe('the PDF viewer stops remembering a speed', pdfUnwired, PDF_SRC, () =>
  pageTurnerViewersShareThePresets(pdfUnwired, SCANNED_SRC, HOOK_SRC),
);
// RE-POINTED by v42 fix C: the dead control coming BACK must fail the guard.
const scannedDeadControlBack = SCANNED_SRC.replace(
  '<FlatList',
  '<AutoScrollControl speedProfiles={speedProfiles} />\n        <FlatList',
);
probe('the scanned viewer takes the dead auto-scroll control back', scannedDeadControlBack, SCANNED_SRC, () =>
  pageTurnerViewersShareThePresets(PDF_SRC, scannedDeadControlBack, HOOK_SRC),
);
// …and so must the surface losing its reason ("why there is nothing to start").
const scannedSilent = SCANNED_SRC.replace(/<Text style=\{styles\.autoScrollNote\}>\{SCANNED_NO_AUTOSCROLL_LINE\}<\/Text>/, '');
probe('the scanned viewer stops saying why there is no auto-scroll', scannedSilent, SCANNED_SRC, () =>
  pageTurnerViewersShareThePresets(PDF_SRC, scannedSilent, HOOK_SRC),
);
const hookForgetsPiece = HOOK_SRC.replace('pageTurnSpeedForPiece(map, itemId', 'pageTurnSpeedForPiece(map, null');
probe('the hook stops reading the per-piece speed', hookForgetsPiece, HOOK_SRC, () =>
  pageTurnerViewersShareThePresets(PDF_SRC, SCANNED_SRC, hookForgetsPiece),
);
const bpmOnlyProfile = ENGINE_SRC.replace('beatsPerPageRef.current = nextBeatsPerPage;', '');
probe('a preset stops moving the beats per page', bpmOnlyProfile, ENGINE_SRC, () =>
  pageTurnerPresetTapChangesBothNumbers(PRESETS_SRC, bpmOnlyProfile, CONTROL_SRC),
);
const doubleSnap = ENGINE_SRC.replace(
  '        snapNextTurn();\n      }\n    },\n    [snapNextTurn]',
  '        snapNextTurn();\n        snapNextTurn();\n      }\n    },\n    [snapNextTurn]',
);
probe('the engine schedules the next turn twice per tap', doubleSnap, ENGINE_SRC, () =>
  pageTurnerPresetTapChangesBothNumbers(PRESETS_SRC, doubleSnap, CONTROL_SRC),
);
const chipUnwired = CONTROL_SRC.replace('speedProfiles.onSelectPreset(preset.id)', 'undefined');
probe('the preset chip calls nothing', chipUnwired, CONTROL_SRC, () =>
  pageTurnerPresetTapChangesBothNumbers(PRESETS_SRC, ENGINE_SRC, chipUnwired),
);
const stepsGone = CONTROL_SRC.replace('label="beats/page"', 'label="bpp"');
probe('the beats-per-page stepper loses its label', stepsGone, CONTROL_SRC, () =>
  pageTurnerKeepsTheSteppers(stepsGone),
);
const boundsWidened = CONTROL_SRC.replace('incrementDisabled={bpm >= 200}', 'incrementDisabled={bpm >= 400}');
probe('the BPM stepper’s ceiling moves', boundsWidened, CONTROL_SRC, () =>
  pageTurnerKeepsTheSteppers(boundsWidened),
);
/**
 * The key probe replaces the constant EVERYWHERE (the /g is the point): the first
 * occurrence in the store is the IMPORT, so a single replace left the store still
 * building its key from the shared constant and the guard could not bite — a dead
 * probe, not a passing guard (v39 gate fix).
 */
const storeLosesKey = STORE_SRC.replace(/PAGE_TURN_SPEED_KEY/g, 'SOME_OTHER_KEY');
probe('the device adapter loses the shared key', storeLosesKey, STORE_SRC, () =>
  pageTurnerRemembersPerPiece(storeLosesKey, PRESETS_SRC),
);
const pureTouchesStorage = PRESETS_SRC.replace(
  'export const PAGE_TURN_PRESETS',
  "import AsyncStorage from '@react-native-async-storage/async-storage';\nexport const PAGE_TURN_PRESETS",
);
probe('the pure module starts touching storage', pureTouchesStorage, PRESETS_SRC, () =>
  pageTurnerRemembersPerPiece(STORE_SRC, pureTouchesStorage),
);
const hookBoundDrift = ENGINE_SRC.replace('AUTO_SCROLL_BPM_MIN = 30', 'AUTO_SCROLL_BPM_MIN = 25');
probe('the engine’s minimum BPM drifts from the pure bound', hookBoundDrift, ENGINE_SRC, () =>
  pageTurnerBoundsMatchTheHook(PRESETS_SRC, hookBoundDrift),
);
const pureBoundDrift = PRESETS_SRC.replace('PAGE_TURN_BPM_MAX = 200', 'PAGE_TURN_BPM_MAX = 220');
probe('the pure bound drifts from the engine', pureBoundDrift, PRESETS_SRC, () =>
  pageTurnerBoundsMatchTheHook(pureBoundDrift, ENGINE_SRC),
);
const defaultDrift = ENGINE_SRC.replace('AUTO_SCROLL_DEFAULT_BPM = 60', 'AUTO_SCROLL_DEFAULT_BPM = 72');
probe('the engine’s default tempo drifts from the default profile', defaultDrift, ENGINE_SRC, () =>
  pageTurnerBoundsMatchTheHook(PRESETS_SRC, defaultDrift),
);
const impureControl = CONTROL_SRC.replace(
  "import { useThemedStyles } from '../services/themeStore';",
  "import { Platform } from 'react-native';\nimport { useThemedStyles } from '../services/themeStore';",
);
probe('the preset service grows a native import', impureControl, CONTROL_SRC, () =>
  v39ModuleStaysPure(PRESETS_SRC.length > 0 ? impureControl.replace('react-native', 'expo-camera') : ''),
);

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
