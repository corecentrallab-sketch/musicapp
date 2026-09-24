/**
 * medalStore.ts — the device adapter for the medals & achievements layer.
 *
 * Everything DECIDES in ./medals.ts (pure, tier-1 tested); this file only reads
 * the device's existing data, hands it to that module, and persists the result.
 * It is the second module besides ./reinforcementStore.ts that owns a
 * AsyncStorage key for the retention layer, and it follows the same rules:
 *
 *   • NO NEW BACKEND CALLS. Every number comes from data the app already has —
 *     the practice history (streaks + minutes), the recognition history (first
 *     match), the library registry (25 items) and a tiny local ledger of pieces
 *     the user opened (the 10-piece medal). Nothing leaves the device.
 *   • EARNED ONCE, STAYS EARNED. `checkAndAwardMedals()` only ever APPENDS to
 *     `notesnap:medals:earned:v1`; there is no removal path, so a broken streak,
 *     a deleted library item or the 200-run practice-history cap can never take
 *     a medal away. Re-running it is idempotent (see awardMedalRecords).
 *   • A BROKEN READ IS NOT A CELEBRATION. Every read is individually guarded: a
 *     storage failure contributes 0 to that metric instead of throwing, so the
 *     medals screen renders with honest zeroes and never crashes.
 *   • Ids are validated against the catalog on read. A record whose medal no
 *     longer exists (a renamed id after an update) is dropped from the list
 *     rather than rendered as a mystery row.
 *
 * STATE SURVIVES RESTARTS: both keys are plain AsyncStorage JSON, exactly like
 * the badge list and the practice history they sit beside.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDisplayStreakLocal } from './reinforcementStore';
import { getPracticeHistoryLocal } from './practiceHistoryStore';
import { computeMinutesTotal } from './practiceMilestones';
import { getRecognitionHistory } from './storage';
import { getLibraryItems } from './libraryStore';
import {
  MEDALS,
  awardMedalRecords,
  normalizeMedalStats,
  type Medal,
  type MedalContext,
  type MedalRecord,
  type MedalStats,
} from './medals';

/** Earned medal records — written once per medal, never rewritten. */
export const MEDAL_RECORDS_KEY = 'notesnap:medals:earned:v1';
/** Distinct piece ids the user has opened (the 10-piece repertoire medal). */
export const OPENED_PIECES_KEY = 'notesnap:medals:opened-pieces:v1';
/** Newest-first cap on the opened ledger — it only needs to cross 10. */
export const OPENED_PIECES_CAP = 200;

// ─── parsing (pure, exported for the gate) ─────────────────────

function knownMedalIds(): Set<string> {
  return new Set(MEDALS.map((medal) => medal.id));
}

/**
 * Records off disk, validated: catalog ids only, one record per id (the FIRST
 * earnedAt wins, so a corrupt duplicate cannot rewrite history), junk dropped.
 */
export function parseMedalRecords(raw: string | null | undefined): MedalRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = knownMedalIds();
  const seen = new Set<string>();
  const out: MedalRecord[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Partial<MedalRecord>;
    if (typeof record.id !== 'string' || !ids.has(record.id)) continue;
    if (seen.has(record.id)) continue;
    const earnedAt = typeof record.earnedAt === 'string' ? record.earnedAt : '';
    seen.add(record.id);
    out.push({
      id: record.id,
      // An empty timestamp would render as a blank date; ISO-now is a lie, so
      // keep the unlock and let the screen fall back to "earned".
      earnedAt,
      contextTitle: typeof record.contextTitle === 'string' ? record.contextTitle : null,
      contextSubtitle:
        typeof record.contextSubtitle === 'string' ? record.contextSubtitle : null,
    });
  }
  return out;
}

/** Distinct, non-empty piece ids, newest first, capped. */
export function parseOpenedPieceIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= OPENED_PIECES_CAP) break;
  }
  return out;
}

// ─── reads ─────────────────────────────────────────────────────

export async function getMedalRecordsLocal(): Promise<MedalRecord[]> {
  try {
    return parseMedalRecords(await AsyncStorage.getItem(MEDAL_RECORDS_KEY));
  } catch {
    return [];
  }
}

