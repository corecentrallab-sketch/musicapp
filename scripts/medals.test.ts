/**
 * medals.test.ts — the guard for the MEDALS & ACHIEVEMENTS layer
 * (owner-approved 08-25; the retention/"desire" build that rides the
 * closed-test builds after v25).
 *
 * Layout, like scripts/frontDoor.test.ts and scripts/recognitionRetry.test.ts:
 *   1. THE CATALOG — thresholds, names, and the proof that they are SOURCED from
 *      the engines that measure them (streaks, minutes) rather than retyped.
 *   2. EARNED ONCE, STAYS EARNED — idempotency, compound crossings, records that
 *      survive a broken streak, and an `earnedAt` that is never rewritten.
 *   3. PROGRESS + SHARE COPY — what the screen shows and what the card says.
 *   4. PRE-FIX FIXTURES — verbatim pre-fix source must FAIL these contracts.
 *   5. LIVE SCAN — the real screens/components off disk, with floors, so a
 *      regression in the wiring fails the gate with no emulator involved.
 *
 * Plain Node, no react-native, no network, no clock of its own. `now` is always
 * passed in, so the same input gives the same output.
 * Run with: npm run test:tier1
 */
import {
  ACHIEVEMENTS_EMPTY_COPY,
  EMPTY_MEDAL_CONTEXT,
  EMPTY_MEDAL_STATS,
  FIRST_MATCH_MEDAL_ID,
  LIBRARY_MEDAL_ID,
  LIBRARY_TARGET,
  MEDAL_COUNT,
  MEDALS,
  MEDAL_SHARE_CTA,
  MINUTES_MEDAL_IDS,
  PIECES_OPENED_MEDAL_ID,
  PIECES_OPENED_TARGET,
  STREAK_MEDAL_IDS,
  achievementsScreenWired,
  achievementsSummaryLine,
  awardMedalRecords,
  earnedMedalCount,
  earnedDateLabel,
  homeHasQuietAchievementsEntry,
  homeOpensAchievementsScreen,
  homeSurfacesMedalUnlock,
  isMedalEarned,
  medalById,
  medalCardSubtitle,
  medalCardTitle,
  medalContext,
  medalHeadline,
  medalMetricValue,
  medalProgress,
  medalProgressLabel,
  medalProgressList,
  medalRowSharesCard,
  medalShareText,
  medalStorePersists,
  medalToastNeverBlocks,
  medalToastOffersShare,
  newlyEarnedMedalIds,
  nextMedalToEarn,
  normalizeMedalStats,
  pieceDetailRecordsOpened,
  shareCardRendersMedal,
  thousands,
  type MedalRecord,
  type MedalStats,
} from '../src/services/medals';
import { STREAK_TIERS } from '../src/services/practiceStreaks';
import { MILESTONES, MILESTONE_LABELS } from '../src/services/practiceMilestones';
import { hasSingleHeroCta } from '../src/services/frontDoor';

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

/** Stats builder so each test states only the numbers it cares about. */
function stats(overrides: Partial<MedalStats> = {}): MedalStats {
  return normalizeMedalStats(overrides);
}

function record(id: string, earnedAt = '2026-09-24T00:00:00.000Z'): MedalRecord {
  return { id, earnedAt, contextTitle: null, contextSubtitle: null };
}

const NOW = '2026-09-24T09:00:00.000Z';

// ─── 1. The catalog ─────────────────────────────────────────────

