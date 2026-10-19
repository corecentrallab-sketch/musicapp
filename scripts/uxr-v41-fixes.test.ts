/**
 * uxr-v41-fixes.test.ts — THE v41 FIX-BATCH CONTRACTS.
 *
 * Four owner complaints from the v40 device pass (10-18), each with a guard that
 * BITES on the pre-fix code:
 *
 *  1. AUDIO ROOT CAUSE. expo-av's `AudioFocusNotAcquiredException` silenced every
 *     player (practice video, both take listen rows, the metronome). The session is
 *     now focus-safe (one pure spec), re-applied before every play, and every play
 *     goes through ONE guarded path with a single retry. Guarded here by reading
 *     the five real player sources: a play that bypasses `playWithAudioFocus`, or a
 *     screen that states a session of its own, fails the suite.
 *  2. THE EMPTY-TAKE PDF. A take with nothing usable recorded in it never becomes a
 *     file (the owner's ~8 KB empty .pdf).
 *  3. THE COVER-SCAN DEAD END. The no-match state and the licensed-retailer cards
 *     share ONE scroller, so the money path is reachable on a zero-match query.
 *  4. HOME'S TODAY'S PIECE. One card built to designer spec §1 (geometry, type,
 *     paper tile, one chevron, whole card is the target).
 *
 * Source-scan guards read the .tsx at RUNTIME, so they bite without a recompile.
 */