export async function getOpenedPieceIdsLocal(): Promise<string[]> {
  try {
    return parseOpenedPieceIds(await AsyncStorage.getItem(OPENED_PIECES_KEY));
  } catch {
    return [];
  }
}

// ─── writes ────────────────────────────────────────────────────

export async function saveMedalRecordsLocal(records: readonly MedalRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MEDAL_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // A failed write must not break the screen; the medal is simply re-awarded
    // on the next check (the rule still holds).
  }
}

/**
 * Remember that the user opened a piece. Distinct ids only (the medal is about
 * different pieces), newest first, capped so the ledger can never grow forever.
 */
export async function recordPieceOpened(pieceId: string | null | undefined): Promise<void> {
  const id = typeof pieceId === 'string' ? pieceId.trim() : '';
  if (id.length === 0) return;
  try {
    const existing = await getOpenedPieceIdsLocal();
    if (existing.includes(id)) return;
    const next = [id, ...existing].slice(0, OPENED_PIECES_CAP);
    await AsyncStorage.setItem(OPENED_PIECES_KEY, JSON.stringify(next));
  } catch {
    // Opening a piece must never fail because bookkeeping did.
  }
}

// ─── stats ─────────────────────────────────────────────────────

/**
 * Every number the medal catalog reads, from the app's EXISTING data. Each read
 * is independent: if one source fails the rest still count.
 */
export async function collectMedalStats(now: number = Date.now()): Promise<MedalStats> {
  const [streaks, history, recognitions, libraryItems, opened] = await Promise.all([
    getDisplayStreakLocal(now).catch(() => null),
    getPracticeHistoryLocal().catch(() => []),
    getRecognitionHistory().catch(() => []),
    getLibraryItems().catch(() => []),
    getOpenedPieceIdsLocal(),
  ]);

  return normalizeMedalStats({
    currentStreakDays: streaks?.currentDays ?? 0,
    longestStreakDays: streaks?.longestDays ?? 0,
    totalMinutes: computeMinutesTotal(history),
    recognitions: recognitions.length,
    piecesOpened: opened.length,
    libraryItems: libraryItems.length,
  });
}

/**
 * The piece/song context for a fresh medal: the most recent thing the user
 * recognized, so the achievement card can say WHAT they were working on. Null
 * values (no history yet) are handled by medalContext.
 */
export async function latestRecognitionContext(): Promise<MedalContext> {
  try {
    const [latest] = await getRecognitionHistory();
    if (!latest) return { title: null, subtitle: null };
    return { title: latest.title ?? null, subtitle: latest.composer ?? null };
  } catch {
    return { title: null, subtitle: null };
  }
}

// ─── the one call the surfaces make ────────────────────────────

export interface MedalCheckResult {
  /** The persisted records AFTER this check. */
  records: MedalRecord[];
  /** Medals that were awarded BY this call (empty on a repeat call). */
  unlocks: MedalRecord[];
  /** Catalog rows for this call's unlocks, in catalog order. */
  medals: Medal[];
  stats: MedalStats;
}

/**
 * Award every medal whose rule holds and that is not already earned.
 *
 * @param options.now     injected clock (tests); defaults to the device clock.
 * @param options.stats   pre-collected stats (avoids a second read pass when the
 *                        caller already has them).
 * @param options.context piece/song context for the unlock card.
 */
export async function checkAndAwardMedals(
  options: {
    now?: number;
    stats?: MedalStats;
    context?: MedalContext | null;
  } = {},
): Promise<MedalCheckResult> {
  const now = options.now ?? Date.now();
  const stats = options.stats ?? (await collectMedalStats(now));
  const records = await getMedalRecordsLocal();
  const context = options.context ?? (await latestRecognitionContext());

  const { records: nextRecords, unlocks } = awardMedalRecords(
    stats,
    records,
    context,
    new Date(now).toISOString(),
  );

  if (unlocks.length > 0) {
    await saveMedalRecordsLocal(nextRecords);
  }

  const medals = unlocks
    .map((unlock) => MEDALS.find((medal) => medal.id === unlock.id) ?? null)
    .filter((medal): medal is Medal => medal !== null);

  return { records: nextRecords, unlocks, medals, stats };
}
