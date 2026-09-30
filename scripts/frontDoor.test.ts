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
  HUM_ENTRY_HANDLER,
  HUM_ENTRY_STYLE,
  HUM_FALLBACK_LIBRARY_NOTE,
  HUM_FALLBACK_PROMPT,
  HUM_SECONDARY_CTA,
  RIVAL_MODE_HANDLERS,
  DEMO_BUTTON_STYLE,
  DEMO_HANDLER,
  demoButtonHiddenInProd,
  elementWithMarker,
  findPieceIsSearchEntry,
  findPieceOpensScreen,
  frontDoorStartFailure,
  hasSingleHeroCta,
  heroAccessibilityLabel,
  heroButtonWired,
  heroLabel,
  heroRunsHybridPipeline,
  heroStartFailureSurfaced,
  heroStaysIdentifyFirst,
  heroState,
  heroSupport,
  heroTapAction,
  heroTitle,
  homePromiseCopy,
  homePromiseRendered,
  humEntryWired,
  humFallbackIsInline,
  humMatchToResultResponse,
  noMatchOffersNextStep,
  CAPTURE_MODES,
  RETIRED_HUM_ONLY_COPY,
  captureModesNamed,
  copyNamesAllCaptureModes,
  captureCopyIsHonest,
  humOnlyCopyRetired,
} from '../src/services/frontDoor';
import {
  HUM_CLOSE_MESSAGE,
  HUM_DEFAULT_NO_MATCH_REASON,
  humOutcome,
  type HumOutcome,
} from '../src/services/tier1';
import { HUM_RETRY_CTA, HUM_TO_MODERN_BLURB } from '../src/services/humBridge';
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
  const secondaryCta: string = HUM_SECONDARY_CTA;
  assert(
    copyNamesAllCaptureModes(secondaryCta) &&
      secondaryCta !== (HERO_CTA_HUM as string),
    'the hum way in is offered as a labelled SECONDARY affordance naming all three modes, never the primary CTA',
  );
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

  console.log('\npre-fix Home source is caught: the hero quietly BECOMES "Tap to hum it"');
  // Verbatim pre-fix shape (v25): an ambient miss, and the no-clip case, both arm
  // the hum fallback behind the user's back — so the big red button's job (and
  // its label) changes without anyone choosing it. That is the defect the owner
  // reported on 09-25.
  const preFixHeroJobs = [
    '  const runAmbientPipeline = useCallback(async (uri: string, diagnostics?: CaptureDiagnostics) => {',
    "        setRecognitionPhase({ type: 'no-match', message: result.no_confident_match_reason });",
    "        setHumFallback(true);",
    "        setNoMatchOffer('hum');",
    '  }, [recorder]);',
    '  const handleStopCapture = useCallback(async () => {',
    "        if (reason === 'empty') {",
    '          setNoMatchOffer(null);',
    '          setHumFallback(true);',
    '          return;',
    '        }',
    '  }, [recorder]);',
    '  const handleHumFallbackFromCard = useCallback(() => {',
    '    setHumFallback(true);',
    '  }, []);',
  ].join('\n');
  assertEq(
    heroStaysIdentifyFirst(preFixHeroJobs),
    false,
    'an ambient miss that arms hum mode behind the user fails (the big button changes job)',
  );
  const preFixEmptyOnly = [
    "        setRecognitionPhase({ type: 'no-match' });",
    "        setNoMatchOffer('hum');",
    "        if (reason === 'empty') {",
    '          setNoMatchOffer(null);',
    '          setHumFallback(true);',
    '          return;',
    '        }',
    '  const handleHumFallbackFromCard = useCallback(() => {',
    '    setHumFallback(true);',
    '  }, []);',
  ].join('\n');
  assertEq(
    heroStaysIdentifyFirst(preFixEmptyOnly),
    false,
    'a no-clip capture that arms hum and shows NO card fails (the v25 silent dead end)',
  );
  // The fixed shape (ambient miss keeps the door identify-first, the no-clip case
  // shows the honest card, the CARD is what arms hum) passes.
  const fixedHeroJobs = [
    "        setRecognitionPhase({ type: 'no-match', diagnostics: NO_AUDIO_DIAGNOSTICS });",
    "        setNoMatchOffer('hum');",
    "        if (reason === 'empty') {",
    "          setNoMatchOffer('hum');",
    "          setRecognitionPhase({ type: 'no-match', diagnostics: NO_AUDIO_DIAGNOSTICS });",
    '          setShowRecognitionResults(true);',
    '          return;',
    '        }',
    '  const handleHumFallbackFromCard = useCallback(() => {',
    '    setHumFallback(true);',
    '  }, []);',
  ].join('\n');
  assertEq(
    heroStaysIdentifyFirst(fixedHeroJobs),
    true,
    'the identify-first door passes: the card carries the hum path, the hero keeps its job',
  );

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
    '    {onHumFallback ? (<Text>{HUM_SECONDARY_CTA}</Text>) : null}',
    '    {onHumFallback ? (<Text>{HUM_FALLBACK_BUTTON}</Text>) : null}',
    '    {onFindAnySong ? (<Text>{HUM_TO_MODERN_CTA}</Text>) : null}',
    '  }',
    '  const topMatch = phase.response.matches[0];',
  ].join('\n');
  assertEq(noMatchOffersNextStep(fixedCard), true, 'the both-ways-forward card passes');
  // A card that offers the hum affordance but does NOT label it as the
  // secondary way in fails — the identify pass is the door's primary action.
  const unlabelledHumCard = fixedCard.replace('{HUM_SECONDARY_CTA}', 'Humming');
  assertEq(
    noMatchOffersNextStep(unlabelledHumCard),
    false,
    'an unlabelled hum affordance fails (the hum button is not the primary CTA)',
  );

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
  assertEq(
    heroStaysIdentifyFirst(home),
    true,
    'the hero stays IDENTIFY-FIRST: no miss path arms hum mode behind the user',
  );
  assert(
    home.indexOf('handleHumFallbackFromCard') > 0,
    "the card's hum affordance is still the way into the hum pass (the hum path is not removed)",
  );
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
    card.indexOf('HUM_SECONDARY_CTA') >= 0,
    'the hum way in is LABELLED as the secondary affordance on the card',
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

