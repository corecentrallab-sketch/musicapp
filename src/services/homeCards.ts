/**
 * homeCards.ts — the pure decisions behind Home's three summary cards.
 *
 * Owner-reported on device (v19 / 0.1.14): "⏱️ Practice today", "📋 This Week"
 * and the "🎯 For You" block all LOOKED tappable and did nothing. Home now
 * routes each one to a real destination, and this module owns those decisions
 * so they are testable under plain Node (scripts/homeCards.test.ts):
 *
 *   • ⏱️ Practice today → the featured piece's reader / piece page (the coach
 *                        lives there), or Find-a-Piece when the catalog did not
 *                        load — never a dead tap.
 *   • 📋 This Week      → the practice-week surface: which days were practised,
 *                        minutes per day, and this week's coached takes.
 *   • 🎯 For You        → Find-a-Piece (catalog browse / search by title).
 *
 * No react-native / expo imports here (deliberately): this file is listed in
 * tsconfig.tier1.json and compiled with no node_modules present.
 */

// ─── Destination mapping (Practice today) ──────────────────────

/**
 * Where tapping the "⏱️ Practice today" card lands.
 *
 *  • `sheet`      → the in-app sheet-music reader for the featured piece
 *  • `piece`      → the piece page (score button + practice coach)
 *  • `find-piece` → Find-a-Piece, the fallback when the catalog did not load
 */
export type PracticeTodayDestination = 'sheet' | 'piece' | 'find-piece';

/** The slice of DailyChallengePiece this mapping reads. */
export interface PracticeTodayChallenge {
  sheetMusicUrl?: string | null;
}

/**
 * The destination for "⏱️ Practice today".
 *
 * A blank/whitespace sheet URL is NOT a sheet (the same honesty rule the
 * catalog parser applies): the card still opens the piece page, which says
 * "sheet music coming soon" rather than opening an empty reader. A missing
 * challenge (catalog unreachable) falls through to Find-a-Piece so the tap
 * always has somewhere real to go.
 */
export function practiceTodayDestination(
  challenge: PracticeTodayChallenge | null | undefined,
): PracticeTodayDestination {
  if (!challenge) return 'find-piece';
  const url = challenge.sheetMusicUrl;
  return typeof url === 'string' && url.trim().length > 0 ? 'sheet' : 'piece';
}

// ─── Week view (This Week) ─────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface WeekDay {
  /** Local calendar day, YYYY-MM-DD (matches the storage keys). */
  date: string;
  /** Mon…Sun. */
  weekday: string;
  /** Short human label, e.g. "14 Sep". */
  label: string;
  /** Minutes recorded for this day (0 when none). */
  minutes: number;
  /** A day the user practised: a recorded practice day, or minutes > 0. */
  practiced: boolean;
  isToday: boolean;
  /** Later this week than today — rendered as "—", never as a failure. */
  isFuture: boolean;
}

export interface WeekView {
  /** Monday → Sunday of the current week, in order. */
  days: WeekDay[];
  /** Practised days inside this week (the "x" of "x/5 days practiced"). */
  practicedCount: number;
  /** Sum of the week's recorded minutes. */
  minutesTotal: number;
}

/** YYYY-MM-DD from LOCAL date parts — the same convention as storage.getDateStr. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local midnight on the Monday of `date`'s week. */
export function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

/**
 * Build the Monday→Sunday week view around `now` from the on-device records.
 *
 * A day counts as practised when it is in `practiceDays` OR it carries minutes:
 * the two stores (streak practice days, practice minutes) are written
 * separately, so trusting only one of them would under-report a real session.
 * Values outside the week are ignored, and junk minutes (NaN / negative /
 * non-finite) read as 0 rather than poisoning a total.
 */
export function buildWeekView(input: {
  now: Date;
  practiceDays?: readonly string[] | null;
  minutesByDay?: Record<string, number> | null;
}): WeekView {
  const now = input.now;
  const monday = mondayOf(now);
  const todayKey = localDateKey(now);
  const practiceDays = new Set(
    (input.practiceDays ?? []).filter((d): d is string => typeof d === 'string'),
  );
  const minutesByDay = input.minutesByDay ?? {};

  const days: WeekDay[] = [];
  let practicedCount = 0;
  let minutesTotal = 0;

  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    date.setDate(monday.getDate() + offset);
    const key = localDateKey(date);

    const rawMinutes = minutesByDay[key];
    const minutes =
      typeof rawMinutes === 'number' && Number.isFinite(rawMinutes) && rawMinutes > 0
        ? rawMinutes
        : 0;

    const practiced = practiceDays.has(key) || minutes > 0;
    if (practiced) practicedCount++;
    minutesTotal += minutes;

    days.push({
      date: key,
      weekday: WEEKDAY_LABELS[offset],
      label: `${date.getDate()} ${MONTH_LABELS[date.getMonth()]}`,
      minutes,
      practiced,
      isToday: key === todayKey,
      isFuture: key > todayKey,
    });
  }

  return {
    days,
    practicedCount,
    minutesTotal: Math.round(minutesTotal * 10) / 10,
  };
}

/** The card's "x/5 days practiced" line — ONE wording for Home and the week view. */
export function weekProgressCopy(current: number, target: number): string {
  return `${current}/${target} days practiced`;
}