function catalogTests(): void {
  console.log('\nthe medal catalog (thresholds sourced from the engines)');

  // The streak ladder IS the engine's ladder — a medal can never disagree with
  // the streak the app displays.
  const streakMedals = MEDALS.filter((medal) => medal.category === 'streak');
  assertEq(
    streakMedals.map((medal) => medal.threshold).join(','),
    STREAK_TIERS.join(','),
    `streak medals are exactly the engine tiers (${STREAK_TIERS.join(' / ')} days)`,
  );
  for (const tier of STREAK_TIERS) {
    assertEq(
      medalById(STREAK_MEDAL_IDS[tier])?.threshold,
      tier,
      `the ${tier}-day medal is at ${tier} days`,
    );
  }

  // …and the minutes ladder IS the Iron Fingers ladder.
  const minutesMedals = MEDALS.filter((medal) => medal.category === 'minutes');
  assertEq(
    minutesMedals.map((medal) => medal.threshold).join(','),
    MILESTONES.join(','),
    `minutes medals are exactly the Iron Fingers ladder (${MILESTONES.join(' / ')} minutes)`,
  );
  for (const tier of MILESTONES) {
    assertEq(
      medalById(MINUTES_MEDAL_IDS[tier])?.name,
      MILESTONE_LABELS[tier],
      `the ${tier}-minute medal keeps the engine's label ("${MILESTONE_LABELS[tier]}")`,
    );
  }
  const thousandMinutesDescription = medalById(MINUTES_MEDAL_IDS[1000])?.description ?? '';
  assert(
    thousandMinutesDescription.indexOf('1,000') > 0,
    'the 1,000-minute medal reads "1,000 minutes" (thousands separator, no Intl)',
  );
  assertEq(thousands(5000), '5,000', 'thousands() formats 5000 as 5,000');
  assertEq(thousands(0), '0', 'thousands() leaves 0 alone');

  // The repertoire medals: first match, 10 pieces opened, 25 in the library.
  assertEq(
    medalById(FIRST_MATCH_MEDAL_ID)?.threshold,
    1,
    'the first-match medal fires on the FIRST recognition',
  );
  assertEq(
    medalById(FIRST_MATCH_MEDAL_ID)?.metric,
    'recognitions',
    'the first-match medal reads recognitions',
  );
  assertEq(
    medalById(PIECES_OPENED_MEDAL_ID)?.threshold,
    PIECES_OPENED_TARGET,
    `the opened-pieces medal is at ${PIECES_OPENED_TARGET} pieces`,
  );
  assertEq(
    medalById(LIBRARY_MEDAL_ID)?.threshold,
    LIBRARY_TARGET,
    `the library medal is at ${LIBRARY_TARGET} items`,
  );

  // Sanity on the catalog itself.
  assertEq(MEDAL_COUNT, 11, '11 medals ship (5 streak + 3 minutes + 3 repertoire)');
  assertEq(new Set(MEDALS.map((m) => m.id)).size, MEDAL_COUNT, 'every medal id is unique');
  for (const medal of MEDALS) {
    assert(
      medal.name.length > 2 && medal.description.length > 8 && medal.emoji.length > 0,
      `${medal.id} has a name, a rule and an emoji`,
    );
  }
  assertEq(medalById('nope'), null, 'an unknown id resolves to null (never a guess)');
}

// ─── 2. Earned once, stays earned ───────────────────────────────

