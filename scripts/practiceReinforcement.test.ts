/**
 * Unit tests for practice-reinforcement slice 1 (engine only, no UI):
 *   • src/services/practiceStreaks.ts        — practice-day streak maths
 *   • src/services/practiceMilestones.ts     — minutes ladder + personal best
 *   • src/services/practiceReinforcement.ts  — the pure entry point + copy
 *
 * Run with: npm run test:tier1
 * Compiles the pure modules + this test to CommonJS and runs under plain Node
 * (same convention as scripts/tier1.test.ts / practiceCoach.test.ts — no test
 * framework, no app runtime, no react-native).
 *
 * Determinism: every call injects `now` and a fixed UTC offset (`tz: 0`) so
 * days line up with the ISO strings in the fixtures. Two cases deliberately use
 * an IANA zone name to prove the DST-safe path.
 */
import {
  STREAK_TIERS,
  computeStreak,
  localDayKey,
  toEpochMs,
  type TimeZoneSpec,
} from '../src/services/practiceStreaks';
import {
  MILESTONES,
  MILESTONE_LABELS,
  computeMinutesTotal,
  computePersonalBest,
  excludedDurationCount,
  milestonesCrossed,
  nextMilestone,
  sessionMinutes,
} from '../src/services/practiceMilestones';
import {
  evaluateReinforcement,
  normalizeCompletedSession,
  type Celebration,
  type CompletedSessionInput,
} from '../src/services/practiceReinforcement';
import type { PracticeSession } from '../src/services/practiceHistory';

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
  const ok = actual === expected;
  if (ok) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function assertDeepEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assertEq(a, b, msg);
}

// ─── fixtures ──────────────────────────────────────────────────

/** Fixed UTC offset used for the day-aligned fixtures (0 = the ISO day). */
const UTC = 0 as TimeZoneSpec;

/** A stored practice run (shape of practiceHistory.PracticeSession). */
function session(
  playedAt: string,
  accuracyPct = 80,
  durationSec = 600,
  pieceId = 'fur-elise',
): PracticeSession {
  return { pieceId, accuracyPct, durationSec, playedAt };
}

/** Session at 12:00Z on the given YYYY-MM-DD. */
function onDay(day: string, accuracyPct = 80, durationSec = 600, pieceId = 'fur-elise'): PracticeSession {
  return session(`${day}T12:00:00.000Z`, accuracyPct, durationSec, pieceId);
}

/** `count` consecutive days ending on `endDay` (inclusive), ascending. */
function consecutiveDays(
  endDay: string,
  count: number,
  durationSec = 600,
  accuracyPct = 80,
): PracticeSession[] {
  const endMs = Date.parse(`${endDay}T12:00:00.000Z`);
  const out: PracticeSession[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const ms = endMs - i * 86_400_000;
    out.push(session(new Date(ms).toISOString(), accuracyPct, durationSec));
  }
  return out;
}

/** The completed-run argument for evaluateReinforcement. */
function completed(
  playedAt: string,
  accuracyPct = 80,
  durationSec = 600,
  pieceId = 'fur-elise',
): CompletedSessionInput {
  return { pieceId, accuracyPct, durationSec, playedAt };
}

const NOW = '2026-09-10T20:00:00.000Z';
const TODAY = '2026-09-10';
const YESTERDAY = '2026-09-09';

function kinds(list: Celebration[]): string[] {
  return list.map((c) => c.kind);
}

/** No celebration or nudge copy may carry a raw percentage or guilt framing. */
const GUILT = /(don'?t break|lost your streak|you'?ll lose|hurry|last chance|urgent|only \d+ (spots|left))/i;
function copyIsClean(c: Celebration): boolean {
  const text = `${c.title} ${c.copy} ${c.shareText}`;
  return !text.includes('%') && !GUILT.test(text) && c.title.length > 0 && c.copy.length > 0 && c.shareText.length > 0;
}

// ─── 1. streak maths ───────────────────────────────────────────

