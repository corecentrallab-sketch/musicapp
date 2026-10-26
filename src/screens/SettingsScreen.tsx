/**
 * SettingsScreen — DESIGNER SPEC §3 (v43 slice 2), plus the surfaces the spec's
 * closed row set does not model yet.
 *
 * THE SPEC'S SHAPE (v43 §3, "/home/team/shared/ux-design-v41/spec.md"):
 *
 *     Pro row → Audio & Recording → Playback → Cloud Sync & Storage → Support
 *
 *   • ONE row style everywhere: 52 dp rows inset x32, title 15 dp bold TXT, sub
 *     11 dp SUB capped at right-100 dp, trailing value 13 dp bold HUM / chevron,
 *     a hairline LINE between rows inside a card.
 *   • Cards are the group bounds (r16, CARD + CARD_LINE), 20 dp apart; the section
 *     header is 11 dp caps bold SUB, 20 dp above / 18 dp below, indent x16.
 *   • The Pro row is the money path: CARD fill + 1 dp LISTEN border, one quiet row,
 *     and its "View plans" pill opens the EXISTING plans flow (the one-time AUD
 *     checkout cards that already live in this screen). Nothing else on the
 *     surface blocks the free tier.
 *   • There is NO Account section, on purpose: nothing in the app creates an
 *     account, so the screen says so once at the bottom.
 *   • Colours come from the SPEC ROLE MAP (services/settingsSpec →
 *     settingsPalette), i.e. existing theme.ts tokens only. The §3 styles carry no
 *     hex of their own, so light mode is the token swap and nothing else.
 *
 * EVERY ROW RESOLVES (owner rule: no dead surfaces):
 *   Microphone access → the LIVE permission state; the tap opens the system
 *                       settings page (the app's existing permission path).
 *   Noise filter      → "Always on" — the cleanup is always applied and there is
 *                       no stored preference to flip, so the row states that
 *                       instead of offering a switch that would change nothing.
 *   Theme             → the current mode; the tap opens the existing Dark/Light
 *                       choice (services/themeStore — app-wide since v34b).
 *   Auto-scroll speed → the profile a piece with no saved speed starts from. The
 *                       speed is a PER-PIECE memory set in the score reader
 *                       (services/pageTurnPresets), so the row is a value, not a
 *                       control.
 *   Google Drive / Dropbox → the real connection state; the tap opens the
 *                       existing Cloud Sync screen.
 *   Help & FAQ        → the honest FAQ (services/settingsSpec → SETTINGS_FAQ).
 *   Privacy policy    → the policy page the Play listing already points at
 *                       (app.json → privacyPolicyUrl; one owner for that URL).
 *   About NoteSnap    → the LIVE version from the app config (the spec frame's
 *                       "0.1.32" is stale by construction) plus the honest scope.
 *
 * BELOW THE FOUR GROUPS, UNTOUCHED IN BEHAVIOUR: the practice-reminder block, the
 * calendar-reminder channel and the plans/checkout cards' billing notes. The
 * spec's closed row set has no home for them, and this slice deliberately does
 * NOT delete owner-approved surfaces — the delivery report lists them for the
 * lead to move or retire.
 *
 * Upgrade flow (no hardcoded payment links — the old buy.stripe.com URLs pointed
 * at a foreign Stripe account and are gone):
 *   1. Tap a plan → POST /api/create-checkout-session with the device id
 *   2. Open the returned Stripe Checkout URL in a browser
 *   3. On return, poll GET /api/entitlement until the webhook grants Pro
 *   4. Persist the Pro state locally and show the active-plan UI
 *
 * NOTE (pre-launch, owner 09-22 Option B): the in-app checkout is known-broken
 * until the post-launch fix, so the Pro row's honest job is to stay the entry it
 * is today — it opens the plan cards, and the cards do what they already did.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  Linking,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Audio } from 'expo-av';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList, RootTabParamList } from '../types';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
// ── v45 slice 2 (OWNER CALL 10-26): the two retention ENTRIES that left Home's
// bands — 🏅 Achievements and 📋 This Week — are Settings rows now, and the streak
// is visible here as STATE. Both screens are mounted by THIS screen behind its own
// flags (rendered in place, each owning its Android BACK handling), and the row
// labels come from services/frontDoorBands so there is ONE copy of each name.
// frontDoorBands.retentionChipsAreInSettings asserts all of that from source.
import { AchievementsScreen } from './AchievementsScreen';
import { PracticeWeekScreen } from './PracticeWeekScreen';
import {
  MEDALS_CHIP_LABEL,
  WEEK_CHIP_LABEL,
  streakChipCopy,
} from '../services/frontDoorBands';
// The achievements row's subtitle is the medals module's OWN copy — never retyped
// here (medals.homeHasQuietAchievementsEntry asserts that, and it is why the row
// carries ACHIEVEMENTS_ENTRY_HINT rather than a lookalike string).
import { ACHIEVEMENTS_ENTRY_HINT } from '../services/medals';
import { getDisplayStreakLocal } from '../services/reinforcementStore';
import { useEffect } from 'react';
import { getNotificationEnabled, setNotificationEnabled, getProState, saveProState, type ProState } from '../services/storage';
// The user's chosen practice-reminder time (owner request 09-25): the value, its
// formatting and the row copy all come from one pure module (tier1-tested), so
// this screen can never drift from what the scheduler actually arms.
import {
  DEFAULT_REMINDER_MINUTES,
  formatReminderTime,
  normalizeReminderMinutes,
  reminderSettingCopy,
  stepReminderMinutes,
} from '../services/reminderTime';
import {
  scheduleStreakNudge,
  cancelStreakNudge,
  rescheduleStreakNudgeForTimeChange,
} from '../services/notifications';
import {
  getCalendarReminderCalendarId,
  getCalendarReminderEventId,
  getReminderChannel,
  getReminderMinutes,
  setCalendarReminderCalendarId,
  setCalendarReminderEventId,
  setReminderChannel as persistReminderChannel,
  setReminderMinutes as persistReminderMinutes,
} from '../services/storage';
// ── The CALENDAR channel (owner-approved 10-10, backlog b033ab48) ──────────────
// The whole model — the channel choice, the event shape, the honest copy and the
// plan that decides what gets armed — is a PURE tier1-gated module. This screen
// renders its copies and calls its decisions; it does not decide anything itself,
// and it never imports the native calendar module (the seam below is the only file
// allowed to do that).
import {
  CALENDAR_HONESTY,
  CALENDAR_HYGIENE_CTA,
  CALENDAR_CHOICE_TITLE,
  CALENDAR_HYGIENE_FAILED_LINE,
  CALENDAR_OPEN_SETTINGS_CTA,
  CALENDAR_PERMISSION_DENIED_LINE,
  CALENDAR_ROW_TITLE,
  CALENDAR_SURVIVES_UNINSTALL_LINE,
  CALENDAR_TWO_REMINDERS_LINE_KEY,
  CALENDAR_UPDATE_FAILED_LINE,
  CHANGE_CALENDAR_CTA,
  CHANNEL_CHOICE_BOTH_LABEL,
  CHANNEL_CHOICE_CALENDAR_ONLY_LABEL,
  CHOOSE_CALENDAR_CTA,
  DEFAULT_REMINDER_CHANNEL,
  calendarChoiceLabel,
  calendarHygieneConfirm,
  calendarHygieneOutcomeLine,
  calendarHonestyText,
  formatCalendarReminderRow,
  isCalendarReminderStale,
  reminderChannelPlan,
  type ReminderChannel,
  type WritableCalendar,
} from '../services/calendarReminder';
import {
  calendarPermissionState,
  defaultCalendarId as pickDefaultCalendarId,
  ensureCalendarPermission,
  listWritableCalendars,
  removeNoteSnapReminders as removeNoteSnapRemindersFromCalendar,
  removeReminderEvent,
  upsertReminderEvent,
  type CalendarPermissionState,
} from '../services/calendarReminderDevice';
import { CalendarPickerSheet } from '../components/CalendarPickerSheet';
import { createCheckoutSession, checkEntitlement } from '../services/api';
import { getDeviceId } from '../services/device';
// The app's light/dark choice (v33 §F2, owner 10-04 email batch: "a dark/light
// mode toggle in Settings"; v34b: the SAME choice now repaints every screen —
// owner FAIL item 6). The mode, the palette and the persisted-value contract live
// in services/theme.ts; the app-wide read/write binding in themeStore.ts
// (useThemeMode = the shared mode, useThemedStyles = this screen's StyleSheet
// re-painted for the chosen palette). This screen is the TOGGLE.
import { useThemeMode, useThemedStyles } from '../services/themeStore';
import {
  PRACTICE_SECTION_SUBTITLE,
  PRACTICE_SECTION_TITLE,
  PRACTICE_STREAK_ROW_HINT,
  PRACTICE_STREAK_ROW_TITLE,
  THEME_ACCESSIBILITY_LABEL,
  THEME_DARK_LABEL,
  THEME_HONEST_NOTE,
  THEME_LIGHT_LABEL,
  THEME_ROW_TITLE,
  THEME_SECTION_TITLE,
  themeAppliedLine,
} from '../services/theme';
// DESIGNER SPEC §3 (v43 slice 2): the copy, the geometry, the role map and every
// honest-value rule these rows obey live in ONE pure module (tier1-gated by
// scripts/uxr-v43-settings.test.ts), so this screen cannot drift from the spec it
// is the delivery of.
import {
  SETTINGS_NO_ACCOUNT_LINE,
  SETTINGS_PRO_CTA,
  SETTINGS_PRO_SUB,
  SETTINGS_PRO_TITLE,
  SETTINGS_PRIVACY_URL,
  aboutDialogBody,
  aboutVersionLine,
  autoScrollValueLabel,
  cloudValueLabel,
  faqDialogBody,
  microphoneAccessLabel,
  noiseFilterValueLabel,
  settingsPalette,
  themeValueLabel,
  type MicrophoneAccessState,
  type SettingsPalette,
} from '../services/settingsSpec';
import { BUILD_STAMP_TAG, buildStampLine } from '../services/buildStamp';
import { BUILD_SHA } from '../services/buildSha';
import { providerConnected } from '../services/cloudSync';

// Owner-account Stripe price IDs (USD). These are public identifiers passed to
// our own API — the API is what creates the Checkout session on the owner's
// Stripe account, so money always lands in the right place.
type Plan = {
  id: string;
  name: string;
  price: string;
  feature: string;
  savings?: string;
  highlight?: boolean;
};
const PLANS: Plan[] = [
  {
    id: 'price_1U3SEFBbnDObsY4ujb2zxBSs', // NoteSnap Pro — Monthly $4.99
    name: 'Pro Monthly',
    price: '$4.99 / month',
    feature:
      '✓ Unlimited recognitions\n✓ Grade/difficulty levels\n✓ Advanced recommendations\n✓ Custom app skins\n✓ Cloud sync & sharing\n✓ No ads anywhere',
  },
  {
    id: 'price_1U3SEKBbnDObsY4usDGDFNPQ', // NoteSnap Pro — Yearly $39.99
    name: 'Pro Yearly',
    price: '$39.99 / year',
    savings: 'Save 33% vs monthly',
    feature: 'All Pro features, billed annually.',
    highlight: true,
  },
  {
    id: 'price_1U3SEKBbnDObsY4uVrnJDIyg', // NoteSnap Family/Teacher $9.99
    name: 'Family / Teacher',
    price: '$9.99 / month',
    feature:
      '✓ Up to 5 accounts\n✓ Shared History libraries\n✓ All Pro features included\n✓ Perfect for families & music teachers',
  },
];

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30000;

const PLAN_LABELS: Record<string, string> = {
  'pro-monthly': 'NoteSnap Pro',
  'pro-yearly': 'NoteSnap Pro',
  family: 'NoteSnap Family',
};

/**
 * THE LIVE MICROPHONE PERMISSION (spec §3 row 1). Read, never requested: opening
 * Settings must not raise a permission dialog (the same rule the calendar channel
 * follows). Android's `check` cannot tell "never asked" from "denied", so the row
 * says what is true right now — the app is or is not allowed to record — and the
 * tap opens the system page where either answer can be changed.
 */
