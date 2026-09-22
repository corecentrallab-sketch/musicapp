/**
 * Tests for the pass-2 (retry / resample) contract of the "Find any song" flow
 * — src/services/recognitionRetry.ts + src/services/modernRetryContract.ts.
 *
 * The bug these guard (owner-reproduced on device, 09-22): after a first pass
 * returned "No modern song found", a SECOND pass showed NOTHING — no loading, no
 * result, no error, no retry. The screen just sat there. Every failure in that
 * path was silent (`if (!started) return;`), so `npm run test:tier1` was green
 * while the flow was a dead end. These tests are written so the PRE-FIX code
 * fails them:
 *
 *   1. FLOW tests — every capture failure maps to a non-empty, honest surface;
 *      a retry while a start/request is in flight is refused (never a second
 *      capture stacked on the first); the "getting the mic ready" window has
 *      words instead of an inert screen.
 *   2. CONTRACT tests — fixtures of the pre-fix source lines (`if (!started)
 *      return;`, `await recording.stopAndUnloadAsync();`, a bare
 *      `setTimeout(() => handleStart(), 300)`) are flagged, and the fixed forms
 *      are not.
 *   3. LIVE SCAN — the real src/screens/ModernSearchScreen.tsx and
 *      src/hooks/useAudioRecorder.ts are read off disk and audited, with floors
 *      so a broken walk cannot pass vacuously.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  IDLE_SURFACE,
  isPermissionFailure,
  micBusy,
  micHint,
  planRetry,
  planTap,
  shouldSurfaceStopFailure,
  startFailure,
  startFailureSurface,
  stopFailure,
  stopFailureSurface,
  START_FAILURE_COPY,
  STOP_FAILURE_COPY,
  type StartFailureReason,
  type StopFailureReason,
} from '../src/services/recognitionRetry';
import {
  findSilentStartReturns,
  findUnboundedStops,
  retryTimerTracked,
  startResultIdentifiers,
  startTearsDownStaleRecording,
  type SourceFile,
} from '../src/services/modernRetryContract';

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

const START_REASONS: StartFailureReason[] = [
  'permission-denied',
  'permission-timeout',
  'permission-error',
  'busy',
  'start-error',
];
const STOP_REASONS: StopFailureReason[] = ['no-recording', 'no-uri', 'empty'];

// ─── 1. Honest copy + surfaces ──────────────────────────────────

function surfaceTests(): void {
  console.log('\nfailure copy (honest words, no thresholds)');

  for (const reason of START_REASONS) {
    const message = START_FAILURE_COPY[reason];
    assert(!!message && message.length > 12, `start copy for ${reason} is a sentence`);
    assert(!/%/.test(message), `start copy for ${reason} quotes no percentage`);
    assert(
      /try again|settings|retry/i.test(message),
      `start copy for ${reason} tells the user what to do next`,
    );
  }
  for (const reason of STOP_REASONS) {
    const message = STOP_FAILURE_COPY[reason];
    assert(!!message && message.length > 12, `stop copy for ${reason} is a sentence`);
    assert(!/%/.test(message), `stop copy for ${reason} quotes no percentage`);
  }
  assertEq(
    startFailure('busy').message,
    START_FAILURE_COPY.busy,
    'startFailure() carries its canonical message',
  );
  assertEq(
    stopFailure('empty').message,
    STOP_FAILURE_COPY.empty,
    'stopFailure() carries its canonical message',
  );
  assert(
    /move closer/i.test(STOP_FAILURE_COPY.empty),
    'the empty-capture message tells the user to move closer to the music',
  );

  console.log('\npermission classification');

  assert(isPermissionFailure('permission-denied'), 'a denied permission keeps its Settings path');
  assert(isPermissionFailure('permission-timeout'), 'a permission timeout keeps its Settings path');
  assert(!isPermissionFailure('busy'), 'a busy start is not a permission problem');
  assert(!isPermissionFailure('start-error'), 'a start error is not a permission problem');

  console.log('\nstart-failure surface (THE dead-end guard)');

  for (const reason of START_REASONS) {
    const surface = startFailureSurface(startFailure(reason));
    assert(
      typeof surface.error === 'string' && surface.error.length > 0,
      `a ${reason} start failure produces a NON-EMPTY error surface`,
    );
    assertEq(surface.loading, false, `a ${reason} start failure is not left loading`);
    assertEq(surface.recognized, false, `a ${reason} start failure claims no match`);
    assertEq(surface.match, null, `a ${reason} start failure has no match object`);
  }
  assert(
    !!startFailureSurface(null).error,
    'even an unknown start failure (no reason recorded) still surfaces words',
  );
  assertEq(
    startFailureSurface(null).error,
    START_FAILURE_COPY['start-error'],
    'an unknown start failure falls back to the canonical copy',
  );

  console.log('\nstop-failure surface');

  for (const reason of STOP_REASONS) {
    const surface = stopFailureSurface(stopFailure(reason));
    assert(
      typeof surface.error === 'string' && surface.error!.length > 0,
      `a ${reason} stop failure produces a NON-EMPTY error surface`,
    );
    assertEq(surface.loading, false, `a ${reason} stop failure drops the spinner`);
  }
  assert(
    !!stopFailureSurface(null).error,
    'an unknown stop failure still surfaces words',
  );
  assertEq(
    stopFailureSurface(null).error,
    STOP_FAILURE_COPY['no-recording'],
    'an unknown stop failure falls back to the canonical copy',
  );

  console.log('\ncontrol bits');

  assertEq(IDLE_SURFACE.error, null, 'the idle surface carries no error');
  assertEq(IDLE_SURFACE.loading, false, 'the idle surface is not loading');
}

// ─── 2. The pass-2 decision ─────────────────────────────────────

function planTests(): void {
  console.log('\nmic tap routing');

  assertEq(
    planTap({ recording: false, starting: false, requestInFlight: false }),
    'start',
    'an idle tap starts a capture',
  );
  assertEq(
    planTap({ recording: true, starting: false, requestInFlight: false }),
    'stop',
    'a tap while capturing stops it (tap-to-stop unchanged)',
  );
  assertEq(
    planTap({ recording: false, starting: true, requestInFlight: false }),
    'wait',
    'a tap while a start is in flight does NOT stack a second capture',
  );
  assertEq(
    planTap({ recording: false, starting: false, requestInFlight: true }),
    'wait',
    'a tap while the recognition request is in flight does NOT stack a capture',
  );
  assertEq(
    planTap({ recording: true, starting: true, requestInFlight: false }),
    'wait',
    'a start in flight outranks a stale recording flag',
  );

  console.log('\nretry routing');

  assertEq(
    planRetry({ recording: false, starting: false, requestInFlight: false }),
    'start',
    'Try Again with nothing running starts the next pass',
  );
  assertEq(
    planRetry({ recording: true, starting: false, requestInFlight: false }),
    'start',
    'Try Again with a stale recorder still starts (the hook tears it down first) — it never turns into a stop',
  );
  assertEq(
    planRetry({ recording: false, starting: true, requestInFlight: false }),
    'wait',
    'Try Again while a start is already in flight does not stack a second capture',
  );
  assertEq(
    planRetry({ recording: false, starting: false, requestInFlight: true }),
    'wait',
    'Try Again while a request is in flight does not start a capture underneath it',
  );

  console.log('\nphantom-stop rule');

  assert(
    shouldSurfaceStopFailure('empty', { interstitialVisible: false, requestInFlight: false }),
    'an empty capture is surfaced when nothing else is on screen',
  );
  assert(
    shouldSurfaceStopFailure('no-uri', { interstitialVisible: true, requestInFlight: false }),
    'a failed save is surfaced even with a surface up (it is a real failure)',
  );
  assert(
    !shouldSurfaceStopFailure('no-recording', { interstitialVisible: true, requestInFlight: false }),
    'a stray stop with a result already on screen does NOT replace the result',
  );
  assert(
    !shouldSurfaceStopFailure('no-recording', { interstitialVisible: false, requestInFlight: true }),
    'a stray stop during an in-flight request does NOT clobber it',
  );
  assert(
    shouldSurfaceStopFailure('no-recording', { interstitialVisible: false, requestInFlight: false }),
    'a stray stop with nothing on screen is still reported (never silent)',
  );

  console.log('\nmic hint (no inert window)');

  const idleHint = micHint({ recording: false, starting: false, checkingPermissions: false });
  const recordingHint = micHint({ recording: true, starting: false, checkingPermissions: false });
  const startingHint = micHint({ recording: false, starting: true, checkingPermissions: false });
  const checkingHint = micHint({ recording: false, starting: false, checkingPermissions: true });

  assert(idleHint.includes('8–12s'), 'the idle hint keeps the 8–12s capture guidance');
  assert(
    idleHint.startsWith('Tap the mic and play the music around you'),
    'the idle hint keeps its original wording',
  );
  assert(
    recordingHint.includes('tap again to stop'),
    'the recording hint keeps tap-to-stop wording',
  );
  assert(!!startingHint && startingHint.length > 0, 'the STARTING state has words (was silent)');
  assert(!!checkingHint && checkingHint.length > 0, 'the permission-check state has words');
  assertEq(startingHint, checkingHint, 'starting and permission-check read the same');
  assert(
    startingHint !== idleHint,
    'the starting state is NOT indistinguishable from idle (the pass-2 silence)',
  );

  console.log('\nmic availability');

  assert(
    micBusy({ recording: false, starting: true, checkingPermissions: false }),
    'the mic is unavailable while a start is in flight',
  );
  assert(
    micBusy({ recording: false, starting: false, checkingPermissions: true }),
    'the mic is unavailable while permissions are being checked',
  );
  assert(
    !micBusy({ recording: true, starting: false, checkingPermissions: false }),
    'a live capture can ALWAYS be stopped by tapping the mic',
  );
  assert(
    !micBusy({ recording: false, starting: false, checkingPermissions: false }),
    'the mic is available when the screen is idle',
  );
}

// ─── 3. Contract scanner fixtures (pre-fix code must be caught) ──

function fixtureTests(): void {
  console.log('\npre-fix source is caught (silent start return)');

  // Verbatim from the pre-fix ModernSearchScreen.handleStart (master 3f7a905):
  const preFixScreen: SourceFile = {
    path: 'src/screens/ModernSearchScreen.tsx',
    source: [
      'const handleStart = useCallback(async () => {',
      '  if (recorder.isRecording) { handleStop(); return; }',
      '  setRecording(false);',
      '  const started = await recorder.startRecording();',
      '  if (!started) return;',
      '  setRecording(true);',
      '  timeoutRef.current = setTimeout(() => handleStop(), RECORDING_TIMEOUT_MS);',
      '}, [recorder.isRecording, recorder.startRecording]);',
    ].join('\n'),
  };

  const flagged = findSilentStartReturns([preFixScreen]);
  assertEq(flagged.length, 1, 'the pre-fix `if (!started) return;` is flagged');
  assertEq(flagged[0].line, 5, 'it names the offending line');
  assert(
    flagged[0].problem.includes('silent dead end'),
    'it says why it matters (the retry becomes a silent dead end)',
  );
  assertEq(
    startResultIdentifiers(preFixScreen.source).join(','),
    'started',
    'the start result identifier is recognised',
  );

  const fixedScreen: SourceFile = {
    path: 'src/screens/Fixed.tsx',
    source: [
      'const started = await recorder.startRecording();',
      'if (!started) {',
      '  const failure = recorder.takeStartFailure();',
      '  setInterstitial(startFailureSurface(failure));',
      '  setShowInterstitial(true);',
      '  return;',
      '}',
    ].join('\n'),
  };
  assertEq(
    findSilentStartReturns([fixedScreen]).length,
    0,
    'the fixed form (surface then return) is not flagged',
  );

  const commented: SourceFile = {
    path: 'src/screens/Comment.tsx',
    source: [
      '// const started = await recorder.startRecording();',
      '// if (!started) return;',
      'const started = await recorder.startRecording();',
      'if (!started) { setError(x); return; }',
    ].join('\n'),
  };
  assertEq(
    findSilentStartReturns([commented]).length,
    0,
    'a commented-out dead end is not flagged (comments are masked)',
  );

  console.log('\npre-fix source is caught (unbounded stop)');

  const preFixHook: SourceFile = {
    path: 'src/hooks/useAudioRecorder.ts',
    source: [
      'try {',
      '  await recording.stopAndUnloadAsync();',
      '} catch {',
      '  // swallowed',
      '}',
    ].join('\n'),
  };
  const unbounded = findUnboundedStops([preFixHook]);
  assertEq(unbounded.length, 1, 'the pre-fix unbounded stopAndUnloadAsync() is flagged');
  assert(
    unbounded[0].problem.includes('never resolve'),
    'it explains that an unbounded stop can never resolve',
  );
  assertEq(
    findUnboundedStops([
      {
        path: 'src/hooks/Fixed.ts',
        source: 'await withTimeout(recording.stopAndUnloadAsync().catch(() => undefined), 5000, undefined);',
      },
    ]).length,
    0,
    'the bounded form is not flagged',
  );
  assertEq(
    findUnboundedStops([
      {
        path: 'src/hooks/Unmount.ts',
        source: 'return () => { recordingRef.current.stopAndUnloadAsync().catch(() => {}); };',
      },
    ]).length,
    0,
    'a fire-and-forget cleanup (not awaited) is not flagged',
  );

  console.log('\nretry timer tracking fixture');

  const bareRetry: SourceFile = {
    path: 'src/screens/Bare.tsx',
    source: [
      'const handleRetry = useCallback(() => {',
      '  setShowInterstitial(false);',
      '  setInterstitial(IDLE_INTERSTITIAL);',
      '  setTimeout(() => handleStart(), 300);',
      '}, [handleStart]);',
    ].join('\n'),
  };
  assertEq(
    retryTimerTracked(bareRetry.source),
    false,
    'a bare 300ms setTimeout is NOT tracked (the pre-fix race)',
  );

  console.log('\nstale-recording teardown fixture');

  assertEq(
    startTearsDownStaleRecording('const startRecording = async () => { const r = new Audio.Recording(); };'),
    false,
    'a start that creates a recorder without tearing down the previous one is flagged',
  );
  assertEq(
    startTearsDownStaleRecording(
      [
        'const startRecording = useCallback(async () => {',
        '  if (recordingRef.current) {',
        '    const stale = recordingRef.current;',
        '    recordingRef.current = null;',
        '    await releaseRecording(stale);',
        '  }',
        '  const recording = new Audio.Recording();',
        '}, []);',
      ].join('\n'),
    ),
    true,
    'a start that releases the stale recorder first passes',
  );
}

// ─── 4. Live scan of the real app source ────────────────────────

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

/** Every .ts/.tsx under src/ plus App.tsx — the app's own source. */
function appSources(): SourceFile[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: SourceFile[] = [];

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir) as string[];
    for (const name of entries) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
        files.push({
          path: path.relative(root, full),
          source: fs.readFileSync(full, 'utf8') as string,
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  files.push({
    path: 'App.tsx',
    source: fs.readFileSync(path.join(root, 'App.tsx'), 'utf8') as string,
  });
  return files;
}

/**
 * Screens that still drop a failed `startRecording()` on the floor (the same
 * silent-dead-end pattern this fix removes from the modern path). They are
 * tracked here so a NEW offender fails this suite immediately, while the
 * remaining debt (out of scope — HomeScreen's own recognition start path is a
 * separate follow-up) can be paid down later. When one of them is fixed, remove
 * it from this list: the suite then keeps it clean.
 *
 * HumSearchScreen came OFF this list with the HUM → MODERN bridge pass: its
 * failed start now lands on the honest error card (humStartFailureOutcome(),
 * src/services/humBridge.ts) and the assertion below keeps it that way.
 */
const KNOWN_SILENT_START_OFFENDERS = ['src/screens/HomeScreen.tsx'];

function liveScanTests(): void {
  console.log('\nlive scan of the app source');

  const files = appSources();
  assert(files.length >= 25, `scanned ${files.length} app source files (≥ 25)`);

  const modernScreen = files.find(
    (f) => f.path === 'src/screens/ModernSearchScreen.tsx',
  );
  const humScreen = files.find((f) => f.path === 'src/screens/HumSearchScreen.tsx');
  const hook = files.find((f) => f.path === 'src/hooks/useAudioRecorder.ts');
  assert(!!modernScreen, 'src/screens/ModernSearchScreen.tsx is part of the scan');
  assert(!!humScreen, 'src/screens/HumSearchScreen.tsx is part of the scan');
  assert(!!hook, 'src/hooks/useAudioRecorder.ts is part of the scan');

  // Floors: the scan must actually see the pass-2 code it is auditing.
  const identifiers = files.flatMap((f) => startResultIdentifiers(f.source));
  assert(
    identifiers.length >= 3,
    `found ${identifiers.length} startRecording() result checks across the app (≥ 3)`,
  );

  const silent = findSilentStartReturns(files);
  const unexpected = silent.filter(
    (v) => KNOWN_SILENT_START_OFFENDERS.indexOf(v.path) < 0,
  );
  for (const v of unexpected) {
    console.error(`  ✗ FAILED: ${v.path}:${v.line} — ${v.problem} (${v.snippet})`);
  }
  assertEq(
    unexpected.length,
    0,
    'no screen drops a failed recording start silently (outside the tracked backlog)',
  );
  assertEq(
    silent.filter((v) => v.path === 'src/screens/ModernSearchScreen.tsx').length,
    0,
    'the modern "Find any song" screen surfaces every failed start',
  );
  // HumSearchScreen was removed from the tracked backlog in the same pass: it
  // must now be clean on its own, NOT because the allowlist still covers it.
  assertEq(
    silent.filter((v) => v.path === 'src/screens/HumSearchScreen.tsx').length,
    0,
    'the hum "Hum it" screen surfaces every failed start (no longer allowlisted)',
  );
  assertEq(
    KNOWN_SILENT_START_OFFENDERS.indexOf('src/screens/HumSearchScreen.tsx'),
    -1,
    'HumSearchScreen is no longer exempt from the silent-start contract',
  );
  for (const v of silent) {
    console.log(
      `    · tracked backlog: ${v.path}:${v.line} — ${v.snippet}`,
    );
  }

  const unbounded = findUnboundedStops(files);
  for (const v of unbounded) {
    console.error(`  ✗ FAILED: ${v.path}:${v.line} — ${v.problem} (${v.snippet})`);
  }
  assertEq(
    unbounded.length,
    0,
    'no recorder stop can hang the caller for ever',
  );

  assert(
    !!hook && startTearsDownStaleRecording(hook.source),
    'startRecording() releases any recorder still held before creating a new one',
  );
  assert(
    !!modernScreen && retryTimerTracked(modernScreen.source),
    'the retry auto-start is tracked in a ref and cleared',
  );
  assert(
    !!modernScreen && modernScreen.source.includes('startNewPass'),
    'the retry path starts a fresh pass (it never routes into a stop)',
  );
  assert(
    !!hook && hook.source.includes('takeStartFailure'),
    'the hook exposes the start failure to the caller without a stale state read',
  );
  assert(
    !!hook && /withTimeout\(/.test(hook.source) && /STOP_UNLOAD_TIMEOUT_MS/.test(hook.source),
    'every native wait in the hook is bounded',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log(
    '\n=== modern retry / resample contract (a second pass must never be silent) ===',
  );
  surfaceTests();
  planTests();
  fixtureTests();
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