/** Percentage width (0–100) for the weekly progress bar; opaque to bad input. */
export function weekPercent(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

// ─── Coached takes in the current week ─────────────────────────

export interface CoachedTakeSummary {
  count: number;
  /** Best accuracy in the week, 0–100, or null when nothing was scored. */
  bestAccuracyPct: number | null;
  /** Total length of the week's takes, rounded to whole minutes. */
  minutesTotal: number;
}

/** One practised run through the coach, in the shape this summary needs. */
export interface CoachedTakeLike {
  playedAt: string;
  accuracyPct: number;
  durationSec: number;
}

/**
 * Count this week's coached takes (and the best score among them) from the
 * on-device practice history. Sessions outside `weekDates`, unparseable
 * timestamps and junk numbers are skipped, never guessed at.
 */
export function coachedTakeSummary(
  sessions: readonly CoachedTakeLike[] | null | undefined,
  weekDates: readonly string[],
): CoachedTakeSummary {
  const inWeek = new Set(weekDates);
  let count = 0;
  let best: number | null = null;
  let seconds = 0;

  for (const session of sessions ?? []) {
    if (!session || typeof session.playedAt !== 'string') continue;
    const played = new Date(session.playedAt);
    if (Number.isNaN(played.getTime())) continue;
    if (!inWeek.has(localDateKey(played))) continue;

    count++;
    if (typeof session.accuracyPct === 'number' && Number.isFinite(session.accuracyPct)) {
      const pct = Math.max(0, Math.min(100, Math.round(session.accuracyPct)));
      if (best === null || pct > best) best = pct;
    }
    if (
      typeof session.durationSec === 'number' &&
      Number.isFinite(session.durationSec) &&
      session.durationSec > 0
    ) {
      seconds += session.durationSec;
    }
  }

  return {
    count,
    bestAccuracyPct: best,
    minutesTotal: Math.round(seconds / 60),
  };
}

/** Honest one-line summary of the week's coached takes. */
export function coachedTakeCopy(summary: CoachedTakeSummary): string {
  if (summary.count <= 0) {
    return 'No coached takes this week yet — open a piece and record one.';
  }
  const takes = summary.count === 1 ? '1 coached take' : `${summary.count} coached takes`;
  const best =
    summary.bestAccuracyPct === null
      ? ''
      : ` · best ${summary.bestAccuracyPct}% accuracy`;
  return `${takes} this week${best}`;
}

// ─── For You copy (no promise of a feed that does not exist) ───

/** The card's affordance: it opens catalog browse/search. */
export const FOR_YOU_CTA = 'Browse catalog →';

/**
 * The byline under the personalised line. The destination is a plain catalog
 * search — it does not filter by instrument/level yet — so the copy says what
 * it does and admits the personalised feed is still to come, instead of
 * claiming a feed the app cannot show.
 */
export const FOR_YOU_BYLINE_PERSONALISED =
  'Search by title or composer — a personalised feed is still coming.';
/** Same card, for a user who has not answered onboarding. */
export const FOR_YOU_BYLINE_DEFAULT =
  'Tell us what you play to shape your picks — meanwhile, search by title or composer.';

export function forYouByline(hasOnboarding: boolean): string {
  return hasOnboarding ? FOR_YOU_BYLINE_PERSONALISED : FOR_YOU_BYLINE_DEFAULT;
}

/** Accessibility label for the For You card (screen readers get the truth too). */
export function forYouAccessibilityLabel(personalisedCopy: string): string {
  return `${personalisedCopy} — browse the catalog`;
}

// ─── Practice-week screen copy ─────────────────────────────────

/** CTA on the "This Week" screen: practice the featured piece when we have one. */
export function practiceWeekCta(featuredTitle: string | null | undefined): string {
  const title = typeof featuredTitle === 'string' ? featuredTitle.trim() : '';
  return title ? `Practice “${title}” →` : 'Find a piece to practice →';
}

/** Reserved copy for a day with no practice, so the week never looks broken. */
export const NO_PRACTICE_TODAY = 'No practice yet';
/** Copy for a future day of the same week. */
export const WEEK_DAY_FUTURE = '—';

/**
 * What a week row says on the right. Minutes win when there are any ("12 min");
 * a recorded practice day with no minutes (a coached take shorter than the
 * minute tracker, or the daily-challenge tap) still reads as practised rather
 * than as "no practice" — the week view never contradicts the tick.
 */
export function weekDayStatusText(
  day: Pick<WeekDay, 'minutes' | 'practiced' | 'isFuture'>,
): string {
  if (day.minutes >= 1) return `${Math.round(day.minutes)} min`;
  if (day.minutes > 0) return '<1 min practised';
  if (day.practiced) return 'Practised ✓';
  return day.isFuture ? WEEK_DAY_FUTURE : NO_PRACTICE_TODAY;
}

/** The week's minute total, said honestly when nothing was logged. */
export function weekTotalCopy(minutesTotal: number): string {
  if (!Number.isFinite(minutesTotal) || minutesTotal <= 0) {
    return 'No minutes logged this week yet';
  }
  if (minutesTotal < 1) return 'Under a minute logged this week';
  return `${Math.round(minutesTotal)} min this week`;
}
