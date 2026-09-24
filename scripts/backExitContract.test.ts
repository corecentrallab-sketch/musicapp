/**
 * backExitContract.test.ts — the guard for the owner's hardware-BACK bug class.
 *
 * Owner-reproduced on device (09-23): "Streak day → featured piece → sheet music
 * page → BACK → the app exits", confirmed on the sheet-music-from-streak path.
 * v22's modalBackContract covers `<Modal>` surfaces; this suite covers the OTHER
 * family of full-screen surfaces — the IN-PLACE flows that replace their host
 * tab's whole body and are neither routes nor modals, so an unconsumed BACK press
 * reaches React Navigation, which has no route to pop and finishes the activity.
 *
 * Two halves, like the rest of the repo's contract suites:
 *   1. DETECTOR tests — fixtures prove the scan flags a flow with no
 *      `useHardwareBack()` call, accepts a hand-rolled BackHandler subscription,
 *      flags a modal-based surface whose modal cannot be closed by BACK, and flags
 *      a host that mounts a flow without its back callback.
 *   2. LIVE SCAN — every .ts/.tsx under src/ plus App.tsx is read off disk and
 *      audited, so a real regression fails this suite. Floors on the file count
 *      and on the number of registered handlers mean an empty or broken walk
 *      cannot pass vacuously.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  BACK_HANDLER_SUBSCRIPTION_PATTERN,
  FULL_SCREEN_FLOWS,
  countHardwareBackHandlers,
  findBackExitViolations,
  findFlowMountsMissingBackCallback,
  findUnguardedFullScreenFlows,
  flowMountSites,
  formatBackExitViolations,
  registersHardwareBackHandler,
  type BackGuardViolation,
} from '../src/services/backExitContract';
import type { SourceFile } from '../src/services/modalBackContract';

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

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
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

// ─── 1. Detectors ───────────────────────────────────────────────

const IN_PLACE_FLOW = 'src/screens/PracticeWeekScreen.tsx';
const MODAL_FLOW = 'src/components/ScoreViewer.tsx';

function detectorTests(): void {
  console.log('\nwhich flows the contract declares');

  assert(
    FULL_SCREEN_FLOWS.length >= 6,
    `the contract declares ${FULL_SCREEN_FLOWS.length} full-screen flows (≥ 6)`,
  );
  for (const path of [
    'src/screens/PieceDetailScreen.tsx',
    'src/screens/HumSearchScreen.tsx',
    'src/screens/FindPieceScreen.tsx',
    'src/screens/PracticeWeekScreen.tsx',
    'src/screens/ModernSearchScreen.tsx',
    'src/components/ScoreViewer.tsx',
  ]) {
    assert(
      FULL_SCREEN_FLOWS.some((f) => f.path === path),
      `${path} is in the BACK contract`,
    );
  }
  assert(
    FULL_SCREEN_FLOWS.every((f) => f.why.length > 20),
    'every declared flow says WHY it is in the contract',
  );

  console.log('\ndetecting a BACK handler');

  assert(
    registersHardwareBackHandler('const x = () => {\n  useHardwareBack(handler);\n};'),
    'the shared useHardwareBack() hook counts as a handler',
  );
  assert(
    registersHardwareBackHandler(
      "BackHandler.addEventListener('hardwareBackPress', () => true)",
    ),
    'a hand-rolled BackHandler subscription counts as a handler',
  );
  assert(
    !registersHardwareBackHandler('const x = () => null;'),
    'a screen with no handler is not counted',
  );
  assert(
    !registersHardwareBackHandler('// useHardwareBack(onBack) — deleted\nconst y = 1;'),
    'a handler mentioned only in a comment does not count',
  );
  assert(
    BACK_HANDLER_SUBSCRIPTION_PATTERN.test(
      'BackHandler  .  addEventListener( "hardwareBackPress"',
    ),
    'the subscription pattern tolerates spacing and quoting',
  );

  console.log('\nflagging unguarded flows');

  // A fixture scan holds ONE flow's file, so the other declared flows read as
  // missing files — the flow under test is isolated by path below.
  const forPath = (path: string, files: SourceFile[]): BackGuardViolation[] =>
    findUnguardedFullScreenFlows(files).filter((v) => v.path === path);

  const unguarded: SourceFile = {
    path: IN_PLACE_FLOW,
    source: 'export const S = () => {\n  return <View />;\n};',
  };
  const guarded: SourceFile = {
    path: IN_PLACE_FLOW,
    source:
      'export const S = () => {\n  useHardwareBack(() => {\n    onClose();\n    return true;\n  });\n  return <View />;\n};',
  };
  const unguardedViolations = forPath(IN_PLACE_FLOW, [unguarded]);
  assertEq(unguardedViolations.length, 1, 'an in-place flow with no handler is a violation');
  assertEq(
    unguardedViolations[0].kind,
    'no-hardware-back-handler',
    'the violation names the missing handler',
  );
  assertEq(
    forPath(IN_PLACE_FLOW, [guarded]).length,
    0,
    'the same flow with useHardwareBack() is clean',
  );
  assert(
    formatBackExitViolations(unguardedViolations)[0].includes(IN_PLACE_FLOW),
    'the report names the file',
  );

  // A declared flow that is missing from the scan must never pass silently.
  const missing = findUnguardedFullScreenFlows([]);
  assertEq(missing.length, FULL_SCREEN_FLOWS.length, 'every missing flow is reported');
  assert(
    missing.every((v) => v.kind === 'missing-file'),
    'a flow absent from the scan is reported as a missing file, not as clean',
  );

  // The modal-based surface (the sheet-music view) keeps v22's onRequestClose rule.
  const modalNoClose: SourceFile = {
    path: MODAL_FLOW,
    source: 'const V = () => (\n  <Modal visible animationType="slide">\n    <View />\n  </Modal>\n);',
  };
  const modalCloses: SourceFile = {
    path: MODAL_FLOW,
    source:
      'const V = () => (\n  <Modal visible animationType="slide" onRequestClose={onClose}>\n    <View />\n  </Modal>\n);',
  };
  const modalViolations = forPath(MODAL_FLOW, [modalNoClose]);
  assertEq(
    modalViolations[0].kind,
    'modal-cannot-close-by-back',
    'a sheet-music modal without onRequestClose is a violation',
  );
  assertEq(modalViolations[0].line, 2, 'the modal violation points at the offending tag');
  assertEq(
    forPath(MODAL_FLOW, [modalCloses]).length,
    0,
    'a modal with onRequestClose satisfies the contract',
  );

  console.log('\nmount sites (the host that forgot the prop)');

  const hostNoProp: SourceFile = {
    path: 'src/screens/HomeScreen.tsx',
    source: 'const H = () => (\n  <PieceDetailScreen piece={dailyChallenge} />\n);',
  };
  const hostWithProp: SourceFile = {
    path: 'src/screens/HomeScreen.tsx',
    source:
      'const H = () => (\n  <PieceDetailScreen piece={dailyChallenge} onBack={() => setShowDetail(false)} />\n);',
  };
  assertEq(
    flowMountSites(hostNoProp.source, 'PieceDetailScreen').length,
    1,
    'a mount of the piece page is found',
  );
  const noPropViolations = findFlowMountsMissingBackCallback([hostNoProp]);
  assertEq(noPropViolations.length, 1, 'a mount without onBack is a violation');
  assertEq(
    noPropViolations[0].kind,
    'mount-without-back-callback',
    'the violation names the missing back callback',
  );
  assertEq(noPropViolations[0].line, 2, 'the violation points at the mount');
  assert(
    formatBackExitViolations(noPropViolations)[0].includes('no way back'),
    'the report explains what breaks in words',
  );
  assertEq(
    findFlowMountsMissingBackCallback([hostWithProp]).length,
    0,
    'a mount with onBack is clean',
  );
  assertEq(
    flowMountSites(
      'import { PieceDetailScreen } from "./PieceDetailScreen";\n' +
        'interface PieceDetailScreenProps { x: number }\n' +
        'const C: React.FC<PieceDetailScreenProps> = () => null;',
      'PieceDetailScreen',
    ).length,
    0,
    'an import, a Props type and a generic are not mounts',
  );
  assertEq(
    flowMountSites('<ScoreViewer url={u} onClose={close} />', 'ScoreViewer').length,
    1,
    'the sheet-music view is tracked as a mount too',
  );
  assertEq(
    findFlowMountsMissingBackCallback([
      { path: 'src/components/RecognitionResultView.tsx', source: '<ScoreViewer url={u} />' },
    ]).length,
    1,
    'a ScoreViewer mount without onClose is a violation',
  );
  assert(
    findBackExitViolations([hostNoProp]).some(
      (v) => v.kind === 'mount-without-back-callback',
    ),
    'the combined entry point reports the mount half (one gate check covers both)',
  );
}

// ─── 2. Live scan of the app ────────────────────────────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (
      fs.existsSync(path.join(dir, 'app.json')) &&
      fs.existsSync(path.join(dir, 'src'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

/** Every .ts/.tsx under src/ plus App.tsx — the app's own source. */
function appSources(): SourceFile[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir) as string[]) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
        files.push({
          path: path.relative(root, full),
          source: fs.readFileSync(full, 'utf8') as string,
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  files.push({ path: 'App.tsx', source: readAppFile('App.tsx') });
  return files;
}

function liveScanTests(): void {
  console.log('\nlive scan of the app source');

  const files = appSources();
  // Floors, so a broken walk cannot make this suite pass by finding nothing.
  assert(files.length >= 25, `scanned ${files.length} app source files (≥ 25)`);

  const handlers = countHardwareBackHandlers(files);
  assert(
    handlers >= FULL_SCREEN_FLOWS.length,
    `${handlers} app source files register a hardware-back handler (≥ ${FULL_SCREEN_FLOWS.length} declared flows)`,
  );

  for (const flow of FULL_SCREEN_FLOWS) {
    const file = files.find((f) => f.path === flow.path);
    assert(!!file, `${flow.path} (${flow.name}) is part of the scan`);
  }

  // The five in-place flows must each own the BACK press.
  for (const path of [
    'src/screens/PieceDetailScreen.tsx',
    'src/screens/HumSearchScreen.tsx',
    'src/screens/FindPieceScreen.tsx',
    'src/screens/PracticeWeekScreen.tsx',
    'src/screens/ModernSearchScreen.tsx',
  ]) {
    const file = files.find((f) => f.path === path);
    assert(
      !!file && /useHardwareBack\s*\(/.test(file.source),
      `${path} calls useHardwareBack() (owner re-confirmed defect 09-23)`,
    );
  }

  const violations: BackGuardViolation[] = findBackExitViolations(files);
  if (violations.length > 0) {
    for (const line of formatBackExitViolations(violations)) console.error(`  ✗ ${line}`);
  }
  assertEq(
    violations.length,
    0,
    'every full-screen flow can be left with the hardware BACK button',
  );

  console.log('\nthe hook itself (src/hooks/useHardwareBack.ts)');

  const hook = readAppFile('src/hooks/useHardwareBack.ts');
  assert(
    /BackHandler\s*\.\s*addEventListener\s*\(\s*'hardwareBackPress'/.test(hook),
    'the hook subscribes to hardwareBackPress',
  );
  assert(
    /subscription\.remove\(\)/.test(hook),
    'the hook removes its subscription on unmount/blur (no leaked handler)',
  );
  assert(
    /useIsFocused\(\)/.test(hook),
    'the hook is focus-gated, so a flow left on a blurred tab cannot swallow BACK',
  );
  assert(
    /return\s+true/.test(hook) || /handler\.current\(\)/.test(hook),
    'the hook returns the handler result (true = the press is consumed)',
  );
  assert(
    /Platform\.OS\s*(?:===|!==)\s*'android'/.test(hook),
    'the hook is Android-only (the key event it handles is Android-only)',
  );
  assert(
    findFlowMountsMissingBackCallback([
      { path: 'src/services/backExitContract.ts', source: '<PieceDetailScreen />' },
    ]).length === 0,
    'the detector does not report its own documentation (self-allowlisted)',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== hardware BACK exits in-place full-screen flows ===');
  detectorTests();
  liveScanTests();
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