import {
  AUDITED_PLAYER_FILES,
  AUDIO_FOCUS_RETRY_LIMIT,
  GUARDED_PLAY_CALLEE,
  PLAYBACK_SESSION_SPEC,
  RECORDING_SESSION_SPEC,
  insideCallSpan,
  isAudioFocusError,
  playbackSessionIsFocusSafe,
  strayAudioModeCalls,
  unguardedPlayers,
  unguardedPlayCallSites,
} from '../src/services/audioFocusContract';
import {
  TAKE_PDF_MIN_MEANINGFUL_BYTES,
  TAKE_PDF_NOTHING_RECORDED_MESSAGE,
  takePdfBytesLookEmpty,
  takePdfUsableNoteCount,
  takePdfVerdict,
} from '../src/services/takePdfGuard';
import {
  TODAYS_PIECE_EYEBROW,
  noMatchSharesOneScrollerWithRetailers,
  noMatchStarvesRetailers,
  styleValue,
  todayCardBlock,
  todayCardMatchesSpec,
} from '../src/services/uxrV41Contract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ FAILED: ${label}`);
  }
}
function assertEq(actual: unknown, expected: unknown, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, ok ? label : `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let at = 0; at < 6; at += 1) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}
function walk(rel: string, out: string[]): string[] {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(repoRoot(), rel);
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(path.posix.join(rel, entry), out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path.posix.join(rel, entry));
  }
  return out;
}

// ─── 1 · THE AUDIO SESSION SPEC ─────────────────────────────────────────────

console.log('\n§1 the playback session is focus-safe (v41 item 1)');
assertEq(
  playbackSessionIsFocusSafe(PLAYBACK_SESSION_SPEC),
  true,
  'the playback session closes expo-av’s focus throw (parked in background, full AUDIOFOCUS_GAIN)',
);
assertEq(
  playbackSessionIsFocusSafe(RECORDING_SESSION_SPEC),
  true,
  'the recording session keeps the same focus-safe keys (plus the mic)',
);
assertEq(PLAYBACK_SESSION_SPEC.staysActiveInBackground, true, 'staysActiveInBackground is ON (expo-av’s "in the background" throw path is closed)');
assertEq(PLAYBACK_SESSION_SPEC.interruptionModeAndroid, 1, 'interruptionModeAndroid is the NUMERIC DoNotMix (a string is rejected by expo-av)');
assertEq(PLAYBACK_SESSION_SPEC.playsInSilentModeIOS, true, 'the iOS ringer switch cannot mute the app');
assertEq(AUDIO_FOCUS_RETRY_LIMIT, 1, 'a refused focus request is retried exactly once');
// MUTATIONS: each pre-fix key value must fail the contract.
assertEq(
  playbackSessionIsFocusSafe({ ...PLAYBACK_SESSION_SPEC, staysActiveInBackground: false }),
  false,
  'MUTATION: the v40 value (staysActiveInBackground: false) FAILS the contract',
);
assertEq(
  playbackSessionIsFocusSafe({ ...PLAYBACK_SESSION_SPEC, interruptionModeAndroid: 2 }),
  false,
  'MUTATION: duck-only focus (DuckOthers = 2) FAILS the contract',
);
assertEq(
  playbackSessionIsFocusSafe({ ...PLAYBACK_SESSION_SPEC, playsInSilentModeIOS: false }),
  false,
  'MUTATION: silent-mode-off FAILS the contract',
);

console.log('\n§1 the exception classifier reads the owner’s own device error');
assertEq(
  isAudioFocusError(
    'expo.modules.v.AudioFocusNotAcquiredException: Audio focus could not be acquired from the OS at this time.',
  ),
  true,
  'the owner’s v40 banner text is recognised as an audio-focus failure',
);
assertEq(
  isAudioFocusError(new Error('This experience is currently in the background, so audio focus could not be acquired.')),
  true,
  'the background throw message is recognised',
);
assertEq(isAudioFocusError('E_AUDIO_NOPLAYER: Player does not exist.'), false, 'an ordinary expo-av error is NOT treated as a focus failure');
assertEq(isAudioFocusError(null), false, 'null is not a focus failure');
assertEq(isAudioFocusError({ message: 'audiofocusnotacquired' }), true, 'a code-style object is recognised too');

console.log('\n§1 the guarded play path is required of every player');
const guardedFixture = `
  const { sound } = await playWithAudioFocus(async () => await sound.replayAsync());
`;
assertEq(unguardedPlayCallSites(guardedFixture), [], 'a play inside playWithAudioFocus is guarded');
const unguardedFixture = `
  await sound.replayAsync();
`;
assertEq(unguardedPlayCallSites(unguardedFixture).length, 1, 'PRE-FIX: a bare replayAsync is caught');
const loadPlayFixture = `
  await player.loadAsync({ uri }, { shouldPlay: true, volume: 1 });
`;
assertEq(unguardedPlayCallSites(loadPlayFixture).length, 1, 'PRE-FIX: a load-and-play call is a play and is caught');
const plainLoadFixture = `
  await sound.loadAsync(source);
`;
assertEq(unguardedPlayCallSites(plainLoadFixture), [], 'a plain load (no shouldPlay) is not a play');
const commentFixture = `
  // await sound.replayAsync();
  /* await player.playAsync(); */
`;
assertEq(unguardedPlayCallSites(commentFixture), [], 'a COMMENTED-OUT play never counts as a fix');
assert(insideCallSpan(guardedFixture, guardedFixture.indexOf('.replayAsync'), GUARDED_PLAY_CALLEE), 'the scanner sees the play inside the guarded call');
assert(!insideCallSpan(guardedFixture, guardedFixture.indexOf('playWithAudioFocus'), GUARDED_PLAY_CALLEE), 'the callee itself is not inside its own span');
const nestedFixture = 'await playWithAudioFocus(async () => { await playWithAudioFocus(async () => { await sound.playAsync(); }); });';
assertEq(unguardedPlayCallSites(nestedFixture), [], 'a nested guarded play is still guarded');

console.log('\n§1 live scan: the five real players');
const playerFiles: Record<string, string> = {};
for (const file of AUDITED_PLAYER_FILES) playerFiles[file] = readAppFile(file);
assertEq(AUDITED_PLAYER_FILES.length >= 5, true, `the audit covers the owner’s players (${AUDITED_PLAYER_FILES.length} files)`);
for (const file of AUDITED_PLAYER_FILES) {
  const source = playerFiles[file];
  assert(source.length > 500, `${file} was read (${source.length} chars)`);
  assert(source.indexOf(GUARDED_PLAY_CALLEE) >= 0, `${file} plays through ${GUARDED_PLAY_CALLEE}`);
}
const unguarded = unguardedPlayers(playerFiles);
assertEq(
  unguarded.map((audit) => `${audit.file} ${audit.unguarded.join(',')}`),
  [],
  'every player call-site goes through the ONE guarded play path',
);
// The metronome the owner re-flagged twice: its click is a Sound, and it is guarded.
const metronome = playerFiles['src/screens/MetronomeScreen.tsx'];
assert(metronome.indexOf('playWithAudioFocus(') >= 0, 'the metronome click is guarded');
assert(metronome.indexOf('ensurePlaybackAudioMode()') >= 0, 'the metronome still establishes the session on load');
// The tab page renders the SAME listen row (so the owner’s "no sound" on the tabs
// page is the same two players, not a third).
const tabs = readAppFile('src/components/TakeTabsView.tsx');
assert(tabs.indexOf('{listenRow}') >= 0, 'the tabbed whole-take view renders the editor’s own listen row');
const editor = readAppFile('src/components/TakeCorrectionEditor.tsx');
assert(editor.indexOf('listenRow={listenRow}') >= 0, 'the editor hands that row to the tab page');

console.log('\n§1 live scan: no surface states a session of its own');
const srcFiles = walk('src', []);
assert(srcFiles.length >= 150, `the session scan covers the whole app (${srcFiles.length} files)`);
const strays: string[] = [];
for (const file of srcFiles) {
  const source = readAppFile(file);
  const calls = strayAudioModeCalls(source);
  if (calls.length === 0) continue;
  // Only the shared session module may state the session.
  if (file === 'src/services/audioSession.ts') continue;
  strays.push(`${file}: ${calls.join(',')}`);
}
assertEq(strays, [], 'no screen/hook calls Audio.setAudioModeAsync itself (one session, one module)');
assert(
  strayAudioModeCalls(readAppFile('src/services/audioSession.ts')).length >= 1,
  'the shared session module is the one that does call setAudioModeAsync',
);
// PRE-FIX fixture: the score player used to state its own partial mode.
const strayFixure = `await Audio.setAudioModeAsync({ staysActiveInBackground: false });`;
assertEq(strayAudioModeCalls(strayFixure).length, 1, 'PRE-FIX: the score player’s own setAudioModeAsync call is caught');

// ─── 2 · THE EMPTY-TAKE PDF ─────────────────────────────────────────────────

console.log('\n§2 a take with nothing recorded never becomes a PDF (v41 item 2)');
const emptyTake = { notes: [], tempoBpm: 90, durationSec: 0, key: null, capturedAt: '' };
assertEq(takePdfUsableNoteCount(emptyTake), 0, 'an empty take holds no usable note');
assertEq(takePdfVerdict(emptyTake).refused, true, 'PRE-FIX shape: an empty take is REFUSED');
assertEq(takePdfVerdict(emptyTake).message, TAKE_PDF_NOTHING_RECORDED_MESSAGE, 'the refusal is the honest "nothing recorded" sentence');
assert(TAKE_PDF_NOTHING_RECORDED_MESSAGE.length > 30, 'that sentence actually says what happened');
assert(!/coming soon/i.test(TAKE_PDF_NOTHING_RECORDED_MESSAGE), 'no promise copy in it');
const zeroLengthTake = { notes: [{ midi: 60, startSec: 0, durationSec: 0 }], tempoBpm: 90, durationSec: 5, key: null, capturedAt: '' };
assertEq(takePdfUsableNoteCount(zeroLengthTake), 0, 'a note with no sounding length is not usable');
assertEq(takePdfVerdict(zeroLengthTake).refused, true, 'a take of only zero-length notes is REFUSED (the ~8 KB stub)');
const nanTake = { notes: [{ midi: Number.NaN, startSec: 0, durationSec: 1 }, { midi: 300, startSec: 1, durationSec: 1 }], tempoBpm: 90, durationSec: 3, key: null, capturedAt: '' };
assertEq(takePdfVerdict(nanTake).refused, true, 'notes with no real pitch are refused');
const realTake = { notes: [{ midi: 60, startSec: 0, durationSec: 0.5 }], tempoBpm: 90, durationSec: 5, key: null, capturedAt: '' };
assertEq(takePdfVerdict(realTake).refused, false, 'a take with ONE real note keeps the real PDF path');
assertEq(takePdfVerdict(realTake).usableNotes, 1, 'and it is counted honestly');
assertEq(takePdfVerdict(null).refused, true, 'no take at all is refused');
assertEq(takePdfBytesLookEmpty(new Uint8Array(TAKE_PDF_MIN_MEANINGFUL_BYTES - 1)), true, 'a stub-sized file is caught by the byte floor too');
assertEq(takePdfBytesLookEmpty(new Uint8Array(TAKE_PDF_MIN_MEANINGFUL_BYTES)), false, 'a real page passes the byte floor');
// WIRING: the export path asks the guard BEFORE it builds or shares anything.
const device = readAppFile('src/services/takeSendDevice.ts');
assert(device.indexOf('takePdfVerdict(') >= 0, 'exportTakePdfFromTake consults the guard');
const verdictAt = device.indexOf('takePdfVerdict(');
const buildAt = device.indexOf('buildTakeNotationPdf(');
assert(verdictAt >= 0 && buildAt > verdictAt, 'the guard runs BEFORE the PDF is built');
const videoSend = readAppFile('src/services/videoSendTo.ts');
assert(videoSend.indexOf('takePdfVerdict(') >= 0, 'the practice-video send sheet drops the PDF/MIDI row when nothing was recorded');

// ─── 3 · THE COVER-SCAN DEAD END ────────────────────────────────────────────

console.log('\n§3 the no-match state puts the retailer CTAs in reach (v41 item 3)');
const findPiece = readAppFile('src/screens/FindPieceScreen.tsx');
assert(findPiece.length > 4000, `FindPieceScreen was read (${findPiece.length} chars)`);
assertEq(
  noMatchSharesOneScrollerWithRetailers(findPiece),
  true,
  'the no-match block and the licensed-retailer cards live in ONE scroller',
);
assertEq(noMatchStarvesRetailers(findPiece), false, 'the live screen no longer starves the retailers');
assert(findPiece.indexOf('{EXTERNAL_NO_MATCH_HINT}') >= 0, 'the no-match state still points at the retailers');
assert(findPiece.indexOf('styles.stateBlock') >= 0, 'the state blocks are natural-height (never flex: 1)');
assert(findPiece.indexOf('styles.externalBlock') >= 0, 'the retailer cards render in the shared flow');
assert(!/externalWrap:/.test(findPiece), 'the bounded retailer frame (flexGrow: 0 / maxHeight) is gone');
// PRE-FIX FIXTURE — the exact v40 shape: a flex:1 state box plus a bounded frame.
const PRE_FIX_FIND_PIECE = `
      {status === 'empty' ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No match</Text>
          <Text style={styles.emptyText}>{NO_MATCH_MESSAGE}</Text>
          {external.visible ? (
            <Text style={styles.emptyText}>{EXTERNAL_NO_MATCH_HINT}</Text>
          ) : null}
        </View>
      ) : null}

      {external.visible ? (
        <ScrollView
          style={styles.externalWrap}
          contentContainerStyle={styles.externalContent}
          keyboardShouldPersistTaps="handled"
        >
          <SearchExternalSection section={external} onOpen={handleOpenRetailer} />
        </ScrollView>
      ) : null}