function streakTests(): void {
  console.log('\nstreaks: calendar-day maths');
  const empty = computeStreak([], NOW, UTC);
  assertEq(empty.currentDays, 0, 'no history → currentDays 0');
  assertEq(empty.longestDays, 0, 'no history → longestDays 0');
  assertEq(empty.alive, false, 'no history → not alive');
  assertEq(empty.atRisk, false, 'no history → not at risk (nothing to protect)');
  assertEq(empty.totalPracticeDays, 0, 'no history → 0 practice days');
  assertEq(empty.nextTier, 3, 'no history → first tier is 3');
  assertEq(empty.daysToNextTier, 3, 'no history → 3 days to the first tier');

  const today = computeStreak([onDay(TODAY)], NOW, UTC);
  assertEq(today.currentDays, 1, 'a run today → current streak 1');
  assertEq(today.alive, true, 'a run today → streak alive');
  assertEq(today.atRisk, false, 'a run today → not at risk');
  assertEq(today.totalPracticeDays, 1, 'a run today → 1 practice day');
  assertEq(today.nextTier, 3, '1 day → next tier 3');
  assertEq(today.daysToNextTier, 2, '1 day → 2 days to tier 3');

  // Two runs on one calendar day are still ONE streak day.
  const twiceToday = computeStreak([onDay(TODAY), session(`${TODAY}T18:30:00.000Z`)], NOW, UTC);
  assertEq(twiceToday.currentDays, 1, 'two runs on the same day → streak 1');
  assertEq(twiceToday.totalPracticeDays, 1, 'two runs on the same day → 1 practice day');

  const yestToday = computeStreak([onDay(YESTERDAY), onDay(TODAY)], NOW, UTC);
  assertEq(yestToday.currentDays, 2, 'yesterday + today → streak 2');
  assertEq(yestToday.alive, true, 'yesterday + today → alive');
  assertEq(yestToday.atRisk, false, 'yesterday + today → not at risk');

  // Out-of-order input must not matter.
  const unordered = computeStreak([onDay(TODAY), onDay(YESTERDAY)], NOW, UTC);
  assertEq(unordered.currentDays, 2, 'input order does not affect the streak');

  const atRisk = computeStreak(consecutiveDays(YESTERDAY, 2), NOW, UTC);
  assertEq(atRisk.currentDays, 2, 'runs ending yesterday → streak still counts (2)');
  assertEq(atRisk.alive, true, 'runs ending yesterday → alive');
  assertEq(atRisk.atRisk, true, 'runs ending yesterday → at risk');
  assertEq(atRisk.longestDays, 2, 'runs ending yesterday → longest 2');

  const gap2 = computeStreak(consecutiveDays('2026-09-08', 3), NOW, UTC);
  assertEq(gap2.currentDays, 0, 'gap of 2 days → streak broken (0)');
  assertEq(gap2.alive, false, 'gap of 2 days → not alive');
  assertEq(gap2.atRisk, false, 'gap of 2 days → not at risk');
  assertEq(gap2.longestDays, 3, 'gap of 2 days → longest run still reported (3)');
  assertEq(gap2.totalPracticeDays, 3, 'gap of 2 days → 3 practice days total');
  assertEq(gap2.nextTier, 3, 'broken streak → next tier restarts at 3');
  assertEq(gap2.daysToNextTier, 3, 'broken streak → 3 days to tier 3');

  const gap3 = computeStreak([onDay('2026-09-07')], NOW, UTC);
  assertEq(gap3.currentDays, 0, 'gap of 3 days → broken');
  assertEq(gap3.alive, false, 'gap of 3 days → not alive');

  const longestMidHistory = computeStreak(
    [
      onDay('2026-08-01'),
      onDay('2026-08-02'),
      onDay('2026-08-03'),
      onDay('2026-08-04'),
      onDay(TODAY),
    ],
    NOW,
    UTC,
  );
  assertEq(longestMidHistory.currentDays, 1, 'current streak counts only the live run');
  assertEq(longestMidHistory.longestDays, 4, 'longest run is remembered (4)');
  assertEq(longestMidHistory.totalPracticeDays, 5, 'total practice days counts all days (5)');
  assertEq(longestMidHistory.nextTier, 3, 'current 1 → next tier 3 (based on the live run)');

  const split = computeStreak(
    [
      onDay('2026-09-06'),
      onDay('2026-09-08'),
      onDay('2026-09-09'),
      onDay(TODAY),
    ],
    NOW,
    UTC,
  );
  assertEq(split.currentDays, 3, 'today-2,today-1,today → streak 3');
  assertEq(split.longestDays, 3, 'longest is also the live run (3)');

  console.log('\nstreaks: month / year / leap boundaries');
  const monthRollover = computeStreak(
    [onDay('2026-08-30'), onDay('2026-08-31'), onDay('2026-09-01')],
    '2026-09-01T20:00:00.000Z',
    UTC,
  );
  assertEq(monthRollover.currentDays, 3, 'Aug 30/31 + Sep 1 → streak 3 (month boundary)');
  assertEq(monthRollover.nextTier, 7, 'streak 3 → next tier 7');
  assertEq(monthRollover.daysToNextTier, 4, 'streak 3 → 4 days to tier 7');

  const yearRollover = computeStreak(
    [onDay('2025-12-30'), onDay('2025-12-31'), onDay('2026-01-01')],
    '2026-01-01T20:00:00.000Z',
    UTC,
  );
  assertEq(yearRollover.currentDays, 3, 'Dec 30/31 + Jan 1 → streak 3 (year boundary)');

  const leapDay = computeStreak(
    [onDay('2028-02-28'), onDay('2028-02-29'), onDay('2028-03-01')],
    '2028-03-01T20:00:00.000Z',
    UTC,
  );
  assertEq(leapDay.currentDays, 3, 'leap-day Feb 29 counts as a normal day → streak 3');

  const nonLeap = computeStreak(
    [onDay('2027-02-27'), onDay('2027-02-28'), onDay('2027-03-01')],
    '2027-03-01T20:00:00.000Z',
    UTC,
  );
  assertEq(nonLeap.currentDays, 3, 'non-leap Feb 28 → Mar 1 → streak 3');

  // at-risk across a month boundary (Aug 31 → now Sep 1)
  const riskBoundary = computeStreak([onDay('2026-08-31')], '2026-09-01T08:00:00.000Z', UTC);
  assertEq(riskBoundary.atRisk, true, 'Aug 31 run → at risk on Sep 1');
  assertEq(riskBoundary.currentDays, 1, 'Aug 31 run → current streak 1 on Sep 1');
  const brokenBoundary = computeStreak([onDay('2026-08-30')], '2026-09-01T08:00:00.000Z', UTC);
  assertEq(brokenBoundary.currentDays, 0, 'Aug 30 run → broken on Sep 1');
  assertEq(brokenBoundary.alive, false, 'Aug 30 run → not alive on Sep 1');

  console.log('\nstreaks: the 100-day tier boundary');
  const ninetyNine = computeStreak(consecutiveDays(TODAY, 99), NOW, UTC);
  assertEq(ninetyNine.currentDays, 99, '99 consecutive days → currentDays 99');
  assertEq(ninetyNine.longestDays, 99, '99 consecutive days → longestDays 99');
  assertEq(ninetyNine.nextTier, 100, '99 days → next tier 100');
  assertEq(ninetyNine.daysToNextTier, 1, '99 days → 1 day to tier 100');

  const hundred = computeStreak(consecutiveDays(TODAY, 100), NOW, UTC);
  assertEq(hundred.currentDays, 100, '100 consecutive days → currentDays 100');
  assertEq(hundred.nextTier, null, '100 days → no tier above 100');
  assertEq(hundred.daysToNextTier, 0, '100 days → 0 days to next tier');
  assertEq(hundred.totalPracticeDays, 100, '100 consecutive days → 100 practice days');

  const overHundred = computeStreak(consecutiveDays(TODAY, 130), NOW, UTC);
  assertEq(overHundred.currentDays, 130, 'above the top tier the streak keeps counting');
  assertEq(overHundred.nextTier, null, 'above the top tier → nextTier null');
  assertEq(overHundred.daysToNextTier, 0, 'above the top tier → daysToNextTier 0');

  const hundredAtRisk = computeStreak(consecutiveDays(YESTERDAY, 100), NOW, UTC);
  assertEq(hundredAtRisk.currentDays, 100, 'at-risk 100-day streak still counts 100');
  assertEq(hundredAtRisk.atRisk, true, 'at-risk 100-day streak is flagged');
  assertEq(hundredAtRisk.daysToNextTier, 0, 'top tier reached → nothing left to chase');

  console.log('\nstreaks: tier ladder + degenerate input');
  const tiers: Array<[number, number | null, number]> = [
    [2, 3, 1],
    [3, 7, 4],
    [6, 7, 1],
    [7, 14, 7],
    [13, 14, 1],
    [14, 30, 16],
    [29, 30, 1],
    [30, 100, 70],
    [100, null, 0],
  ];
  for (const [days, nextTier, toGo] of tiers) {
    const s = computeStreak(consecutiveDays(TODAY, days), NOW, UTC);
    assertEq(s.currentDays, days, `tier ladder: ${days} days → currentDays ${days}`);
    assertEq(s.nextTier, nextTier, `tier ladder: ${days} days → nextTier ${String(nextTier)}`);
    assertEq(s.daysToNextTier, toGo, `tier ladder: ${days} days → daysToNextTier ${toGo}`);
  }
  assertDeepEq(STREAK_TIERS, [3, 7, 14, 30, 100], 'STREAK_TIERS is the documented ladder');

  const badDate = computeStreak([session('not-a-date'), onDay(TODAY)], NOW, UTC);
  assertEq(badDate.totalPracticeDays, 1, 'an unparseable playedAt is skipped, not counted');
  const badDateOnly = computeStreak([session('')], NOW, UTC);
  assertEq(badDateOnly.totalPracticeDays, 0, 'that also holds when every record is unparseable');

  // Documented choice: a future-dated run (device clock skew) is treated as
  // "practised today" so an active player never looks lapsed.
  const future = computeStreak([onDay('2026-09-12')], NOW, UTC);
  assertEq(future.currentDays, 1, 'future-dated run → still counted as an active streak');
  assertEq(future.alive, true, 'future-dated run → alive');
  assertEq(future.atRisk, false, 'future-dated run → not at risk');

  const noNow = computeStreak([onDay(TODAY)], 'garbage', UTC);
  assertEq(noNow.alive, false, 'unusable `now` → not claimed alive');
  assertEq(noNow.atRisk, false, 'unusable `now` → no nudge state');
  assertEq(noNow.totalPracticeDays, 1, 'unusable `now` still reports the days recorded');

  const nowShapes = [
    computeStreak([onDay(TODAY)], new Date(NOW), UTC).currentDays,
    computeStreak([onDay(TODAY)], Date.parse(NOW), UTC).currentDays,
    computeStreak([onDay(TODAY)], NOW, UTC).currentDays,
  ];
  assertDeepEq(nowShapes, [1, 1, 1], 'Date, epoch ms and ISO string `now` agree');
  assertEq(toEpochMs('2026-09-10T20:00:00.000Z'), Date.parse(NOW), 'toEpochMs parses ISO strings');
  assertEq(Number.isNaN(toEpochMs('garbage')), true, 'toEpochMs is NaN-safe');

  console.log('\nstreaks: timezone injection (fixed offsets)');
  assertEq(localDayKey(Date.parse('2026-09-10T23:30:00Z'), 0), '2026-09-10', 'UTC day for a 23:30Z run');
  assertEq(localDayKey(Date.parse('2026-09-10T23:30:00Z'), 600), '2026-09-11', '+10:00 moves that run to the next day');
  assertEq(localDayKey(Date.parse('2026-09-11T03:00:00Z'), -300), '2026-09-10', '-05:00 keeps that run on the previous day');
  assertEq(localDayKey(Date.parse('2026-09-10T19:00:00Z'), 330), '2026-09-11', '+05:30 (half-hour zone) rolls over too');

  // Same two instants are 2 UTC days but 1 local day at +10:00.
  const tzSpread = [
    session('2026-09-09T23:30:00Z'),
    session('2026-09-10T00:30:00Z'),
  ];
  assertEq(computeStreak(tzSpread, '2026-09-10T12:00:00Z', 0).totalPracticeDays, 2, 'UTC sees 2 practice days');
  assertEq(
    computeStreak(tzSpread, '2026-09-10T12:00:00Z', 600).totalPracticeDays,
    1,
    '+10:00 correctly sees those runs as one local day',
  );
  assertEq(
    computeStreak(tzSpread, '2026-09-11T02:00:00Z', 600).currentDays,
    1,
    'and the +10:00 streak is 1 day "today"',
  );

  console.log('\nstreaks: DST-safe named zones');
  let intlOk = false;
  try {
    intlOk = new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney' }).format(new Date(0)).length > 0;
  } catch {
    intlOk = false;
  }
  assert(intlOk, 'this engine has IANA timezone support (required for the DST cases)');
  if (intlOk) {
    // Sydney DST ends 2025-04-06 03:00 AEDT (= 2025-04-05T16:00Z), so local
    // Sunday Apr 6 2025 is a 25-hour day. These two instants:
    //   2025-04-05T14:00Z = Apr 6 01:00 AEDT → local Apr 6
    //   2025-04-06T13:00Z = Apr 6 23:00 AEST → local Apr 6 (after the change!)
    // are ONE local practice day but TWO UTC days. Adding 86_400_000 ms to the
    // first would land on Apr 7, which is exactly the bug this avoids.
    const dstOneDay = [session('2025-04-05T14:00:00Z'), session('2025-04-06T13:00:00Z')];
    const dstNow = '2025-04-06T20:00:00Z';
    assertEq(
      localDayKey(Date.parse('2025-04-05T14:00:00Z'), 'Australia/Sydney'),
      '2025-04-06',
      'DST: 14:00Z Apr 5 is local Apr 6 in Sydney',
    );
    assertEq(
      localDayKey(Date.parse('2025-04-05T14:00:00Z'), 0),
      '2025-04-05',
      'DST: the same instant is Apr 5 in UTC',
    );
    assertEq(
      localDayKey(Date.parse('2025-04-06T13:00:00Z'), 'Australia/Sydney'),
      '2025-04-06',
      'DST: 23:00 local after the clock change is still Apr 6',
    );
    assertEq(
      localDayKey(Date.parse('2025-04-06T15:00:00Z'), 'Australia/Sydney'),
      '2025-04-07',
      'DST: the zone offset really changed inside the dataset (+11 → +10)',
    );
    assertEq(
      computeStreak(dstOneDay, dstNow, 'Australia/Sydney').totalPracticeDays,
      1,
      'DST: the 25-hour local day counts as ONE practice day in Sydney',
    );
    assertEq(
      computeStreak(dstOneDay, dstNow, 0).totalPracticeDays,
      2,
      'DST control: UTC sees two days for the same instants',
    );
    assertEq(
      computeStreak(dstOneDay, dstNow, 'Australia/Sydney').atRisk,
      true,
      'DST: practised on local Apr 6 → at risk on local Apr 7',
    );
    assertEq(
      computeStreak(dstOneDay, dstNow, 0).currentDays,
      2,
      'DST control: UTC still counts both days as one live streak',
    );

    // Consecutive local days must still chain across the transition.
    const dstChain = [session('2025-04-04T23:00:00Z'), session('2025-04-06T13:00:00Z')];
    assertEq(
      computeStreak(dstChain, dstNow, 'Australia/Sydney').currentDays,
      2,
      'DST: local Apr 5 + Apr 6 chain into a 2-day streak',
    );
    assertEq(
      computeStreak(dstChain, dstNow, 0).currentDays,
      1,
      'DST control: UTC does not chain those two instants',
    );
  }

  const badZone = computeStreak([onDay(TODAY)], NOW, 'Not/AZone');
  assertEq(badZone.currentDays, 1, 'an unknown zone name falls back to device-local instead of throwing');
  const zoneShapes = [
    computeStreak([onDay(TODAY)], NOW, undefined).currentDays,
    computeStreak([onDay(TODAY)], NOW, null).currentDays,
  ];
  assertDeepEq(zoneShapes, [1, 1], 'tz undefined and null behave the same (device local)');
}