async function readMicrophonePermission(): Promise<MicrophoneAccessState> {
  try {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      return granted ? 'granted' : 'denied';
    }
    const permission = await Audio.getPermissionsAsync();
    if (permission.granted) return 'granted';
    return permission.status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    // No permission API on this device: the row says "Not checked" rather than
    // claiming an answer the app does not have.
    return 'unknown';
  }
}

type LoadingPlan = string | null;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // The TAB navigator's own view of the same object: the week view's exits have to
  // switch tabs (Home), which the stack typing does not describe.
  const tabNavigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const [loadingPlan, setLoadingPlan] = useState<LoadingPlan>(null);
  const [proState, setProState] = useState<ProState>({
    isPro: false,
    plan: null,
    currentPeriodEnd: null,
  });
  const [checking, setChecking] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  // The practice-reminder time, in minutes since local midnight (owner 09-25).
  // 18:00 until the user picks another time — the exact pre-existing behaviour.
  const [reminderMinutes, setReminderMinutes] = useState(DEFAULT_REMINDER_MINUTES);
  // ── The calendar channel (owner-approved 10-10, backlog b033ab48) ──
  // OPT-IN and OFF by default: the persisted channel stays 'notification' — i.e.
  // exactly the reminder every existing user has — until they turn this row on.
  const [reminderChannel, setReminderChannel] = useState<ReminderChannel>(DEFAULT_REMINDER_CHANNEL);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [calendarEventId, setCalendarEventId] = useState<string | null>(null);
  const [calendarReady, setCalendarReady] = useState(false);
  const [writableCalendars, setWritableCalendars] = useState<WritableCalendar[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDefaultId, setPickerDefaultId] = useState<string | null>(null);
  const [calendarPermission, setCalendarPermission] = useState<CalendarPermissionState>({
    available: true,
    granted: false,
    canAskAgain: true,
  });
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  const [hygieneLine, setHygieneLine] = useState<string | null>(null);
  const [hygieneBusy, setHygieneBusy] = useState(false);
  // ── The §3 rows' state (v43 slice 2) ──
  /** The Pro row's pill: opens the EXISTING plans flow (never a dead pill). */
  const [plansOpen, setPlansOpen] = useState(false);
  /** The Theme row opens the existing Dark/Light choice in place. */
  const [themeOpen, setThemeOpen] = useState(false);
  const [microphone, setMicrophone] = useState<MicrophoneAccessState>('unknown');
  const [cloud, setCloud] = useState({ gdrive: false, dropbox: false });
  // ── v45 slice 2 · the retention entries that moved off Home (owner 10-26) ──
  const [showAchievements, setShowAchievements] = useState(false);
  const [showPracticeWeek, setShowPracticeWeek] = useState(false);
  /** The streak NUMBER from the same store the front door read (never invented). */
  const [streakDays, setStreakDays] = useState<number | null>(null);
  // The chosen theme (v33 §F2, app-wide in v34b). `theme` is the RESOLVED token
  // table for the current mode: every surface below reads its colours from here,
  // so flipping the toggle repaints the screen instead of only relabelling a
  // switch. `styles` is this screen's own StyleSheet re-painted from the same
  // tokens (the leftovers the `themed` map below does not name). The store
  // persists the choice (themeStore), so it survives a restart.
  const { mode: themeMode, tokens: theme, setMode: setThemeMode } = useThemeMode();
  const { styles } = useThemedStyles(baseStyles);
  /**
   * THE SPEC'S ROLES FOR THIS MODE (v43 §3). One palette per render, built from
   * the same tokens themeStore hands every other screen — so the light theme is
   * the token swap and the §3 styles hold no colour of their own.
   */
  const palette = settingsPalette(theme);
  /** The live app version (the spec frame's "0.1.32" is stale by construction). */
  const appVersion = Constants.expoConfig?.version ?? null;
  /**
   * v43 item B1 — THE BUILD STAMP. The version alone cannot answer "am I testing
   * the new build?" (one version can be uploaded twice), so the About block also
   * shows the Android versionCode and the commit the build was made from
   * (services/buildSha.ts, stamped by the release slice). */
  const appVersionCode = Constants.expoConfig?.android?.versionCode ?? null;

  // ── WHAT IS ARMED — derived from the ONE decision point (services/calendarReminder).
  // These are computed here (before the handlers that read them) and passed to the
  // row, so the screen never invents its own notion of which channel is live.
  const calendarOn = reminderChannel !== 'notification';
  /** The remembered calendar is no longer on this phone (honest, never a crash). */
  const calendarStale = isCalendarReminderStale({
    storedCalendarId: calendarId,
    calendars: writableCalendars,
  });
  /** The user asked for the calendar channel and the permission is not there. */
  const calendarDenied = calendarPermission.available && !calendarPermission.granted;
  const selectedCalendar = writableCalendars.find((calendar) => calendar.id === calendarId) ?? null;
  const calendarPlan = reminderChannelPlan({
    channel: reminderChannel,
    notificationsEnabled,
    calendarReady,
  });
  const calendarRow = formatCalendarReminderRow(calendarPlan, {
    calendarName: calendarStale ? null : calendarChoiceLabel(selectedCalendar),
    minutes: reminderMinutes,
    blocked: calendarDenied,
  });

  // ── THE §3 ROWS' READERS (v43 slice 2) ──
  /** Re-read the two cloud providers' REAL connection state (never a guess). */
  const refreshCloudState = useCallback(async () => {
    try {
      const [gdrive, dropbox] = await Promise.all([
        providerConnected('gdrive'),
        providerConnected('dropbox'),
      ]);
      setCloud({ gdrive, dropbox });
    } catch {
      // A failed read keeps the last known value; it never becomes "Connected".
    }
  }, []);

  // The streak this screen shows is the ENGINE's (practice history), read from the
  // SAME store Home used — a Settings row may never print a different number.
  useEffect(() => {
    let alive = true;
    const readStreak = () => {
      void getDisplayStreakLocal()
        .then((display) => {
          if (alive) setStreakDays(display.currentDays);
        })
        .catch(() => {
          if (alive) setStreakDays(null);
        });
    };
    readStreak();
    // A practice day can start on another tab, so the row re-reads on focus.
    const unsubscribe = navigation.addListener('focus', readStreak);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [navigation]);
  useEffect(() => {
    void readMicrophonePermission().then(setMicrophone);
    void refreshCloudState();
    // Coming back from the Cloud Sync screen must show the new state — the row is
    // the status of that screen, not a snapshot taken once at mount.
    const unsubscribe = navigation.addListener('focus', () => {
      void refreshCloudState();
      void readMicrophonePermission().then(setMicrophone);
    });
    return unsubscribe;
  }, [navigation, refreshCloudState]);

  useEffect(() => {
    getNotificationEnabled().then(setNotificationsEnabled);
    getReminderMinutes().then(setReminderMinutes);
    // The calendar channel's persisted state. NOTE: opening Settings only ever
    // READS the permission (calendarPermissionState) — the request happens on the
    // tap that turns the row on, never on mount, because a permission dialog shown
    // before the user has expressed any interest is how an app earns a permanent
    // "deny" (design brief §5.1).
    getReminderChannel().then(setReminderChannel);
    getCalendarReminderCalendarId().then(setCalendarId);
    getCalendarReminderEventId().then(setCalendarEventId);
    (async () => {
      try {
        const permission = await calendarPermissionState();
        setCalendarPermission(permission);
        setWritableCalendars(await listWritableCalendars());
        const storedCalendar = await getCalendarReminderCalendarId();
        const storedEvent = await getCalendarReminderEventId();
        setCalendarReady(permission.granted && Boolean(storedCalendar) && Boolean(storedEvent));
      } catch {
        // No calendar provider, or a read that failed: the row stays honest and
        // the in-app reminder keeps working (never a dead end).
      }
    })();
    (async () => {
      try {
        const cached = await getProState();
        setProState(cached);
        // Refresh entitlement from the server (webhook may have landed since).
        const deviceId = await getDeviceId();
        const fresh = await checkEntitlement(deviceId);
        setProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
        await saveProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
      } catch {
        // Offline or server hiccup — keep the cached state.
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  /**
   * Change the practice-reminder time (owner request 09-25: "practice reminders
   * at 6:00 PM" → the user picks the time). Persist the choice FIRST so the
   * scheduler reads the new value, then cancel + re-arm the ONE pending one-shot
   * at the new time. Nothing is ever stacked, and no notification can land during
   * a practice run — the nudge stays a single one-shot outside play.
   */
  const onChangeReminderTime = useCallback(
    async (next: number) => {
      const normalized = normalizeReminderMinutes(next);
      setReminderMinutes(normalized);
      await persistReminderMinutes(normalized);
      if (notificationsEnabled) await rescheduleStreakNudgeForTimeChange();
      // ONE time, BOTH channels (design brief §2.4): if the calendar channel is
      // armed, the SAME minutes move the ONE event in place — never a second event
      // and never a drift between the two reminders.
      if (calendarOn && calendarId && !calendarStale) {
        const write = await upsertReminderEvent({
          eventId: calendarEventId,
          calendarId,
          minutes: normalized,
        });
        if (write.eventId !== calendarEventId) {
          setCalendarEventId(write.eventId);
          await setCalendarReminderEventId(write.eventId);
        }
        setCalendarNotice(write.ok ? null : CALENDAR_UPDATE_FAILED_LINE);
      }
    },
    [calendarEventId, calendarId, calendarOn, calendarStale, notificationsEnabled],
  );

  /**
   * WHAT GETS ARMED — the ONE decision (owner 10-10). Every channel change goes
   * through here: the plan is computed first, the event is written only because
   * the plan asks for it, and the in-app nudge is armed or cancelled only on the
   * plan's verdict. There is no second path that arms anything.
   */
  const applyChannelChoice = useCallback(
    async (next: ReminderChannel, calendarIdForEvent?: string) => {
      const target = calendarIdForEvent ?? calendarId;
      const permission = await calendarPermissionState();
      setCalendarPermission(permission);
      const wantsCalendar = next === 'calendar' || next === 'both';

      // 1. The event itself (only when the choice asks for a calendar reminder).
      let wrote = false;
      if (wantsCalendar && target && permission.granted) {
        const write = await upsertReminderEvent({
          eventId: calendarEventId,
          calendarId: target,
          minutes: reminderMinutes,
        });
        wrote = write.ok;
        setCalendarEventId(write.eventId);
        await setCalendarReminderEventId(write.eventId);
        setCalendarNotice(write.ok ? null : CALENDAR_UPDATE_FAILED_LINE);
      }

      // 2. What is armed, from the plan — and the plan is told the truth about
      //    whether the calendar channel can really fire, so a failed write (or a
      //    revoked permission) hands the reminder back to the in-app channel
      //    instead of leaving the user with nothing (design brief §5.4).
      const plan = reminderChannelPlan({
        channel: next,
        notificationsEnabled,
        calendarReady: wrote && Boolean(target) && permission.granted,
      });
      await persistReminderChannel(next);
      setReminderChannel(next);
      // The row's own armed state IS the plan's verdict: the calendar channel did
      // not fire (a failed write, or the choice was the in-app one) means the row
      // must not claim an event is armed.
      if (plan.armCalendarEvent) {
        setCalendarReady(true);
      } else {
        setCalendarReady(false);
      }
      if (plan.armNotification) {
        if (!notificationsEnabled) {
          setNotificationsEnabled(true);
          await setNotificationEnabled(true);
        }
        await scheduleStreakNudge();
      } else {
        await cancelStreakNudge();
      }
      return plan;
    },
    [calendarEventId, calendarId, notificationsEnabled, reminderMinutes],
  );

  /**
   * The in-app reminder row's switch (owner 09-25) — now ALSO the explicit
   * "also keep the in-app reminder" opt-in of the owner's 10-10 decision: while
   * the calendar channel is armed, turning this row on moves the channel to
   * 'both' (and the calendar row immediately says "two reminders"), and turning
   * it off moves it back to 'calendar'. Both go through the same plan
   * (`applyChannelChoice`), so the double-ping is never silent. With the calendar
   * channel off this is exactly the pre-existing behaviour.
   */
  const toggleNotifications = useCallback(async () => {
    const next = !notificationsEnabled;
    if (reminderChannel !== 'notification') {
      await applyChannelChoice(next ? 'both' : 'calendar');
      return;
    }
    setNotificationsEnabled(next);
    await setNotificationEnabled(next);
    if (next) await scheduleStreakNudge();
    else await cancelStreakNudge();
  }, [applyChannelChoice, notificationsEnabled, reminderChannel]);

  /** The enable confirmation: the uninstall truth is said BEFORE it happens. */
  const confirmCalendarEnable = useCallback(
    (targetId: string, channel: ReminderChannel) => {
      Alert.alert(CALENDAR_ROW_TITLE, `${CALENDAR_SURVIVES_UNINSTALL_LINE}\n\n${CALENDAR_HONESTY}`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add it', onPress: () => void applyChannelChoice(channel, targetId) },
      ]);
    },
    [applyChannelChoice],
  );

  /** The picker's commit: the chosen calendar is remembered, then used. */
  const onPickCalendar = useCallback(
    async (pickedId: string) => {
      setPickerOpen(false);
      setCalendarId(pickedId);
      await setCalendarReminderCalendarId(pickedId);
      confirmCalendarEnable(pickedId, 'calendar');
    },
    [confirmCalendarEnable],
  );

  /**
   * The enable tap (design brief §2.4): permission first — ON THE TAP, never on
   * mount — then the calendar picker on first use (or when the remembered
   * calendar is gone), then the honest enable confirmation, then the plan.
   */
  const enableCalendarReminders = useCallback(async () => {
    const granted = await ensureCalendarPermission();
    const permission = await calendarPermissionState();
    setCalendarPermission(permission);
    if (!granted) {
      setCalendarNotice(null);
      return;
    }
    const calendars = await listWritableCalendars();
    setWritableCalendars(calendars);
    if (calendars.length === 0) {
      setCalendarNotice(CALENDAR_HYGIENE_FAILED_LINE);
      return;
    }
    const remembered = calendarId && calendars.some((calendar) => calendar.id === calendarId) ? calendarId : null;
    if (!remembered) {
      // First use, or the remembered calendar is no longer on this phone: the user
      // picks. We never write the event into a different calendar behind their back.
      setPickerDefaultId(await pickDefaultCalendarId());
      setPickerOpen(true);
      return;
    }
    confirmCalendarEnable(remembered, 'calendar');
  }, [calendarId, confirmCalendarEnable]);

  /** The one event we own, deleted FIRST — before any state forgets its id. */
  const disableCalendarReminders = useCallback(async () => {
    if (calendarEventId) await removeReminderEvent(calendarEventId);
    await setCalendarReminderEventId(null);
    setCalendarEventId(null);
    setCalendarReady(false);
    await persistReminderChannel(DEFAULT_REMINDER_CHANNEL);
    setReminderChannel(DEFAULT_REMINDER_CHANNEL);
    setCalendarNotice(null);
    // The in-app nudge takes the time back, so turning the calendar off can never
    // leave the user with no reminder at all.
    if (!notificationsEnabled) {
      setNotificationsEnabled(true);
      await setNotificationEnabled(true);
    }
    await scheduleStreakNudge();
  }, [calendarEventId, notificationsEnabled]);

  /** THE REINSTALL PATH: find our own event by exact title and remove it. */
  const runNoteSnapReminderHygiene = useCallback(async () => {
    setHygieneBusy(true);
    const calendars = writableCalendars.length > 0 ? writableCalendars : await listWritableCalendars();
    const outcome = await removeNoteSnapRemindersFromCalendar(calendars);
    setHygieneBusy(false);
    if (!outcome.ok) {
      setHygieneLine(CALENDAR_HYGIENE_FAILED_LINE);
      return;
    }
    setHygieneLine(calendarHygieneOutcomeLine(outcome.removed));
    if (outcome.removed > 0) {
      await setCalendarReminderEventId(null);
      setCalendarEventId(null);
    }
  }, [writableCalendars]);

  const removeNoteSnapReminders = useCallback(() => {
    Alert.alert(CALENDAR_HYGIENE_CTA, calendarHygieneConfirm(reminderMinutes), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void runNoteSnapReminderHygiene() },
    ]);
  }, [reminderMinutes, runNoteSnapReminderHygiene]);

  const refreshEntitlement = useCallback(async (deviceId: string): Promise<boolean> => {
    const fresh = await checkEntitlement(deviceId);
    setProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
    await saveProState({ isPro: fresh.pro, plan: fresh.plan, currentPeriodEnd: fresh.currentPeriodEnd });
    return fresh.pro;
  }, []);

  const handleUpgrade = useCallback(async (priceId: string) => {
    setLoadingPlan(priceId);
    try {
      const deviceId = await getDeviceId();
      const checkoutUrl = await createCheckoutSession(priceId, deviceId);
      await WebBrowser.openBrowserAsync(checkoutUrl);

      // User is back — poll the server until the webhook grants the entitlement
      // (webhooks usually land within seconds; give it up to 30s).
      const startedAt = Date.now();
      let pro = false;
      while (!pro && Date.now() - startedAt < POLL_MAX_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          pro = await refreshEntitlement(deviceId);
        } catch {
          // transient failure — keep polling
        }
      }
      if (pro) {
        Alert.alert('Welcome to Pro!', 'Your subscription is active. Enjoy unlimited recognitions.');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong.';
      Alert.alert('Checkout Error', message);
    } finally {
      setLoadingPlan(null);
    }
  }, [refreshEntitlement]);

  const planLabel = proState.plan ? PLAN_LABELS[proState.plan] ?? 'NoteSnap Pro' : null;

  // ── THE §3 ROWS' DESTINATIONS (v43 slice 2) — every one of them exists ──
  /** The Pro row: opens the plans/checkout cards that already live below. */
  const openPlans = useCallback(() => setPlansOpen((open) => !open), []);
  /** The Theme row: opens the existing Dark/Light choice, in place. */
  const toggleThemeChoice = useCallback(() => setThemeOpen((open) => !open), []);
  /** Google Drive / Dropbox: the Cloud Sync screen that owns their state. */
  const openCloudSync = useCallback(() => {
    navigation.getParent()?.navigate('CloudSync');
  }, [navigation]);
  /** Help & FAQ: the honest answers, from services/settingsSpec. */
  const openHelp = useCallback(() => {
    Alert.alert('Help & FAQ', faqDialogBody());
  }, []);
  /** Privacy policy: the page the Play listing already points at. */
  const openPrivacyPolicy = useCallback(() => {
    void WebBrowser.openBrowserAsync(SETTINGS_PRIVACY_URL);
  }, []);
  /** About: the live version + what this build really does. */
  const openAbout = useCallback(() => {
    Alert.alert('NoteSnap', aboutDialogBody(appVersion));
  }, [appVersion]);
  // ── v45 slice 2 · the two retention entries (owner 10-26: off Home, in here) ──
  /** 🏅 Achievements — the medals surface, rendered in place like Home used to. */
  const handleOpenAchievements = useCallback(() => {
    setShowAchievements(true);
  }, []);
  /** 📋 This Week — the practice-week surface, rendered in place. */
  const handleOpenPracticeWeek = useCallback(() => {
    setShowPracticeWeek(true);
  }, []);
  /**
   * The week view's practice exits. Settings owns no practice flow of its own, so
   * both land on the HOME tab — where today's piece and the find-a-song search
   * live. That is a real destination, not a dead tap: the tab actually changes.
   */
  const goPracticeOnHome = useCallback(() => {
    setShowPracticeWeek(false);
    tabNavigation.navigate('Home');
  }, [tabNavigation]);

  /**
   * The screen's colours, resolved from the chosen theme (v33 §F2). Each entry is
   * one ROLE, so a new palette is a value in theme.ts and never a hunt through
   * this file. `styles` keeps the layout; these override every colour.
   */
  const themed = {
    screen: { backgroundColor: theme.background },
    title: { color: theme.accent },
    subtitle: { color: theme.subtext },
    muted: { color: theme.subtext },
    strong: { color: theme.text },
    card: { backgroundColor: theme.surface, borderColor: theme.border },
    chip: { backgroundColor: theme.chipBg, borderColor: theme.border },
    chipText: { color: theme.chipText },
  };

  // ── v45 slice 2 · the two retention SURFACES (rendered in place) ──
  // Same full-screen-in-place pattern every flow in this app uses, so no route is
  // added and Android BACK is each screen's own job (src/services/backExitContract).
  if (showAchievements) {
    return <AchievementsScreen onClose={() => setShowAchievements(false)} />;
  }
  if (showPracticeWeek) {
    return (
      <PracticeWeekScreen
        onClose={() => setShowPracticeWeek(false)}
        featuredTitle={null}
        onPracticeToday={goPracticeOnHome}
        onFindPiece={goPracticeOnHome}
      />
    );
  }
  return (
    <ScrollView
      style={[styles.container, themed.screen]}
      contentContainerStyle={styles.content}
    >
      {/* ═══════════════ v43 §3 · THE PRO ROW (the money path, one quiet row) ═══════════════
          CARD fill + 1 dp LISTEN edge, r16, 358 × 62. The pill opens the EXISTING
          plans flow below; nothing here blocks the free tier. */}
      <Pressable
        style={[styles.proRow, { backgroundColor: palette.CARD, borderColor: palette.LISTEN }]}
        onPress={openPlans}
        accessibilityRole="button"
        accessibilityLabel={SETTINGS_PRO_TITLE}
        accessibilityHint="Shows the NoteSnap Pro plans"
      >
        <View style={styles.proCopy}>
          <Text style={[styles.proTitle, { color: palette.TXT }]}>{SETTINGS_PRO_TITLE}</Text>
          <Text style={[styles.proSub, { color: palette.SUB }]}>{SETTINGS_PRO_SUB}</Text>
        </View>
        <Pressable
          style={[styles.proCta, { backgroundColor: palette.SOFTFILL }]}
          onPress={openPlans}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[styles.proCtaText, { color: palette.HUM }]}>{SETTINGS_PRO_CTA}</Text>
        </Pressable>
      </Pressable>

      {/* ── The plans flow the Pro row opens: the EXISTING checkout cards ── */}
      {plansOpen && (
        <>
          {/* ── Current Plan ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, themed.title]}>Your Plan</Text>
            <View style={[styles.planCard, themed.card]}>
              {checking ? (
                <ActivityIndicator color={theme.accent} size="small" />
              ) : (
                <>
                  <Text style={styles.planEmoji}>
                    {proState.isPro ? '⭐' : '🎵'}
                  </Text>
                  <Text style={[styles.planName, themed.strong]}>
                    {proState.isPro ? planLabel ?? 'NoteSnap Pro' : 'NoteSnap Free'}
                  </Text>
                  <Text style={[styles.planStatus, themed.muted]}>
                    {proState.isPro
                      ? 'Unlimited recognitions'
                      : '5 recognitions / month'}
                  </Text>
                  {proState.isPro && proState.currentPeriodEnd && (
                    <Text style={styles.planRenews}>
                      Renews {new Date(proState.currentPeriodEnd).toLocaleDateString()}
                    </Text>
                  )}
                </>
              )}
            </View>
          </View>

          {/* ── Upgrade Options (shown for free users) ── */}
          {!checking && !proState.isPro && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, themed.title]}>Upgrade</Text>
              <Text style={[styles.sectionSubtitle, themed.subtitle]}>
                You're on the free plan — 5 recognitions/month.{'\n'}
                Upgrade anytime for unlimited access.
              </Text>

              {PLANS.map((plan) => (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.upgradeCard, themed.card, plan.highlight && styles.upgradeCardHighlight]}
                  onPress={() => handleUpgrade(plan.id)}
                  disabled={loadingPlan !== null}
                  activeOpacity={0.7}
                >
                  {plan.highlight && (
                    <View style={styles.bestValueBadge}>
                      <Text style={styles.bestValueText}>BEST VALUE</Text>
                    </View>
                  )}
                  <View style={styles.upgradeInfo}>
                    <Text style={[styles.upgradeName, themed.strong]}>{plan.name}</Text>
                    <Text style={[styles.upgradePrice, themed.muted]}>{plan.price}</Text>
                    {plan.savings && (
                      <Text style={styles.upgradeSavings}>{plan.savings}</Text>
                    )}
                    <Text style={[styles.upgradeFeature, themed.muted]}>{plan.feature}</Text>
                  </View>
                  {loadingPlan === plan.id ? (
                    <ActivityIndicator color={theme.accent} size="small" />
                  ) : (
                    <View style={[styles.upgradeBtn, plan.highlight && styles.upgradeBtnPrimary]}>
                      <Text style={[styles.upgradeBtnText, plan.highlight && styles.upgradeBtnTextPrimary]}>
                        Subscribe
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── Billing Info ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, themed.title]}>Billing</Text>
            <View style={[styles.infoCard, themed.card]}>
              <Text style={[styles.infoText, themed.muted]}>
                • Cancel anytime — one tap, no hassle{'\n'}
                • Free plan available with 5 recognitions/month{'\n'}
                • No commitments — you're in control{'\n'}
                • Payment processed securely by Stripe
              </Text>
            </View>
          </View>
        </>
      )}

      {/* ═══════════════ v43 §3 · AUDIO & RECORDING ═══════════════ */}
      <Text style={[styles.specHeader, { color: palette.SUB }]} accessibilityRole="header">Audio & Recording</Text>
      <View style={[styles.specGroup, { backgroundColor: palette.CARD, borderColor: palette.CARD_LINE }]}>
        <SpecRow
          styles={styles}
          palette={palette}
          title="Microphone access"
          sub="Allowed while using the app"
          value={microphoneAccessLabel(microphone)}
          onPress={openSystemSettings}
          hint="Opens the system settings"
        />
        {/* The cleanup is ALWAYS applied (the pitch extractor filters breath and
            room tone; the backend filters every query), and no stored preference
            exists — so this is a value, not a switch that would do nothing. */}
        <SpecRow
          styles={styles}
          palette={palette}
          title="Noise filter"
          sub="Clean the room before matching"
          value={noiseFilterValueLabel()}
          divider
        />
      </View>

      {/* ═══════════════ v43 §3 · PLAYBACK ═══════════════ */}
      <Text style={[styles.specHeader, { color: palette.SUB }]} accessibilityRole="header">Playback</Text>
      <View style={[styles.specGroup, { backgroundColor: palette.CARD, borderColor: palette.CARD_LINE }]}>
        <SpecRow
          styles={styles}
          palette={palette}
          title="Theme"
          sub="Dark, light or follow system"
          value={themeValueLabel(themeMode)}
          onPress={toggleThemeChoice}
          hint="Shows the dark and light choices"
        />
        {/* The page-turner speed is a PER-PIECE memory set in the score reader
            (services/pageTurnPresets + pageTurnSpeedStore); the row names the
            profile a piece with no saved speed starts from. */}
        <SpecRow
          styles={styles}
          palette={palette}
          title="Auto-scroll speed"
          sub="Page turns while you play"
          value={autoScrollValueLabel()}
          divider
        />
      </View>
      {/* The Theme row's choice — the SAME Dark/Light binding every screen reads
          (services/themeStore), so the change is app-wide and live. */}
      {themeOpen && (
        <View style={[styles.specThemePanel, { backgroundColor: palette.CARD, borderColor: palette.CARD_LINE }]}>
          <Text style={[styles.specPanelTitle, { color: palette.TXT }]}>{THEME_SECTION_TITLE}</Text>
          <Text style={[styles.infoText, themed.strong]}>{THEME_ROW_TITLE}</Text>
          <Text style={[styles.infoText, themed.muted]}>{themeAppliedLine(themeMode)}</Text>
          <View style={styles.themeChoiceRow}>
            <TouchableOpacity
              style={[
                styles.themeChoice,
                themed.chip,
                themeMode === 'dark' && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
              onPress={() => setThemeMode('dark')}
              accessibilityRole="button"
              accessibilityState={{ selected: themeMode === 'dark' }}
              accessibilityLabel={THEME_ACCESSIBILITY_LABEL}
            >
              <Text style={[styles.themeChoiceText, themed.chipText]}>{THEME_DARK_LABEL}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.themeChoice,
                themed.chip,
                themeMode === 'light' && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
              onPress={() => setThemeMode('light')}
              accessibilityRole="button"
              accessibilityState={{ selected: themeMode === 'light' }}
              accessibilityLabel={THEME_ACCESSIBILITY_LABEL}
            >
              <Text style={[styles.themeChoiceText, themed.chipText]}>{THEME_LIGHT_LABEL}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.themeNote, themed.muted]}>{THEME_HONEST_NOTE}</Text>
        </View>
      )}

      {/* ═══════════════ v43 §3 · CLOUD SYNC & STORAGE ═══════════════ */}
      <Text style={[styles.specHeader, { color: palette.SUB }]} accessibilityRole="header">Cloud Sync & Storage</Text>
      <View style={[styles.specGroup, { backgroundColor: palette.CARD, borderColor: palette.CARD_LINE }]}>
        <SpecRow
          styles={styles}
          palette={palette}
          title="Google Drive"
          sub="Back up scores and takes"
          value={cloudValueLabel(cloud.gdrive)}
          onPress={openCloudSync}
          hint="Opens Cloud sync"
        />
        <SpecRow
          styles={styles}
          palette={palette}
          title="Dropbox"
          sub="Back up scores and takes"
          value={cloudValueLabel(cloud.dropbox)}
          onPress={openCloudSync}
          hint="Opens Cloud sync"
          divider
        />
      </View>

      {/* ═══════════════ v43 §3 · SUPPORT ═══════════════ */}
      <Text style={[styles.specHeader, { color: palette.SUB }]} accessibilityRole="header">Support</Text>
      <View style={[styles.specGroup, { backgroundColor: palette.CARD, borderColor: palette.CARD_LINE }]}>
        <SpecRow
          styles={styles}
          palette={palette}
          title="Help & FAQ"
          onPress={openHelp}
          hint="Opens the answers to the common questions"
          chevron
        />
        <SpecRow
          styles={styles}
          palette={palette}
          title="Privacy policy"
          onPress={openPrivacyPolicy}
          hint="Opens the privacy policy"
          chevron
          divider
        />
        <SpecRow
          styles={styles}
          palette={palette}
          title="About NoteSnap"
          sub={aboutVersionLine(appVersion)}
          onPress={openAbout}
          hint="Shows the version and what this build does"
          chevron
          divider
        />
        {/* v43 item B1 — THE BUILD STAMP, under the About row. Step 0 of every
            owner checklist from v43 on: this line must read the version you were
            told to test. It is the only reliable cure for a stale Play install. */}
        <Text
          style={styles.buildStamp}
          accessibilityLabel={BUILD_STAMP_TAG}
          selectable
        >
          {buildStampLine({ version: appVersion, versionCode: appVersionCode, sha: BUILD_SHA })}
        </Text>
      </View>

      {/* ═══════════ BELOW THE SPEC'S FOUR GROUPS ═══════════
          The spec's closed row set has no home for these owner-approved surfaces
          (practice reminders 09-25, the calendar channel 10-10). They are kept —
          nothing is silently dropped — and the delivery report lists them for the
          lead to move or retire. */}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themed.title]}>{PRACTICE_SECTION_TITLE}</Text>
        <Text style={[styles.sectionSubtitle, themed.subtitle]}>{PRACTICE_SECTION_SUBTITLE}</Text>
        <View style={[styles.infoCard, themed.card]}>
          <View style={styles.reminderRow}>
            <View style={styles.reminderCopy}>
              <Text style={[styles.reminderTitle, themed.strong]}>{PRACTICE_STREAK_ROW_TITLE}</Text>
              <Text style={[styles.infoText, themed.muted]}>{PRACTICE_STREAK_ROW_HINT}</Text>
              <Text style={[styles.infoText, themed.muted]}>{reminderSettingCopy(reminderMinutes)}</Text>
            </View>
            <TouchableOpacity onPress={toggleNotifications} style={[styles.toggle, themed.chip, notificationsEnabled && { backgroundColor: theme.accent }]} accessibilityRole="switch" accessibilityState={{ checked: notificationsEnabled }}>
              <Text style={[styles.toggleText, themed.chipText]}>{notificationsEnabled ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>
          {/* The reminder TIME the user chooses (owner 09-25). Deliberately a
              lightweight in-repo picker — hour and 5-minute steppers — rather than
              a native time dialog: no new dependency, no OS-styled modal, and the
              chosen value is the same minutes-of-day the scheduler arms. */}
          <View style={styles.timePickerRow}>
            <View style={styles.timeStepper}>
              <TouchableOpacity
                style={styles.timeStepBtn}
                disabled={!notificationsEnabled}
                accessibilityRole="button"
                accessibilityLabel="Remind me an hour earlier"
                onPress={() => onChangeReminderTime(stepReminderMinutes(reminderMinutes, -60))}
              >
                <Text style={styles.timeStepText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.timeStepLabel}>Hour</Text>
              <TouchableOpacity
                style={styles.timeStepBtn}
                disabled={!notificationsEnabled}
                accessibilityRole="button"
                accessibilityLabel="Remind me an hour later"
                onPress={() => onChangeReminderTime(stepReminderMinutes(reminderMinutes, 60))}
              >
                <Text style={styles.timeStepText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.timePickerValue}>{formatReminderTime(reminderMinutes)}</Text>
            <View style={styles.timeStepper}>
              <TouchableOpacity
                style={styles.timeStepBtn}
                disabled={!notificationsEnabled}
                accessibilityRole="button"
                accessibilityLabel="Remind me five minutes earlier"
                onPress={() => onChangeReminderTime(stepReminderMinutes(reminderMinutes, -5))}
              >
                <Text style={styles.timeStepText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.timeStepLabel}>5 min</Text>
              <TouchableOpacity
                style={styles.timeStepBtn}
                disabled={!notificationsEnabled}
                accessibilityRole="button"
                accessibilityLabel="Remind me five minutes later"
                onPress={() => onChangeReminderTime(stepReminderMinutes(reminderMinutes, 5))}
              >
                <Text style={styles.timeStepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* ═══════════ v45 slice 2 · YOUR PRACTICE (owner 10-26) ═══════════
          These three were Home's retention CHIPS, closing the "Browse & keep
          going" band. The owner moved them here rather than deleting them, so the
          door lost its last non-search rows and retention stayed reachable:

            · the streak STATE — visible, never a tap (a number promises nothing);
            · 🏅 Achievements — opens AchievementsScreen;
            · 📋 This Week — opens PracticeWeekScreen.

          Both rows are real taps into screens this screen mounts itself, and the
          labels come from services/frontDoorBands (one copy of each name). */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themed.title]}>Your practice</Text>
        <Text style={[styles.sectionSubtitle, themed.subtitle]}>
          Your streak, your medals and this week.
        </Text>
        <View
          style={[
            styles.retentionCard,
            { backgroundColor: palette.CARD, borderColor: palette.CARD_LINE },
          ]}
        >
          <SpecRow
            styles={styles}
            palette={palette}
            title="Current streak"
            sub="Days in a row you have practised"
            value={streakChipCopy(streakDays)}
          />
          <SpecRow
            styles={styles}
            palette={palette}
            title={MEDALS_CHIP_LABEL}
            sub={ACHIEVEMENTS_ENTRY_HINT}
            onPress={handleOpenAchievements}
            hint="Opens your achievements and medals"
            chevron
            divider
          />
          <SpecRow
            styles={styles}
            palette={palette}
            title={WEEK_CHIP_LABEL}
            sub="The days you practised this week"
            onPress={handleOpenPracticeWeek}
            hint="Opens this week's practice"
            chevron
            divider
          />
        </View>
      </View>

      {/* THE CALENDAR CHANNEL (owner-approved 10-10, backlog b033ab48): opt-in,
          OFF by default, CALENDAR-ONLY when armed, with "also keep the in-app
          reminder" as the explicit two-reminders choice. Every line here comes
          from the pure model, and what is armed comes from `calendarPlan`. The
          single-line marker below is what the tier1 guard suite slices on. */}
      {/* CALENDAR-REMINDERS-SECTION-START */}
      <View style={styles.section}>
        <View style={[styles.infoCard, themed.card]}>
          <View style={styles.reminderRow}>
            <View style={styles.reminderCopy}>
              <Text style={[styles.reminderTitle, themed.strong]}>{calendarRow.title}</Text>
              {calendarRow.lines.map((line) => (
                <Text key={line} style={[styles.infoText, themed.muted]}>
                  {line}
                </Text>
              ))}
              {calendarRow.honesty.map((line) => (
                <Text
                  key={line}
                  style={[
                    styles.calendarHonestLine,
                    themed.muted,
                    calendarPlan.doublePing && line === CALENDAR_TWO_REMINDERS_LINE_KEY && styles.calendarWarn,
                  ]}
                >
                  {calendarHonestyText(line, reminderMinutes)}
                </Text>
              ))}
            </View>
            <TouchableOpacity
              onPress={() => {
                if (calendarOn) void disableCalendarReminders();
                else void enableCalendarReminders();
              }}
              style={[styles.toggle, themed.chip, calendarOn && { backgroundColor: theme.accent }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: calendarOn }}
              accessibilityLabel={CALENDAR_ROW_TITLE}
            >
              <Text style={[styles.toggleText, themed.chipText]}>{calendarOn ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {calendarOn && !calendarStale && (
            <View style={styles.calendarActionRow}>
              <Text style={[styles.infoText, themed.muted]}>
                {calendarChoiceLabel(selectedCalendar)}
              </Text>
              <TouchableOpacity
                style={[styles.calendarSmallBtn, themed.chip]}
                onPress={() => setPickerOpen(true)}
                accessibilityRole="button"
              >
                <Text style={[styles.calendarSmallBtnText, themed.chipText]}>{CHANGE_CALENDAR_CTA}</Text>
              </TouchableOpacity>
            </View>
          )}

          {calendarStale && (
            <View style={styles.calendarActionRow}>
              <TouchableOpacity
                style={[styles.calendarSmallBtn, themed.chip]}
                onPress={() => setPickerOpen(true)}
                accessibilityRole="button"
              >
                <Text style={[styles.calendarSmallBtnText, themed.chipText]}>{CHOOSE_CALENDAR_CTA}</Text>
              </TouchableOpacity>
            </View>
          )}

          {calendarDenied && (
            <View style={styles.calendarDeniedBlock}>
              <Text style={[styles.calendarHonestLine, themed.muted]}>
                {CALENDAR_PERMISSION_DENIED_LINE}
              </Text>
              <TouchableOpacity
                style={[styles.calendarSmallBtn, themed.chip]}
                onPress={() => {
                  void Linking.openSettings();
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.calendarSmallBtnText, themed.chipText]}>
                  {CALENDAR_OPEN_SETTINGS_CTA}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {calendarOn && (
            <>
              <Text style={[styles.calendarChoiceTitle, themed.strong]}>
                {CALENDAR_CHOICE_TITLE}
              </Text>
              <View style={styles.themeChoiceRow}>
                <TouchableOpacity
                  style={[
                    styles.themeChoice,
                    themed.chip,
                    reminderChannel === 'calendar' && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                  onPress={() => void applyChannelChoice('calendar')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reminderChannel === 'calendar' }}
                >
                  <Text style={[styles.themeChoiceText, themed.chipText]}>
                    {CHANNEL_CHOICE_CALENDAR_ONLY_LABEL}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.themeChoice,
                    themed.chip,
                    reminderChannel === 'both' && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                  onPress={() => void applyChannelChoice('both')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reminderChannel === 'both' }}
                >
                  <Text style={[styles.themeChoiceText, themed.chipText]}>
                    {CHANNEL_CHOICE_BOTH_LABEL}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.calendarHonestLine, themed.muted]}>
                {calendarRow.choiceHints.calendarOnly}
              </Text>
              <Text style={[styles.calendarHonestLine, themed.muted]}>{calendarRow.choiceHints.both}</Text>
              <Text style={[styles.calendarHonestLine, themed.muted]}>{CALENDAR_SURVIVES_UNINSTALL_LINE}</Text>
              <Text style={[styles.calendarHonestLine, themed.muted]}>{CALENDAR_HONESTY}</Text>
            </>
          )}

          {calendarNotice && (
            <Text style={[styles.calendarHonestLine, themed.muted]}>{calendarNotice}</Text>
          )}
          {hygieneLine && <Text style={[styles.calendarHonestLine, themed.muted]}>{hygieneLine}</Text>}

          <View style={styles.calendarActionRow}>
            <TouchableOpacity
              style={[styles.calendarSmallBtn, themed.chip]}
              disabled={hygieneBusy}
              onPress={() => void removeNoteSnapReminders()}
              accessibilityRole="button"
            >
              <Text style={[styles.calendarSmallBtnText, themed.chipText]}>{CALENDAR_HYGIENE_CTA}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {/* CALENDAR-REMINDERS-SECTION-END */}

      <CalendarPickerSheet
        visible={pickerOpen}
        calendars={writableCalendars}
        defaultCalendarId={pickerDefaultId}
        selectedCalendarId={calendarId}
        onClose={() => setPickerOpen(false)}
        onSelect={(pickedId) => void onPickCalendar(pickedId)}
      />

      {/* The honest tail (v43 §3): there is nothing to sign in to. */}
      <Text style={[styles.specFootnote, { color: palette.DIM }]}>{SETTINGS_NO_ACCOUNT_LINE}</Text>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

/**
 * THE MICROPHONE ROW'S DESTINATION — the system page where the permission lives,
 * which is the same path the calendar channel's denied state already offers. It
 * is declared once, at module level (hoisted), and it is deliberately the file's
 * LAST openSettings() call site so the calendar section keeps the one the v38
 * guard suite follows.
 */
function openSystemSettings(): void {
  Linking.openSettings().catch(() => {
    // A device with no settings app: the row's value already tells the truth.
  });
}

// ══════════════════ v43 §3 · THE ONE ROW (and its card) ══════════════════
//
// Every row on the §3 surface is this component: one geometry, one type scale,
// one trailing shape (a value / a chevron), and a hairline LINE between rows
// inside a card. Colours arrive ONLY as the palette's roles — this file's §3
// styles carry no hex, so the light theme is the token swap.

interface SpecRowProps {
  /** The screen's own themed StyleSheet. This row is a MODULE-LEVEL
   *  component, so it cannot read the screen's component-scope `styles`
   *  binding — every call site passes it in instead (reading it here was a
   *  runtime ReferenceError on the first row, i.e. Settings crashed on open). */
  styles: SpecRowStyles;
  palette: SettingsPalette;
  title: string;
  /** The 11 dp SUB line; the title centres when it is absent. */
  sub?: string;
  /** The 13 dp bold HUM trailing value — shown when the row states something. */
  value?: string;
  /** The row's REAL destination. Absent only on a declared honest-value row. */
  onPress?: () => void;
  hint?: string;
  /** The trailing chevron — only on rows that open something. */
  chevron?: boolean;
  /** The hairline LINE above this row (every row but the card's first). */
  divider?: boolean;
}

const SpecRow: React.FC<SpecRowProps> = ({
  styles,
  palette,
  title,
  sub,
  value,
  onPress,
  hint,
  chevron,
  divider,
}) => {
  const content = (
    <>
      <View style={styles.specRowCopy}>
        <Text style={[styles.specRowTitle, { color: palette.TXT }]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.specRowSub, { color: palette.SUB }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.specRowValue, { color: palette.HUM }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {chevron ? <Ionicons name="chevron-forward" size={14} color={palette.SUB} /> : null}
    </>
  );
  return (
    <View>
      {divider ? <View style={[styles.specDivider, { backgroundColor: palette.LINE }]} /> : null}
      {onPress ? (
        <Pressable
          style={styles.specRow}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityHint={hint}
        >
          {content}
        </Pressable>
      ) : (
        <View style={styles.specRow} accessibilityRole="text">
          {content}
        </View>
      )}
    </View>
  );
};

/** The §3 row styles, read OFF the screen's sheet — one geometry, no copy:
 *  the names stay the ones baseStyles declares (specRow / specRowCopy /
 *  specRowTitle / specRowSub / specRowValue / specDivider). */
type SpecRowStyles = Pick<
  typeof baseStyles,
  'specRow' | 'specRowCopy' | 'specRowTitle' | 'specRowSub' | 'specRowValue' | 'specDivider'
>;

const baseStyles = StyleSheet.create({
  // ── v43 §3 · SETTINGS SPEC ── (every value below is a number from
  // services/settingsSpec's SETTINGS_SPEC; NO colour lives in this block — the
  // palette supplies every one of them at render time.)
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  // The Pro row: 358 × 62, r16, 1 dp LISTEN edge.
  proRow: {
    height: 62,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 12,
  },
  proCopy: { flex: 1, paddingRight: 8 },
  proTitle: { fontSize: 16, fontWeight: '700' },
  proSub: { fontSize: 12, marginTop: 2 },
  proCta: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  proCtaText: { fontSize: 13, fontWeight: '700' },
  // The section header: 11 dp caps bold, 20 above / 18 below, indent x16.
  specHeader: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 18,
  },
  // The card IS the group bound: r16, 1 dp CARD_LINE, 20 dp to the next group.
  specGroup: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 20,
  },
  specDivider: { height: 1 },
  // v45 slice 2 · the "Your practice" card that carries the three retention rows.
  // Same geometry as the spec's cards ON PURPOSE (one row idiom on this screen),
  // but its own key: the spec's four-group guard counts ITS cards, and these rows
  // deliberately sit BELOW the spec's closed row set (owner 10-26).
  retentionCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 20,
  },
  // ONE row style: 52 dp, inset x32, title 15 / sub 11 / value 13.
  specRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 10,
  },
  specRowCopy: { flex: 1, paddingRight: 100 },
  specRowTitle: { fontSize: 15, fontWeight: '700' },
  specRowSub: { fontSize: 11, marginTop: 2 },
  specRowValue: { fontSize: 13, fontWeight: '700', marginRight: 6 },
  // The Theme row's in-place choice (the existing Dark/Light binding).
  specThemePanel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: -8,
    marginBottom: 20,
  },
  specPanelTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  // The honest tail, once.
  specFootnote: { fontSize: 11.5, textAlign: 'center', marginTop: 8 },
  // ── v43 §3 · END (everything below is pre-existing layout, unchanged) ──

  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e94560',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#a0a0b8',
    marginBottom: 16,
    lineHeight: 20,
  },

  reminderRow: { flexDirection: 'row', alignItems: 'center' },
  reminderCopy: { flex: 1, marginRight: 12 },
  reminderTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  // The reminder-time picker (owner 09-25): one row, two steppers, the chosen
  // time in the middle.
  timePickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  timeStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeStepBtn: { backgroundColor: '#3a3a5c', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  timeStepText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  timeStepLabel: { color: '#8f8fa8', fontSize: 12 },
  timePickerValue: { color: '#fff', fontSize: 15, fontWeight: '700' },
  toggle: { backgroundColor: '#3a3a5c', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  toggleOn: { backgroundColor: '#e94560' },
  toggleText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  // The calendar-reminder row (owner 10-10, backlog b033ab48). Layout only — every
  // colour comes from the resolved theme tokens at the call site; the two-reminder
  // line is the one line that is highlighted, because it is the one the user needs
  // to notice (it is shown exactly when the plan says `doublePing`).
  calendarHonestLine: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  calendarWarn: { color: '#f0b429', fontWeight: '700' },
  calendarChoiceTitle: { fontSize: 14, fontWeight: '700', marginTop: 14 },
  calendarActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 10,
  },
  calendarDeniedBlock: { marginTop: 10 },
  calendarSmallBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  calendarSmallBtnText: { fontSize: 13, fontWeight: '700' },

  // The Appearance segment buttons (v33 §F2). Layout only — every colour comes
  // from the resolved theme tokens at the call site.
  themeChoiceRow: { flexDirection: 'row', marginTop: 12, gap: 10 },
  themeChoice: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeChoiceText: { fontSize: 15, fontWeight: '700' },
  themeNote: { fontSize: 13, lineHeight: 19, marginTop: 12 },

  // Current Plan
  planCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
    minHeight: 110,
    justifyContent: 'center',
  },
  planEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  planStatus: {
    fontSize: 14,
    color: '#a0a0b8',
  },
  planRenews: {
    fontSize: 13,
    color: '#4ecdc4',
    marginTop: 6,
    fontWeight: '600',
  },

  // Upgrade Cards
  upgradeCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    flexDirection: 'row',
    alignItems: 'center',
  },
  upgradeCardHighlight: {
    borderColor: '#e94560',
    borderWidth: 2,
  },
  bestValueBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: '#e94560',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  bestValueText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  upgradeInfo: {
    flex: 1,
    marginRight: 12,
  },
  upgradeName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  upgradePrice: {
    fontSize: 15,
    color: '#c0c0d0',
    fontWeight: '600',
    marginBottom: 2,
  },
  upgradeSavings: {
    fontSize: 13,
    color: '#4ecdc4',
    fontWeight: '600',
    marginBottom: 6,
  },
  upgradeFeature: {
    fontSize: 13,
    color: '#a0a0b8',
    lineHeight: 20,
  },
  upgradeBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e94560',
  },
  upgradeBtnPrimary: {
    backgroundColor: '#e94560',
  },
  upgradeBtnText: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '700',
  },
  upgradeBtnTextPrimary: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Billing info
  infoCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  infoText: {
    fontSize: 14,
    color: '#a0a0b8',
    lineHeight: 22,
  },
  /* v43 item B1 — the build stamp: the quietest type on the screen, but
     selectable, so a tester can copy it into a report. */
  buildStamp: {
    fontSize: 12,
    color: '#8a8ab0',
    lineHeight: 17,
    paddingHorizontal: 4,
    paddingTop: 8,
  },

  bottomSpacer: {
    height: 40,
  },
});
