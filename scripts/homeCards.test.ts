/**
 * Unit tests for the Home-card destination logic (src/services/homeCards.ts) —
 * the fix for the owner-reported dead cards (v19 / 0.1.14):
 *
 *   "⏱️ Practice today", "📋 This Week (x/5 days practiced)" and the
 *   "🎯 For You" block all looked tappable and did nothing.
 *
 * What is pinned here is the part a screen tap cannot be trusted to prove:
 *   • Practice today → sheet reader / piece page / Find-a-Piece fallback
 *   • the Monday→Sunday week view behind "This Week" (days, minutes, totals)
 *   • this week's coached-take summary + the copy shown for it
 *   • the For You copy reformulation (no promise of a feed that does not exist)
 *   • the streak card's destination (0 days → today's featured piece, through
 *     the same mapping as Practice today; a live streak → the week view)
 *
 * Pure module, plain Node, no react-native, no network — same convention as the
 * other scripts/*.test.ts. Run with: npm run test:tier1
 */
import {
  FIND_PIECE_CTA,
  FOR_YOU_BYLINE_DEFAULT,
  FOR_YOU_BYLINE_PERSONALISED,
  FOR_YOU_CTA,
  NO_PRACTICE_TODAY,
  OPEN_FEATURED_CTA,
  WEEK_CTA,
  WEEK_DAY_FUTURE,
  buildWeekView,
  coachedTakeCopy,
  coachedTakeSummary,
  featuredPieceCta,
  forYouAccessibilityLabel,
  forYouByline,
  historyStreakDestination,
  localDateKey,
  mondayOf,
  practiceTodayDestination,
  practiceWeekCta,
  streakAccessibilityLabel,
  streakCta,
  streakDestination,
  weekPercent,
  weekProgressCopy,
  weekDayStatusText,
  weekTotalCopy,
} from '../src/services/homeCards';

declare const process: { exit(code: number): never };
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

/**
 * Wednesday 16 Sep 2026, 10:00 local — inside the week Mon 14 → Sun 20 Sep 2026
 * (the same Monday `storage.getMondayStr` computes for that date).
 */
const WED = new Date(2026, 8, 16, 10, 0, 0);
const WEEK_DATES = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
];

// ─── "⏱️ Practice today" destination ───────────────────────────

function practiceTodayTests(): void {
  assertEq(
    practiceTodayDestination(null),
    'find-piece',
    'no featured piece (catalog unreachable) → Find-a-Piece, never a dead tap',
  );
  assertEq(
    practiceTodayDestination(undefined),
    'find-piece',
    'an undefined challenge also falls back to Find-a-Piece',
  );
  assertEq(
    practiceTodayDestination({}),
    'piece',
    'a featured piece with no curated sheet → the piece page (coach lives there)',
  );
  assertEq(
    practiceTodayDestination({ sheetMusicUrl: null }),
    'piece',
    'a null sheet URL is not a sheet',
  );
  assertEq(
    practiceTodayDestination({ sheetMusicUrl: '' }),
    'piece',
    'an empty sheet URL is not a sheet',
  );
  assertEq(
    practiceTodayDestination({ sheetMusicUrl: '   ' }),
    'piece',
    'a whitespace-only sheet URL is not a sheet (no empty reader)',
  );
  assertEq(
    practiceTodayDestination({ sheetMusicUrl: 'https://x/api/sheets/y.pdf' }),
    'sheet',
    'a curated sheet URL opens the in-app reader',
  );
  assertEq(
    practiceTodayDestination({ sheetMusicUrl: '  https://x/y.pdf  ' }),
    'sheet',
    'a padded sheet URL is still a real sheet',
  );
  assertEq(
    practiceTodayDestination({ sheetMusicUrl: 42 as unknown as string }),
    'piece',
    'a non-string sheet URL is not trusted',
  );
}

// ─── week view (📋 This Week) ──────────────────────────────────