// ─── 2. minutes ladder ─────────────────────────────────────────

function minutesTests(): void {
  console.log('\nminutes: totals + exclusion of unusable durations');
  assertDeepEq(MILESTONES, [100, 1000, 5000], 'MILESTONES is the Iron Fingers ladder');
  assertEq(MILESTONE_LABELS[100], 'Iron Fingers I', 'milestone 100 is labelled');
  assertEq(MILESTONE_LABELS[1000], 'Iron Fingers II', 'milestone 1000 is labelled');
  assertEq(MILESTONE_LABELS[5000], 'Iron Fingers III', 'milestone 5000 is labelled');

  assertEq(computeMinutesTotal([]), 0, 'no sessions → 0 minutes');
  assertEq(computeMinutesTotal([session(NOW, 80, 600)]), 10, '600s → 10 minutes');
  assertEq(computeMinutesTotal([session(NOW, 80, 60), session(NOW, 80, 120)]), 3, '60s + 120s → 3 minutes');
  assertEq(computeMinutesTotal([session(NOW, 80, 30)]), 0.5, '30s → 0.5 minutes');
  assertEq(computeMinutesTotal([session(NOW, 80, 0)]), 0, 'a zero-duration run adds nothing');

  // duration missing / null / broken → excluded, never counted as 0.0 with a lie.
  const noDuration = { pieceId: 'x', accuracyPct: 80, playedAt: NOW } as unknown as PracticeSession;
  const nullDuration = session(NOW, 80, 0);
  (nullDuration as unknown as { durationSec: unknown }).durationSec = null;
  const nanDuration = session(NOW, 80, 0);
  (nanDuration as unknown as { durationSec: unknown }).durationSec = NaN;
  const negativeDuration = session(NOW, 80, -60);
  const mixed = [session(NOW, 80, 600), noDuration, nullDuration, nanDuration, negativeDuration];

  assertEq(sessionMinutes(noDuration), null, 'a missing duration is excluded (null)');
  assertEq(sessionMinutes(nullDuration), null, 'a null duration is excluded');
  assertEq(sessionMinutes(nanDuration), null, 'a NaN duration is excluded');
  assertEq(sessionMinutes(negativeDuration), null, 'a negative duration is excluded');
  assertEq(sessionMinutes(undefined), null, 'a missing session is excluded');
  assertEq(sessionMinutes({ durationSec: 0 }), 0, 'a zero duration is a valid 0 minutes');
  assertEq(sessionMinutes({ durationSec: 90 }), 1.5, 'duration seconds convert to minutes');
  assertEq(computeMinutesTotal(mixed), 10, 'excluded sessions do not distort the total');
  assertEq(excludedDurationCount(mixed), 4, 'the excluded sessions are countable');
  assertEq(computeMinutesTotal([noDuration]), 0, 'a history of only-excluded sessions totals 0');
  assertEq(excludedDurationCount([session(NOW, 80, 600)]), 0, 'a clean session is not excluded');

  console.log('\nminutes: crossings are compound and non-resetting');
  assertDeepEq(milestonesCrossed(0, 100), [100], 'reaching 100 crosses the first milestone');
  assertDeepEq(milestonesCrossed(99, 101), [100], 'crossing 100 fires even mid-range');
  assertDeepEq(milestonesCrossed(100, 999), [], 'a threshold already passed never re-fires');
  assertDeepEq(milestonesCrossed(100, 1000), [1000], 'the next threshold fires on its own');
  assertDeepEq(milestonesCrossed(0, 1200), [100, 1000], 'one long session can cross several thresholds');
  assertDeepEq(milestonesCrossed(0, 5000), [100, 1000, 5000], 'crossings come back ascending');
  assertDeepEq(milestonesCrossed(5000, 9000), [], 'nothing fires above the top threshold');
  assertDeepEq(milestonesCrossed(400, 400), [], 'no movement → no crossing');
  assertDeepEq(milestonesCrossed(600, 500), [], 'a total can never go backwards, but if it did: no crossing');

  const n0 = nextMilestone(0);
  assertEq(n0.tier, 100, 'next milestone from 0 is 100');
  assertEq(n0.minutesToNext, 100, 'next milestone from 0 needs 100 minutes');
  const n100 = nextMilestone(100);
  assertEq(n100.tier, 1000, 'next milestone from exactly 100 is 1000 (100 already earned)');
  assertEq(n100.minutesToNext, 900, 'next milestone from 100 needs 900 minutes');
  const nMid = nextMilestone(4999.5);
  assertEq(nMid.tier, 5000, 'next milestone below the top is 5000');
  assertEq(nMid.minutesToNext, 0.5, 'remaining minutes are fractional-safe');
  const nTop = nextMilestone(5000);
  assertEq(nTop.tier, null, 'no milestone above 5000');
  assertEq(nTop.minutesToNext, 0, 'nothing left to chase above 5000');
  const nOver = nextMilestone(8123.25);
  assertEq(nOver.tier, null, 'past every milestone → null tier');
}

