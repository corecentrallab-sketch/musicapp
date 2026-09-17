/**
 * Unit tests for practice-reinforcement slice 2 (the UI-facing layer):
 *   • src/services/practiceReinforcementView.ts — what the UI may show, and where
 *     (celebration cap, streak line, nudge surface/day gating, nudge time)
 *   • src/services/practiceReinforcement.evaluateNudge() — the slice-2 engine
 *     addition the outside-play nudge card reads
 *
 * Run with: npm run test:tier1
 * Compiles the pure modules + this test to CommonJS and runs under plain Node
 * (same convention as scripts/practiceReinforcement.test.ts — no test framework,
 * no app runtime, no react-native). Rendering itself is NOT covered here: the
 * components are thin wrappers around these selectors.
 *
 * Determinism: every call injects `now` and a fixed UTC offset (`tz: 0`) so days
 * line up with the ISO fixtures in the history.
 */
import {
  MAX_CELEBRATIONS,
  EMPTY_STREAK_SUMMARY,
  NUDGE_HOUR,
  buildReinforcementMoment,
  nextNudgeTime,
  nudgeForSurface,
  streakLine,
} from '../src/services/practiceReinforcementView';
import {
  evaluateNudge,
  evaluateReinforcement,
  type Celebration,
  type Reinforcement,
  type ReinforcementNudge,
} from '../src/services/practiceReinforcement';
import { STREAK_TIERS, computeStreak } from '../src/services/practiceStreaks';
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

const UTC = 0;
const TODAY = '2026-09-17';
const NOW = `${TODAY}T12:00:00.000Z`;
/** Session fixture on a UTC day, `back` days before TODAY. */
function session(back: number, accuracyPct = 70, durationSec = 60): PracticeSession {
  const iso = new Date(Date.parse(NOW) - back * 86_400_000).toISOString();
  return { pieceId: 'fur-elise', accuracyPct, durationSec, playedAt: iso };
}

// ─── streak line ───────────────────────────────────────────────

function streakLineTests(): void {
  console.log('\n— streak line (quiet, positive, derived from streak fields) —');
  assertEq(streakLine(null), null, 'no streak → no line (silence, never "0-day streak")');
  assertEq(streakLine(undefined), null, 'undefined summary → no line');
  assertEq(
    streakLine({ currentDays: 0, nextTier: 3, daysToNextTier: 3 }),
    null,
    'zero-day streak → no line',
  );
  assertEq(
    streakLine({ currentDays: NaN, nextTier: 3, daysToNextTier: 3 }),
    null,
    'unusable day count → no line',
  );

  const three = streakLine({ currentDays: 3, nextTier: 7, daysToNextTier: 4 });
  assertEq(
    three ? three.text : null,
    '3-day streak — 4 more days to hit 7',
    'the brief\'s line renders from streak fields',
  );
  assertEq(three ? three.nextTier : null, 7, 'next tier carried through');
  assertEq(three ? three.daysToNextTier : -1, 4, 'days-to-next carried through');

  assertEq(
    streakLine({ currentDays: 1, nextTier: 3, daysToNextTier: 2 })?.text,
    '1-day streak — 2 more days to hit 3',
    'singular "1-day streak"',
  );
  assertEq(
    streakLine({ currentDays: 6, nextTier: 7, daysToNextTier: 1 })?.text,
    '6-day streak — 1 more day to hit 7',
    'singular "1 more day"',
  );
  assertEq(
    streakLine({ currentDays: 100, nextTier: null, daysToNextTier: 0 })?.text,
    '100-day streak — you have reached every practice milestone',
    'past every tier → no next tier promised',
  );
  assertEq(
    streakLine({ currentDays: 4, nextTier: 7, daysToNextTier: NaN })?.text,
    '4-day streak — 0 more days to hit 7',
    'a malformed remaining count degrades to 0, it never prints NaN',
  );

  // Derived from the real engine, so the two cannot drift apart.
  const streaks = computeStreak([session(2), session(1), session(0)], NOW, UTC);
  assertEq(streaks.currentDays, 3, 'engine: 3 consecutive days including today');
  assertEq(
    streakLine(streaks)?.text,
    '3-day streak — 4 more days to hit 7',
    'line built straight from an engine summary',
  );
}