function awardTests(): void {
  console.log('\nearned once, stays earned (idempotent awards)');

  assertEq(newlyEarnedMedalIds(EMPTY_MEDAL_STATS, []).length, 0, 'a fresh install has nothing');

  const streak3 = awardMedalRecords(stats({ longestStreakDays: 3 }), [], EMPTY_MEDAL_CONTEXT, NOW);
  assertEq(streak3.unlocks.length, 1, 'a 3-day run earns exactly one medal');
  assertEq(streak3.unlocks[0].id, STREAK_MEDAL_IDS[3], '…the 3-day streak medal');
  assertEq(streak3.unlocks[0].earnedAt, NOW, 'the unlock timestamp is the injected now');

  // Idempotent: the SAME stats twice award nothing the second time.
  const again = awardMedalRecords(
    stats({ longestStreakDays: 3 }),
    streak3.records,
    EMPTY_MEDAL_CONTEXT,
    '2026-09-25T09:00:00.000Z',
  );
  assertEq(again.unlocks.length, 0, 're-running the same check awards nothing (idempotent)');
  assertEq(
    again.records[0].earnedAt,
    NOW,
    'the original earnedAt is never rewritten by a later check',
  );

  // Compound: a big jump crosses several thresholds at once.
  const marathon = awardMedalRecords(
    stats({ longestStreakDays: 100, totalMinutes: 5000 }),
    [],
    EMPTY_MEDAL_CONTEXT,
    NOW,
  );
  assertEq(
    marathon.unlocks.length,
    STREAK_TIERS.length + MILESTONES.length,
    '100 days + 5,000 minutes awards all 5 streak and all 3 minutes medals at once',
  );
  assert(
    marathon.unlocks.some((u) => u.id === STREAK_MEDAL_IDS[14]) &&
      marathon.unlocks.some((u) => u.id === MINUTES_MEDAL_IDS[1000]),
    'the crossed tiers are the real ones (14-day and 1,000-minute)',
  );

  // EARNED STAYS EARNED: the streak breaks, the library is emptied, the practice
  // history is capped away — the records do not move.
  const broken = awardMedalRecords(
    stats({ longestStreakDays: 0, currentStreakDays: 0, libraryItems: 0 }),
    streak3.records,
    EMPTY_MEDAL_CONTEXT,
    '2026-10-30T09:00:00.000Z',
  );
  assertEq(broken.unlocks.length, 0, 'a broken streak awards nothing new (no re-award)');
  assertEq(broken.records.length, 1, 'a broken streak never REMOVES a medal');
  assertEq(isMedalEarned(STREAK_MEDAL_IDS[3], broken.records), true, 'the medal is still earned');

  // The streak metric reads the LONGEST run, so a medal cannot depend on which
  // day the app happened to check.
  assertEq(
    medalMetricValue(medalById(STREAK_MEDAL_IDS[7])!, stats({ longestStreakDays: 9 })),
    9,
    'streak progress reads the longest run (9)',
  );
  assertEq(
    medalMetricValue(
      medalById(STREAK_MEDAL_IDS[7])!,
      stats({ longestStreakDays: 6, currentStreakDays: 7 }),
    ),
    7,
    'a current run that leads the collapsed history is honoured, never under-reported',
  );
  assertEq(
    newlyEarnedMedalIds(stats({ longestStreakDays: 7 }), []).includes(STREAK_MEDAL_IDS[7]),
    true,
    'a run that ENDED before this check still earns its medal',
  );

  // Minutes and repertoire are independent metrics — one medal never reads
  // another's number.
  assertEq(
    newlyEarnedMedalIds(stats({ totalMinutes: 100 }), []).join(','),
    MINUTES_MEDAL_IDS[100],
    '100 minutes earns only the 100-minute medal',
  );
  assertEq(
    newlyEarnedMedalIds(stats({ recognitions: 12 }), []).join(','),
    FIRST_MATCH_MEDAL_ID,
    'recognitions earn the first-match medal, not a 10-recognition badge nobody designed',
  );
  assertEq(
    newlyEarnedMedalIds(stats({ piecesOpened: 10 }), []).join(','),
    PIECES_OPENED_MEDAL_ID,
    '10 opened pieces earns the explorer medal (and only that one)',
  );
  assertEq(
    newlyEarnedMedalIds(stats({ libraryItems: 25 }), []).join(','),
    LIBRARY_MEDAL_ID,
    '25 library items earns the library medal',
  );

  // Context travels with the record (the share card is personal because of it).
  const withContext = awardMedalRecords(
    stats({ longestStreakDays: 7 }),
    [],
    medalContext('Für Elise', 'Beethoven'),
    NOW,
  );
  assertEq(
    withContext.unlocks[0].contextTitle,
    'Für Elise',
    'the unlock records the piece the user was working on',
  );
  assertEq(withContext.unlocks[0].contextSubtitle, 'Beethoven', '…and its composer');
  assertEq(
    awardMedalRecords(stats({ longestStreakDays: 7 }), [], medalContext('   ', ''), NOW).unlocks[0]
      .contextTitle,
    null,
    'an empty/whitespace context is null, never an empty string on a card',
  );

  // Ordering is the catalog's, so the screen never reshuffles.
  assertEq(
    marathon.records.map((r) => r.id)[0],
    STREAK_MEDAL_IDS[3],
    'records are kept in catalog order (the streak ladder first)',
  );
}