// ─── 3. personal best ──────────────────────────────────────────

function personalBestTests(): void {
  console.log('\npersonal best: first-ever, improvement, no-improvement');
  const first = computePersonalBest([], completed(NOW, 74), 'fur-elise');
  assertEq(first.firstEver, true, 'no prior runs → firstEver');
  assertEq(first.priorBest, null, 'no prior runs → priorBest null');
  assertEq(first.deltaPct, null, 'no prior runs → deltaPct null');
  assertEq(first.isNewBest, false, 'a first run is not a "beat your best" moment');
  assertEq(first.accuracyPct, 74, 'the finished run accuracy is reported');
  assertEq(first.pieceId, 'fur-elise', 'the comparison is scoped to the piece');

  const improve = computePersonalBest([onDay(YESTERDAY, 70)], completed(NOW, 80), 'fur-elise');
  assertEq(improve.isNewBest, true, '80 beats a prior best of 70 → new best');
  assertEq(improve.deltaPct, 10, 'deltaPct is the improvement (10)');
  assertEq(improve.priorBest, 70, 'priorBest is the pre-run best');
  assertEq(improve.firstEver, false, 'a prior run exists → not firstEver');

  const worse = computePersonalBest([onDay(YESTERDAY, 90)], completed(NOW, 85), 'fur-elise');
  assertEq(worse.isNewBest, false, '85 does not beat a prior best of 90');
  assertEq(worse.deltaPct, -5, 'deltaPct is negative when the run is below the best');
  const equal = computePersonalBest([onDay(YESTERDAY, 80)], completed(NOW, 80), 'fur-elise');
  assertEq(equal.isNewBest, false, 'matching the best is not beating it');
  assertEq(equal.deltaPct, 0, 'matching the best → delta 0');

  const maxOfMany = computePersonalBest(
    [onDay('2026-09-07', 70), onDay('2026-09-08', 91), onDay('2026-09-09', 88)],
    completed(NOW, 95),
    'fur-elise',
  );
  assertEq(maxOfMany.priorBest, 91, 'priorBest is the highest earlier run');
  assertEq(maxOfMany.deltaPct, 4, 'deltaPct is measured against that highest run');

  // Per-piece: another piece's high score must not count as this piece's best.
  const otherPiece = computePersonalBest([onDay('2026-09-09', 99, 600, 'ode-to-joy')], completed(NOW, 80, 600, 'fur-elise'), 'fur-elise');
  assertEq(otherPiece.priorBest, null, 'another piece’s score is not this piece’s best');
  assertEq(otherPiece.firstEver, true, 'so this counts as a first run for this piece');
  const samePiece = computePersonalBest([onDay('2026-09-09', 99, 600, 'ode-to-joy'), onDay('2026-09-09', 50)], completed(NOW, 80, 600, 'fur-elise'), 'fur-elise');
  assertEq(samePiece.priorBest, 50, 'the same-piece maximum is used, not the global max');
  assertEq(samePiece.isNewBest, true, '80 beats the 50 recorded on this piece');

  const clamped = computePersonalBest([onDay('2026-09-09', 80)], completed(NOW, 150), 'fur-elise');
  assertEq(clamped.accuracyPct, 100, 'an out-of-range accuracy is clamped to 100');
  assertEq(clamped.deltaPct, 20, 'the clamped value drives the delta (100 − 80)');
}