// ─── the HOME hum entry (owner 09-25, build #3) ─────────────────

/**
 * Owner-reported (RC v26 Test 6, 09-25): "no 'Hum the melody' CTA on the home
 * screen — hum reachable only post-recognition via result-card levers". The one
 * big button was doing the right thing (identify-first), but a musician who
 * cannot play the audio at all had NO visible way in on the surface they land on.
 *
 * The contract (src/services/frontDoor.ts, humEntryWired) is deliberately
 * picky, because the fix is easy to get half right: the affordance must exist,
 * carry the labelled-secondary copy, be styled as a secondary row, render AFTER
 * the hero (never as a rival CTA), and open the EXISTING hum flow. Each of those
 * is a mutation fixture below — a fixture that must FAIL the contract, so the
 * live pass cannot be vacuous.
 */
function humEntryTests(): void {
  console.log('\nthe HOME hum entry (a visible way in for a musician who can\'t play it)');

  const hero = `<TouchableOpacity onPress={${HERO_TAP_HANDLER}} accessibilityLabel={heroAccessibilityLabel(state)} />`;
  const entry =
    `<TouchableOpacity onPress={${HUM_ENTRY_HANDLER}} style={${HUM_ENTRY_STYLE}} ` +
    `accessibilityRole="button" accessibilityLabel={HUM_SECONDARY_CTA}>` +
    `<Text>{HUM_SECONDARY_CTA}</Text></TouchableOpacity>`;
  const handler = `const ${HUM_ENTRY_HANDLER} = useCallback(() => { setShowHumSearch(true); }, []);`;

  // The shape the fix ships: handler declared, hero first, the labelled entry
  // SECOND, opening the existing hum flow.
  assertEq(
    humEntryWired(`${handler}\n${hero}\n${entry}`),
    true,
    'the hum entry renders BELOW the hero and opens the existing hum flow',
  );

  // Fixture 1 — the v26 source (no hum entry at all): the reported defect.
  assertEq(
    humEntryWired(`${hero}`),
    false,
    'PRE-FIX: a Home with only the hero has no way in for hummers (the RC v26 defect)',
  );

  // Fixture 2 — the entry above the hero would make it a RIVAL mode CTA, which
  // the owner's one-button front door forbids.
  assertEq(
    humEntryWired(`${handler}\n${entry}\n${hero}`),
    false,
    'an entry placed BEFORE the hero is a rival CTA, not a secondary path',
  );

  // Fixture 3 — wired, but to nothing: the affordance is decoration.
  assertEq(
    humEntryWired(`const ${HUM_ENTRY_HANDLER} = () => { doNothing(); };\n${hero}\n${entry}`),
    false,
    'a hum entry whose handler never opens the hum flow is not wired',
  );

  // Fixture 4 — the old rival hum opener creeping back beside the entry.
  assertEq(
    humEntryWired(`${handler}\n${hero}\n${entry}\n<TouchableOpacity onPress={handleOpenHumSearch} />`),
    false,
    'the retired rival hum opener is still rejected next to the entry',
  );

  // Fixture 5 — present but unlabelled / unstyled: it would read as a second
  // hero button rather than the labelled secondary path.
  assertEq(
    humEntryWired(
      `${handler}\n${hero}\n<TouchableOpacity onPress={${HUM_ENTRY_HANDLER}} style={styles.other}>` +
        `<Text>Hum</Text></TouchableOpacity>`,
    ),
    false,
    'the entry must carry the shared secondary label and its own style',
  );

  // ── the live Home screen ──
  const home = readAppFile('src/screens/HomeScreen.tsx');
  assert(home.length > 5000, `read HomeScreen.tsx (${home.length} chars)`);
  assertEq(humEntryWired(home), true, 'the real Home screen satisfies the hum-entry contract');
  assert(
    home.indexOf(`onPress={${HUM_ENTRY_HANDLER}}`) > 0,
    `the entry is wired to ${HUM_ENTRY_HANDLER}`,
  );
  assert(
    /<Text style=\{styles\.humEntryText\}>\{HUM_SECONDARY_CTA\}<\/Text>/.test(home),
    "the entry's visible label IS the shared secondary CTA copy (never a rival hero label)",
  );
  assert(
    /accessibilityLabel=\{HUM_SECONDARY_CTA\}/.test(home),
    'the entry is reachable to a screen reader under the same copy',
  );
  assert(
    home.indexOf(`onPress={${HUM_ENTRY_HANDLER}}`) >
      home.indexOf(`onPress={${HERO_TAP_HANDLER}}`),
    'the entry renders AFTER the one hero button (secondary path, not a rival mode)',
  );
  // The flows the entry opens are the app's ONLY hum implementation.
  assert(
    /setShowHumSearch\(true\)/.test(home) && home.indexOf('<HumSearchScreen') > 0,
    'the entry opens the EXISTING hum screen (one hum implementation, no drift)',
  );

  // Mutation on the REAL source, not a fixture: break the wiring and the contract
  // must notice (a contract that only ever sees a healthy file proves nothing).
  const broken = home.replace(
    `onPress={${HUM_ENTRY_HANDLER}}`,
    'onPress={handleHumEntryRemoved}',
  );
  assert(broken !== home, 'the mutation fixture changed the real source');
  assertEq(humEntryWired(broken), false, 'MUTATION: an unwired hum entry fails the contract');
  const closed = home.replace(
    /const handleHumEntry = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/,
    `const ${HUM_ENTRY_HANDLER} = useCallback(() => { setShowFindPiece(true); }, []);`,
  );
  assert(closed !== home, 'the handler mutation fixture changed the real handler');
  assertEq(
    humEntryWired(closed),
    false,
    'MUTATION: an entry that stops opening the hum flow fails the contract',
  );
}

