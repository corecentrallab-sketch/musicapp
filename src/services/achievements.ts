/**
 * Achievement badge system for NoteSnap.
 * Badges are checked and awarded based on user activity.
 */
import { getBadges, saveBadges, getStreakData } from './storage';
import type { Badge } from '../types';

// ─── Badge Definitions ────────────────────────────────────────

const BADGE_DEFS: Omit<Badge, 'earnedAt'>[] = [
  {
    id: 'first-recognition',
    name: 'First Recognition',
    description: 'Identify your first piece of music',
    emoji: '🎵',
  },
  {
    id: '10-recognitions',
    name: '10 Recognitions',
    description: 'Identify 10 pieces of music',
    emoji: '🎧',
  },
  {
    id: 'streak-7',
    name: '7-Day Streak',
    description: 'Practice 7 days in a row',
    emoji: '🔥',
  },
  {
    id: '50-pieces',
    name: '50 Pieces Saved',
    description: 'Save 50 pieces to your History',
    emoji: '📚',
  },
  {
    id: 'perfect-week',
    name: 'Perfect Week',
    description: 'Practice every day for a full week',
    emoji: '🌟',
  },
  {
    id: 'genre-explorer',
    name: 'Genre Explorer',
    description: 'Play pieces from 3 different genres',
    emoji: '🗺️',
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    description: 'Practice after 10 PM',
    emoji: '🦉',
  },
  {
    id: 'early-bird',
    name: 'Early Bird',
    description: 'Practice before 7 AM',
    emoji: '🌅',
  },
];

// ─── Badge Checking ───────────────────────────────────────────

/** Check context against badge conditions and award any newly earned badges.
 *  Returns the list of badges that were *just* earned (for toast display). */
export async function checkAndAwardBadges(context: {
  totalRecognitions?: number;
  totalSavedPieces?: number;
  genresPlayed?: string[];
  currentHour?: number;
}): Promise<Badge[]> {
  const existing = await getBadges();
  const earnedIds = new Set(existing.filter((b) => b.earnedAt).map((b) => b.id));
  const streak = await getStreakData();

  const newlyEarned: Badge[] = [];
  const now = new Date().toISOString();

  for (const def of BADGE_DEFS) {
    if (earnedIds.has(def.id)) continue;

    let earned = false;
    switch (def.id) {
      case 'first-recognition':
        earned = (context.totalRecognitions ?? 0) >= 1;
        break;
      case '10-recognitions':
        earned = (context.totalRecognitions ?? 0) >= 10;
        break;
      case 'streak-7':
        earned = streak.currentStreak >= 7;
        break;
      case '50-pieces':
        earned = (context.totalSavedPieces ?? 0) >= 50;
        break;
      case 'perfect-week':
        earned = streak.currentStreak >= 7;
        break;
      case 'genre-explorer':
        earned = (context.genresPlayed ?? []).length >= 3;
        break;
      case 'night-owl':
        earned = (context.currentHour ?? new Date().getHours()) >= 22;
        break;
      case 'early-bird':
        earned = (context.currentHour ?? new Date().getHours()) >= 0 &&
                 (context.currentHour ?? new Date().getHours()) < 7;
        break;
    }

    if (earned) {
      const badge: Badge = { ...def, earnedAt: now };
      newlyEarned.push(badge);
    }
  }

  if (newlyEarned.length > 0) {
    const allBadges = [...existing, ...newlyEarned];
    await saveBadges(allBadges);
  }

  return newlyEarned;
}

/** Get all badges (earned and unearned). */
export async function getAllBadges(): Promise<Badge[]> {
  const earned = await getBadges();
  const earnedMap = new Map(earned.map((b) => [b.id, b]));

  return BADGE_DEFS.map((def) => {
    const e = earnedMap.get(def.id);
    return e ? { ...def, earnedAt: e.earnedAt } : { ...def };
  });
}

export { BADGE_DEFS };