// ─── the moment ────────────────────────────────────────────────

function momentTests(): void {
  console.log('\n— reinforcement moment (celebrations capped, nothing fabricated) —');

  assertEq(buildReinforcementMoment(null), null, 'no engine result → no moment');
  assertEq(buildReinforcementMoment(undefined), null, 'undefined result → no moment');

  // First ever scored run: welcome celebration + streak line for day 1.
  const first = evaluateReinforcement({
    history: [],
    completedSession: { pieceId: 'fur-elise', accuracyPct: 80, durationSec: 150 },
    now: NOW,
    tz: UTC,
  });
  const firstMoment = buildReinforcementMoment(first, { durationSec: 150 });
  assertEq(firstMoment?.hasMoment, true, 'first run produces a moment');
  assertEq(
    firstMoment?.celebrations[0]?.kind,
    'first-session',
    'and it is the welcome celebration',
  );
  assertEq(firstMoment?.streakDays, 1, 'share card gets the engine streak (1 day)');
  assertEq(firstMoment?.runMinutes, 3, 'this run\'s minutes for the share card (150s → 3)');
  assertEq(firstMoment?.streakLine?.text, '1-day streak — 2 more days to hit 3', 'day-1 line');

  // Crossing the 3-day tier.
  const tier = evaluateReinforcement({
    history: [session(2), session(1)],
    completedSession: { pieceId: 'fur-elise', accuracyPct: 60, durationSec: 60 },
    now: NOW,
    tz: UTC,
  });
  const tierMoment = buildReinforcementMoment(tier, { durationSec: 60 });
  assertEq(
    tierMoment?.celebrations.some((c) => c.kind === 'streak-tier'),
    true,
    'a streak-tier crossing is celebrated',
  );
  assertEq(tierMoment?.streakDays, 3, 'moment reports the new streak');
  assertEq(
    tierMoment?.celebrations[0]?.copy.includes('%'),
    false,
    'celebration copy never carries a raw percentage',
  );
  assertEq(
    (tierMoment?.celebrations[0]?.copy ?? '').toLowerCase().includes("don't break"),
    false,
    'celebration copy carries no guilt framing',
  );

  // A second run on the same day that crosses nothing and has a 1-day streak:
  // the streak line only. No manufactured celebration.
  const sameDay = evaluateReinforcement({
    history: [session(0, 90, 60)],
    completedSession: { pieceId: 'fur-elise', accuracyPct: 40, durationSec: 60 },
    now: NOW,
    tz: UTC,
  });
  const sameDayMoment = buildReinforcementMoment(sameDay, { durationSec: 60 });
  assertEq(sameDayMoment?.celebrations.length, 0, 'no crossing → no celebration');
  assertEq(sameDayMoment?.hasMoment, false, 'hasMoment stays false (no big moment)');
  assertEq(
    sameDayMoment?.streakLine?.text,
    '1-day streak — 2 more days to hit 3',
    'the run still gets the quiet streak line',
  );

  // Nothing at all: the run itself is days old (a late-synced take), the streak
  // is broken and nothing was crossed.
  const nothing = evaluateReinforcement({
    history: [session(5, 90, 60)],
    completedSession: {
      pieceId: 'fur-elise',
      accuracyPct: 40,
      durationSec: 60,
      playedAt: session(4).playedAt,
    },
    now: NOW,
    tz: UTC,
  });
  assertEq(nothing?.streaks.currentDays, 0, 'engine: broken streak');
  assertEq(nothing?.celebrations.length, 0, 'engine: nothing crossed');
  assertEq(
    buildReinforcementMoment(nothing, { durationSec: 60 }),
    null,
    'nothing to celebrate and no streak → NO moment (never a fake one)',
  );

  // Cap: one run can cross several things at once.
  const fakeCelebrations: Celebration[] = [1, 2, 3, 4, 5].map((i) => ({
    kind: 'minutes-milestone',
    title: `milestone ${i}`,
    emoji: '🏅',
    copy: 'copy',
    shareText: 'share',
    value: i,
    threshold: i,
  }));
  const heavy = {
    ...(first as Reinforcement),
    celebrations: fakeCelebrations,
  };
  const capped = buildReinforcementMoment(heavy, { durationSec: 0 });
  assertEq(capped?.celebrations.length, MAX_CELEBRATIONS, 'celebrations are capped');
  assertEq(capped?.hasMoment, true, 'a capped moment is still a moment');
  assertEq(capped?.runMinutes, 0, 'unknown run length → 0 minutes, not NaN');
  assertEq(capped?.totalMinutes, first?.minutes.total ?? -1, 'total minutes pass through');

  const noRun = buildReinforcementMoment(first);
  assertEq(noRun?.runMinutes, 0, 'omitted run info → 0 minutes');

  // Every celebration the engine can emit carries shareable text for the card.
  for (const celebration of capped?.celebrations ?? []) {
    assert(celebration.shareText.length > 0, `celebration "${celebration.title}" has shareText`);
  }
}