// ─── 4. celebrations ───────────────────────────────────────────

function celebrationTests(): void {
  console.log('\ncelebrations: first session');
  const first = evaluateReinforcement({ history: [], completedSession: completed(NOW), now: NOW, tz: UTC });
  assert(first !== null, 'a first run evaluates');
  if (first) {
    assertDeepEq(kinds(first.celebrations), ['first-session'], 'first run → exactly the first-session celebration');
    assertEq(first.personalBest.firstSessionEver, true, 'first run → personalBest.firstSessionEver');
    assertEq(first.celebrations[0].emoji, '🎉', 'first-session emoji');
    assertEq(first.celebrations[0].value, 1, 'first-session carries value 1');
    assertEq(first.celebrations[0].threshold, null, 'first-session has no threshold');
    assert(copyIsClean(first.celebrations[0]), 'first-session copy is clean and shareable');
  }

  const firstWithMilestone = evaluateReinforcement({
    history: [],
    completedSession: completed(NOW, 80, 6000),
    now: NOW,
    tz: UTC,
  });
  assertDeepEq(
    firstWithMilestone ? kinds(firstWithMilestone.celebrations) : [],
    ['first-session', 'minutes-milestone'],
    'a first run that also crosses a milestone celebrates both (order fixed)',
  );

  console.log('\ncelebrations: minutes (fire once, no refires, compound)');
  const cross100 = evaluateReinforcement({
    history: [onDay(YESTERDAY, 80, 5940)],
    completedSession: completed(NOW, 80, 120),
    now: NOW,
    tz: UTC,
  });
  assert(cross100 !== null, 'a milestone-crossing run evaluates');
  if (cross100) {
    assertDeepEq(cross100.minutes.crossed, [100], '99 + 2 minutes crosses exactly 100');
    assertEq(cross100.minutes.total, 101, 'the reported total includes the finished run (101)');
    assertEq(cross100.minutes.next_tier, 1000, 'next milestone after 101 is 1000');
    assertEq(cross100.minutes.minutesToNext, 899, 'minutesToNext is exact (899)');
    assertDeepEq(kinds(cross100.celebrations), ['minutes-milestone'], 'crossing 100 celebrates once');
    assertEq(cross100.celebrations[0].threshold, 100, 'the celebration names the threshold (100)');
    assertEq(cross100.celebrations[0].title, 'Iron Fingers I: 100 minutes', 'milestone title uses the ladder name');
    assert(copyIsClean(cross100.celebrations[0]), 'milestone copy is clean and shareable');
  }

  const alreadyPast = evaluateReinforcement({
    history: [onDay(YESTERDAY, 80, 305_000)],
    completedSession: completed(NOW, 80, 300),
    now: NOW,
    tz: UTC,
  });
  assertDeepEq(alreadyPast ? alreadyPast.minutes.crossed : [-1], [], 'no new crossing when past every threshold');
  assertDeepEq(alreadyPast ? alreadyPast.celebrations : [], [], 'nothing re-fires for milestones already earned');
  assertEq(alreadyPast ? alreadyPast.minutes.total : -1, 5088.3, 'totals still accumulate (5083.3 + 5 minutes)');
  assertEq(alreadyPast ? alreadyPast.minutes.next_tier : -1, null, 'past 5000 → next_tier null');
  assertEq(alreadyPast ? alreadyPast.minutes.minutesToNext : -1, 0, 'past 5000 → minutesToNext 0');

  const compound = evaluateReinforcement({
    history: [onDay(YESTERDAY, 80, 5700)],
    completedSession: completed(NOW, 80, 72_000),
    now: NOW,
    tz: UTC,
  });
  assertDeepEq(
    compound ? compound.minutes.crossed : [],
    [100, 1000],
    'one long session crosses the thresholds it passes (compound, ascending)',
  );
  assertDeepEq(
    compound ? kinds(compound.celebrations) : [],
    ['minutes-milestone', 'minutes-milestone'],
    'each newly crossed threshold gets its own celebration',
  );
  assertDeepEq(
    compound ? compound.celebrations.map((c) => c.threshold) : [],
    [100, 1000],
    'the celebrations carry their thresholds in order',
  );

  // Non-resetting: the ladder only moves forward, so a later quiet session is
  // not silently re-announced.
  const afterCrossing = evaluateReinforcement({
    history: [onDay('2026-09-05', 80, 5940), onDay(YESTERDAY, 80, 120)],
    completedSession: completed(NOW, 80, 60),
    now: NOW,
    tz: UTC,
  });
  assertDeepEq(afterCrossing ? afterCrossing.minutes.crossed : [-1], [], 'the next session crosses nothing new');
  assertDeepEq(afterCrossing ? afterCrossing.celebrations : [], [], 'so no milestone celebration repeats');

  console.log('\ncelebrations: streak tiers');
  const day3 = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 2),
    completedSession: completed(NOW),
    now: NOW,
    tz: UTC,
  });
  if (day3) {
    assertEq(day3.streaks.currentDays, 3, '2 prior days + today → streak 3');
    assertDeepEq(kinds(day3.celebrations), ['streak-tier'], 'reaching 3 days celebrates the tier once');
    assertEq(day3.celebrations[0].threshold, 3, 'the tier celebration names tier 3');
    assertEq(day3.celebrations[0].value, 3, 'the tier celebration carries the day count');
    assertEq(day3.celebrations[0].title, '3-day streak!', 'tier title is the day count');
    assertEq(day3.celebrations[0].emoji, '🔥', 'tier emoji is the flame');
    assert(copyIsClean(day3.celebrations[0]), 'tier copy is clean and shareable');
    assert(day3.celebrations[0].shareText.includes('3-day'), 'share text names the streak length');
    assertEq(day3.streaks.nextTier, 7, 'after tier 3 the next tier is 7');
  }

  const day7 = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 6),
    completedSession: completed(NOW),
    now: NOW,
    tz: UTC,
  });
  assertEq(day7 ? day7.streaks.currentDays : -1, 7, '6 prior days + today → streak 7');
  assertDeepEq(day7 ? kinds(day7.celebrations) : [], ['streak-tier'], 'streak 7 celebrates exactly once');
  assertEq(day7 ? day7.celebrations[0].threshold : -1, 7, 'streak 7 celebration names tier 7');

  const day100 = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 99, 1),
    completedSession: completed(NOW, 80, 1),
    now: NOW,
    tz: UTC,
  });
  assertEq(day100 ? day100.streaks.currentDays : -1, 100, '99 prior days + today → streak 100');
  assertEq(day100 ? day100.celebrations[0].threshold : -1, 100, 'the 100-day tier celebrates');
  assertEq(day100 ? day100.streaks.nextTier : -1, null, '100 days → no tier left');

  const midTier = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 4),
    completedSession: completed(NOW),
    now: NOW,
    tz: UTC,
  });
  assertDeepEq(
    midTier ? kinds(midTier.celebrations) : [],
    [],
    'reaching 5 days (a tier already passed at 3) does not celebrate again',
  );

  // Second run on the same day: the tier must not be announced twice.
  const twoRunsOneDay = evaluateReinforcement({
    history: [...consecutiveDays(YESTERDAY, 2), onDay(TODAY)],
    completedSession: completed(`${TODAY}T18:00:00.000Z`),
    now: NOW,
    tz: UTC,
  });
  assertEq(twoRunsOneDay ? twoRunsOneDay.streaks.currentDays : -1, 3, 'the same-day second run keeps the streak at 3');
  assertDeepEq(
    twoRunsOneDay ? kinds(twoRunsOneDay.celebrations) : [],
    [],
    'a second run on the same day never re-announces the streak tier',
  );

  console.log('\ncelebrations: personal best + ordering');
  const pb = evaluateReinforcement({
    history: [onDay(YESTERDAY, 60)],
    completedSession: completed(NOW, 75),
    now: NOW,
    tz: UTC,
  });
  assertDeepEq(pb ? kinds(pb.celebrations) : [], ['personal-best'], 'beating the previous best celebrates once');
  assertEq(pb ? pb.celebrations[0].value : -1, 15, 'the celebration carries the delta (15)');
  assert(
    pb ? pb.celebrations[0].copy.includes('15 points') : false,
    'beat-last-time framing states the margin in points',
  );
  assert(pb ? copyIsClean(pb.celebrations[0]) : false, 'personal-best copy is clean and shareable');
  assertEq(pb ? pb.personalBest.isNewBest : false, true, 'personalBest.isNewBest is reported');

  const noPb = evaluateReinforcement({
    history: [onDay('2026-09-05', 90), onDay(YESTERDAY, 40)],
    completedSession: completed(NOW, 70),
    now: NOW,
    tz: UTC,
  });
  assertDeepEq(noPb ? kinds(noPb.celebrations) : [], [], 'a run below the piece best celebrates nothing');
  assertEq(noPb ? noPb.personalBest.isNewBest : true, false, 'and is flagged as not a new best');

  const rich = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 6, 950, 60),
    completedSession: completed(NOW, 75, 600),
    now: NOW,
    tz: UTC,
  });
  if (rich) {
    assertEq(rich.streaks.currentDays, 7, 'rich case: streak reaches 7');
    assertDeepEq(rich.minutes.crossed, [100], 'rich case: crosses 100 minutes');
    assertDeepEq(
      kinds(rich.celebrations),
      ['personal-best', 'streak-tier', 'minutes-milestone'],
      'rich case: all three celebration kinds fire, in the documented order',
    );
    assertEq(rich.celebrations.every(copyIsClean), true, 'every celebration payload is clean');
    assertEq(
      rich.celebrations.every((c) => c.shareText.includes('NoteSnap')),
      true,
      'every share text is ready to share (mentions the app)',
    );
    assertEq(new Set(kinds(rich.celebrations)).size, 3, 'each kind appears exactly once');
  }

  console.log('\ncelebrations: exactly-once across repeated evaluation');
  const prior = consecutiveDays(YESTERDAY, 6, 950, 60);
  const firstCall = evaluateReinforcement({ history: prior, completedSession: completed(NOW, 75, 600), now: NOW, tz: UTC });
  const secondCall = evaluateReinforcement({ history: prior, completedSession: completed(NOW, 75, 600), now: NOW, tz: UTC });
  assertDeepEq(
    firstCall ? kinds(firstCall.celebrations) : [],
    secondCall ? kinds(secondCall.celebrations) : [],
    'evaluating the same finished run twice yields the same celebrations',
  );
  assertDeepEq(
    firstCall ? kinds(firstCall.celebrations) : [],
    ['personal-best', 'streak-tier', 'minutes-milestone'],
    'the reference evaluation fired all three kinds once',
  );
  // Now the run is stored: replaying it must announce nothing again.
  const storedRun: PracticeSession = {
    pieceId: 'fur-elise',
    accuracyPct: 75,
    durationSec: 600,
    playedAt: new Date(NOW).toISOString(),
  };
  const replays = evaluateReinforcement({
    history: [...prior, storedRun],
    completedSession: completed(NOW, 75, 600),
    now: NOW,
    tz: UTC,
  });
  assertEq(replays !== null, true, 'replaying after the run was stored evaluates');
  assertEq(
    replays ? replays.celebrations.length : -1,
    0,
    'once the run is in history, nothing re-fires (no milestones, no tiers, no best)',
  );
  assertEq(replays ? replays.minutes.crossed.length : -1, 0, 'and no threshold is re-crossed');
  assertEq(replays ? replays.personalBest.deltaPct : -99, 0, 'the stored run is the current best, so delta is 0');
  assertEq(replays ? replays.streaks.currentDays : -1, 7, 'the streak itself is unchanged by the replay');
}

