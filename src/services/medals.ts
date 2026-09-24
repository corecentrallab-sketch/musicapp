/**
 * medals.ts — the MEDALS & ACHIEVEMENTS layer (owner-approved 08-25, retention
 * build: the "desire layer" that rides the closed-test builds after v25).
 *
 * WHAT THIS IS
 * Every medal the app can award, the exact rule that earns it, and the progress
 * a user still has to make — all as ONE pure module, so the medals screen, the
 * unlock toast, the achievement share card and the tier-1 gate read the SAME
 * numbers and the SAME words. Persistence lives in ./medalStore.ts, the surface
 * in src/screens/AchievementsScreen.tsx; nothing here touches storage, the
 * clock, react-native or the network.
 *
 * THE THREE FAMILIES (all from the approved design)
 *   1. STREAK — 3 / 7 / 14 / 30 / 100 days in a row (the loss-aversion anchor).
 *      Thresholds are IMPORTED from ./practiceStreaks (STREAK_TIERS), not
 *      retyped, so a medal can never disagree with the streak the app displays.
 *   2. MINUTES — 100 / 1 000 / 5 000 total practice minutes, the "Iron Fingers"
 *      ladder. Thresholds and labels come from ./practiceMilestones
 *      (MILESTONES / MILESTONE_LABELS) for the same reason. Compound and
 *      non-resetting: total minutes only grow.
 *   3. REPERTOIRE — first match recognized, 10 different pieces opened, 25
 *      pieces in the library.
 *
 * TWO RULES THAT DECIDE EVERY DESIGN QUESTION HERE
 *   • EARNED ONCE, STAYS EARNED. A medal record is written when its rule first
 *     holds and is never removed — so a broken streak, a deleted library item or
 *     the practice-history cap (200 runs, see practiceHistory.ts) can never take
 *     a medal away. `awardMedalRecords()` is the whole rule: it only ever APPENDS
 *     ids that are not already in the records, which makes re-running it
 *     idempotent (a second call awards nothing).
 *   • HONEST, NOT FLATTERING. A medal's progress comes from the metric the medal
 *     is actually about, and a metric is never invented. Two consequences worth
 *     knowing:
 *       - Streak medals evaluate `longestStreakDays`, not the CURRENT streak.
 *         The achievement is "you once practised N days in a row", and the medal
 *         must not depend on which day the app happened to check — a user whose
 *         7-day run ended before an app update still earned their 7-day medal.
 *         The Achievements screen still shows the current streak, labelled as
 *         the current streak (see ./reinforcementStore.ts for that number).
 *         `currentStreakDays` is used only as a floor, so a live run that the
 *         history has not collapsed into `longestDays` (clock skew, a session
 *         whose playedAt is in the future) can never *under*-report.
 *       - `piecesOpened` counts DISTINCT piece ids the user actually opened
 *         (./medalStore.ts keeps that small local ledger), not recognitions and
 *         not saves: three different medals must not be the same number wearing
 *         three hats.
 *
 * COPY RULE (same as the reinforcement layer): celebratory, never guilt-driven.
 * No "don't lose your streak", no manufactured urgency, no fake scarcity.
 *
 * GUARDS: scripts/medals.test.ts (tier-1) tests the rules above AND scans the
 * real screens/components from disk for the wirings that no pure test can see —
 * the achievements entry on Home, the share path on a medal, the share card's
 * medal block, the non-blocking toast, the opened-piece ledger. Each scanner is
 * exported from here (pure string functions) so the screen and the gate can
 * never drift apart.
 */
import { STREAK_TIERS } from './practiceStreaks';
import { MILESTONES, MILESTONE_LABELS } from './practiceMilestones';
import { maskComments } from './modalBackContract';
import { elementWithMarker } from './frontDoor';

// ─── the catalog ───────────────────────────────────────────────

export type MedalCategory = 'streak' | 'minutes' | 'repertoire';

/**
 * The metric a medal reads. One metric per number the app can honestly observe.
 */
export type MedalMetric =
  | 'streak-days'
  | 'total-minutes'
  | 'recognitions'
  | 'pieces-opened'
  | 'library-items';

