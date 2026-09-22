/**
 * Tests for the HUM → MODERN bridge (owner-approved 09-22) and the hum screen's
 * start-failure contract — src/services/humBridge.ts.
 *
 * The two things guarded here:
 *
 *   1. THE BRIDGE. "Hum it" matches a hummed melody against OUR (small) melody
 *      catalog only, so a miss used to be a dead end: "No match for that hum"
 *      with nothing but retry and close. Recognition must not be capped by the
 *      size of our own library, so the no-match card now offers the modern
 *      "Find any song" route (its own recorder + the licensed fingerprint
 *      service), where the actual recording is identified and the official sheet
 *      music is linked. The reverse lever (modern → hum) already existed.
 *   2. THE SILENT START. PR #115 found this screen still had the pre-fix
 *      `const started = await recorder.startRecording(); if (!started) return;`
 *      — a failed start (denied mic, a start that threw, a tap eaten while
 *      another start was in flight) set NOTHING, so the screen sat there
 *      unchanged. It now lands on the honest error card, and HumSearchScreen has
 *      been removed from the silent-start allowlist in
 *      scripts/recognitionRetry.test.ts.
 *
 * Written so the PRE-FIX code fails these tests: the pre-fix card/start bodies
 * are reproduced verbatim (master 76cbf43) as fixtures, and the real
 * src/screens/*.tsx are read off disk and audited with floors, so a broken walk
 * cannot pass vacuously.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  HUM_RETRY_CTA,
  HUM_TO_MODERN_BLURB,
  HUM_TO_MODERN_CTA,
  humNoMatchActions,
  humNoMatchOffersModern,
  humStartFailureOutcome,
  humStartFailureSurfaced,
  hostStillWiresModernToHum,
  hostWiresHumBridge,
} from '../src/services/humBridge';
import {
  findSilentStartReturns,
  startResultIdentifiers,
  type SourceFile,
} from '../src/services/modernRetryContract';
import {
  startFailure,
  type StartFailureReason,
} from '../src/services/recognitionRetry';

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

// ─── 1. The no-match card's actions ─────────────────────────────

function actionTests(): void {
  console.log('\nhum no-match card — retry AND the modern route');

  const actions = humNoMatchActions();
  const ids = actions.map((a) => a.id);
  assert(ids.length >= 2, 'the card offers more than one way forward');
  assertEq(actions[0].id, 'retry', 'the first action is still the hum retry');
  assert(
    ids.indexOf('find-any-song') >= 0,
    'the card exposes a switch-to-modern action (the bridge)',
  );
  assertEq(
    actions[actions.length - 1].id,
    'find-any-song',
    'the bridge is the last / most prominent way out of the dead end',
  );

  const bridge = actions.filter((a) => a.id === 'find-any-song')[0];
  assertEq(bridge.label, HUM_TO_MODERN_CTA, 'the bridge label comes from the constant');
  assertEq(bridge.blurb, HUM_TO_MODERN_BLURB, 'the bridge blurb comes from the constant');
  assertEq(actions[0].label, HUM_RETRY_CTA, 'the retry label is unchanged');

  console.log('\nbridge copy (honest, no overclaim)');

  assert(
    HUM_TO_MODERN_CTA.length > 6 && HUM_TO_MODERN_CTA.length < 40,
    'the CTA is a short button label, not a sentence',
  );
  assert(
    /play the song/i.test(HUM_TO_MODERN_CTA),
    'the CTA names the actual action: play the song instead of humming',
  );
  assert(!/%/.test(HUM_TO_MODERN_CTA), 'the CTA quotes no percentage');
  assert(!/%/.test(HUM_TO_MODERN_BLURB), 'the blurb quotes no percentage');
  assert(
    /sheet music/i.test(HUM_TO_MODERN_BLURB),
    'the blurb says what the route is FOR: the sheet music',
  );
  assert(
    /identif/i.test(HUM_TO_MODERN_BLURB),
    'the blurb says we identify the RECORDING (not that the piece is in our library)',
  );
  assert(
    /if there is a match|if we find|when there is a match/i.test(HUM_TO_MODERN_BLURB),
    'the blurb is conditional — it never promises a sheet-music link',
  );
  assert(
    !/guarantee|instantly|always|free of charge/i.test(HUM_TO_MODERN_BLURB),
    'the blurb carries no promise we cannot keep',
  );
}

// ─── 2. A failed start always reaches a surface ─────────────────

function startFailureTests(): void {
  console.log('\nstart failure → an honest error card, never silence');

  for (const reason of START_REASONS) {
    const outcome = humStartFailureOutcome(startFailure(reason));
    assertEq(outcome.stage, 'error', `a ${reason} start failure lands on the error card`);
    assert(
      typeof outcome.message === 'string' && outcome.message.length > 12,
      `a ${reason} start failure carries a real sentence`,
    );
    assert(!/%/.test(outcome.message), `the ${reason} message quotes no percentage`);
  }

  const unknown = humStartFailureOutcome(null);
  assertEq(unknown.stage, 'error', 'a failure the hook could not describe still shows the card');
  assert(
    unknown.message.length > 12,
    'a failure with no recorded reason still has honest words (never empty)',
  );
  assertEq(
    unknown.keepHookError,
    false,
    'with no reason we do not leave a stale hook error on screen',
  );

  console.log('\npermission problems keep the "Open Settings" affordance');

  assert(
    humStartFailureOutcome(startFailure('permission-denied')).keepHookError,
    'a denied microphone keeps the hook error (its Open Settings button)',
  );
  assert(
    humStartFailureOutcome(startFailure('permission-timeout')).keepHookError,
    'a permission timeout keeps the Open Settings affordance',
  );
  assert(
    humStartFailureOutcome(startFailure('permission-error')).keepHookError,
    'a permission-check throw keeps the Open Settings affordance',
  );
  assertEq(
    humStartFailureOutcome(startFailure('busy')).keepHookError,
    false,
    'a busy start is surfaced once, not as a permission problem',
  );
  assertEq(
    humStartFailureOutcome(startFailure('start-error')).keepHookError,
    false,
    'a start error is surfaced once, not as a permission problem',
  );
}

// ─── 3. Contract scanner fixtures (the PRE-FIX source must fail) ─

function fixtureTests(): void {
  console.log('\npre-fix hum screen is caught (the silent start return)');

  // Verbatim from the pre-fix HumSearchScreen.handleStart (master 76cbf43).
  const preFixHum: SourceFile = {
    path: 'src/screens/HumSearchScreen.tsx',
    source: [
      'const handleStart = useCallback(async () => {',
      '  if (recorder.isRecording) {',
      '    handleStop();',
      '    return;',
      '  }',
      '  setErrorMessage(null);',
      '  setOutcome(null);',
      '  const started = await recorder.startRecording();',
      '  if (!started) return;',
      "  setStage('recording');",
      '  timeoutRef.current = setTimeout(() => handleStop(), RECORDING_TIMEOUT_MS);',
      '}, [recorder.isRecording, recorder.startRecording]);',
    ].join('\n'),
  };

  assertEq(
    startResultIdentifiers(preFixHum.source).join(','),
    'started',
    'the pre-fix start result identifier is recognised',
  );
  assertEq(
    findSilentStartReturns([preFixHum]).length,
    1,
    'the pre-fix `if (!started) return;` is flagged by the shared scanner',
  );
  assertEq(
    humStartFailureSurfaced(preFixHum.source),
    false,
    'the pre-fix hum screen does NOT surface a failed start (this test would fail on it)',
  );

  const fixedHum: SourceFile = {
    path: 'src/screens/HumSearchScreen.tsx',
    source: [
      'const started = await recorder.startRecording();',
      'if (!started) {',
      '  const failedStart = humStartFailureOutcome(recorder.takeStartFailure());',
      '  if (!failedStart.keepHookError) recorder.clearError();',
      '  setErrorMessage(failedStart.message);',
      '  setStage(failedStart.stage);',
      '  return;',
      '}',
    ].join('\n'),
  };
  assertEq(
    humStartFailureSurfaced(fixedHum.source),
    true,
    'the fixed form (surface, then return) passes the contract',
  );
  assertEq(
    findSilentStartReturns([fixedHum]).length,
    0,
    'the fixed form is not flagged as a silent start',
  );

  const setsButDoesNotReturn: SourceFile = {
    path: 'src/screens/HalfFixed.tsx',
    source: [
      'const started = await recorder.startRecording();',
      'if (!started) {',
      '  setErrorMessage(HUM_START_FAILED);',
      '}',
      "setStage('recording');",
    ].join('\n'),
  };
  assertEq(
    humStartFailureSurfaced(setsButDoesNotReturn.source),
    false,
    'a branch that sets an error but carries on into the recording stage does not count',
  );

  console.log('\npre-fix no-match card is caught (retry only, no bridge)');

  // The card as it was before this pass (retry, then close — no way onward).
  const preFixCard = [
    "{stage === 'no-match' && outcome && (",
    '  <View style={styles.resultCard}>',
    '    <Text style={styles.resultTitle}>No match for that hum</Text>',
    '    <Text style={styles.resultText}>{humNoMatchMessage(outcome)}</Text>',
    '    <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>',
    '      <Text style={styles.primaryBtnText}>Hum Again</Text>',
    '    </TouchableOpacity>',
    '  </View>',
    ')}',
  ].join('\n');

  assertEq(
    humNoMatchOffersModern(preFixCard),
    false,
    'the pre-fix no-match card offers no way out of the hum flow',
  );

  const fixedCard = [
    "{stage === 'no-match' && outcome && (",
    '  <View style={styles.resultCard}>',
    '    <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>',
    '      <Text style={styles.primaryBtnText}>{HUM_RETRY_CTA}</Text>',
    '    </TouchableOpacity>',
    '    <TouchableOpacity style={styles.bridgeBtn} onPress={onSwitchToModern}>',
    '      <Text style={styles.bridgeBtnText}>{HUM_TO_MODERN_CTA}</Text>',
    '      <Text style={styles.bridgeBtnHint}>{HUM_TO_MODERN_BLURB}</Text>',
    '    </TouchableOpacity>',
    '  </View>',
    ')}',
  ].join('\n');

  assertEq(
    humNoMatchOffersModern(fixedCard),
    true,
    'the fixed no-match card carries the switch-to-modern action',
  );

  const commentedBridge = [
    "{stage === 'no-match' && outcome && (",
    '  <View>',
    '    {/* TODO: onPress={onSwitchToModern} — {HUM_TO_MODERN_CTA} */}',
    '    <TouchableOpacity onPress={handleRetry} />',
    '  </View>',
    ')}',
  ].join('\n');
  assertEq(
    humNoMatchOffersModern(commentedBridge),
    false,
    'a commented-out bridge is not mistaken for a real one (comments are masked)',
  );

  const bridgeElsewhere = [
    "{stage === 'result' && outcome && (",
    '  <TouchableOpacity onPress={onSwitchToModern}>{HUM_TO_MODERN_CTA}</TouchableOpacity>',
    ')}',
    '',
    "{stage === 'no-match' && outcome && (",
    '  <TouchableOpacity onPress={handleRetry}>Hum Again</TouchableOpacity>',
    ')}',
  ].join('\n');
  assertEq(
    humNoMatchOffersModern(bridgeElsewhere),
    false,
    'the bridge wired to some OTHER stage does not satisfy the no-match contract',
  );

  console.log('\nhost wiring contract');

  const preFixHost = "<HumSearchScreen onClose={() => setShowHumSearch(false)} />";
  assertEq(
    hostWiresHumBridge(preFixHost),
    false,
    'the pre-fix host renders HumSearchScreen with no switch prop',
  );
  assertEq(
    hostWiresHumBridge(
      [
        '<HumSearchScreen',
        '  onClose={() => setShowHumSearch(false)}',
        '  onSwitchToModern={handleSwitchToModernFromHum}',
        '/>',
      ].join('\n'),
    ),
    true,
    'the fixed host passes the switch prop through',
  );
  assertEq(
    hostStillWiresModernToHum(
      [
        '<ModernSearchScreen',
        '  onClose={() => setShowModernSearch(false)}',
        '  onHumIt={handleHumItFromModern}',
        '  onBrowseLibrary={handleBrowseLibraryFromModern}',
        '/>',
      ].join('\n'),
    ),
    true,
    'the reverse lever (modern → hum) is recognised',
  );
  assertEq(
    hostStillWiresModernToHum('<ModernSearchScreen onClose={onClose} />'),
    false,
    'a modern screen with no hum lever is flagged',
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

function readRepoFile(relative: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), relative), 'utf8') as string;
}