function weekViewTests(): void {
  const empty = buildWeekView({ now: WED });
  assertEq(empty.days.length, 7, 'the week view is always Monday→Sunday (7 rows)');
  assertEq(empty.practicedCount, 0, 'no records → 0 days practised');
  assertEq(empty.minutesTotal, 0, 'no records → 0 minutes');

  assertEq(empty.days[0].date, '2026-09-14', 'the week starts on Monday the 14th');
  assertEq(empty.days[0].weekday, 'Mon', 'row 1 is labelled Mon');
  assertEq(empty.days[0].label, '14 Sep', 'row 1 carries a short human date');
  assertEq(empty.days[2].date, '2026-09-16', 'Wednesday is the third row');
  assertEq(empty.days[2].weekday, 'Wed', 'Wednesday is labelled Wed');
  assertEq(empty.days[6].date, '2026-09-20', 'the week ends on Sunday the 20th');
  assertEq(empty.days[6].weekday, 'Sun', 'row 7 is labelled Sun');

  assertEq(empty.days[2].isToday, true, 'today is flagged on its own row');
  assertEq(
    empty.days.filter((d) => d.isToday).length,
    1,
    'exactly one row is today (the header can never point at two days)',
  );
  assertEq(empty.days[0].isFuture, false, 'a past day of the week is not future');
  assertEq(empty.days[3].isFuture, true, 'Thursday (after today) is future');
  assertEq(empty.days[6].isFuture, true, 'Sunday (after today) is future');

  const practised = buildWeekView({
    now: WED,
    practiceDays: ['2026-09-15', '2026-09-16', '2026-09-08'],
  });
  assertEq(
    practised.practicedCount,
    2,
    'only this week’s practice days are counted (last week’s is ignored)',
  );
  assertEq(practised.days[1].practiced, true, 'Tue the 15th shows as practised');
  assertEq(practised.days[2].practiced, true, 'today shows as practised');
  assertEq(practised.days[0].practiced, false, 'a day with no record is not practised');
  assertEq(
    practised.days.filter((d) => d.practiced).length,
    practised.practicedCount,
    'the per-day ticks and the x-of-N count agree',
  );

  const withMinutes = buildWeekView({
    now: WED,
    practiceDays: ['2026-09-14'],
    minutesByDay: { '2026-09-14': 12.5, '2026-09-16': 7, '2026-09-08': 30 },
  });
  assertEq(withMinutes.days[0].minutes, 12.5, 'a day’s recorded minutes are shown');
  assertEq(withMinutes.days[2].minutes, 7, 'today’s minutes are shown');
  assertEq(
    withMinutes.minutesTotal,
    19.5,
    'the week total adds only this week’s minutes (last week’s 30 is excluded)',
  );
  assertEq(
    withMinutes.practicedCount,
    2,
    'minutes alone mark a day practised (the two stores can drift)',
  );

  const minutesOnly = buildWeekView({ now: WED, minutesByDay: { '2026-09-15': 4 } });
  assertEq(
    minutesOnly.practicedCount,
    1,
    'a day with minutes but no practice-day record still counts',
  );
  assertEq(minutesOnly.days[1].minutes, 4, 'that day carries its minutes');

  const junk = buildWeekView({
    now: WED,
    minutesByDay: {
      '2026-09-14': Number.NaN,
      '2026-09-15': -5,
      '2026-09-16': Number.POSITIVE_INFINITY,
      '2026-09-17': 0,
    },
    practiceDays: ['', 'not-a-date'],
  });
  assertEq(junk.minutesTotal, 0, 'NaN / negative / infinite minutes never reach a total');
  assertEq(junk.days[0].minutes, 0, 'a NaN day reads as 0 minutes');
  assertEq(junk.days[1].minutes, 0, 'a negative day reads as 0 minutes');
  assertEq(junk.practicedCount, 0, 'junk practice-day strings are not a practised day');

  const boundaries = buildWeekView({
    now: WED,
    practiceDays: ['2026-09-13', '2026-09-14', '2026-09-20', '2026-09-21'],
  });
  assertEq(
    boundaries.practicedCount,
    2,
    'the Sunday before and the Monday after fall outside the week',
  );
  assertEq(boundaries.days[0].practiced, true, 'the Monday itself is inside the week');
  assertEq(boundaries.days[6].practiced, true, 'the Sunday itself is inside the week');

  const monday = new Date(2026, 8, 14, 8, 0, 0);
  assertEq(
    buildWeekView({ now: monday }).days[0].isToday,
    true,
    'on a Monday, today is the first row of its own week',
  );
  assertEq(
    buildWeekView({ now: new Date(2026, 8, 20, 23, 30, 0) }).days[6].isToday,
    true,
    'on a Sunday night, today is still the last row of that week',
  );

  // Week that straddles a month boundary (Thu 1 Oct 2026 → Mon 28 Sep 2026).
  const october = buildWeekView({ now: new Date(2026, 9, 1, 9, 0, 0) });
  assertEq(october.days[0].date, '2026-09-28', 'a week can start in the previous month');
  assertEq(october.days[0].weekday, 'Mon', 'and it still starts on a Monday');
  assertEq(october.days[3].date, '2026-10-01', 'the month rollover lands on the right row');
  assertEq(october.days[3].label, '1 Oct', 'the day label has no zero padding');

  assertEq(localDateKey(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05', 'date keys are zero-padded');
  assertEq(
    localDateKey(mondayOf(WED)),
    '2026-09-14',
    'mondayOf(WED) is the Monday that starts the week',
  );
  assertEq(
    localDateKey(mondayOf(new Date(2026, 8, 20, 23, 0, 0))),
    '2026-09-14',
    'mondayOf(Sunday) walks back to the same Monday, not forward',
  );
}

// ─── weekly progress copy + bar ────────────────────────────────

function progressTests(): void {
  assertEq(weekProgressCopy(3, 5), '3/5 days practiced', 'the x/5 line keeps its wording');
  assertEq(weekProgressCopy(0, 5), '0/5 days practiced', 'a fresh week reads 0/5');
  assertEq(
    weekProgressCopy(7, 5),
    '7/5 days practiced',
    'extra days are shown, not silently clamped',
  );

  assertEq(weekPercent(3, 5), 60, '3 of 5 days fills the bar 60%');
  assertEq(weekPercent(10, 5), 100, 'the bar never overflows past 100%');
  assertEq(weekPercent(0, 5), 0, 'no days → an empty bar');
  assertEq(weekPercent(-2, 5), 0, 'a negative count does not draw a negative bar');
  assertEq(weekPercent(3, 0), 0, 'a zero target cannot divide by zero');
  assertEq(weekPercent(Number.NaN, 5), 0, 'a NaN count is an empty bar');
  assertEq(weekPercent(3, Number.NaN), 0, 'a NaN target is an empty bar');
}

// ─── this week's coached takes ─────────────────────────────────

function coachedTakeTests(): void {
  const sessions = [
    { playedAt: '2026-09-16T18:00:00', accuracyPct: 82.4, durationSec: 90 },
    { playedAt: '2026-09-14T09:00:00', accuracyPct: 70, durationSec: 150 },
    { playedAt: '2026-09-08T09:00:00', accuracyPct: 99, durationSec: 600 },
  ];
  const summary = coachedTakeSummary(sessions, WEEK_DATES);
  assertEq(summary.count, 2, 'only this week’s coached takes are counted');
  assertEq(summary.bestAccuracyPct, 82, 'the best accuracy of the week is rounded');
  assertEq(summary.minutesTotal, 4, 'the week’s take lengths are totalled in minutes');

  assertEq(
    coachedTakeSummary([], WEEK_DATES).bestAccuracyPct,
    null,
    'no takes → no best accuracy (null, not 0)',
  );
  assertEq(coachedTakeSummary(null, WEEK_DATES).count, 0, 'a null history is safe');
  assertEq(coachedTakeSummary(undefined, WEEK_DATES).count, 0, 'an undefined history is safe');

  const clamped = coachedTakeSummary(
    [
      { playedAt: '2026-09-16T10:00:00', accuracyPct: 120, durationSec: -30 },
      { playedAt: '2026-09-17T10:00:00', accuracyPct: -5, durationSec: Number.NaN },
    ],
    WEEK_DATES,
  );
  assertEq(clamped.bestAccuracyPct, 100, 'an over-100 accuracy is clamped, not shown');
  assertEq(clamped.count, 2, 'both takes are counted even with junk scores');
  assertEq(clamped.minutesTotal, 0, 'junk durations never add minutes');

  const badTimestamps = coachedTakeSummary(
    [
      { playedAt: 'not-a-date', accuracyPct: 90, durationSec: 60 },
      { playedAt: '', accuracyPct: 90, durationSec: 60 },
      { playedAt: '2026-09-16T10:00:00', accuracyPct: 55, durationSec: 60 },
    ],
    WEEK_DATES,
  );
  assertEq(badTimestamps.count, 1, 'unparseable take timestamps are skipped, not guessed');

  const bestRounding = coachedTakeSummary(
    [{ playedAt: '2026-09-15T10:00:00', accuracyPct: 82.6, durationSec: 30 }],
    WEEK_DATES,
  );
  assertEq(bestRounding.bestAccuracyPct, 83, 'accuracy rounds to the nearest whole percent');
  assertEq(bestRounding.minutesTotal, 1, 'a 30-second take rounds to 1 minute');

  assertEq(
    coachedTakeCopy({ count: 0, bestAccuracyPct: null, minutesTotal: 0 }),
    'No coached takes this week yet — open a piece and record one.',
    'the empty week says what to do next (and never claims a take)',
  );
  assertEq(
    coachedTakeCopy({ count: 1, bestAccuracyPct: 82, minutesTotal: 2 }),
    '1 coached take this week · best 82% accuracy',
    'a single take reads as one take',
  );
  assertEq(
    coachedTakeCopy({ count: 3, bestAccuracyPct: 90, minutesTotal: 8 }),
    '3 coached takes this week · best 90% accuracy',
    'several takes are plural',
  );
  const noScore = coachedTakeCopy({ count: 2, bestAccuracyPct: null, minutesTotal: 0 });
  assertEq(noScore, '2 coached takes this week', 'takes with no score omit the best-accuracy tail');
  assertEq(noScore.includes('·'), false, 'no dangling separator when there is no score');
}

// ─── For You card copy ─────────────────────────────────────────

function forYouTests(): void {
  assertEq(FOR_YOU_CTA, 'Browse catalog →', 'the For You affordance names its destination');
  assertEq(
    forYouByline(true),
    FOR_YOU_BYLINE_PERSONALISED,
    'with onboarding answered, the byline is the personalised variant',
  );
  assertEq(
    forYouByline(false),
    FOR_YOU_BYLINE_DEFAULT,
    'without onboarding, the byline asks for the answers',
  );
  assert(
    /personali[sz]ed feed is still coming/i.test(FOR_YOU_BYLINE_PERSONALISED),
    'the byline admits the personalised feed does not exist yet',
  );
  assert(
    !/^Based on your instrument/i.test(FOR_YOU_BYLINE_PERSONALISED),
    'the old "Based on your instrument, level, and genre" claim is gone (it never filtered)',
  );
  assert(
    FOR_YOU_BYLINE_PERSONALISED.includes('Search by title or composer'),
    'the byline describes what the tap actually does',
  );
  assertEq(
    forYouAccessibilityLabel('Piano picks for beginners'),
    'Piano picks for beginners — browse the catalog',
    'screen readers hear the real destination too',
  );
  assertEq(
    forYouAccessibilityLabel('Discover sheet music'),
    'Discover sheet music — browse the catalog',
    'the accessibility label works for the un-onboarded title as well',
  );
}

// ─── practice-week screen copy ─────────────────────────────────

function practiceWeekTests(): void {
  assertEq(
    practiceWeekCta('Bagatelle in A Minor (Für Elise)'),
    'Practice “Bagatelle in A Minor (Für Elise)” →',
    'the week screen offers today’s featured piece by name',
  );
  assertEq(
    practiceWeekCta('  Für Elise  '),
    'Practice “Für Elise” →',
    'the featured title is trimmed before it is quoted',
  );
  assertEq(practiceWeekCta(null), 'Find a piece to practice →', 'no featured piece → Find-a-Piece');
  assertEq(practiceWeekCta(undefined), 'Find a piece to practice →', 'undefined → Find-a-Piece');
  assertEq(practiceWeekCta('   '), 'Find a piece to practice →', 'a blank title is no title');
  assertEq(NO_PRACTICE_TODAY, 'No practice yet', 'an un-practised day has honest copy');
  assertEq(WEEK_DAY_FUTURE, '—', 'a future day shows a dash, not a zero');
}

// ─── week-row status + week total ──────────────────────────────

function weekRowCopyTests(): void {
  assertEq(
    weekDayStatusText({ minutes: 24.4, practiced: true, isFuture: false }),
    '24 min',
    'a practised day with minutes shows them, rounded',
  );
  assertEq(
    weekDayStatusText({ minutes: 12.5, practiced: true, isFuture: false }),
    '13 min',
    'fractional minutes are rounded for display',
  );
  assertEq(
    weekDayStatusText({ minutes: 0.4, practiced: true, isFuture: false }),
    '<1 min practised',
    'a sub-minute session is not shown as "0 min"',
  );
  assertEq(
    weekDayStatusText({ minutes: 0, practiced: true, isFuture: false }),
    'Practised ✓',
    'a practice day with no minutes (challenge tap / short take) still reads as practised',
  );
  assertEq(
    weekDayStatusText({ minutes: 0, practiced: false, isFuture: false }),
    NO_PRACTICE_TODAY,
    'a past day with nothing recorded says so',
  );
  assertEq(
    weekDayStatusText({ minutes: 0, practiced: false, isFuture: true }),
    WEEK_DAY_FUTURE,
    'a future day is a dash — never a failure or a zero',
  );
  assertEq(
    weekDayStatusText({ minutes: 5, practiced: true, isFuture: true }),
    '5 min',
    'minutes always win, even on a (clock-skewed) future row',
  );

  assertEq(weekTotalCopy(19.5), '20 min this week', 'the week total is rounded minutes');
  assertEq(weekTotalCopy(0), 'No minutes logged this week yet', 'an empty week says so');
  assertEq(weekTotalCopy(0.4), 'Under a minute logged this week', 'under a minute is not "0 min"');
  assertEq(weekTotalCopy(Number.NaN), 'No minutes logged this week yet', 'a NaN total says so');
  assertEq(weekTotalCopy(-3), 'No minutes logged this week yet', 'a negative total says so');
}

// ─── Streak card (Home) — the last dead card ───────────────────

function streakTests(): void {
  console.log('\nstreak card destination');

  // 0 / junk counts → the card is the way to START, so it opens today's
  // featured piece exactly like "⏱️ Practice today" does.
  assertEq(streakDestination(0), 'practice', 'no streak yet → open today’s featured piece');
  assertEq(streakDestination(-1), 'practice', 'a negative count is not a streak');
  assertEq(streakDestination(Number.NaN), 'practice', 'a junk count reads as no streak');
  assertEq(streakDestination(null), 'practice', 'an unloaded streak reads as no streak');
  assertEq(streakDestination(undefined), 'practice', 'a missing streak reads as no streak');
  // A live streak → the week view, where the days behind it are visible.
  assertEq(streakDestination(1), 'week', 'a 1-day streak already has a week to show');
  assertEq(streakDestination(37), 'week', 'a long streak → the week view');

  console.log('\nstreak card CTA + accessibility label');

  // The 0-day CTA mirrors Practice today's, from the SAME mapping.
  assertEq(
    streakCta(0, { sheetMusicUrl: 'https://example.test/score.pdf' }),
    OPEN_FEATURED_CTA,
    'a featured piece with a score → the Practice-today CTA',
  );
  assertEq(
    streakCta(0, { sheetMusicUrl: '   ' }),
    OPEN_FEATURED_CTA,
    'a blank sheet URL still opens the piece page (coach), not Find-a-Piece',
  );
  assertEq(
    streakCta(0, { sheetMusicUrl: null }),
    OPEN_FEATURED_CTA,
    'a piece with no score → the piece page, same CTA',
  );
  assertEq(
    streakCta(0, null),
    FIND_PIECE_CTA,
    'no featured piece loaded → the Find-a-Piece CTA',
  );
  assertEq(streakCta(4, { sheetMusicUrl: 'x' }), WEEK_CTA, 'an active streak → see your week');
  assertEq(streakCta(4, null), WEEK_CTA, 'an active streak ignores the featured piece');
  assertEq(streakCta(Number.NaN, null), FIND_PIECE_CTA, 'a junk count takes the 0-day path');

  // Owner-visible copy is pinned here: the two cards must not drift apart, and
  // the Practice-today / This Week wording is unchanged by this fix.
  assertEq(OPEN_FEATURED_CTA, "Open today's featured piece →", 'Practice-today CTA reads as before');
  assertEq(FIND_PIECE_CTA, 'Find a piece to practice →', 'the Find-a-Piece CTA reads as before');
  assertEq(WEEK_CTA, 'See your week →', 'the This Week CTA reads as before');
  assertEq(featuredPieceCta({ sheetMusicUrl: 'x' }), OPEN_FEATURED_CTA, 'featuredPieceCta is the shared source');
  assertEq(featuredPieceCta(null), FIND_PIECE_CTA, 'featuredPieceCta falls back when the catalog is empty');

  assertEq(
    streakAccessibilityLabel(0, { title: 'Für Elise' }),
    'Start your streak today — open Für Elise',
    'screen reader: the 0-day card names the piece it opens',
  );
  assertEq(
    streakAccessibilityLabel(0, { title: '  Für Elise  ' }),
    'Start your streak today — open Für Elise',
    'the label trims the title it is given',
  );
  assertEq(
    streakAccessibilityLabel(0, null),
    'Start your streak today — find a piece to practice',
    'screen reader: no featured piece → says Find-a-Piece, names no piece',
  );
  assertEq(
    streakAccessibilityLabel(6, { title: 'Für Elise' }),
    '6-day streak — see your practice week',
    'screen reader: an active streak states the streak and the week view',
  );
}

// ─── Streak card (History tab) — the same card, wired in v22 ───

/**
 * History's streak card is Home's card on another tab: same copy, same styling.
 * The one difference is what 0 days can open — History has no featured piece, so
 * it opens the catalog search it already renders in place. Pinned here because
 * the failure mode was a card that LOOKED wired and did nothing: the destination
 * and the CTA line must come from the same mapping.
 */
function historyStreakTests(): void {
  console.log('\nHistory streak card (same card, wired)');

  assertEq(
    historyStreakDestination(0),
    'find-piece',
    'no streak yet on History → Find-a-Piece (History has no featured piece)',
  );
  assertEq(
    historyStreakDestination(-2),
    'find-piece',
    'a negative count is not a streak',
  );
  assertEq(
    historyStreakDestination(Number.NaN),
    'find-piece',
    'a junk count reads as no streak',
  );
  assertEq(
    historyStreakDestination(null),
    'find-piece',
    'an unloaded streak reads as no streak',
  );
  assertEq(
    historyStreakDestination(undefined),
    'find-piece',
    'a missing streak reads as no streak',
  );
  assertEq(
    historyStreakDestination(1),
    'week',
    'a 1-day streak opens the practice-week view',
  );
  assertEq(
    historyStreakDestination(37),
    'week',
    'a long streak opens the practice-week view',
  );

  // The CTA line and the destination must agree, in both branches.
  assertEq(
    streakCta(0, null),
    FIND_PIECE_CTA,
    'the 0-day CTA is the Find-a-Piece line the tap really opens',
  );
  assertEq(
    streakCta(9, null),
    WEEK_CTA,
    'the live-streak CTA is the week view the tap really opens',
  );
  assertEq(
    streakAccessibilityLabel(0, null),
    'Start your streak today — find a piece to practice',
    'screen reader: the 0-day History card says where it goes',
  );
  assertEq(
    streakAccessibilityLabel(9, null),
    '9-day streak — see your practice week',
    'screen reader: the live-streak History card says where it goes',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== home cards (Practice today / This Week / For You / Streak) ===');
  practiceTodayTests();
  weekViewTests();
  progressTests();
  coachedTakeTests();
  forYouTests();
  practiceWeekTests();
  weekRowCopyTests();
  streakTests();
  historyStreakTests();
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