export interface Medal {
  id: string;
  /** Short, flavourful name ("Iron Fingers II", "Piece Explorer"). */
  name: string;
  /** Exactly what earns it — the rule, in the user's words. */
  description: string;
  emoji: string;
  category: MedalCategory;
  metric: MedalMetric;
  /** Value of the metric at which the medal is earned. */
  threshold: number;
}

/** Stable ids — persisted in the medal records, so never rename one. */
export const STREAK_MEDAL_IDS: Record<number, string> = {
  3: 'streak-3',
  7: 'streak-7',
  14: 'streak-14',
  30: 'streak-30',
  100: 'streak-100',
};

export const MINUTES_MEDAL_IDS: Record<number, string> = {
  100: 'minutes-100',
  1000: 'minutes-1000',
  5000: 'minutes-5000',
};

export const FIRST_MATCH_MEDAL_ID = 'first-match';
export const PIECES_OPENED_MEDAL_ID = 'pieces-opened-10';
export const LIBRARY_MEDAL_ID = 'library-25';

/** Pieces that must be opened for the repertoire medal. */
export const PIECES_OPENED_TARGET = 10;
/** Library items that must be collected for the library medal. */
export const LIBRARY_TARGET = 25;

/**
 * Plain thousands separator — `toLocaleString` is not dependable on every
 * Hermes build (some ship without Intl) and a medal description is copy that
 * must read the same everywhere.
 */