// ─── 3. Progress + the share card copy ──────────────────────────

function progressTests(): void {
  console.log('\nprogress: honest numbers on every row');

  const sevenDay = medalById(STREAK_MEDAL_IDS[7])!;
  const partial = medalProgress(sevenDay, stats({ longestStreakDays: 4 }), []);
  assertEq(partial.earned, false, 'an unearned medal reports earned=false');
  assertEq(partial.value, 4, 'its value is the real number (4)');
  assertEq(partial.remaining, 3, 'remaining is the real distance (3 more days)');
  assertEq(partial.percent, 57, 'the bar is 4/7 = 57%');
  assertEq(partial.progressLabel, '4 of 7 days in a row', 'the row line states the rule plainly');
  assert(partial.percent < 100, 'an UNEARNED medal never shows 100%');

  const earned = medalProgress(sevenDay, stats({ longestStreakDays: 30 }), [record(sevenDay.id)]);
  assertEq(earned.percent, 100, 'an earned medal fills its bar');
  assertEq(earned.remaining, 0, 'an earned medal has nothing left to do');
  assertEq(earned.earnedAt, '2026-09-24T00:00:00.000Z', 'its unlock date comes from the record');
  assertEq(
    medalProgress(sevenDay, stats({ longestStreakDays: 30 }), [record(sevenDay.id)]).value,
    7,
    'the displayed value is clamped to the threshold (7, not 30)',
  );

  // Overflow safety: a huge history must not print NaN or a negative number.
  const huge = medalProgress(
    medalById(MINUTES_MEDAL_IDS[100])!,
    normalizeMedalStats({ totalMinutes: Number.NaN, libraryItems: -5 }),
    [],
  );
  assertEq(huge.value, 0, 'a NaN stat reads as 0, never NaN on screen');
  assertEq(huge.remaining, 100, 'and its remaining distance stays the full threshold');
  assertEq(
    normalizeMedalStats({ libraryItems: -5 }).libraryItems,
    0,
    'a negative stat clamps to 0',
  );

  // Next to earn: the closest unearned medal, and null once everything is done.
  const next = nextMedalToEarn(stats({ totalMinutes: 95 }), []);
  assertEq(
    next?.medal.id,
    MINUTES_MEDAL_IDS[100],
    'the closest medal wins "next to earn" (95 minutes → the 100-minute medal)',
  );
  const allEarned = MEDALS.map((medal) => record(medal.id));
  assertEq(
    nextMedalToEarn(stats({ longestStreakDays: 200, totalMinutes: 9000, recognitions: 9, piecesOpened: 40, libraryItems: 90 }), allEarned),
    null,
    'with every medal earned there is no "next" (null, not a made-up one)',
  );
  assertEq(earnedMedalCount(EMPTY_MEDAL_STATS, allEarned), MEDAL_COUNT, 'all 11 count as earned');
  assertEq(earnedMedalCount(EMPTY_MEDAL_STATS, []), 0, 'a fresh install counts zero');
  assertEq(medalProgressList(EMPTY_MEDAL_STATS, []).length, MEDAL_COUNT, 'every medal gets a row');

  const summary = achievementsSummaryLine(
    stats({ longestStreakDays: 7, totalMinutes: 100 }),
    [],
  );
  assert(summary.indexOf('0 of 11 earned') === 0, `the entry line counts honestly ("${summary}")`);
  assert(summary.indexOf('next:') > 0, 'the entry line names the next medal');
  assertEq(
    achievementsSummaryLine(stats(), allEarned).indexOf('11 of 11') === 0,
    true,
    'the line counts the records it was given (11 of 11 with every medal earned)',
  );
  assert(ACHIEVEMENTS_EMPTY_COPY.length > 20, 'the empty state explains how to earn the first medal');
  assert(MEDAL_SHARE_CTA.indexOf('Share') > 0, 'the earned row carries a Share CTA');

  console.log('\nthe achievement card copy');

  const medal = medalById(MINUTES_MEDAL_IDS[1000])!;
  assertEq(medalHeadline(medal), `🏅 ${medal.name} unlocked!`, 'the headline names the medal');
  assertEq(
    medalCardTitle(medal, EMPTY_MEDAL_CONTEXT),
    medal.name,
    'with no context the card titles the medal itself',
  );
  assertEq(
    medalCardTitle(medal, medalContext('Für Elise', 'Beethoven')),
    'Für Elise',
    'with context the card titles the PIECE (the personal half of the loop)',
  );
  assertEq(
    medalCardSubtitle(medal, EMPTY_MEDAL_CONTEXT),
    medal.description,
    'with no context the subtitle is the rule that was satisfied',
  );
  assertEq(
    medalCardSubtitle(medal, medalContext('Für Elise', 'Beethoven')),
    'Beethoven',
    'with context the subtitle is the composer',
  );

  const shareText = medalShareText(medal, EMPTY_MEDAL_CONTEXT);
  assert(shareText.indexOf(medal.name) > 0, 'the share sentence names the medal');
  assert(shareText.indexOf('undefined') < 0, 'the share sentence never ships an undefined');
  assert(
    shareText.indexOf('%') < 0,
    'the share sentence carries no raw accuracy percentage (copy rule)',
  );
  const withPiece = medalShareText(medal, medalContext('Für Elise', 'Beethoven'));
  assert(withPiece.indexOf('Für Elise') > 0, 'with context the share sentence names the piece');
  assert(
    medalShareText(medal, medalContext(null, null)).indexOf('null') < 0,
    'a null context never leaks the word "null" into a shared sentence',
  );

  assertEq(
    earnedDateLabel('2026-09-24T00:00:00.000Z'),
    '24 Sep 2026',
    'an unlock date renders without Intl',
  );
  assertEq(earnedDateLabel(''), null, 'an empty timestamp has no date label');
  assertEq(earnedDateLabel('not-a-date'), null, 'a corrupt timestamp has no date label');
}