// ─── the capture mode is named honestly (RC v28 Test 4b) ─────────

/**
 * Owner-reported (RC v28 Test 4b, 09-28): "A hum is a hum — a whistle is a
 * whistle and a sing is a sing." The capture surface ACCEPTS all three, but the
 * CTA read "Can't play it? Hum it" — so a whistler or a singer was told the
 * feature is not for them. The copy now names all three modes on every surface
 * that names the capture mode, and the retired hum-only strings are rejected by
 * a live scan of the real screens (with mutation probes, so a healthy file is
 * not the only thing the guard ever sees).
 */
function humLabelCopyTests(): void {
  console.log('\nthe capture mode is named honestly (hum, whistle or sing)');

  // ── the rule ──
  assertEq(CAPTURE_MODES.length, 3, 'the capture accepts exactly three named modes');
  assertEq(
    captureModesNamed('Hum, whistle or sing the melody').length,
    3,
    'the rule finds all three accepted modes in honest copy',
  );
  assertEq(
    captureCopyIsHonest("Can't play it? Hum it"),
    false,
    'PRE-FIX: the hum-only CTA is dishonest (the reported Test 4b defect)',
  );
  assertEq(captureCopyIsHonest('Hum it'), false, 'PRE-FIX: the bare "Hum it" CTA is dishonest');
  assertEq(
    captureCopyIsHonest('Humming... tap again to stop & search.'),
    false,
    'PRE-FIX: "Humming..." names one mode only',
  );
  assertEq(
    captureCopyIsHonest('hum or whistle a longer, clearer phrase and try again'),
    false,
    'PRE-FIX: two of the three modes is still the defect',
  );
  assertEq(
    captureCopyIsHonest('Recording your melody…'),
    true,
    'a mode-NEUTRAL state label is honest (it names no mode)',
  );

  // ── the copy the app ships ──
  assert(
    copyNamesAllCaptureModes(HUM_SECONDARY_CTA),
    `the shared secondary CTA names all three modes: "${HUM_SECONDARY_CTA}"`,
  );
  assert(
    copyNamesAllCaptureModes(HERO_CTA_HUM),
    `the hero's hum-fallback label names all three: "${HERO_CTA_HUM}"`,
  );
  assert(
    copyNamesAllCaptureModes(HUM_FALLBACK_HINT),
    `the fallback hint names all three: "${HUM_FALLBACK_HINT}"`,
  );
  assert(
    copyNamesAllCaptureModes(HUM_FALLBACK_PROMPT),
    `the fallback prompt names all three: "${HUM_FALLBACK_PROMPT}"`,
  );
  assert(
    copyNamesAllCaptureModes(HUM_TO_MODERN_BLURB),
    `the bridge blurb names all three: "${HUM_TO_MODERN_BLURB}"`,
  );
  assert(
    copyNamesAllCaptureModes(HUM_CLOSE_MESSAGE),
    `the close-band no-match copy names all three: "${HUM_CLOSE_MESSAGE}"`,
  );
  assert(
    copyNamesAllCaptureModes(HUM_DEFAULT_NO_MATCH_REASON),
    `the default no-match copy names all three: "${HUM_DEFAULT_NO_MATCH_REASON}"`,
  );
  assert(
    captureCopyIsHonest(HERO_CTA_HUMMING),
    `the live-capture label is mode-neutral: "${HERO_CTA_HUMMING}"`,
  );
  assert(
    captureCopyIsHonest(HUM_RETRY_CTA),
    `the retry label is mode-neutral: "${HUM_RETRY_CTA}"`,
  );
  for (const retired of RETIRED_HUM_ONLY_COPY) {
    assert(
      captureCopyIsHonest(retired) === false,
      `every retired hum-only string is rejected by the rule: "${retired}"`,
    );
  }

  // ── live scan of every surface that names the capture mode ──
  const surfaces = [
    'src/screens/HomeScreen.tsx',
    'src/components/RecognitionResultView.tsx',
    'src/screens/HumSearchScreen.tsx',
    'src/components/ModernSongInterstitial.tsx',
  ];
  for (const rel of surfaces) {
    const src = readAppFile(rel);
    assert(src.length > 4000, `read ${rel} (${src.length} chars)`);
    assertEq(humOnlyCopyRetired(src), true, `${rel} carries no retired hum-only copy`);
  }

  const home = readAppFile('src/screens/HomeScreen.tsx');
  const card = readAppFile('src/components/RecognitionResultView.tsx');
  const hum = readAppFile('src/screens/HumSearchScreen.tsx');
  const interstitial = readAppFile('src/components/ModernSongInterstitial.tsx');

  // Home + the result card render the SHARED CTA (whose copy is asserted above).
  assert(home.indexOf('HUM_SECONDARY_CTA') >= 0, 'Home renders the shared secondary CTA');
  assert(card.indexOf('HUM_SECONDARY_CTA') >= 0, 'the result card renders the shared secondary CTA');

  // The capture screen's own labels.
  assert(
    /hum, whistle or sing the melody/i.test(hum),
    'the hum screen headline names all three modes',
  );
  assert(
    /hum, whistle or sing the\s+tune/i.test(hum),
    'the capture screen intro names all three modes',
  );
  assert(
    /hum, whistle or sing a phrase/i.test(hum),
    'the capture screen idle hint names all three modes',
  );
  assert(
    hum.indexOf('Recording your melody...') >= 0,
    'the live-recording label is mode-neutral (was "Humming...")',
  );
  assert(
    hum.indexOf('No match for that melody') >= 0,
    'the no-match title is mode-neutral (was "No match for that hum")',
  );

  // The modern-song interstitial (the other reported surface).
  const cta = /Can't play it\?[^<]*/.exec(interstitial);
  assert(
    cta !== null && copyNamesAllCaptureModes(cta[0]),
    `the interstitial hum CTA names all three modes: "${cta ? cta[0].trim() : '(not found)'}"`,
  );
  assert(
    /or hum, whistle or sing the melody to find a free\s+public-domain piece/.test(interstitial),
    'the interstitial no-modern-match body names all three modes',
  );
  assert(
    interstitial.indexOf('>Hum, whistle or sing</Text>') >= 0,
    'the no-modern-match button is mode-neutral (was "Hum it")',
  );

  // ── mutation probes on the REAL sources ──
  const humOnlyHome = home.split('HUM_SECONDARY_CTA').join('"Can\'t play it? Hum it"');
  assert(humOnlyHome !== home, 'the Home mutation fixture changed the real source');
  assertEq(
    humOnlyCopyRetired(humOnlyHome),
    false,
    'MUTATION: the hum-only CTA coming back to Home fails the live scan',
  );

  const hummedCapture = hum.replace('Recording your melody...', 'Humming...');
  assert(hummedCapture !== hum, 'the capture-screen mutation fixture changed the real source');
  assertEq(
    humOnlyCopyRetired(hummedCapture),
    false,
    'MUTATION: the retired "Humming..." capture label coming back fails the live scan',
  );

  const humOnlyInterstitial = interstitial.replace(
    '>Hum, whistle or sing</Text>',
    '>Hum it</Text>',
  );
  assertEq(
    humOnlyCopyRetired(humOnlyInterstitial),
    false,
    'MUTATION: the retired "Hum it" interstitial button coming back fails the live scan',
  );
}