export function thousands(value: number): string {
  const digits = String(Math.abs(Math.trunc(value)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return value < 0 ? `-${out}` : out;
}

const REPERTOIRE_MEDALS: Medal[] = [
  {
    id: FIRST_MATCH_MEDAL_ID,
    name: 'First Match',
    description: 'Recognize your first piece of music.',
    emoji: '🎵',
    category: 'repertoire',
    metric: 'recognitions',
    threshold: 1,
  },
  {
    id: PIECES_OPENED_MEDAL_ID,
    name: 'Piece Explorer',
    description: `Open ${PIECES_OPENED_TARGET} different pieces.`,
    emoji: '📖',
    category: 'repertoire',
    metric: 'pieces-opened',
    threshold: PIECES_OPENED_TARGET,
  },
  {
    id: LIBRARY_MEDAL_ID,
    name: 'Library Builder',
    description: `Add ${LIBRARY_TARGET} pieces to your library.`,
    emoji: '📚',
    category: 'repertoire',
    metric: 'library-items',
    threshold: LIBRARY_TARGET,
  },
];

/**
 * The full catalog in display order: the streak ladder (the headline), then the
 * compound minutes ladder, then the repertoire medals. Every threshold is
 * sourced from the engine that measures it.
 */
export const MEDALS: readonly Medal[] = [
  ...STREAK_TIERS.map((tier): Medal => ({
    id: STREAK_MEDAL_IDS[tier] ?? `streak-${tier}`,
    name: `${tier}-Day Streak`,
    description: `Practise ${tier} days in a row.`,
    emoji: '🔥',
    category: 'streak',
    metric: 'streak-days',
    threshold: tier,
  })),
  ...MILESTONES.map((tier): Medal => ({
    id: MINUTES_MEDAL_IDS[tier] ?? `minutes-${tier}`,
    name: MILESTONE_LABELS[tier] ?? `${tier} minutes`,
    description: `Log ${thousands(tier)} minutes of practice in total.`,
    emoji: '🏅',
    category: 'minutes',
    metric: 'total-minutes',
    threshold: tier,
  })),
  ...REPERTOIRE_MEDALS,
];

export const MEDAL_COUNT = MEDALS.length;

export function medalById(id: string): Medal | null {
  return MEDALS.find((medal) => medal.id === id) ?? null;
}

// ─── the numbers a medal reads ─────────────────────────────────

/** Everything the catalog can observe about a user, in one plain object. */
export interface MedalStats {
  /** Consecutive practice days ending today/yesterday (see practiceStreaks). */
  currentStreakDays: number;
  /** Longest consecutive run anywhere in the practice history. */
  longestStreakDays: number;
  /** Total minutes across the practice history (see practiceMilestones). */
  totalMinutes: number;
  /** Pieces recognized and saved to History. */
  recognitions: number;
  /** DISTINCT pieces the user has opened. */
  piecesOpened: number;
  /** Items in the library (imported, scanned or saved scores). */
  libraryItems: number;
}

export const EMPTY_MEDAL_STATS: MedalStats = {
  currentStreakDays: 0,
  longestStreakDays: 0,
  totalMinutes: 0,
  recognitions: 0,
  piecesOpened: 0,
  libraryItems: 0,
};

/** A non-negative integer view of a stat, so a broken read can never print NaN. */
function count(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Normalize any partial/legacy stats object into a complete, honest one. */
export function normalizeMedalStats(stats?: Partial<MedalStats> | null): MedalStats {
  const source = stats ?? {};
  return {
    currentStreakDays: count(source.currentStreakDays),
    longestStreakDays: count(source.longestStreakDays),
    totalMinutes: count(source.totalMinutes),
    recognitions: count(source.recognitions),
    piecesOpened: count(source.piecesOpened),
    libraryItems: count(source.libraryItems),
  };
}

/**
 * The value a medal's metric currently holds. Streak medals take the better of
 * the longest run and the current run (the current run can lead the collapsed
 * history by one under clock skew — never *behind* it) so progress is never
 * under-reported while the medal is still unearned.
 */
export function medalMetricValue(medal: Medal, stats: MedalStats): number {
  switch (medal.metric) {
    case 'streak-days':
      return Math.max(count(stats.longestStreakDays), count(stats.currentStreakDays));
    case 'total-minutes':
      return count(stats.totalMinutes);
    case 'recognitions':
      return count(stats.recognitions);
    case 'pieces-opened':
      return count(stats.piecesOpened);
    case 'library-items':
      return count(stats.libraryItems);
    default:
      return 0;
  }
}

// ─── earned, once, forever ─────────────────────────────────────

/**
 * A medal as it is PERSISTED once earned. `contextTitle`/`contextSubtitle`
 * carry the piece or song that was on screen when it unlocked, which is what
 * makes the achievement share card personal ("working on Für Elise").
 */
export interface MedalRecord {
  /** Medal id from MEDALS. */
  id: string;
  /** ISO timestamp of the unlock — never rewritten on a later run. */
  earnedAt: string;
  contextTitle: string | null;
  contextSubtitle: string | null;
}

export interface MedalContext {
  title: string | null;
  subtitle: string | null;
}

export const EMPTY_MEDAL_CONTEXT: MedalContext = { title: null, subtitle: null };

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Piece/song context for a medal, from whatever was on screen at unlock. */
export function medalContext(
  title?: string | null,
  subtitle?: string | null,
): MedalContext {
  return { title: trimOrNull(title), subtitle: trimOrNull(subtitle) };
}

/** True when `id` is already in the record list (earned stays earned). */
export function isMedalEarned(id: string, records: readonly MedalRecord[]): boolean {
  return records.some((record) => record.id === id);
}

/** Ids whose rule holds at `stats` and which are NOT already recorded. */
export function newlyEarnedMedalIds(
  stats: MedalStats,
  records: readonly MedalRecord[],
): string[] {
  const earned = new Set(records.map((record) => record.id));
  return MEDALS.filter(
    (medal) => !earned.has(medal.id) && medalMetricValue(medal, stats) >= medal.threshold,
  ).map((medal) => medal.id);
}

/** Medal ids in catalog order — used to keep records sorted and stable. */
function catalogOrder(id: string): number {
  const index = MEDALS.findIndex((medal) => medal.id === id);
  return index < 0 ? MEDALS.length : index;
}

/**
 * THE award rule, in one pure function: append a record for every newly earned
 * medal, keep every existing record untouched, return both. Idempotent — calling
 * it twice with the same stats and the same records awards nothing the second
 * time, and no record's `earnedAt` is ever rewritten.
 */
export function awardMedalRecords(
  stats: MedalStats,
  records: readonly MedalRecord[],
  ctx: MedalContext = EMPTY_MEDAL_CONTEXT,
  nowIso: string,
): { records: MedalRecord[]; unlocks: MedalRecord[] } {
  const fresh = newlyEarnedMedalIds(stats, records);
  const unlocks: MedalRecord[] = fresh.map((id) => ({
    id,
    earnedAt: nowIso,
    contextTitle: ctx.title,
    contextSubtitle: ctx.subtitle,
  }));
  const next = [...records, ...unlocks].sort(
    (a, b) => catalogOrder(a.id) - catalogOrder(b.id),
  );
  return { records: next, unlocks };
}

// ─── progress (what the screen shows) ──────────────────────────

export interface MedalProgress {
  medal: Medal;
  earned: boolean;
  /** ISO unlock timestamp, or null while unearned. */
  earnedAt: string | null;
  /** The piece/song that was on screen at unlock (for the share card). */
  context: MedalContext;
  /** Current metric value, clamped to the threshold for display. */
  value: number;
  target: number;
  /** 0–100, and never 100 while unearned (no "complete" medal that isn't). */
  percent: number;
  /** How much of the metric is still missing (0 once earned). */
  remaining: number;
  /** One short line for the row ("3 of 7 days in a row"). */
  progressLabel: string;
}

/** Unit word per metric, for progress copy. */
const METRIC_UNITS: Record<MedalMetric, string> = {
  'streak-days': 'days in a row',
  'total-minutes': 'minutes',
  recognitions: 'recognitions',
  'pieces-opened': 'pieces opened',
  'library-items': 'pieces in your library',
};

/** Short progress line — the number, the unit, the target. Always honest. */
export function medalProgressLabel(medal: Medal, value: number): string {
  const shown = Math.min(count(value), medal.threshold);
  const unit = METRIC_UNITS[medal.metric];
  // Recognitions read better without a repeated "1 recognitions"; the rest are
  // fixed phrases where the count is the interesting part.
  if (medal.metric === 'recognitions') {
    return `${shown} of ${medal.threshold} ${shown === 1 ? 'recognition' : 'recognitions'}`;
  }
  return `${shown} of ${medal.threshold} ${unit}`;
}

/** Progress for one medal at `stats`, with its earned flag from `records`. */
export function medalProgress(
  medal: Medal,
  stats: MedalStats,
  records: readonly MedalRecord[],
): MedalProgress {
  const record = records.find((entry) => entry.id === medal.id) ?? null;
  const raw = medalMetricValue(medal, stats);
  const earned = record !== null;
  const value = Math.min(raw, medal.threshold);
  const remaining = earned ? 0 : Math.max(0, medal.threshold - raw);
  const percent = earned
    ? 100
    : Math.min(99, Math.floor((value / medal.threshold) * 100));
  return {
    medal,
    earned,
    earnedAt: record ? record.earnedAt : null,
    context: medalContext(record?.contextTitle, record?.contextSubtitle),
    value,
    target: medal.threshold,
    percent,
    remaining,
    progressLabel: medalProgressLabel(medal, raw),
  };
}

/** Every medal, catalog order, with its honest progress. */
export function medalProgressList(
  stats: MedalStats,
  records: readonly MedalRecord[],
): MedalProgress[] {
  return MEDALS.map((medal) => medalProgress(medal, stats, records));
}

export function earnedMedalCount(
  stats: MedalStats,
  records: readonly MedalRecord[],
): number {
  return MEDALS.filter((medal) => isMedalEarned(medal.id, records)).length;
}

/**
 * The next medal to earn: the unearned one closest to its threshold, so the
 * screen can say "next up" without inventing a target the user cannot reach.
 * Ties break on catalog order (streak ladder first).
 */
export function nextMedalToEarn(
  stats: MedalStats,
  records: readonly MedalRecord[],
): MedalProgress | null {
  const candidates = medalProgressList(stats, records).filter((entry) => !entry.earned);
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.remaining < best.remaining) best = candidate;
  }
  return best;
}

/** The quiet Home entry line: "3 of 11 earned · next: 7-Day Streak". */
export function achievementsSummaryLine(
  stats: MedalStats,
  records: readonly MedalRecord[],
): string {
  const earned = earnedMedalCount(stats, records);
  const next = nextMedalToEarn(stats, records);
  const base = `${earned} of ${MEDAL_COUNT} earned`;
  return next ? `${base} · next: ${next.medal.name}` : `${base} — every medal earned`;
}

// ─── the achievement share card (extends ShareCard) ────────────

/**
 * The unlock date as a short label ("24 Sep 2026"), or null when the record has
 * no usable timestamp. Hand-rolled on purpose: `toLocaleDateString` is not
 * dependable on every Hermes build, and a medal row must render the same
 * everywhere.
 */
export function earnedDateLabel(earnedAt: string | null | undefined): string | null {
  if (typeof earnedAt !== 'string' || earnedAt.length === 0) return null;
  const ms = Date.parse(earnedAt);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const day = date.getUTCDate();
  const month = EARNED_MONTHS[date.getUTCMonth()] ?? '';
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

const EARNED_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Headline on the congratulatory card: "🏅 Iron Fingers I unlocked!" */
export function medalHeadline(medal: Medal): string {
  return `${medal.emoji} ${medal.name} unlocked!`;
}

/** Title line: the piece/song context when there is one, else the medal name. */
export function medalCardTitle(medal: Medal, ctx: MedalContext): string {
  return ctx.title ?? medal.name;
}

/** Subtitle line under the title — the piece's composer, or the medal's rule. */
export function medalCardSubtitle(medal: Medal, ctx: MedalContext): string {
  if (ctx.title) return ctx.subtitle ?? medal.description;
  return medal.description;
}

/** Ready-to-share sentence (the brand link is added by shareCardShare). */
export function medalShareText(medal: Medal, ctx: MedalContext): string {
  const base = `I just unlocked the ${medal.name} medal on NoteSnap ${medal.emoji}`;
  return ctx.title ? `${base} — earned while working on "${ctx.title}"` : base;
}

/** Share sheet dialog title / accessibility label for a medal's share button. */
export function medalShareAccessibilityLabel(medal: Medal): string {
  return `Share the ${medal.name} medal`;
}

/** CTA shown on an earned medal row. */
export const MEDAL_SHARE_CTA = '📤 Share this medal';

// ─── copy the surfaces render (one source for screen + gate) ────

export const ACHIEVEMENTS_ENTRY_LABEL = '🏅 Achievements';
export const ACHIEVEMENTS_ENTRY_HINT = 'Medals you have earned';
export const ACHIEVEMENTS_SCREEN_TITLE = 'Medals';
export const ACHIEVEMENTS_NEXT_LABEL = 'Next to earn';
export const ACHIEVEMENTS_EARNED_LABEL = 'Earned';
export const ACHIEVEMENTS_EMPTY_COPY =
  'No medals yet — recognise a piece or log a practice run and the first one is yours.';
export const ACHIEVEMENTS_CURRENT_STREAK_LABEL = 'Current streak';
export const ACHIEVEMENTS_MINUTES_LABEL = 'Practice minutes';
export const ACHIEVEMENTS_ALL_EARNED_COPY = 'Every medal earned. 🏅';
/** Toast label for a fresh medal (the toast is a banner, never a modal). */
export const MEDAL_UNLOCK_LABEL = 'Medal unlocked!';
export const MEDAL_TOAST_SHARE_LABEL = 'Share';

// ─── source contracts (what no pure test can see) ──────────────

/**
 * The Achievements screen renders the catalog from THIS module (never a retyped
 * list) with progress, the next-to-earn block and a share action per earned
 * medal. A hardcoded medal name in the screen fails.
 */
export function achievementsScreenWired(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(`} from '../services/medals'`) < 0) return false;
  if (masked.indexOf('medalProgressList(') < 0) return false;
  if (masked.indexOf('nextMedalToEarn(') < 0) return false;
  if (masked.indexOf('medalProgressLabel(') < 0) return false;
  if (masked.indexOf('ACHIEVEMENTS_EMPTY_COPY') < 0) return false;
  return true;
}

/** Each EARNED medal row carries the share action (the viral loop). */
export function medalRowSharesCard(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf('MEDAL_SHARE_CTA') < 0) return false;
  if (!/onPress=\{\(\) => openMedalShare\(/.test(masked)) return false;
  // The card it opens must BE the shared ShareCard component, fed by the medal
  // copy helpers — a fork would not import it here.
  if (masked.indexOf(`from '../components/ShareCard'`) < 0) return false;
  if (!/<ShareCard[\s\S]{0,400}?medal=\{/.test(masked)) return false;
  return true;
}

/**
 * ShareCard (the EXISTING component) renders the medal block when given one —
 * so medals extend the share card instead of forking it.
 */
export function shareCardRendersMedal(source: string): boolean {
  const masked = maskComments(source);
  const propsStart = masked.indexOf('interface ShareCardProps');
  const componentStart = masked.indexOf('export const ShareCard');
  if (propsStart < 0 || componentStart <= propsStart) return false;
  // The prop is declared AND destructured in the component.
  if (masked.slice(propsStart, componentStart).indexOf('medal') < 0) return false;
  if (!/medal,\n/.test(masked.slice(componentStart, componentStart + 1200))) return false;
  // …and it actually renders (the captured card carries the medal).
  if (masked.indexOf('styles.medalEmoji') < 0) return false;
  return masked.indexOf('styles.medalName') >= 0;
}

/**
 * Home carries a QUIET achievements entry: below the one-button front door (the
 * hero stays the first and only primary action) and it renders the shared copy.
 */
export function homeHasQuietAchievementsEntry(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(`from './AchievementsScreen'`) < 0) return false;
  if (masked.indexOf('ACHIEVEMENTS_ENTRY_LABEL') < 0) return false;
  if (masked.indexOf('achievementsSummaryLine(') < 0) return false;
  const tag = elementWithMarker(masked, 'styles.achievementsCard');
  if (!/onPress=\{handleOpenAchievements\}/.test(tag)) return false;
  // The front door still renders, and the entry sits AFTER it — never above the
  // hero, never a competing primary CTA.
  const heroIndex = masked.indexOf('styles.recognitionCard');
  const entryIndex = masked.indexOf('styles.achievementsCard');
  if (heroIndex < 0 || entryIndex < 0) return false;
  if (entryIndex < heroIndex) return false;
  if (!masked.includes('onPress={handleHeroTap}')) return false;
  return true;
}

/** Home can actually OPEN the medals screen (state + early return with BACK). */
export function homeOpensAchievementsScreen(source: string): boolean {
  const masked = maskComments(source);
  if (!/setShowAchievements\(true\)/.test(masked)) return false;
  if (!/if \(showAchievements\)/.test(masked)) return false;
  return /<AchievementsScreen[\s\S]{0,300}?onClose=\{\(\) => setShowAchievements\(false\)\}/.test(
    masked,
  );
}

/**
 * The medal unlock is a NON-BLOCKING banner: the toast component holds no Modal
 * and stays `pointerEvents="none"` when it has no action, so an unlock can never
 * freeze play behind a dialog.
 */
export function medalToastNeverBlocks(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf('<Modal') >= 0) return false;
  if (!/pointerEvents=\{onAction \? 'box-none' : 'none'\}/.test(masked)) return false;
  return masked.indexOf('setTimeout') >= 0;
}

/** The toast can carry the share action (unlock → share card in one tap). */
export function medalToastOffersShare(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf('onAction') < 0) return false;
  return /onPress=\{onAction\}/.test(masked);
}

