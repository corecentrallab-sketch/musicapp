/**
 * notifications.ts — the once-a-day practice nudge (positive reinforcement only).
 *
 * REWRITTEN in the practice-reinforcement slice 2 (owner rule, 2026-09-17):
 * the old copy was "Don't break your streak! Practice today 🔥" — guilt framing,
 * and it read the legacy mutable `@notesnap/streak` counter. Both are gone.
 *
 * What it does now:
 *   • the streak comes from the reinforcement engine over the practice history
 *     (services/reinforcementStore.ts), the same number every screen shows
 *   • it only fires while the streak is genuinely alive and today has no run yet
 *     (the engine's at-risk nudge — services/practiceReinforcement.evaluateNudge)
 *   • the copy states the streak and keeps it warm: no pressure, no deadline
 *   • it is a ONE-SHOT at 18:00 local with TODAY's copy, re-scheduled each time
 *     the app refreshes — so the number in the message is the real one, and we
 *     never repeat a stale count day after day
 *   • no streak to speak of → nothing is scheduled at all
 * It can never interrupt play: notifications only ever land at 18:00, outside any
 * run or score screen.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getNotificationEnabled, getTodayPracticeMinutes } from './storage';
import {
  getEngineStreakLocal,
  getReinforcementNudgeLocal,
} from './reinforcementStore';
import { nextNudgeTime } from './practiceReinforcementView';

const CHANNEL_ID = 'streak-nudges';
const NUDGE_ID = 'streak-nudge';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Practice nudges', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const result = await Notifications.requestPermissionsAsync();
  return result.status === 'granted';
}

/**
 * Schedule today's gentle nudge (once, at the nudge hour).
 *
 * Returns true when something was scheduled. Nothing is scheduled when:
 * notifications are off, permission is denied, there is no live streak to keep
 * warm, or today's nudge hour has already passed (we do not nag after it).
 */
export async function scheduleStreakNudge(): Promise<boolean> {
  const enabled = await getNotificationEnabled();
  if (!enabled) return false;

  // The engine's outside-play nudge: null unless a streak is alive and today
  // still has no practice run.
  const nudge = await getReinforcementNudgeLocal();
  await Notifications.cancelScheduledNotificationAsync(NUDGE_ID).catch(() => undefined);
  if (!nudge) return false;

  const when = nextNudgeTime(new Date());
  if (!when) return false;

  const granted = await requestNotificationPermission();
  if (!granted) return false;

  await Notifications.scheduleNotificationAsync({
    identifier: NUDGE_ID,
    content: {
      title: 'NoteSnap',
      // Positive framing only — no "don't break your streak".
      body: `You're on a ${nudge.streakDays}-day streak — a few minutes today keeps it going 🎵`,
      sound: undefined,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
      channelId: CHANNEL_ID,
    },
  });
  return true;
}

/**
 * Re-evaluate the nudge: cancel it when today is already covered, otherwise make
 * sure today's copy is scheduled. Called whenever the app learns something new
 * about the user's practice (score viewer close, settings toggle).
 */
export async function refreshStreakNudge(): Promise<void> {
  const [streaks, minutes] = await Promise.all([
    getEngineStreakLocal(),
    getTodayPracticeMinutes(),
  ]);
  // Practised today already, or no live streak → nothing to keep warm.
  if ((streaks.alive && !streaks.atRisk) || minutes > 0 || streaks.currentDays < 1) {
    await cancelStreakNudge();
    return;
  }
  await scheduleStreakNudge();
}

export async function cancelStreakNudge(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NUDGE_ID).catch(() => undefined);
}
