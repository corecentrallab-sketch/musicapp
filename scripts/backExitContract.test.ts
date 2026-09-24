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
  MODAL_ONLY_SURFACES,
  appPluginNames,
  clearsOpenState,
  countHardwareBackHandlers,
  findBackExitViolations,
  findBlankReturnViolations,
  findBodyReplacingModalMounts,
  findFlowMountsMissingBackCallback,
  findPredictiveBackOptOutViolations,
  findSplitDismissalAuthority,
  findUnguardedFullScreenFlows,
  findViewerMountsThatCannotClearOpenState,
  flowMountSites,
  formatBackExitViolations,
  isReturnedElement,
  pluginScanCandidates,
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
      else if (name.endsWith('.tsx') || name.endsWith('.ts') || name.endsWith('.js')) {
        files.push({
          path: path.relative(root, full),
          source: fs.readFileSync(full, 'utf8') as string,
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  // The predictive-back opt-out lives OUTSIDE src/: app.json references the plugin
  // module and the plugin sets the manifest attribute, so both must be scanned.
  walk(path.join(root, 'plugins'));
  files.push({ path: 'app.json', source: readAppFile('app.json') });
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

  // The in-place flows must each own the BACK press.
  for (const path of [
    'src/screens/PieceDetailScreen.tsx',
    'src/screens/HumSearchScreen.tsx',
    'src/screens/FindPieceScreen.tsx',
    'src/screens/PracticeWeekScreen.tsx',
    'src/screens/ModernSearchScreen.tsx',
    'src/screens/AchievementsScreen.tsx',
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

// ─── 3. The blank-return contract (owner-reported blank white Home page) ─────

const HOST = 'src/screens/HomeScreen.tsx';

function blankReturnTests(): void {
  console.log('\nthe blank-return contract (blank Home body, v22 → v24)');

  assert(
    MODAL_ONLY_SURFACES.some((s) => s.component === 'ScoreViewer'),
    'the contract declares the sheet-music viewer as a modal-only surface',
  );
  assert(
    MODAL_ONLY_SURFACES.some((s) => s.component === 'ShareCard'),
    'the share card (the other modal-only surface v22 patched) is declared too',
  );

  // 1. A host that RETURNS the viewer is the empty-body path itself.
  const bodyReplacing: SourceFile = {
    path: HOST,
    source:
      'const H = () => {\n' +
      '  if (showScoreViewer) {\n' +
      '    return (\n' +
      '      <ScoreViewer url={u} onClose={() => setShowScoreViewer(false)} />\n' +
      '    );\n' +
      '  }\n' +
      '  return <View />;\n' +
      '};',
  };
  const overlay: SourceFile = {
    path: HOST,
    source:
      'const H = () => (\n' +
      '  <View>\n' +
      '    {showScoreViewer && (\n' +
      '      <ScoreViewer url={u} onClose={() => setShowScoreViewer(false)} />\n' +
      '    )}\n' +
      '    <ScrollView />\n' +
      '  </View>\n' +
      ');',
  };
  const replaced = findBodyReplacingModalMounts([bodyReplacing]);
  assertEq(replaced.length, 1, 'a host that returns the viewer is a violation');
  assertEq(
    replaced[0].kind,
    'blank-return-body-replaced',
    'the violation names the blank return',
  );
  assertEq(replaced[0].line, 4, 'the violation points at the returned viewer');
  assert(
    formatBackExitViolations(replaced)[0].includes('empty screen'),
    'the report explains the blank page in words',
  );
  assertEq(
    findBodyReplacingModalMounts([overlay]).length,
    0,
    'the same viewer mounted as an overlay inside the host body is clean',
  );
  assert(
    isReturnedElement(
      'const r = () => <ScoreViewer url={u} />;',
      'const r = () => <ScoreViewer url={u} />;'.indexOf('<'),
    ),
    'an implicit arrow return of the viewer counts as a returned element',
  );
  assert(
    !isReturnedElement(
      'const b = cond ? <A /> : <ScoreViewer url={u} />;',
      'const b = cond ? <A /> : <ScoreViewer url={u} />;'.indexOf('<ScoreViewer'),
    ),
    'a viewer inside a ternary is not a returned element',
  );

  // 2. The close it is handed must clear the state that mounts it.
  const stuck: SourceFile = {
    path: HOST,
    source:
      'const H = () => (\n' +
      '  <View>\n' +
      '    {showScoreViewer && (\n' +
      '      <ScoreViewer url={u} onClose={() => {}} />\n' +
      '    )}\n' +
      '  </View>\n' +
      ');',
  };
  const localClear: SourceFile = {
    path: HOST,
    source:
      'const H = () => {\n' +
      '  const closeViewer = useCallback(() => {\n' +
      '    setShowScoreViewer(false);\n' +
      '  }, []);\n' +
      '  return (\n' +
      '    <View>\n' +
      '      {showScoreViewer && (\n' +
      '        <ScoreViewer url={u} onClose={closeViewer} />\n' +
      '      )}\n' +
      '    </View>\n' +
      '  );\n' +
      '};',
  };
  assertEq(
    findViewerMountsThatCannotClearOpenState([stuck]).length,
    1,
    'a close callback that cannot clear the flag is a violation',
  );
  assertEq(
    findViewerMountsThatCannotClearOpenState([stuck])[0].kind,
    'mount-cannot-clear-open-state',
    'the violation names the unclearable state',
  );
  assertEq(
    findViewerMountsThatCannotClearOpenState([overlay]).length,
    0,
    'an inline setSomething(false) close is clean',
  );
  assertEq(
    findViewerMountsThatCannotClearOpenState([localClear]).length,
    0,
    'a local handler that clears the flag is resolved and accepted',
  );
  assert(
    clearsOpenState('const x = 1;', 'onClose') === true,
    'a prop handed down from a parent is accepted (out of this file)',
  );

  // 3. BACK and the on-screen close must be ONE authority.
  const split: SourceFile = {
    path: 'src/components/ScoreViewer.tsx',
    source:
      'const V = () => (\n' +
      '  <Modal visible onRequestClose={handleDismiss}>\n' +
      '    <TouchableOpacity onPress={onClose} />\n' +
      '  </Modal>\n' +
      ');',
  };
  const single: SourceFile = {
    path: 'src/components/ScoreViewer.tsx',
    source:
      'const V = () => (\n' +
      '  <Modal visible onRequestClose={onClose}>\n' +
      '    <TouchableOpacity onPress={onClose} />\n' +
      '  </Modal>\n' +
      ');',
  };
  assertEq(
    findSplitDismissalAuthority([split]).length,
    1,
    'a BACK handler that differs from the on-screen close is a violation',
  );
  assertEq(
    findSplitDismissalAuthority([split])[0].kind,
    'split-dismissal-authority',
    'the violation names the split dismissal',
  );
  assertEq(
    findSplitDismissalAuthority([single]).length,
    0,
    'one handler for BACK and the ✕ is clean',
  );

  // 4. The Android 16 opt-out that keeps BACK alive at all.
  const appNoPlugin: SourceFile = {
    path: 'app.json',
    source: '{"expo":{"plugins":["expo-notifications"]}}',
  };
  const appWithPlugin: SourceFile = {
    path: 'app.json',
    source: '{"expo":{"plugins":["./plugins/withAndroidBackCompat"]}}',
  };
  const plugin: SourceFile = {
    path: 'plugins/withAndroidBackCompat.js',
    source:
      "const A = 'android:enableOnBackInvokedCallback';\n" +
      "module.exports = (c) => (c.$[A] = 'false', c);",
  };
  const pluginReverted: SourceFile = {
    path: 'plugins/withAndroidBackCompat.js',
    source:
      "const A = 'android:enableOnBackInvokedCallback';\n" +
      "module.exports = (c) => (c.$[A] = 'true', c);",
  };
  assertEq(
    appPluginNames(appWithPlugin.source).length,
    1,
    'the plugin module is read out of app.json',
  );
  assertEq(
    findPredictiveBackOptOutViolations([appNoPlugin]).length,
    1,
    'app.json with no opt-out plugin is a violation',
  );
  assert(
    findPredictiveBackOptOutViolations([appNoPlugin])[0].message.includes(
      'KEYCODE_BACK',
    ),
    'the failure explains that the platform stops dispatching the back key',
  );
  assertEq(
    findPredictiveBackOptOutViolations([appWithPlugin, plugin]).length,
    0,
    'a plugin that sets the attribute to false satisfies the contract',
  );
  assertEq(
    findPredictiveBackOptOutViolations([appWithPlugin, pluginReverted])[0].kind,
    'predictive-back-opt-out-reverted',
    'a plugin flipped back to true is reported as a reverted opt-out',
  );
  assertEq(
    findPredictiveBackOptOutViolations([])[0].kind,
    'predictive-back-opt-out-missing',
    'a scan without app.json cannot pass the opt-out check vacuously',
  );
}

function blankReturnLiveScan(files: SourceFile[]): void {
  console.log('\nblank-return live scan (the real tree)');

  for (const surface of MODAL_ONLY_SURFACES) {
    const file = files.find((f) => f.path === surface.path);
    assert(!!file, `${surface.path} (${surface.component}) is part of the scan`);
  }

  const blank = findBlankReturnViolations(files);
  if (blank.length > 0) {
    for (const line of formatBackExitViolations(blank)) console.error(`  ✗ ${line}`);
  }
  assertEq(
    blank.length,
    0,
    'no host replaces its body with a modal-only surface, every close clears its flag, and every dismissal is one authority',
  );

  for (const path of [HOST, 'src/screens/PieceDetailScreen.tsx', 'src/components/RecognitionResultView.tsx']) {
    const file = files.find((f) => f.path === path);
    assert(
      !!file && /showScoreViewer && /.test(file.source),
      `${path} mounts the sheet viewer as a condition, not as its returned body`,
    );
  }

  // SABOTAGE: put the body-replacement early return back into the REAL Home
  // source and prove the guard fails on it.
  const home = files.find((f) => f.path === HOST);
  assert(!!home, 'HomeScreen.tsx is in the scan');
  const anchor = '  if (showDetail && dailyChallenge) {';
  assert(
    !!home && home.source.includes(anchor),
    'the sabotage anchor (Home\u2019s piece-page branch) is present',
  );
  const sabotaged = home
    ? home.source.replace(
        anchor,
        '  if (showScoreViewer && dailyChallenge) {\n' +
          '    return (\n' +
          '      <ScoreViewer url={u} title={t} composer={c} onClose={() => setShowScoreViewer(false)} />\n' +
          '    );\n' +
          '  }\n' +
          anchor,
      )
    : '';
  const sabotageViolations = findBodyReplacingModalMounts([
    { path: HOST, source: sabotaged },
  ]);
  assertEq(
    sabotageViolations.length,
    1,
    'SABOTAGE: the real Home source with the body-replacement return back in FAILS the guard',
  );

  // SABOTAGE: an unclearable close on the real mount.
  const sabotageStuck = home
    ? home.source.replace('onClose={() => setShowScoreViewer(false)}', 'onClose={() => {}}')
    : '';
  assertEq(
    findViewerMountsThatCannotClearOpenState([{ path: HOST, source: sabotageStuck }])
      .length >= 1,
    true,
    'SABOTAGE: a Home mount whose close cannot clear the flag FAILS the guard',
  );

  console.log('\nthe predictive-back opt-out (Android 16 + targetSdk 36)');

  const appConfig = files.find((f) => f.path === 'app.json');
  const pluginName = appConfig
    ? appPluginNames(appConfig.source).find((n) => n.includes('BackCompat'))
    : undefined;
  assert(!!pluginName, 'app.json references the Android back-compat plugin');
  const pluginFile = pluginName
    ? pluginScanCandidates(pluginName)
        .map((candidate) => files.find((f) => f.path === candidate))
        .find((f) => f !== undefined)
    : undefined;
  assert(!!pluginFile, 'the referenced plugin module is in the scan');
  assert(
    !!pluginFile &&
      /enableOnBackInvokedCallback/.test(pluginFile.source) &&
      /['"]false['"]/.test(pluginFile.source),
    'the plugin sets the manifest attribute to false (RN 0.76 needs the legacy back dispatch)',
  );
  assertEq(
    findPredictiveBackOptOutViolations(files).length,
    0,
    'the live tree carries the predictive-back opt-out',
  );
}

function main2(files: SourceFile[]): void {
  blankReturnTests();
  blankReturnLiveScan(files);
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== hardware BACK exits in-place full-screen flows ===');
  detectorTests();
  liveScanTests();
  main2(appSources());
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