// ─── nudge gating ──────────────────────────────────────────────

function nudgeGateTests(): void {
  console.log('\n— nudge gate (outside play only, once a day, never fabricated) —');

  assertEq(
    nudgeForSurface({ nudge: null, surface: 'home' }),
    null,
    'no payload → no card',
  );

  const engineNudge = evaluateNudge({ history: [session(1)], now: NOW, tz: UTC });
  assert(engineNudge !== null, 'engine: practised yesterday, none today → at-risk nudge');
  assertEq(engineNudge?.playSafeOnly, true, 'payload carries the play-safe contract');
  assertEq(engineNudge?.surface, 'outside-play-only', 'payload names its surface');
  assertEq(engineNudge?.streakDays, 1, 'payload counts the live streak');
  assertEq(
    engineNudge?.daysToNextTier,
    STREAK_TIERS[0] - 1,
    'payload points at the next tier honestly',
  );

  assertEq(
    nudgeForSurface({ nudge: engineNudge, surface: 'home' })?.kind,
    'at-risk-streak',
    'home may show it',
  );
  assertEq(
    nudgeForSurface({ nudge: engineNudge, surface: 'piece-detail' })?.kind,
    'at-risk-streak',
    'the piece screen (idle) may show it',
  );
  assertEq(nudgeForSurface({ nudge: engineNudge, surface: 'play' }), null, 'never during play');
  assertEq(nudgeForSurface({ nudge: engineNudge, surface: 'score' }), null, 'never on the score');

  const brokenContract = { ...(engineNudge as ReinforcementNudge), playSafeOnly: false as true };
  assertEq(
    nudgeForSurface({ nudge: brokenContract, surface: 'home' }),
    null,
    'a payload without the play-safe flag is rejected',
  );
  const wrongSurface = {
    ...(engineNudge as ReinforcementNudge),
    surface: 'inside-play' as 'outside-play-only',
  };
  assertEq(
    nudgeForSurface({ nudge: wrongSurface, surface: 'home' }),
    null,
    'a payload for another surface is rejected',
  );
  const noStreak = { ...(engineNudge as ReinforcementNudge), streakDays: 0 };
  assertEq(
    nudgeForSurface({ nudge: noStreak, surface: 'home' }),
    null,
    'nothing to keep warm → no card',
  );

  assertEq(
    nudgeForSurface({
      nudge: engineNudge,
      surface: 'home',
      dismissedDayKey: TODAY,
      todayKey: TODAY,
    }),
    null,
    'dismissed today → silent for the rest of the day',
  );
  assert(
    nudgeForSurface({
      nudge: engineNudge,
      surface: 'home',
      dismissedDayKey: '2026-09-16',
      todayKey: TODAY,
    }) !== null,
    'yesterday\'s dismissal does not silence today',
  );
  assert(
    nudgeForSurface({ nudge: engineNudge, surface: 'home', todayKey: TODAY }) !== null,
    'no stored dismissal → card is allowed',
  );
}