function hostHandlerBody(hostSource: string): string {
  const start = hostSource.indexOf('const handleSwitchToModernFromHum');
  if (start < 0) return '';
  const end = hostSource.indexOf('}, []);', start);
  return end < 0 ? hostSource.slice(start) : hostSource.slice(start, end);
}

function liveScanTests(): void {
  console.log('\nlive scan — the real hum screen and its host');

  const humSource = readRepoFile('src/screens/HumSearchScreen.tsx');
  const hostSource = readRepoFile('src/screens/HomeScreen.tsx');

  assert(humSource.length > 2000, `read src/screens/HumSearchScreen.tsx (${humSource.length} chars)`);
  assert(hostSource.length > 2000, `read src/screens/HomeScreen.tsx (${hostSource.length} chars)`);

  // Floors: the scan must actually see the code it is auditing.
  const humIdents = startResultIdentifiers(humSource);
  assert(
    humIdents.length >= 1,
    `found ${humIdents.length} startRecording() result check(s) in the hum screen (≥ 1)`,
  );
  assert(
    humSource.indexOf('humNoMatchMessage') >= 0,
    'the hum screen still shows the honest banded no-match copy',
  );

  console.log('\nthe bridge is wired on the real screen');

  assertEq(
    humNoMatchOffersModern(humSource),
    true,
    'the real no-match card offers the switch-to-modern action',
  );
  assert(
    humSource.indexOf('onSwitchToModern: () => void') >= 0,
    'HumSearchScreen declares the onSwitchToModern prop',
  );
  assert(
    /onPress=\{onSwitchToModern\}/.test(humSource),
    'the bridge button calls onSwitchToModern',
  );
  assert(
    humSource.indexOf('HUM_TO_MODERN_CTA') >= 0 &&
      humSource.indexOf('HUM_TO_MODERN_BLURB') >= 0,
    'the card renders the shared CTA + blurb constants (one source of truth)',
  );

  console.log('\nthe silent start is gone from the real screen');

  assertEq(
    findSilentStartReturns([{ path: 'src/screens/HumSearchScreen.tsx', source: humSource }]).length,
    0,
    'no bare `if (!started) return;` remains in the hum screen',
  );
  assertEq(
    humStartFailureSurfaced(humSource),
    true,
    'the real hum screen surfaces a failed start (honest error card)',
  );
  assert(
    /setStage\(failedStart\.stage\)/.test(humSource) &&
      /setErrorMessage\(failedStart\.message\)/.test(humSource),
    'the failure path sets both the stage and the message (never a silent return)',
  );
  assert(
    humSource.indexOf('humStartFailureOutcome') >= 0,
    'the hum screen uses the shared start-failure mapping',
  );

  console.log('\nthe host hands the user into the modern flow (with a BACK path)');

  assertEq(
    hostWiresHumBridge(hostSource),
    true,
    'HomeScreen renders HumSearchScreen with the switch prop',
  );
  assert(
    /onSwitchToModern=\{handleSwitchToModernFromHum\}/.test(hostSource),
    'the hum screen is bound to the dedicated swap handler',
  );
  const body = hostHandlerBody(hostSource);
  assert(
    body.indexOf('setShowHumSearch(false)') >= 0 && body.indexOf('setShowModernSearch(true)') >= 0,
    'the swap closes the hum flow and opens the modern flow (one flow at a time)',
  );
  assertEq(
    hostStillWiresModernToHum(hostSource),
    true,
    'the reverse lever (modern → hum) is still wired (this pass did not touch it)',
  );
  assert(
    /<ModernSearchScreen[\s\S]*?onClose=\{\(\) => setShowModernSearch\(false\)\}/.test(hostSource),
    "the modern flow keeps its own onClose — the BACK path out of the swapped-in screen",
  );

  console.log('\nthe allowlist no longer covers HumSearchScreen');

  const gateSource = readRepoFile('scripts/recognitionRetry.test.ts');
  const listStart = gateSource.indexOf('const KNOWN_SILENT_START_OFFENDERS');
  assert(listStart >= 0, 'the silent-start allowlist is still declared in the gate');
  const listEnd = gateSource.indexOf(']', listStart);
  const allowlist = listStart >= 0 && listEnd > listStart ? gateSource.slice(listStart, listEnd) : '';
  assertEq(
    allowlist.indexOf('HumSearchScreen') < 0,
    true,
    'HumSearchScreen is NOT in the silent-start allowlist (the fix, not the exemption)',
  );
  assert(
    allowlist.indexOf('HomeScreen') >= 0,
    "HomeScreen is still tracked there (its own start path is a separate follow-up)",
  );
  assert(
    gateSource.indexOf("silent.filter((v) => v.path === 'src/screens/HumSearchScreen.tsx')") >= 0,
    'the gate now asserts the hum screen stays clean on its own',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== hum → modern bridge + the hum screen\'s silent start ===');
  actionTests();
  startFailureTests();
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