// ─── 5. nudge ──────────────────────────────────────────────────

function nudgeTests(): void {
  console.log('\nnudge: at-risk only, outside play only');
  const atRisk = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 3),
    completedSession: completed(`${YESTERDAY}T18:00:00.000Z`),
    now: NOW,
    tz: UTC,
  });
  assert(atRisk !== null, 'an at-risk evaluation completes');
  if (atRisk) {
    assertEq(atRisk.streaks.atRisk, true, 'with no run today the streak is at risk');
    assert(atRisk.nudge !== null, 'at risk → the nudge is offered');
    assertEq(atRisk.nudge ? atRisk.nudge.kind : '', 'at-risk-streak', 'nudge kind');
    assertEq(atRisk.nudge ? atRisk.nudge.streakDays : -1, 3, 'nudge reports the streak length (3)');
    assertEq(atRisk.nudge ? atRisk.nudge.daysToNextTier : -1, 4, 'nudge reports the days to the next tier (4)');
    assertEq(atRisk.nudge ? atRisk.nudge.playSafeOnly : false, true, 'nudge is flagged playSafeOnly');
    assertEq(
      atRisk.nudge ? atRisk.nudge.surface : '',
      'outside-play-only',
      'nudge names the only surface it may appear on',
    );
    assert(
      atRisk.nudge ? !atRisk.nudge.copy.includes('%') && !GUILT.test(atRisk.nudge.copy) : false,
      'nudge copy is gentle (no percentage, no guilt framing)',
    );
    assertEq(
      atRisk.nudge ? (atRisk.nudge as unknown as { shareText?: unknown }).shareText : 'x',
      undefined,
      'the nudge is not a shareable celebration payload',
    );
  }

  const sessionToday = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 3),
    completedSession: completed(NOW),
    now: NOW,
    tz: UTC,
  });
  assertEq(sessionToday ? sessionToday.nudge : 'missing', null, 'practised today → no nudge');

  const gap2 = evaluateReinforcement({
    history: consecutiveDays('2026-09-08', 3),
    completedSession: completed('2026-09-05T18:00:00.000Z'),
    now: NOW,
    tz: UTC,
  });
  assertEq(gap2 ? gap2.streaks.alive : true, false, 'a 2-day gap leaves the streak broken');
  assertEq(gap2 ? gap2.streaks.currentDays : -1, 0, 'a broken streak reports 0 current days');
  assertEq(gap2 ? gap2.nudge : 'missing', null, 'a broken streak is not nudged (nothing to protect)');

  const emptyHistory = evaluateReinforcement({
    history: [],
    completedSession: completed('2026-09-07T18:00:00.000Z'),
    now: NOW,
    tz: UTC,
  });
  assertEq(emptyHistory ? emptyHistory.nudge : 'missing', null, 'a long-dead first run → no nudge');
  assertEq(emptyHistory ? emptyHistory.streaks.atRisk : true, false, 'a long-dead first run → not at risk');
  assertEq(emptyHistory ? emptyHistory.streaks.currentDays : -1, 0, 'a long-dead first run → streak 0');

  // Rule as specified: a run dated yesterday (streak exists, nothing today yet)
  // IS at risk and IS nudged — even if it happens to be the device's first run.
  const yesterdayOnly = evaluateReinforcement({
    history: [],
    completedSession: completed(`${YESTERDAY}T18:00:00.000Z`),
    now: NOW,
    tz: UTC,
  });
  assertEq(yesterdayOnly ? yesterdayOnly.streaks.atRisk : false, true, 'a yesterday-only first run is at risk');
  assertEq(yesterdayOnly ? yesterdayOnly.streaks.currentDays : -1, 1, 'and has a 1-day streak to protect');
  assertEq(yesterdayOnly ? yesterdayOnly.nudge?.streakDays : -1, 1, 'so the nudge is offered with streakDays 1');
  assertEq(yesterdayOnly ? yesterdayOnly.nudge?.daysToNextTier : -1, 2, 'and the nudge points at tier 3 (2 days away)');

  const longStreak = evaluateReinforcement({
    history: consecutiveDays(YESTERDAY, 100),
    completedSession: completed(`${YESTERDAY}T18:00:00.000Z`),
    now: NOW,
    tz: UTC,
  });
  assertEq(longStreak ? longStreak.streaks.atRisk : false, true, 'a 100-day streak can still be at risk');
  assertEq(longStreak ? longStreak.nudge?.streakDays : -1, 100, 'the nudge scales to a long streak');
  assertEq(longStreak ? longStreak.nudge?.daysToNextTier : -1, 0, 'at the top tier the nudge has nothing left to chase');
  assertEq(longStreak ? longStreak.nudge?.playSafeOnly : false, true, 'the long-streak nudge keeps the play-safe flag');

  const future = evaluateReinforcement({
    history: [onDay('2026-09-12')],
    completedSession: completed('2026-09-12T09:00:00.000Z'),
    now: NOW,
    tz: UTC,
  });
  assertEq(future ? future.nudge : 'missing', null, 'a future-dated run does not trigger a nudge');
}

