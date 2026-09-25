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
 *   • it is a ONE-SHOT at the user's chosen local time (owner 09-25; 18:00 by
 *     default) with TODAY's copy, re-scheduled each time the app refreshes — so
 *     the number in the message is the real one, and we never repeat a stale
 *     count day after day
 *   • no streak to speak of → nothing is scheduled at all
 * It can never interrupt play: the nudge only ever lands at the time the user
 * chose (outside any run or score screen), and it is a single one-shot.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  getNotificationEnabled,
  getReminderMinutes,
  getTodayPracticeMinutes,
} from './storage';
import {
  getEngineStreakLocal,
  getReinforcementNudgeLocal,
} from './reinforcementStore';
import { nextNudgeTime } from './practiceReinforcementView';
// The user's chosen reminder time: minutes-of-day + its hour/minute pair. The
// default (18:00) and the formatting live in that pure module (owner 09-25).
import { reminderHourMinute } from './reminderTime';

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

  // The user's chosen reminder time (owner 09-25) — 18:00 until they change it.
  // Cancel-then-reschedule above is what makes a time change atomic: the one
  // pending one-shot is dropped and re-armed at the new time, never stacked.
  const reminderMinutes = await getReminderMinutes();
  const { hour, minute } = reminderHourMinute(reminderMinutes);
  const when = nextNudgeTime(new Date(), hour, minute);
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

/**
 * Re-arm the one-shot after the user picked a new reminder time (owner 09-25):
 * cancel the pending notification, then schedule it again at the new time. The
 * caller persists the choice first (services/storage.setReminderMinutes) so the
 * scheduler reads the new value; this is the only place a time change touches
 * the notification queue, which is what keeps exactly ONE nudge armed.
 */
export async function rescheduleStreakNudgeForTimeChange(): Promise<boolean> {
  await cancelStreakNudge();
  return scheduleStreakNudge();
}