// ─── 4. Pre-fix fixtures (verbatim pre-fix source must FAIL) ────

/**
 * Verbatim from origin/master (76db8f2) — the Home badge toast as it shipped
 * before the medals layer, and the Practice-today card that used to be the next
 * thing in the body. Neither knows anything about medals.
 */
const PREFIX_HOME_EXCERPT = [
  '      {/* Badge toast overlay */}',
  '      <BadgeToast',
  "        badge={badgeToast ?? { id: '', name: '', description: '', emoji: '' }}",
  '        visible={badgeToast !== null}',
  '        onDismiss={() => setBadgeToast(null)}',
  '      />',
  '        {/* ⏱️ Practice today — tappable (v19 bug: this card looked tappable and',
  '            did nothing). Opens today\'s featured piece: the sheet reader when the',
  '            catalog has a curated score, else the piece page with the coach; when',
  '            no featured piece loaded it opens Find-a-Piece. */}',
  '        <TouchableOpacity',
  '          style={styles.practiceCard}',
  '          onPress={handlePracticeTodayTap}',
].join('\n');

/** Verbatim from origin/master: ShareCard had no medal block at all. */
const PREFIX_SHARE_CARD_EXCERPT = [
  'interface ShareCardProps {',
  '  /** Label under the minutes stat (default "min today"). */',
  '  minutesLabel?: string;',
  '}',
  '',
  'export const ShareCard: React.FC<ShareCardProps> = ({',
  '  minutesLabel,',
  '}) => {',
].join('\n');

/** Verbatim from origin/master: PieceDetailScreen never recorded an opened piece. */
const PREFIX_PIECE_DETAIL_EXCERPT = [
  '  }, [showScoreViewer]);',
  '  /**',
  '   * When ScoreViewer closes, check if the user practiced long enough',
  '   * to warrant a share prompt. Only shows once per session.',
  '   */',
].join('\n');

