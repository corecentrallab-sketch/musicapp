/**
 * practiceHistory.ts — local progress persistence for the practice-coach layer
 * (roadmap #3, slice 1). Stores one record per finished practice run so the
 * coach can show progress over time ("you were at this a week ago") and the
 * slice-2 UI can list/rank sessions without ever leaving the device.
 *
 * Storage is a plain key/value adapter (`{ getItem, setItem }`), injected by the
 * caller. That keeps this module free of react-native / expo imports so it
 * compiles and is unit-testable under plain Node (see
 * scripts/practiceCoach.test.ts). The real AsyncStorage adapter lives in
 * ./practiceHistoryStore.ts — the UI slice should use the pre-bound helpers
 * there, otherwise sessions land in the in-memory fallback and are lost on
 * restart.
 *
 * On-device layout: one JSON array under `notesnap:practice:history:v1`,
 * oldest session first (appends are cheap); readers reverse it into
 * newest-first order.
 */

export interface PracticeSession {
  /** Catalog piece id the run was played against. Required. */
  pieceId: string;
  /** Practice score for the run, 0–100 (see scorePlayback in practiceCoach.ts). */
  accuracyPct: number;
  /** How long the run lasted, in seconds. */
  durationSec: number;
  /** ISO 8601 timestamp of the run. Defaults to "now" when not supplied. */
  playedAt: string;
}

/** Minimal storage surface we need — matches AsyncStorage's getItem/setItem. */
export interface PracticeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Versioned key: bump the suffix if the record shape ever changes. */
export const PRACTICE_HISTORY_KEY = 'notesnap:practice:history:v1';
/** Keep at most this many sessions on device; older ones are dropped first. */
export const PRACTICE_HISTORY_CAP = 200;

/**
 * In-memory adapter used when no storage is injected. It is NOT persistent —
 * it exists so pure callers (and tests) never crash — and the UI slice must
 * pass the AsyncStorage adapter from ./practiceHistoryStore.ts.
 */
export function createMemoryPracticeStorage(initial?: Record<string, string>): PracticeStorage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    async getItem(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
  };
}

/** Shared fallback instance (see createMemoryPracticeStorage). */
export const memoryPracticeStorage: PracticeStorage = createMemoryPracticeStorage();

// ─── Pure helpers (exported so they can be tested and reused) ───

/** True when a parsed value looks like a session record. */
function isSession(value: unknown): value is PracticeSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pieceId === 'string' &&
    v.pieceId.length > 0 &&
    typeof v.accuracyPct === 'number' &&
    typeof v.durationSec === 'number' &&
    typeof v.playedAt === 'string'
  );
}

/** Parse the stored blob into sessions (oldest first). Never throws. */
export function parseHistory(raw: string | null | undefined): PracticeSession[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // Tolerate a future { sessions: [...] } envelope as well as a bare array.
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { sessions?: unknown })?.sessions)
        ? ((parsed as { sessions: unknown[] }).sessions as unknown[])
        : [];
    return list.filter(isSession).map((s) => ({ ...s }));
  } catch {
    return [];
  }
}

/** Append a session (oldest first) and cap the list, dropping the oldest. */
export function appendSession(
  history: PracticeSession[],
  session: PracticeSession,
): PracticeSession[] {
  const next = [...history, session];
  return next.length > PRACTICE_HISTORY_CAP ? next.slice(next.length - PRACTICE_HISTORY_CAP) : next;
}

/** Best accuracy for a piece, or null when it has never been practised. */
export function bestAccuracy(history: PracticeSession[], pieceId: string): number | null {
  let best: number | null = null;
  for (const s of history) {
    if (s.pieceId !== pieceId) continue;
    if (best === null || s.accuracyPct > best) best = s.accuracyPct;
  }
  return best;
}

/** Newest-first copy, optionally only for one piece. */
export function newestFirst(
  history: PracticeSession[],
  pieceId?: string | null,
): PracticeSession[] {
  const filtered = pieceId ? history.filter((s) => s.pieceId === pieceId) : history;
  return filtered.map((s) => ({ ...s })).reverse();
}

/** Normalize a caller-supplied session, or null when it is unusable. */
export function normalizeSession(input: {
  pieceId?: unknown;
  accuracyPct?: unknown;
  durationSec?: unknown;
  playedAt?: unknown;
}): PracticeSession | null {
  if (!input || typeof input !== 'object') return null;
  const pieceId = typeof input.pieceId === 'string' ? input.pieceId.trim() : '';
  if (!pieceId) return null;
  const rawPct = typeof input.accuracyPct === 'number' ? input.accuracyPct : 0;
  const rawSec = typeof input.durationSec === 'number' ? input.durationSec : 0;
  return {
    pieceId,
    accuracyPct: Number.isFinite(rawPct) ? Math.max(0, Math.min(100, Math.round(rawPct))) : 0,
    durationSec: Number.isFinite(rawSec) ? Math.max(0, Math.round(rawSec)) : 0,
    playedAt:
      typeof input.playedAt === 'string' && input.playedAt
        ? input.playedAt
        : new Date().toISOString(),
  };
}

// ─── Storage-backed API ────────────────────────────────────────

/**
 * Append one finished practice run. Returns the stored record, or null when the
 * input has no usable pieceId (nothing is written in that case).
 */
export async function savePracticeSession(
  session: {
    pieceId: string;
    accuracyPct: number;
    durationSec: number;
    playedAt?: string;
  },
  storage: PracticeStorage = memoryPracticeStorage,
): Promise<PracticeSession | null> {
  const normalized = normalizeSession(session);
  if (!normalized) return null;
  const raw = await storage.getItem(PRACTICE_HISTORY_KEY);
  const next = appendSession(parseHistory(raw), normalized);
  await storage.setItem(PRACTICE_HISTORY_KEY, JSON.stringify(next));
  return normalized;
}

/**
 * Sessions, newest first. Pass a pieceId to get just that piece's runs.
 * Ordering follows save order (appends), not the playedAt field.
 */
export async function getPracticeHistory(
  pieceId?: string | null,
  storage: PracticeStorage = memoryPracticeStorage,
): Promise<PracticeSession[]> {
  const raw = await storage.getItem(PRACTICE_HISTORY_KEY);
  return newestFirst(parseHistory(raw), pieceId);
}

/** Highest accuracy recorded for a piece, or null when there is no history. */
export async function getBestAccuracy(
  pieceId: string,
  storage: PracticeStorage = memoryPracticeStorage,
): Promise<number | null> {
  const raw = await storage.getItem(PRACTICE_HISTORY_KEY);
  return bestAccuracy(parseHistory(raw), pieceId);
}