// ─── engine: evaluateNudge (slice-2 addition) ──────────────────

function evaluateNudgeTests(): void {
  console.log('\n— engine evaluateNudge (the outside-play path) —');
  assertEq(
    evaluateNudge({ history: [], now: NOW, tz: UTC }),
    null,
    'no practice history → no nudge',
  );
  assertEq(
    evaluateNudge({ history: [session(0)], now: NOW, tz: UTC }),
    null,
    'practised today → no nudge (nothing to keep warm)',
  );
  assertEq(
    evaluateNudge({ history: [session(2)], now: NOW, tz: UTC }),
    null,
    'streak already broken → no nudge, and no guilt',
  );
  const atRisk = evaluateNudge({ history: [session(1)], now: NOW, tz: UTC });
  assertEq(atRisk?.streakDays, 1, 'alive-but-not-today → nudge with the real streak');
  assert(
    (atRisk?.copy ?? '').toLowerCase().includes('don\'t') === false,
    'nudge copy carries no guilt framing',
  );
  // Same payload the post-run path returns, so the UI has one source.
  const viaRun = evaluateReinforcement({
    history: [session(1)],
    completedSession: { pieceId: 'fur-elise', accuracyPct: 70, durationSec: 60 },
    now: NOW,
    tz: UTC,
  });
  assertEq(viaRun?.nudge, null, 'a run that lands TODAY clears the at-risk nudge');
}

// ─── nudge time ────────────────────────────────────────────────

function nudgeTimeTests(): void {
  console.log('\n— next nudge time (one shot at 18:00, never late at night) —');
  assertEq(NUDGE_HOUR, 18, 'the nudge hour is 18:00 local');

  const morning = new Date(2026, 8, 17, 10, 30, 0, 0);
  const at = nextNudgeTime(morning);
  assertEq(at?.getHours(), 18, 'morning → today at 18:00');
  assertEq(at?.getMinutes(), 0, 'on the hour');
  assertEq(at?.getDate(), 17, 'same local day');
  assert(
    (at?.getTime() ?? 0) > morning.getTime(),
    'scheduled in the future',
  );

  const evening = new Date(2026, 8, 17, 19, 0, 0, 0);
  assertEq(nextNudgeTime(evening), null, 'after the hour → nothing scheduled (no stale nudge)');
  const exactly = new Date(2026, 8, 17, 18, 0, 0, 0);
  assertEq(nextNudgeTime(exactly), null, 'exactly at the hour → nothing (not strictly future)');
  assertEq(
    nextNudgeTime(new Date(2026, 8, 17, 8, 0, 0, 0), 9)?.getHours(),
    9,
    'hour is injectable',
  );
  assertEq(nextNudgeTime(new Date('nope')), null, 'unusable date → nothing scheduled');
}

// ─── shared zeroed summary ─────────────────────────────────────

function emptySummaryTests(): void {
  console.log('\n— zeroed streak summary —');
  assertEq(EMPTY_STREAK_SUMMARY.currentDays, 0, 'no streak before the first read');
  assertEq(EMPTY_STREAK_SUMMARY.longestDays, 0, 'no best streak either');
  assertEq(EMPTY_STREAK_SUMMARY.nextTier, STREAK_TIERS[0], 'first tier is still ahead');
  assertEq(streakLine(EMPTY_STREAK_SUMMARY), null, 'the zeroed summary shows nothing');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== practice reinforcement (slice 2: view layer) ===');
  streakLineTests();
  momentTests();
  nudgeGateTests();
  evaluateNudgeTests();
  nudgeTimeTests();
  emptySummaryTests();
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