/** A half-fix: the entry card exists but sits ABOVE the one-button front door. */
const ENTRY_ABOVE_HERO_FIXTURE = [
  "import { AchievementsScreen } from '../screens/AchievementsScreen';",
  'const line = achievementsSummaryLine(stats, records);',
  '<TouchableOpacity style={styles.achievementsCard} onPress={handleOpenAchievements}>',
  '  {ACHIEVEMENTS_ENTRY_LABEL}',
  '</TouchableOpacity>',
  '<TouchableOpacity style={styles.recognitionCard} onPress={handleHeroTap}>',
].join('\n');

/** A fork: the toast grew a MODAL (an unlock that interrupts play). */
const BLOCKING_TOAST_FIXTURE = [
  '<Modal visible={visible} onRequestClose={onDismiss}>',
  '  <Animated.View pointerEvents="auto">',
  '    <Text>{badge.name}</Text>',
  '  </Animated.View>',
  '</Modal>',
].join('\n');

/** A fork: a medals screen with a retyped catalog and no shared rules. */
const HARDCODED_MEDALS_SCREEN_FIXTURE = [
  "const MEDALS = ['3-Day Streak', '7-Day Streak', '100-Day Streak'];",
  "const ACHIEVEMENTS_EMPTY_COPY = 'No medals yet.';",
  'export const AchievementsScreen = () => <View />;',
].join('\n');

/** A store that TRIMS the earned records — a medal could be lost. */
const TRIMMING_STORE_FIXTURE = [
  "const MEDAL_RECORDS_KEY = 'notesnap:medals:earned:v1';",
  "const OPENED_PIECES_KEY = 'notesnap:medals:opened-pieces:v1';",
  'const records = (await AsyncStorage.getItem(MEDAL_RECORDS_KEY)) ?? [];',
  'const kept = records.slice(0, 5);',
  'await AsyncStorage.setItem(MEDAL_RECORDS_KEY, JSON.stringify(kept));',
].join('\n');

function prefixFixtureTests(): void {
  console.log('\nthe pre-fix sources must FAIL these contracts');

  assertEq(
    homeSurfacesMedalUnlock(PREFIX_HOME_EXCERPT),
    false,
    'pre-fix Home (no medal toast, no share action) fails the unlock contract',
  );
  assertEq(
    homeHasQuietAchievementsEntry(PREFIX_HOME_EXCERPT),
    false,
    'pre-fix Home (no achievements entry) fails the entry contract',
  );
  assertEq(
    homeOpensAchievementsScreen(PREFIX_HOME_EXCERPT),
    false,
    'pre-fix Home cannot open the medals screen',
  );
  assertEq(
    shareCardRendersMedal(PREFIX_SHARE_CARD_EXCERPT),
    false,
    'pre-fix ShareCard (no medal block) fails the card contract',
  );
  assertEq(
    pieceDetailRecordsOpened(PREFIX_PIECE_DETAIL_EXCERPT),
    false,
    'pre-fix PieceDetailScreen records no opened piece',
  );
  assertEq(
    homeHasQuietAchievementsEntry(ENTRY_ABOVE_HERO_FIXTURE),
    false,
    'HALF-FIX: an entry card ABOVE the front door is rejected (the hero stays the hero)',
  );
  assertEq(
    medalToastNeverBlocks(BLOCKING_TOAST_FIXTURE),
    false,
    'HALF-FIX: a toast that grew a Modal is rejected (an unlock never blocks play)',
  );
  assertEq(
    achievementsScreenWired(HARDCODED_MEDALS_SCREEN_FIXTURE),
    false,
    'HALF-FIX: a medals screen with a retyped catalog is rejected',
  );
  assertEq(
    medalStorePersists(TRIMMING_STORE_FIXTURE),
    false,
    'HALF-FIX: a store that trims the earned records is rejected (medals are never removed)',
  );
}

