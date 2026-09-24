/**
 * Tests for the ONE-BUTTON FRONT DOOR (owner-approved 09-24) —
 * src/services/frontDoor.ts plus the two surfaces it wires
 * (src/screens/HomeScreen.tsx and src/components/RecognitionResultView.tsx).
 *
 * The bug class these guard, with no emulator available: a CTA that is never
 * wired, a rival mode button creeping back next to the one hero, the hero
 * running only half the hybrid pipeline, the hum fallback quietly detached, the
 * old genre-biased Home subtitle returning, or a failed capture start dropped
 * silently (`if (!started) return;`, tracked debt f9f8e4f3). None of those can be
 * seen by a pure-logic test — so this suite reads the app's own source text.
 *
 * Layout, like scripts/recognitionRetry.test.ts:
 *   1. COPY + DECISIONS — the pure state machine and every string.
 *   2. PRE-FIX FIXTURES — verbatim pre-fix source must FAIL these contracts.
 *   3. LIVE SCAN — the real Home screen / result card off disk, with floors so a
 *      broken walk cannot pass vacuously.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  FIND_PIECE_ENTRY_HINT,
  FIND_PIECE_ENTRY_LABEL,
  HERO_CTA_BUSY,
  HERO_CTA_HUM,
  HERO_CTA_HUMMING,
  HERO_CTA_IDENTIFY,
  HERO_CTA_LISTENING,
  HERO_TAP_HANDLER,
  HERO_TITLE,
  HERO_TITLE_HUM,
  HOME_PROMISE_ALL_GENRES,
  HOME_PROMISE_GUITAR,
  HUM_FALLBACK_BUTTON,
  HUM_FALLBACK_HINT,
  HUM_FALLBACK_LIBRARY_NOTE,
  HUM_FALLBACK_PROMPT,
  RIVAL_MODE_HANDLERS,
  elementWithMarker,
  findPieceIsSearchEntry,
  frontDoorStartFailure,
  hasSingleHeroCta,
  heroAccessibilityLabel,
  heroButtonWired,
  heroLabel,
  heroRunsHybridPipeline,
  heroStartFailureSurfaced,
  heroState,
  heroSupport,
  heroTapAction,
  heroTitle,
  homePromiseCopy,
  homePromiseRendered,
  humFallbackIsInline,
  humMatchToResultResponse,
  noMatchOffersNextStep,
} from '../src/services/frontDoor';
import {
  humOutcome,
  type HumOutcome,
} from '../src/services/tier1';
import { START_FAILURE_COPY } from '../src/services/recognitionRetry';
import { maskComments } from '../src/services/modalBackContract';
import type { HumResponse } from '../src/types';

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

// ─── 1. Copy the front door shows ────────────────────────────────

function copyTests(): void {
  console.log('\nthe hero button says ONE thing per state');

  const labels = [
    HERO_CTA_IDENTIFY,
    HERO_CTA_LISTENING,
    HERO_CTA_HUM,
    HERO_CTA_HUMMING,
    HERO_CTA_BUSY,
  ];
  for (const label of labels) {
    assert(label.length > 4, `"${label}" is a real button label`);
  }
  assertEq(
    new Set(labels).size,
    labels.length,
    'no two hero states share a label (the state is never ambiguous)',
  );
  assertEq(
    heroLabel('idle'),
    HERO_CTA_IDENTIFY,
    'idle reads "Tap to identify" (the owner-approved copy)',
  );
  assertEq(heroLabel('hum'), HERO_CTA_HUM, 'hum mode relabels the SAME button');
  assert(
    /tap/i.test(heroLabel('hum')),
    'the hum label is still an instruction on the one button',
  );

  console.log('\nthe hum fallback copy is honest and about the voice');

  assert(
    /hum/i.test(HUM_FALLBACK_PROMPT) &&
      /whistle/i.test(HUM_FALLBACK_PROMPT) &&
      /sing/i.test(HUM_FALLBACK_PROMPT),
    'the fallback prompt names hum, whistle AND sing',
  );
  assert(
    /couldn't hear it/i.test(HUM_FALLBACK_PROMPT),
    'the fallback prompt says WHY the button changed (it could not hear it)',
  );
  assert(
    !/%/.test(HUM_FALLBACK_PROMPT) && !/%/.test(HUM_FALLBACK_HINT),
    'the fallback copy quotes no percentages',
  );
  assert(
    /8–12s/.test(HUM_FALLBACK_HINT),
    'the fallback hint keeps the 8–12s capture guidance',
  );
  assert(
    /still growing/i.test(HUM_FALLBACK_LIBRARY_NOTE),
    'the fallback note keeps the honest library-size wording',
  );
  assert(
    /hum/i.test(HUM_FALLBACK_BUTTON),
    'the no-match card action is the hum fallback',
  );

  console.log('\nthe support line every state shows');

  const idle = heroSupport('idle', { isPro: false, freeRecognitions: 3 });
  const pro = heroSupport('idle', { isPro: true, freeRecognitions: 0 });
  const busy = heroSupport('busy', { isPro: false, freeRecognitions: 0 });
  assert(idle.includes('3/5 free recognitions'), 'the free tier quotes its cap');
  assert(pro.includes('Unlimited recognitions'), 'Pro reads as unlimited');
  assert(!pro.includes('/5 free'), 'Pro never shows the free-tier counter');
  assert(!!busy && busy.length > 10, 'the in-flight state has words');
  assert(
    busy !== idle,
    'the in-flight state is distinguishable from idle (never a silent wait)',
  );
  assertEq(
    heroSupport('hum', { isPro: true, freeRecognitions: 0 }),
    HUM_FALLBACK_PROMPT,
    'hum mode shows the fallback prompt',
  );
  assert(
    heroSupport('hum-listening', { isPro: true, freeRecognitions: 0 }).length > 10,
    'a live hum capture has words too',
  );
  for (const state of ['idle', 'listening', 'hum', 'hum-listening', 'busy'] as const) {
    assert(
      heroAccessibilityLabel(state).length > 10,
      `the ${state} state has a screen-reader label`,
    );
  }

  console.log('\nthe headline');

  assertEq(heroTitle('idle'), HERO_TITLE, 'the idle headline is the door promise');
  assertEq(heroTitle('hum'), HERO_TITLE_HUM, 'hum mode swaps the headline');
  assert(
    !/guitar|piano/i.test(HERO_TITLE),
    'the headline is instrument-neutral (the tool serves any instrument)',
  );
}

// ─── 2. The home promise (genre-neutral, instrument-aware) ───────

function promiseTests(): void {
  console.log('\nthe home subtitle is genre-neutral and instrument-aware');

  assert(
    !/^Curated /.test(HOME_PROMISE_ALL_GENRES) &&
      !/curated/i.test(HOME_PROMISE_ALL_GENRES),
    'the promise no longer says "Curated …"',
  );
  assert(
    /any song/i.test(HOME_PROMISE_ALL_GENRES),
    'the promise covers any song (genre-neutral front door)',
  );
  assert(
    /classical/i.test(HOME_PROMISE_ALL_GENRES),
    'the promise still names classical music as part of the range',
  );
  assert(
    /TAB/.test(HOME_PROMISE_GUITAR),
    'the guitar line promises the official TAB (the live guitar story)',
  );
  assert(
    !/free/i.test(HOME_PROMISE_GUITAR),
    'the guitar line never promises a FREE TAB library (no overclaim: the free',
  );

  assertEq(homePromiseCopy('piano'), HOME_PROMISE_ALL_GENRES, 'piano → genre-neutral line');
  assertEq(homePromiseCopy(undefined), HOME_PROMISE_ALL_GENRES, 'no answer yet → genre-neutral');
  assertEq(homePromiseCopy(null), HOME_PROMISE_ALL_GENRES, 'no onboarding → genre-neutral');
  assertEq(homePromiseCopy('guitar'), HOME_PROMISE_GUITAR, 'guitar → TAB line');
  assertEq(homePromiseCopy('both'), HOME_PROMISE_GUITAR, 'piano & guitar → TAB line');

  console.log('\nthe secondary search entry');

  assert(
    /search/i.test(FIND_PIECE_ENTRY_HINT) && /title or composer/i.test(FIND_PIECE_ENTRY_HINT),
    'the search hint says what can be typed',
  );
  assert(
    /Find a piece/i.test(FIND_PIECE_ENTRY_LABEL) && !/^Tap/i.test(FIND_PIECE_ENTRY_LABEL),
    'the search entry is not phrased as a primary action',
  );
}

// ─── 3. The hero state machine + tap routing ─────────────────────

function stateTests(): void {
  console.log('\nthe hero state machine');

  assertEq(
    heroState({ recording: false, humFallback: false, busy: false }),
    'idle',
    'a quiet door is idle',
  );
  assertEq(
    heroState({ recording: true, humFallback: false, busy: false }),
    'listening',
    'a live ambient capture is listening',
  );
  assertEq(
    heroState({ recording: false, humFallback: true, busy: false }),
    'hum',
    'an armed fallback puts the SAME button in hum mode',
  );
  assertEq(
    heroState({ recording: true, humFallback: true, busy: false }),
    'hum-listening',
    'a live hum capture is its own state',
  );
  assertEq(
    heroState({ recording: true, humFallback: false, busy: true }),
    'busy',
    'an in-flight pass outranks a stale recording flag',
  );

  console.log('\nwhat one tap does');

  assertEq(
    heroTapAction({ recording: false, humFallback: false, busy: false }),
    'start-ambient',
    'an idle tap runs the ambient pipeline',
  );
  assertEq(
    heroTapAction({ recording: false, humFallback: true, busy: false }),
    'start-hum',
    'in hum mode the tap runs the hum pass (no mode menu)',
  );
  assertEq(
    heroTapAction({ recording: true, humFallback: false, busy: false }),
    'stop',
    'a live capture can always be stopped by tapping the button',
  );
  assertEq(
    heroTapAction({ recording: false, humFallback: false, busy: true }),
    'wait',
    'a tap during an in-flight pass never stacks a second capture',
  );
  assertEq(
    heroTapAction({ recording: true, humFallback: true, busy: true }),
    'wait',
    'even a live capture waits while a pass is in flight',
  );

  console.log('\nthe honest start-failure mapping (debt f9f8e4f3)');

  const denied = frontDoorStartFailure({ reason: 'permission-denied', message: START_FAILURE_COPY['permission-denied'] });
  assert(!!denied.message && denied.message.length > 10, 'a denied mic produces words');
  assertEq(denied.keepHookError, true, 'a permission failure keeps the Open Settings path');
  const busy = frontDoorStartFailure({ reason: 'busy', message: START_FAILURE_COPY.busy });
  assertEq(busy.keepHookError, false, 'a busy start is not a permission problem');
  assertEq(
    frontDoorStartFailure(null).message,
    START_FAILURE_COPY['start-error'],
    'an unknown failure still has canonical copy (never empty)',
  );
}

// ─── 4. A hum match on the existing result card ──────────────────

function humResultTests(): void {
  console.log('\na hum match reuses the result card, honestly');

  const raw: HumResponse = {
    success: true,
    query_duration_ms: 4200,
    db_available: true,
    matches: [
      { piece_id: 'fur-elise', title: 'Für Elise', composer: 'Beethoven', confidence: 0.89 },
    ],
  };
  const outcome: HumOutcome = humOutcome(raw);
  assertEq(outcome.ok, true, 'a confident hum match is an ok outcome');

  const response = humMatchToResultResponse(raw, outcome.matches);
  assertEq(response.success, true, 'the adapted response is a success payload');
  assertEq(response.matches.length, 1, 'every hum match is carried over');
  const m = response.matches[0];
  assertEq(m.title, 'Für Elise', 'the title survives');
  assertEq(m.confidence, 0.89, 'the confidence survives');
  assertEq(m.is_public_domain, true, 'a hum match is public domain (our own library)');
  assertEq(m.purchase_url, null, 'a public-domain hum match NEVER gets a retail redirect');
  assertEq(m.sheet_music_url, null, 'no invented sheet URL — the card shows its honest state');
  assertEq(m.album_art_url, null, 'no invented album art');

  // A no-match hum must never be dressed as a match.
  const miss = humOutcome({ success: true, query_duration_ms: 900, db_available: true, matches: [] });
  assertEq(miss.ok, false, 'an empty hum result is an honest no-match');
  assertEq(
    humMatchToResultResponse(raw, miss.matches).matches.length,
    0,
    'a no-match adapts to zero matches (never a fabricated title)',
  );
}

// ─── 5. Pre-fix fixtures (the old source must FAIL these contracts) ─

function fixtureTests(): void {
  console.log('\npre-fix Home source is caught: the tier-1 row of rival buttons');

  // Verbatim shape from master (HomeScreen.tsx, pre-front-door): three rival
  // mode buttons next to the round one.
  const preFixTier1 = [
    '          {!recorder.isRecording && !recorder.checkingPermissions && (',
    '            <View style={styles.tier1Block}>',
    '              <View style={styles.tier1Row}>',
    '                <TouchableOpacity style={styles.tier1Btn} onPress={handleOpenHumSearch} activeOpacity={0.6}>',
    '                  <Text style={styles.tier1BtnText}>Hum, whistle or sing the melody</Text>',
    '                </TouchableOpacity>',
    '                <TouchableOpacity style={styles.tier1Btn} onPress={handleOpenModernSearch} activeOpacity={0.6}>',
    '                  <Text style={styles.tier1BtnText}>Find any song & get the sheet music</Text>',
    '                </TouchableOpacity>',
    '              </View>',
    '              <TouchableOpacity style={styles.findPieceBtn} onPress={handleOpenFindPiece}>',
    '                <Text style={styles.findPieceText}>Find a piece — search by title or composer</Text>',
    '              </TouchableOpacity>',
    '            </View>',
    '          )}',
  ].join('\n');
  assertEq(
    hasSingleHeroCta(preFixTier1),
    false,
    'the pre-fix rival hum/"find any song" buttons fail the one-CTA contract',
  );
  assertEq(
    humFallbackIsInline(preFixTier1),
    false,
    'the pre-fix source has no inline hum fallback (hum was a rival button)',
  );
  assertEq(
    findPieceIsSearchEntry(preFixTier1),
    false,
    'the pre-fix "Find a piece" was not wired from a search-field entry',
  );

  const fixedTier1 = [
    '          <TouchableOpacity',
    '            style={[styles.recognitionBtn, recorder.isRecording && styles.recognitionBtnActive]}',
    '            onPress={handleHeroTap}',
    '          >',
    '            <Text style={styles.recognitionBtnText}>{heroLabel(hero)}</Text>',
    '          </TouchableOpacity>',
    '          <Text style={styles.recognitionDesc}>{heroSupport(hero, { isPro, freeRecognitions })}</Text>',
    '          <TouchableOpacity style={styles.findPieceBtn} onPress={handleOpenFindPiece} accessibilityLabel={FIND_PIECE_ENTRY_LABEL}>',
    '            <Text style={styles.findPieceText}>{FIND_PIECE_ENTRY_HINT}</Text>',
    '          </TouchableOpacity>',
    '          setHumFallback(true);',
  ].join('\n');
  assertEq(hasSingleHeroCta(fixedTier1), true, 'one hero CTA passes');
  assertEq(heroButtonWired(fixedTier1), true, 'the round button is wired to the one handler');
  assertEq(humFallbackIsInline(fixedTier1), true, 'the inline fallback passes');
  assertEq(findPieceIsSearchEntry(fixedTier1), true, 'the search-field entry passes');

  console.log('\npre-fix Home source is caught: the silent start + Curated subtitle');

  const preFixStart = [
    '  const handleStartListening = useCallback(async () => {',
    '    const started = await recorder.startRecording();',
    '    if (!started) return;',
    '  }, [recorder.isRecording, recorder.startRecording]);',
  ].join('\n');
  assertEq(
    heroStartFailureSurfaced(preFixStart),
    false,
    'the pre-fix `if (!started) return;` is caught (a tap that renders nothing)',
  );
  const fixedStart = [
    '  const started = await recorder.startRecording();',
    '  if (!started) {',
    '    const failure = frontDoorStartFailure(recorder.takeStartFailure());',
    '    setRecognitionPhase({ type: "error", message: failure.message });',
    '    setShowRecognitionResults(true);',
    '    return;',
    '  }',
  ].join('\n');
  assertEq(heroStartFailureSurfaced(fixedStart), true, 'the fixed form (surface, then return) passes');
  const halfFix = [
    '  const started = await recorder.startRecording();',
    '  if (!started) { setRecognitionPhase({ type: "error", message: "x" }); }',
  ].join('\n');
  assertEq(
    heroStartFailureSurfaced(halfFix),
    false,
    'a half fix (sets an error but falls through) is still caught',
  );

  const preFixSubtitle =
    "  const genreCopy =\n    onboarding?.genres?.length\n      ? `Curated ${onboarding.genres.map((g) => g).join(', ')}`\n      : 'All genres';";
  assertEq(
    homePromiseRendered(preFixSubtitle),
    false,
    'the pre-fix "Curated …" subtitle fails the genre-neutral contract',
  );
  assertEq(
    homePromiseRendered('        <Text style={styles.subtitle}>{homePromiseCopy(onboarding?.instrument)}</Text>'),
    true,
    'the instrument-aware promise passes',
  );

  console.log('\npre-fix result card is caught: a no-match with no next step');

  const preFixCard = [
    "  if (phase.type === 'no-match') {",
    '    return (',
    '      <Modal visible transparent animationType="fade" onRequestClose={onClose}>',
    '        <View style={styles.card}>',
    '          <Text style={styles.cardTitle}>No Match Found</Text>',
    '          <View style={styles.buttonRow}>',
    '            <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>',
    '              <Text>Try Again</Text>',
    '            </TouchableOpacity>',
    '          </View>',
    '        </View>',
    '      </Modal>',
    '    );',
    '  }',
    '  const topMatch = phase.response.matches[0];',
  ].join('\n');
  assertEq(
    noMatchOffersNextStep(preFixCard),
    false,
    'the pre-fix no-match card (retry only) is a dead end and is caught',
  );
  const fixedCard = [
    "  if (phase.type === 'no-match') {",
    '    {onHumFallback ? (<Text>{HUM_FALLBACK_BUTTON}</Text>) : null}',
    '    {onFindAnySong ? (<Text>{HUM_TO_MODERN_CTA}</Text>) : null}',
    '  }',
    '  const topMatch = phase.response.matches[0];',
  ].join('\n');
  assertEq(noMatchOffersNextStep(fixedCard), true, 'the both-ways-forward card passes');

  console.log('\nthe half-pipeline is caught');

  const onlyLibrary = 'await recognizeAudio(uri);';
  assertEq(
    heroRunsHybridPipeline(onlyLibrary),
    false,
    'a hero that only runs the library pass fails (one tap must run both)',
  );
  const outOfOrder =
    'await humToSearch(uri); await recognizeAudio(uri); await recognizeModernSong(uri);';
  assertEq(
    heroRunsHybridPipeline(outOfOrder),
    false,
    'the cheap library pass must come FIRST (the hum pass is last)',
  );
  assertEq(
    heroRunsHybridPipeline(
      'await recognizeAudio(uri); await recognizeModernSong(uri); await humToSearch(uri);',
    ),
    true,
    'library → modern → hum is the front-door order',
  );

  console.log('\nthe marker helper (used by the search-entry assertion)');

  assert(
    elementWithMarker(
      '<TouchableOpacity style={styles.findPieceBtn} onPress={handleOpenFindPiece}>',
      'styles.findPieceBtn',
    ).includes('onPress={handleOpenFindPiece}'),
    'a marker resolves to its own JSX tag',
  );
  assertEq(
    elementWithMarker('nothing here', 'styles.findPieceBtn'),
    '',
    'a missing marker yields no tag (never a false pass)',
  );
}

// ─── 6. Live scan of the real app source ─────────────────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
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

function liveScanTests(): void {
  console.log('\nlive scan of the real screens');

  const home = readAppFile('src/screens/HomeScreen.tsx');
  const card = readAppFile('src/components/RecognitionResultView.tsx');
  const onboarding = readAppFile('src/screens/OnboardingScreen.tsx');
  // Floors: the walk must actually see the screens it audits.
  assert(home.length > 5000, `read HomeScreen.tsx (${home.length} chars)`);
  assert(card.length > 2000, `read RecognitionResultView.tsx (${card.length} chars)`);
  assert(onboarding.length > 2000, `read OnboardingScreen.tsx (${onboarding.length} chars)`);

  assertEq(hasSingleHeroCta(home), true, 'Home wires exactly ONE hero CTA (no rival mode buttons)');
  for (const handler of RIVAL_MODE_HANDLERS) {
    assert(
      home.indexOf(`onPress={${handler}}`) < 0,
      `${handler} is no longer a button on Home`,
    );
  }
  assertEq(heroButtonWired(home), true, 'the big round button is wired to ' + HERO_TAP_HANDLER);
  assert(
    home.indexOf(`} from '../services/frontDoor'`) > 0,
    'Home renders the front door copy/state from the shared module',
  );

  assertEq(
    heroRunsHybridPipeline(home),
    true,
    'ONE tap runs the hybrid pipeline: library match → AudD modern pass → hum fallback',
  );
  assertEq(heroStartFailureSurfaced(home), true, 'a failed capture start surfaces (no silent dead end)');
  assertEq(humFallbackIsInline(home), true, 'the hum fallback is inline on the SAME button');
  assertEq(findPieceIsSearchEntry(home), true, '"Find a piece" is the secondary search entry');
  assertEq(homePromiseRendered(home), true, 'the subtitle renders the genre-neutral promise');

  assert(
    home.indexOf('<ModernSongInterstitial') > 0 &&
      /match=\{modernSurface\.match\}/.test(home),
    'a modern match opens the EXISTING interstitial (no auto-redirect)',
  );
  assert(
    /onHumIt=\{handleHumItFromModern\}/.test(home) &&
      /onBrowseLibrary=\{handleBrowseLibraryFromModern\}/.test(home),
    'the interstitial keeps its retention levers wired',
  );
  assert(
    /<ModernSearchScreen[\s\S]*?onClose=\{\(\) => setShowModernSearch\(false\)\}/.test(home),
    'the modern "Find any song" screen is still reachable with its BACK path',
  );
  assert(
    /<HumSearchScreen[\s\S]*?onSwitchToModern=\{handleSwitchToModernFromHum\}/.test(home),
    'the hum screen is still mounted with its hum → modern bridge',
  );
  assert(
    /setShowModernSearch\(true\)/.test(home),
    'the hum → modern bridge still opens the modern screen (a miss is never a dead end)',
  );

  console.log('\nthe result card offers the next step');

  assertEq(
    noMatchOffersNextStep(card),
    true,
    'the no-match phase renders BOTH the inline hum fallback and the modern bridge',
  );
  assert(
    /onPress=\{onHumFallback\}/.test(card),
    'the hum fallback button is actually wired to its handler',
  );
  assert(
    /onPress=\{onFindAnySong\}/.test(card),
    'the modern bridge button is actually wired to its handler',
  );

  console.log('\nthe genre-bias default is gone from onboarding');

  // Comments are masked: a comment that DOCUMENTS the removed default (as the
  // real OnboardingScreen does) must not fail the gate, while real code does.
  const onboardingCode = maskComments(onboarding);
  assert(
    onboardingCode.indexOf("['classical']") < 0,
    'onboarding no longer defaults a skipped genre pick to classical',
  );
  assert(
    /genres,\n\s+completedAt/.test(onboarding),
    'onboarding saves the user\'s OWN genre picks (an empty list stays empty)',
  );

  console.log('\nthe gate itself no longer exempts Home from the silent-start rule');

  const gate = readAppFile('scripts/recognitionRetry.test.ts');
  const start = gate.indexOf('const KNOWN_SILENT_START_OFFENDERS');
  assert(start >= 0, 'the silent-start allowlist is still declared in the gate');
  const end = gate.indexOf(']', start);
  const allowlist = start >= 0 && end > start ? gate.slice(start, end) : '';
  assertEq(
    allowlist.indexOf('HomeScreen') < 0,
    true,
    'HomeScreen is NOT in the silent-start allowlist (the fix, not the exemption)',
  );
  assert(
    gate.indexOf("silent.filter((v) => v.path === 'src/screens/HomeScreen.tsx')") >= 0,
    'the gate asserts the Home front door stays clean on its own',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== the ONE-BUTTON FRONT DOOR (one tap, no mode menu) ===');
  copyTests();
  promiseTests();
  stateTests();
  humResultTests();
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