// ─── 6. entry point contract ───────────────────────────────────

function entryPointTests(): void {
  console.log('\nentry point: contract, purity, double-count guard');
  const prior = [onDay(YESTERDAY, 70, 600)];

  const result = evaluateReinforcement({ history: prior, completedSession: completed(NOW, 80, 600), now: NOW, tz: UTC });
  assert(result !== null, 'a normal run evaluates');
  if (result) {
    assertEq(result.minutes.total, 20, 'minutes.total includes the finished run (10 + 10)');
    assertEq(result.streaks.currentDays, 2, 'streaks mirror computeStreak on the updated history');
    assertEq(result.personalBest.deltaPct, 10, 'personalBest compares against the pre-run history');
    assertEq(result.personalBest.firstSessionEver, false, 'the run is not the device’s first');
    assertEq(result.personalBest.pieceId, 'fur-elise', 'the personal best is scoped to the piece');
  }

  const withDifferentPiece = evaluateReinforcement({
    history: prior,
    completedSession: completed(NOW, 80, 600, 'ode-to-joy'),
    now: NOW,
    tz: UTC,
  });
  assertEq(
    withDifferentPiece ? withDifferentPiece.personalBest.firstEver : false,
    true,
    'a first run on a new piece is a first-ever *for that piece*',
  );
  assertEq(
    withDifferentPiece ? withDifferentPiece.personalBest.firstSessionEver : true,
    false,
    'while the device-level first-session flag stays false',
  );

  // History must not be mutated by the engine.
  const snapshotBefore = JSON.stringify(prior);
  evaluateReinforcement({ history: prior, completedSession: completed(NOW, 80, 600), now: NOW, tz: UTC });
  assertEq(JSON.stringify(prior), snapshotBefore, 'the caller’s history array is not mutated');

  // Double-count guard: passing the already-updated history gives the same
  // numbers as passing the pre-run history (the run is not counted twice).
  const stored: PracticeSession = { pieceId: 'fur-elise', accuracyPct: 80, durationSec: 600, playedAt: NOW };
  const preRunCall = evaluateReinforcement({ history: prior, completedSession: completed(NOW, 80, 600), now: NOW, tz: UTC });
  const postRunCall = evaluateReinforcement({ history: [...prior, stored], completedSession: completed(NOW, 80, 600), now: NOW, tz: UTC });
  assertEq(preRunCall ? preRunCall.minutes.total : -1, postRunCall ? postRunCall.minutes.total : -2, 'double-count guard: minutes stay equal');
  assertEq(
    preRunCall ? preRunCall.streaks.currentDays : -1,
    postRunCall ? postRunCall.streaks.currentDays : -2,
    'double-count guard: streaks stay equal',
  );
  assertDeepEq(
    preRunCall ? kinds(preRunCall.celebrations) : [],
    ['personal-best'],
    'the pre-run history yields the personal-best moment (the run beat the earlier best)',
  );
  assertDeepEq(
    postRunCall ? kinds(postRunCall.celebrations) : [],
    [],
    'passing an already-updated history cannot re-announce that moment — which is exactly why callers pass the PRE-run history',
  );

  // Degenerate inputs.
  assertEq(
    evaluateReinforcement({ history: [], completedSession: completed(NOW, 80, 600, ''), now: NOW, tz: UTC }),
    null,
    'an empty pieceId evaluates to null (nothing to reinforce)',
  );
  assertEq(
    evaluateReinforcement({
      history: [],
      completedSession: { pieceId: '', accuracyPct: 1, durationSec: 1 },
      now: NOW,
      tz: UTC,
    }),
    null,
    'a missing pieceId evaluates to null',
  );
  assertEq(
    evaluateReinforcement({
      history: [],
      completedSession: { pieceId: 'fur-elise', accuracyPct: 80, durationSec: 600 },
      now: 'garbage',
      tz: UTC,
    }),
    null,
    'an unusable `now` with no playedAt evaluates to null (no hidden clock)',
  );
  assertEq(
    evaluateReinforcement({
      history: [],
      completedSession: { pieceId: 'fur-elise', accuracyPct: 80, durationSec: 600 },
      now: NaN,
      tz: UTC,
    }),
    null,
    'a NaN `now` with no playedAt evaluates to null',
  );
  assertEq(
    normalizeCompletedSession({ pieceId: 'fur-elise', accuracyPct: 80, durationSec: 600 }, NOW)?.playedAt,
    new Date(NOW).toISOString(),
    'an omitted playedAt defaults to the injected `now`, never the device clock',
  );
  assertEq(
    normalizeCompletedSession({ pieceId: '', accuracyPct: 80, durationSec: 600 }, NOW),
    null,
    'normalizeCompletedSession is null-safe',
  );

  const noHistory = evaluateReinforcement({ completedSession: completed(NOW), now: NOW, tz: UTC });
  assertEq(noHistory ? noHistory.streaks.currentDays : -1, 1, 'history is optional (treated as empty)');
  assertEq(noHistory ? noHistory.minutes.total : -1, 10, 'with no history the run is the whole total');

  // now as various shapes.
  const shapes = [
    evaluateReinforcement({ history: [], completedSession: completed(NOW), now: NOW, tz: UTC })?.minutes.total,
    evaluateReinforcement({ history: [], completedSession: completed(NOW), now: new Date(NOW), tz: UTC })?.minutes.total,
    evaluateReinforcement({ history: [], completedSession: completed(NOW), now: Date.parse(NOW), tz: UTC })?.minutes.total,
  ];
  assertDeepEq(shapes, [10, 10, 10], 'Date / epoch ms / ISO `now` all agree at the entry point');

  // Scale: a full 200-session history (the storage cap) must not break maths.
  const full: PracticeSession[] = [];
  for (let i = 0; i < 200; i++) {
    full.push(onDay(new Date(Date.parse(`${TODAY}T12:00:00.000Z`) - i * 86_400_000).toISOString().slice(0, 10), 70, 60));
  }
  const capped = evaluateReinforcement({ history: full, completedSession: completed(NOW, 80, 60), now: NOW, tz: UTC });
  assertEq(capped !== null, true, 'a 200-session history evaluates (storage cap is respected)');
  assertEq(capped ? capped.streaks.currentDays : -1, 200, '200 consecutive days → streak 200');
  assertEq(capped ? capped.streaks.nextTier : -1, null, 'a 200-day streak has no tier left');
  assertEq(capped ? capped.streaks.totalPracticeDays : -1, 200, 'the capped history keeps 200 practice days');
  assertEq(
    capped ? capped.minutes.total : -1,
    200,
    'documented cap effect: appending to a full 200-session history drops the oldest run, so its minutes are no longer counted',
  );
  assertDeepEq(capped ? capped.minutes.crossed : [-1], [], 'thresholds passed long ago do not re-fire on a capped history');
  assertEq(capped ? capped.minutes.next_tier : -1, 1000, 'the capped history still points at the next milestone');
  assertEq(capped ? capped.minutes.minutesToNext : -1, 800, 'and reports the remaining minutes accurately (800)');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== practice reinforcement (slice 1: engine) ===');
  streakTests();
  minutesTests();
  personalBestTests();
  celebrationTests();
  nudgeTests();
  entryPointTests();
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