// ─── the dev affordance + the search entry's landing ────────────

/**
 * Two things the spec asks for that no pure-logic test can see: the demo button
 * must never reach an owner-facing (production) build, and the one secondary
 * "Find a piece" entry must still LAND on the piece search — the search box
 * gained its external "Official sheet music" results section (owner 10-01), and
 * that section is reached through this single entry, so a front-door change must
 * not quietly detach it.
 *
 * Both are live scans of the real Home screen with mutation probes on the real
 * source, so a healthy file is never the only thing the guard ever sees.
 */
function devAffordanceTests(): void {
  console.log('\nthe demo button is a dev-only shortcut');

  const gatedDemo = [
    '  const handleDemo = useCallback(async () => {',
    '    // Dev-only.',
    '    if (!__DEV__) {',
    '      return;',
    '    }',
    '    setShowRecognitionResults(true);',
    '  }, []);',
    '          {__DEV__ && !recorder.isRecording && (',
    '            <TouchableOpacity style={styles.demoBtn} onPress={handleDemo}>',
    '              <Text style={styles.demoBtnText}>🧪 Try Demo</Text>',
    '            </TouchableOpacity>',
    '          )}',
  ].join('\n');
  assertEq(demoButtonHiddenInProd(gatedDemo), true, 'the dev-gated shortcut passes');
  assert(
    gatedDemo.indexOf(`onPress={${DEMO_HANDLER}}`) >= 0 &&
      gatedDemo.indexOf(DEMO_BUTTON_STYLE) >= 0,
    'the fixture is the real demo button shape (gated render + its own handler)',
  );

  // PRE-FIX shape: the button renders unconditionally, right under the ONE hero
  // CTA — a mock-result button in an owner-facing build.
  const unGated = [
    '  const handleDemo = useCallback(async () => {',
    '    if (!__DEV__) {',
    '      return;',
    '    }',
    '  }, []);',
    '          {!recorder.isRecording && (',
    '            <TouchableOpacity style={styles.demoBtn} onPress={handleDemo}>',
    '            </TouchableOpacity>',
    '          )}',
  ].join('\n');
  assertEq(
    demoButtonHiddenInProd(unGated),
    false,
    'PRE-FIX: a demo button rendered unconditionally fails the contract',
  );

  // Half fix: the render is gated but the handler still runs in production.
  const halfGated = gatedDemo.replace('    if (!__DEV__) {\n      return;\n    }\n', '');
  assert(halfGated !== gatedDemo, 'the half-fix fixture changed the source');
  assertEq(
    demoButtonHiddenInProd(halfGated),
    false,
    'a half fix (render gate only, handler still live) is still caught',
  );

  // A second, ungated copy is the same defect wearing a different tag.
  const duplicated =
    gatedDemo +
    '\n            <TouchableOpacity style={styles.demoBtn} onPress={handleDemo}>';
  assertEq(
    demoButtonHiddenInProd(duplicated),
    false,
    'PRE-FIX: a second ungated demo button fails the contract',
  );

  // ── live scan + mutation probes on the REAL Home screen ──
  const home = readAppFile('src/screens/HomeScreen.tsx');
  assertEq(
    demoButtonHiddenInProd(home),
    true,
    'the REAL Home screen gates its demo button behind __DEV__ (dev-only shortcut)',
  );

  const unmastered = home.replace(
    '{__DEV__ && !recorder.isRecording && (',
    '{!recorder.isRecording && (',
  );
  assert(unmastered !== home, 'the demo-render mutation fixture changed the real source');
  assertEq(
    demoButtonHiddenInProd(unmastered),
    false,
    'MUTATION: the demo button losing its __DEV__ render gate FAILS the contract',
  );

  const liveHandler = home.replace(
    '    if (!__DEV__) {\n      return;\n    }\n',
    '',
  );
  assert(liveHandler !== home, 'the demo-handler mutation fixture changed the real handler');
  assertEq(
    demoButtonHiddenInProd(liveHandler),
    false,
    'MUTATION: the demo handler running in production (no `!__DEV__` bail-out) FAILS',
  );

  console.log('\nthe secondary search entry still lands on the piece search');

  assertEq(
    findPieceOpensScreen(home),
    true,
    '"Find a piece" opens FindPieceScreen (the search box keeps its landing)',
  );

  const detached = home.replace('<FindPieceScreen', '<FindPieceScreenAbsent');
  assert(detached !== home, 'the mount mutation fixture changed the real source');
  assertEq(
    findPieceOpensScreen(detached),
    false,
    'MUTATION: a search entry whose screen is not mounted FAILS (the tap opens nothing)',
  );

  const closedHandler = home.replace(
    /const handleOpenFindPiece = useCallback\(\(\) => \{\n\s*setShowFindPiece\(true\);\n\s*\}, \[\]\);/,
    'const handleOpenFindPiece = useCallback(() => {}, []);',
  );
  assert(closedHandler !== home, 'the open-handler mutation fixture changed the real handler');
  assertEq(
    findPieceOpensScreen(closedHandler),
    false,
    'MUTATION: an entry whose handler never sets the flag FAILS (a dead CTA)',
  );

  // The screen behind that one entry still carries the external retailer results
  // (owner 10-01, PR #142) — the front door must never drop it.
  const findPiece = readAppFile('src/screens/FindPieceScreen.tsx');
  assert(findPiece.length > 4000, `read FindPieceScreen.tsx (${findPiece.length} chars)`);
  assert(
    findPiece.indexOf('Official sheet music') >= 0,
    'FindPieceScreen still renders the "Official sheet music" retailer section',
  );
  assert(
    /from '\.\.\/services\/searchExternal'/.test(findPiece),
    'FindPieceScreen still resolves those results through the searchExternal service',
  );
  const stripped = findPiece.split('Official sheet music').join('Sheet music');
  assert(stripped !== findPiece, 'the external-section mutation fixture changed the real screen');
  assert(
    stripped.indexOf('Official sheet music') < 0,
    'MUTATION: dropping the retailer section is exactly what this live assert reads',
  );
}

