import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getStreakData, getTodayPracticeMinutes, getNotificationEnabled } from './storage';

const CHANNEL_ID = 'streak-nudges';
const NUDGE_ID = 'daily-streak-nudge';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Streak nudges', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const result = await Notifications.requestPermissionsAsync();
  return result.status === 'granted';
}

export async function scheduleDailyStreakNudge(): Promise<void> {
  const enabled = await getNotificationEnabled();
  if (!enabled) return;
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await Notifications.cancelScheduledNotificationAsync(NUDGE_ID).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: NUDGE_ID,
    content: { title: 'NoteSnap', body: "Don't break your streak! Practice today 🔥", sound: undefined },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 18, minute: 0, channelId: CHANNEL_ID },
  });
}

export async function refreshStreakNudge(): Promise<void> {
  const [streak, minutes] = await Promise.all([getStreakData(), getTodayPracticeMinutes()]);
  if (streak.lastPracticeDate === new Date().toISOString().slice(0, 10) || minutes > 0) {
    await Notifications.cancelScheduledNotificationAsync(NUDGE_ID).catch(() => undefined);
  } else {
    await scheduleDailyStreakNudge();
  }
}

export async function cancelStreakNudge(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NUDGE_ID).catch(() => undefined);
}