`;
const PRE_FIX_STYLES = `
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  externalWrap: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: 340,
  },
`;
const preFixScreen = PRE_FIX_FIND_PIECE + PRE_FIX_STYLES;
assertEq(
  noMatchStarvesRetailers(preFixScreen),
  true,
  'PRE-FIX: the v40 layout FAILS — the flex:1 state box pushes the retailers below the fold',
);
assertEq(
  noMatchSharesOneScrollerWithRetailers(preFixScreen),
  false,
  'PRE-FIX: the retailers were not in the no-match scroller',
);
// MUTATION: the retailers gated on `status` (the wall the fix removed).
const gatedOnStatus = findPiece.replace('{external.visible ? (\n          <View style={styles.externalBlock}>', "{status !== 'loading' && external.visible ? (\n          <View style={styles.externalBlock}>");
assertEq(gatedOnStatus !== findPiece, true, 'the status-gating mutation changed the real screen');
assertEq(
  noMatchSharesOneScrollerWithRetailers(gatedOnStatus),
  false,
  'MUTATION: gating the retailer section on `status` FAILS the contract',
);
// MUTATION: the state block becomes flexible again.
const flexibleAgain = findPiece.replace(
  `  stateBlock: {
    alignItems: 'center',`,
  `  stateBlock: {
    flex: 1,
    alignItems: 'center',`,
);
assert(flexibleAgain !== findPiece, 'the flex mutation changed the real screen');
assertEq(
  noMatchStarvesRetailers(flexibleAgain + PRE_FIX_STYLES),
  true,
  'MUTATION: a flex:1 state block starves the retailers again',
);

// ─── 4 · HOME'S TODAY'S PIECE CARD ──────────────────────────────────────────

console.log('\n§4 the Home Today’s Piece card matches designer spec §1 (v41 item 4)');
const home = readAppFile('src/screens/HomeScreen.tsx');
assert(home.length > 40000, `HomeScreen was read (${home.length} chars)`);
assertEq(todayCardMatchesSpec(home), true, 'the live card matches the spec (geometry, type, tile, chevron, one target)');
assertEq(TODAYS_PIECE_EYEBROW, 'TODAY\u2019S PIECE', 'the eyebrow copy is the spec’s, verbatim');
assert(todayCardBlock(home).indexOf('<TouchableOpacity') < 0, 'the card holds no second tap target (the chevron is only a mark)');
assertEq(styleValue(home, 'todayCard', 'borderRadius'), '18', 'radius 18');
assertEq(styleValue(home, 'todayCard', 'minHeight'), '92', '92 dp tall');
assertEq(styleValue(home, 'todayCard', 'marginHorizontal'), '16', '16 dp side margins (never touches the screen edge)');
assertEq(styleValue(home, 'todayCardTile', 'width'), '56', 'a 56 dp score tile');
assertEq(styleValue(home, 'todayCardEyebrow', 'fontSize'), '10', 'eyebrow at 10 dp');
assertEq(styleValue(home, 'todayCardPiece', 'fontSize'), '16', 'title at 16 dp');
assertEq(styleValue(home, 'todayCardComposer', 'fontSize'), '12', 'composer at 12 dp');
// MUTATIONS — each one must break the contract.
const cardMutations: Array<{ label: string; source: string }> = [
  { label: 'radius 16 (the old band’s card)', source: home.replace('borderRadius: 18,', 'borderRadius: 16,') },
  { label: 'no side margin (edge-to-edge)', source: home.replace('    marginHorizontal: 16,\n    minHeight: 92,', '    minHeight: 92,') },
  { label: 'a 44 dp tile instead of 56 dp', source: home.replace('    width: 56,\n    height: 56,', '    width: 44,\n    height: 44,') },
  { label: 'a 20 dp title (the old card)', source: home.replace(`  todayCardPiece: {
    fontSize: 16,`, `  todayCardPiece: {
    fontSize: 20,`) },
  { label: 'the chevron removed', source: home.replace('<Text style={styles.todayCardChevron}>›</Text>', '') },
  { label: 'the eyebrow removed', source: home.replace('<Text style={styles.todayCardEyebrow}>{TODAYS_PIECE_EYEBROW}</Text>', '') },
  { label: 'the tile removed', source: home.replace('<View style={styles.todayCardTile}>', '<View>') },
  { label: 'a second tap target inside the card', source: home.replace('<Text style={styles.todayCardChevron}>›</Text>', '<TouchableOpacity onPress={handlePracticeTodayTap}><Text style={styles.todayCardChevron}>›</Text></TouchableOpacity>') },
  { label: 'the CTA line back inside the card', source: home.replace('<Text style={styles.todayCardChevron}>›</Text>', '<Text style={styles.cardCta}>{todayCardCta(dailyChallenge)}</Text>') },
  { label: 'the tap moved off the card', source: home.replace('onPress={handleDailyChallengeTap}\n            activeOpacity={0.7}', 'activeOpacity={0.7}') },
  { label: 'a non-paper tile', source: home.replace(`  todayCardTile: {
    width: 56,
    height: 56,
    backgroundColor: '#ffffff',`, `  todayCardTile: {
    width: 56,
    height: 56,
    backgroundColor: '#0f3460',`) },
];
for (const mutation of cardMutations) {
  assert(mutation.source !== home, `the mutation "${mutation.label}" changed the real screen`);
  assertEq(todayCardMatchesSpec(mutation.source), false, `MUTATION: ${mutation.label} FAILS the card contract`);
}
// The band still renders exactly ONE card (no retired practice card comes back).
const bandStart = home.indexOf('testID={BAND_TEST_IDS.today}');
const bandEnd = home.indexOf('BAND_TEST_IDS.browse');
const band = bandStart >= 0 && bandEnd > bandStart ? home.slice(bandStart, bandEnd) : '';
assert(band.length > 200, `band B was located (${band.length} chars)`);
assertEq(
  (band.match(/<TouchableOpacity/g) || []).length,
  1,
  'band B holds exactly ONE tap target (the card)',
);

// ─── SUMMARY ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