// ─── 5. Live scan of the real app source ────────────────────────

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
  console.log('\nlive scan of the real screens and components');

  const medalsModule = readAppFile('src/services/medals.ts');
  const store = readAppFile('src/services/medalStore.ts');
  const screen = readAppFile('src/screens/AchievementsScreen.tsx');
  const home = readAppFile('src/screens/HomeScreen.tsx');
  const shareCard = readAppFile('src/components/ShareCard.tsx');
  const toast = readAppFile('src/components/BadgeToast.tsx');
  const pieceDetail = readAppFile('src/screens/PieceDetailScreen.tsx');

  // Floors: the walk must actually see the files it audits.
  assert(medalsModule.length > 8000, `read medals.ts (${medalsModule.length} chars)`);
  assert(store.length > 3000, `read medalStore.ts (${store.length} chars)`);
  assert(screen.length > 3000, `read AchievementsScreen.tsx (${screen.length} chars)`);
  assert(home.length > 20000, `read HomeScreen.tsx (${home.length} chars)`);
  assert(shareCard.length > 8000, `read ShareCard.tsx (${shareCard.length} chars)`);
  assert(toast.length > 1500, `read BadgeToast.tsx (${toast.length} chars)`);
  assert(pieceDetail.length > 5000, `read PieceDetailScreen.tsx (${pieceDetail.length} chars)`);

  console.log('\nthe medals surface');

  assertEq(
    achievementsScreenWired(screen),
    true,
    'the medals screen renders the catalog + progress + next-to-earn from the shared module',
  );
  assertEq(
    medalRowSharesCard(screen),
    true,
    'an EARNED medal row shares the achievement card (the viral loop)',
  );
  assert(
    /useHardwareBack\s*\(/.test(screen),
    'the medals screen owns the Android BACK press (it replaces Home\u2019s body in place)',
  );

  console.log('\nthe share card is EXTENDED, not forked');

  assertEq(
    shareCardRendersMedal(shareCard),
    true,
    'ShareCard renders a medal block when given one (no second share card)',
  );
  assert(
    shareCard.indexOf(`from '../services/shareCardShare'`) > 0,
    'the medal card still shares through the ORIGINAL share-decision module',
  );

  console.log('\nthe unlock is a banner, never a modal');

  assertEq(
    medalToastNeverBlocks(toast),
    true,
    'the toast has no Modal and stays pointer-transparent without an action',
  );
  assertEq(medalToastOffersShare(toast), true, 'the toast exposes the Share action when given one');
  assertEq(homeSurfacesMedalUnlock(home), true, 'Home feeds the toast the fresh medal + its share');

  console.log('\nHome: the front door stays the hero');

  assertEq(
    homeHasQuietAchievementsEntry(home),
    true,
    'the achievements entry is quiet, wired, and sits BELOW the one-button front door',
  );
  assertEq(homeOpensAchievementsScreen(home), true, 'Home opens the medals screen (BACK included)');
  assertEq(
    hasSingleHeroCta(home),
    true,
    'the one-button front door is still the ONLY primary CTA on Home',
  );
  assert(
    home.indexOf('checkAndAwardMedals(') > 0,
    'Home runs the same idempotent medal check as the medals screen',
  );

  console.log('\nthe ledger + persistence');

  assertEq(
    pieceDetailRecordsOpened(pieceDetail),
    true,
    'opening a piece writes the local opened-pieces ledger (the 10-piece medal is real)',
  );
  assertEq(
    medalStorePersists(store),
    true,
    'the store persists both keys and can never trim an earned medal away',
  );
  assert(
    store.indexOf('AsyncStorage.setItem(MEDAL_RECORDS_KEY') > 0,
    'earned medals are written to AsyncStorage (state survives restarts)',
  );
}

// ─── main ───────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== MEDALS & ACHIEVEMENTS (earned once, stays earned) ===');
  catalogTests();
  awardTests();
  progressTests();
  prefixFixtureTests();
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