/** Home hands the FRESH medal to the toast and its share action to the card. */
export function homeSurfacesMedalUnlock(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf('checkAndAwardMedals(') < 0) return false;
  if (!/setBadgeToast\(/.test(masked) || masked.indexOf('setMedalToast(') < 0) return false;
  if (!/onAction=\{/.test(masked)) return false;
  return masked.indexOf('medalToast') >= 0;
}

/** Opening a piece records it in the local opened-pieces ledger (10-piece medal). */
export function pieceDetailRecordsOpened(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf('recordPieceOpened(') < 0) return false;
  return /useEffect\(\(\) => \{\s*void recordPieceOpened\(piece\.id\)/.test(masked);
}

/** The store persists both the records and the opened ledger, and never deletes. */
export function medalStorePersists(storeSource: string): boolean {
  const masked = maskComments(storeSource);
  if (masked.indexOf('MEDAL_RECORDS_KEY') < 0) return false;
  if (masked.indexOf('OPENED_PIECES_KEY') < 0) return false;
  if (masked.indexOf('awardMedalRecords(') < 0) return false;
  // No removal path: the ledger may be capped, the RECORDS may not be trimmed.
  if (/MEDAL_RECORDS_KEY[\s\S]{0,200}?slice\(/.test(masked)) return false;
  return masked.indexOf('AsyncStorage.setItem') >= 0;
}