// ─── the one-CTA contract on the REAL source ────────────────────

/**
 * The one-CTA contract is asserted on a fixture above; these are the two defects
 * a future change would realistically inject into the REAL Home screen — a rival
 * hero returning, and the search entry being promoted back into a second hero
 * button. Both must fail the contract on the real source, not just a fixture.
 */
function rivalHeroMutationTests(): void {
  console.log('\nthe one-CTA contract catches a rival hero on the REAL source');

  const home = readAppFile('src/screens/HomeScreen.tsx');
  const homeBefore = home;
  assertEq(hasSingleHeroCta(homeBefore), true, 'the real Home screen wires exactly ONE hero CTA');
  assertEq(humEntryWired(homeBefore), true, 'the real hum entry is the labelled secondary path');

  // Defect 1: the old hum opener restored as a rival button.
  const rivalHum = home.replace('onPress={handleHumEntry}', 'onPress={handleOpenHumSearch}');
  assert(rivalHum !== home, 'the rival-hum mutation fixture changed the real source');
  assertEq(
    hasSingleHeroCta(rivalHum),
    false,
    'MUTATION: a rival hum hero coming back FAILS the one-CTA contract',
  );
  assertEq(
    humEntryWired(rivalHum),
    false,
    'MUTATION: the hum path restored as a rival opener FAILS the inline-fallback contract',
  );

  // Defect 2: a SECOND hero — the search entry promoted back to the hero handler.
  const twoHeroes = home.replace('onPress={handleOpenFindPiece}', 'onPress={handleHeroTap}');
  assert(twoHeroes !== home, 'the second-hero mutation fixture changed the real source');
  assertEq(
    hasSingleHeroCta(twoHeroes),
    false,
    'MUTATION: a second hero CTA added to Home FAILS the one-CTA contract',
  );
  assertEq(
    findPieceIsSearchEntry(twoHeroes),
    false,
    'MUTATION: a promoted search entry FAILS the "search field, not a hero" contract',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== the ONE-BUTTON FRONT DOOR (one tap, no mode menu) ===');
  copyTests();
  promiseTests();
  stateTests();
  humResultTests();
  humEntryTests();
  humLabelCopyTests();
  fixtureTests();
  liveScanTests();
  rivalHeroMutationTests();
  devAffordanceTests();
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
