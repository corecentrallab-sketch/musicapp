/**
 * Daily challenge piece — now backed by the live catalog.
 *
 * The piece of the day is chosen server-side by GET /api/daily-challenge:
 * deterministic by date (same piece for every user on a given day), selected
 * from the real curated catalog (pieces with fingerprints AND a curated sheet
 * in R2), with honest availability signals (is_public_domain,
 * sheet_music_available). The client never invents a piece — if the fetch
 * fails, null is returned and the Home card shows a retry state.
 */
import { fetchDailyChallenge } from './api';
import type { DailyChallengePiece } from '../types';

/**
 * Returns today's daily challenge piece from the live catalog.
 * Resolves to null when the endpoint is unreachable (offline / not deployed),
 * so the caller can render a retry state instead of placeholder content.
 */
export async function getTodayChallenge(): Promise<DailyChallengePiece | null> {
  return fetchDailyChallenge();
}
