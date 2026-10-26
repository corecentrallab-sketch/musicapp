/**
 * HomeScreen (Discover tab) — the main hub.
 * Shows: recognition prompt, streak counter, weekly goals, daily challenge,
 * and personalised recommendation copy.
 *
 * Recognition flow:
 * 1. Tap "Start Listening" → microphone recording starts
 * 2. Auto-stops after 8s or manual tap → sends audio to API
 * 3. Results shown in RecognitionResultView modal
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { BadgeToast } from '../components/BadgeToast';
import {
  RecognitionResultView,
  type RecognitionPhase,
} from '../components/RecognitionResultView';
import { ModernSongInterstitial } from '../components/ModernSongInterstitial';
import { ScoreViewer } from '../components/ScoreViewer';
import { SampleBadge } from '../components/SampleBadge';
import { PieceDetailScreen } from './PieceDetailScreen';
import { HumSearchScreen } from './HumSearchScreen';
import { ModernSearchScreen } from './ModernSearchScreen';
import { FindPieceScreen } from './FindPieceScreen';
import { PracticeWeekScreen } from './PracticeWeekScreen';
// The medals surface (owner-approved 08-25 retention build). Rendered IN PLACE
// like the flows above; it registers useHardwareBack itself.
import { AchievementsScreen } from './AchievementsScreen';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { NO_AUDIO_DIAGNOSTICS } from '../services/captureTelemetry';
import type { CaptureDiagnostics } from '../services/captureTelemetry';
import {
  recognizeAudio,
  recognizeModernSong,
  humToSearch,
  fetchPieceById,
  isRecognitionLimitError,
} from '../services/api';
import {
  humOutcome,
  humNoMatchMessage,
  humPhraseHint,
  modernOutcome,
  type ModernOutcome,
} from '../services/tier1';
import {
  IDLE_SURFACE,
  STOP_FAILURE_COPY,
  type ModernSurfaceState,
} from '../services/recognitionRetry';
// The ONE-BUTTON FRONT DOOR (owner-approved 09-24). Its state machine, every
// string it shows and its honest start-failure mapping live in
// src/services/frontDoor.ts so the screen and the tier1 gate read the SAME
// words, and the guard can assert the wiring from the app's own source.
import {
  FIND_PIECE_ENTRY_HINT,
  FIND_PIECE_ENTRY_LABEL,
  HOME_SPLIT_HUM_A11Y,
  HOME_SPLIT_HUM_TIP,
  HOME_SPLIT_HUM_TITLE,
  HOME_SPLIT_LISTEN_A11Y,
  HOME_SPLIT_LISTEN_TITLE,
  HOME_SPLIT_SECTION_LABEL,
  frontDoorStartFailure,
  heroAccessibilityLabel,
  heroState,
  heroSupport,
  heroTapAction,
  homePromiseCopy,
  humMatchToResultResponse,
} from '../services/frontDoor';
// The hosted score the hum pass resolves for its top match (bundle A): the shared
// result surface renders it INLINE, so the door's own hum pass looks the piece up
// in our catalog exactly as the full hum screen does.
import type { HumResolvedSheet } from '../services/frontDoor';
// THE v44 EQUAL SPLIT (owner-approved 10-22): two peer panels, ONE component
// with a `variant` prop. Every hex/dp/delta/copy string lives in
// src/services/heroSplit.ts (spec: hum-button-concept/ENGINEER-NOTES.md) so this
// screen never retypes a number, and the tier-1 gate scans this file's real
// source for the wiring (both panels → real handlers, the one-time tip key).
import { HeroSplitPanel } from '../components/HeroSplitPanel';
import { HumSplitCoachMark } from '../components/HumSplitCoachMark';
import {
  SPLIT_TEST_IDS,
  SPLIT_TIP,
  splitPanelBody,
  splitPuckState,
  splitShouldShowTip,
} from '../services/heroSplit';
// The front door's BAND MODEL and the "Find a song" bar's one source of copy
// (re-flow bundle D + B, owner build-go 10-02). The band containers below render
// from these names, and src/services/frontDoorBands.ts + scripts/frontDoorBands.test.ts
// assert the order, the one-meaning-per-entry rule and the zero-promise rule
// against THIS file's real source.
import {
  BAND_TEST_IDS,
  BAND_TITLES,
  BROWSE_LIBRARY_ACCESSIBILITY_LABEL,
  BROWSE_LIBRARY_HINT,
  BROWSE_LIBRARY_LABEL,
  DISCOVER_BAND_NOTE,
  FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL,
  FIND_ANY_SONG_CHIP_LABEL,
  FRONT_DOOR_BETA_NOTE,
  FRONT_DOOR_FACET_FLAGS,
  WEEK_CHIP_ACCESSIBILITY_LABEL,
  WEEK_CHIP_LABEL,
  bandFacets,
  retentionChips,
  todayCardAccessibilityLabel,
} from '../services/frontDoorBands';
import {
  TODAYS_PIECE_EYEBROW,
  TODAYS_PIECE_NO_PIECE_LINE,
  TODAYS_PIECE_NO_PIECE_TITLE,
} from '../services/uxrV41Contract';
// The categories a result is allowed to claim — never a hardcoded genre.
import { PUBLIC_DOMAIN_GENRE } from '../services/resultGenre';
// The PD-library cross-check on the modern route (owner 09-25, build #3): a
// commercial RECORDING of a public-domain work (Lang Lang's Für Elise) must land
// on the PD library card — the free in-app score — not on a "Modern Song" card
// with retailer CTAs.
import {
  pdLibraryResultResponse,
  pdMatchFromModernResponse,
} from '../services/pdRouting';
// The Android hardware-BACK handler for Home's own in-place flow (the featured
// piece view). src/services/backExitContract.ts guards the wiring.
import { useHardwareBack } from '../hooks/useHardwareBack';
// The retailer links a modern match arrived with, saved ON the History row
// (owner 10-01) so the saved row can still open the sheet music it offered.
import { modernPurchaseUrls } from '../services/purchaseCta';
import {
  recordPractice,
  getWeeklyGoal,
  getOnboardingAnswers,
  saveRecognition,
  getRecognitionCount,
  getTodayPracticeMinutes,
  getProState,
} from '../services/storage';
import {
  getDisplayStreakLocal,
  type DisplayStreak,
} from '../services/reinforcementStore';
import {
  EMPTY_STREAK_SUMMARY,
} from '../services/practiceReinforcementView';
import { StreakNudgeCard } from '../components/StreakNudgeCard';
import {
  practiceTodayDestination,
} from '../services/homeCards';
import { checkAndAwardBadges } from '../services/achievements';
// ── The MEDALS layer (owner-approved 08-25): earned-once medals over the data
// the app already has, with the achievement share card and a quiet entry card.
// Every rule/threshold/copy string lives in src/services/medals.ts, and
// scripts/medals.test.ts asserts this screen's wiring from the source text.
import { ShareCard } from '../components/ShareCard';
import {
  ACHIEVEMENTS_ENTRY_HINT,
  ACHIEVEMENTS_ENTRY_LABEL,
  MEDAL_TOAST_SHARE_LABEL,
  MEDAL_UNLOCK_LABEL,
  achievementsSummaryLine,
  medalCardSubtitle,
  medalCardTitle,
  medalContext,
  medalHeadline,
  medalMetricValue,
  medalProgressLabel,
  medalShareText,
  type Medal,
  type MedalContext,
} from '../services/medals';
import { checkAndAwardMedals } from '../services/medalStore';
// The category a recognized match is saved with. The card used to store the
// catalog NUMBER in the genre slot (and a genre-less match fell through to a
// hardcoded one); the genre module owns that decision. A modern match resolves
// through modernGenreLabel() — the provider's real genre, else "Modern song".
import { modernGenreLabel, resultGenreLabel } from '../services/resultGenre';
import { getTodayChallenge } from '../services/dailyChallenge';
import { featuredPieceLibraryState } from '../services/sampleBadge';
import { resolvePieceAbc } from '../services/pieceAbc';
// v43 item B1 — the build stamp (version + versionCode + the commit built).
import type {
  WeeklyGoal,
  DailyChallengePiece,
  OnboardingAnswers,
  Badge,
  RecognitionMatch,
  RecognitionResponse,
  RootTabParamList,
  SavedPiece,
} from '../types';

/** Auto-stop recording after this many ms. Kept comfortably long so the recogniser
 *  gets enough signal from a room-recorded clip — a short capture starves the
 *  matcher and produces weak/uncertain confidence. */
const RECORDING_TIMEOUT_MS = 12000;

/** Pause between dismissing a result card and starting the next capture, so the
 *  recorder from the previous pass is fully released first. */
const RETRY_DELAY_MS = 300;

export const HomeScreen: React.FC = () => {
  const { styles, theme } = useThemedStyles(baseStyles);
  /** v43 item B1 — the live version + versionCode, for the footer build stamp. */
  // Tab-navigation handle (used to jump to Settings → Pro upgrade from the
  // quota-exhausted modal).
  const navigation =
    useNavigation<BottomTabNavigationProp<RootTabParamList>>();

  // ── Core data state ──
  // Streak numbers come from the practice-reinforcement engine (see
  // services/reinforcementStore.ts) — ONE source for every streak surface.
  const [streak, setStreak] = useState<DisplayStreak>(EMPTY_STREAK_SUMMARY);
  const [weeklyGoal, setWeeklyGoal] = useState<WeeklyGoal>({
    target: 5,
    current: 0,
    weekStart: '',
  });
  const [dailyChallenge, setDailyChallenge] =
    useState<DailyChallengePiece | null>(null);
  /**
   * THE NOTATION SCORE THE APP HOLDS FOR TODAY'S PIECE (UX round 1 step 1, owner
   * 10-18 item 5). The catalog's own abc when it carries one, else the bundled
   * public-domain practice phrase — the SAME resolver the coach card uses
   * (services/pieceAbc.ts). '' when we hold none, which renders no badge.
   */
  const featuredExcerptAbc = useMemo(
    () =>
      resolvePieceAbc({
        abc: dailyChallenge?.abc,
        title: dailyChallenge?.title,
        composer: dailyChallenge?.composer,
        pieceId: dailyChallenge?.id,
      }).abc,
    [dailyChallenge]
  );
  const [onboarding, setOnboarding] = useState<OnboardingAnswers | null>(null);
  const [badgeToast, setBadgeToast] = useState<Badge | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showScoreViewer, setShowScoreViewer] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [practiceMinutes, setPracticeMinutes] = useState(0);

  // ── Recognition state ──
  const recorder = useAudioRecorder();
  const [recognitionPhase, setRecognitionPhase] =
    useState<RecognitionPhase | null>(null);
  const [showRecognitionResults, setShowRecognitionResults] = useState(false);
  const [freeRecognitions, setFreeRecognitions] = useState(0);
  const [isPro, setIsPro] = useState(false);
  // Tier-1 full-screen flows (hum/whistle/sing and modern-song search). Each
  // owns its own recorder so they never collide with the audio-recognize flow.
  const [showHumSearch, setShowHumSearch] = useState(false);
  const [showModernSearch, setShowModernSearch] = useState(false);
  // "Find a piece" — catalog search by title/composer (no mic involved).
  const [showFindPiece, setShowFindPiece] = useState(false);
  // "📋 This Week" — the practice-week surface (which days were practised). The
  // app has no practice-run tab, so Home renders it in place like the flows above.
  const [showPracticeWeek, setShowPracticeWeek] = useState(false);

  // ── Medals (owner-approved 08-25 retention build) ──
  // The quiet entry card's line ("3 of 11 earned · next: 7-Day Streak"), the
  // freshly-earned medal shown as a NON-BLOCKING toast, and the achievement card
  // the toast's Share action opens. Nothing here can interrupt play: the toast is
  // a banner (no modal), and the card only ever opens because the user tapped.
  const [showAchievements, setShowAchievements] = useState(false);
  const [medalToast, setMedalToast] = useState<Medal | null>(null);
  const [medalSummary, setMedalSummary] = useState('');
  const [medalCard, setMedalCard] = useState<{
    medal: Medal;
    context: MedalContext;
    progressLabel: string;
  } | null>(null);
  const [showMedalCard, setShowMedalCard] = useState(false);

  // ── The ONE-BUTTON FRONT DOOR (owner-approved 09-24) ──
  // One tap runs the WHOLE hybrid pipeline (our library landmark match, then the
  // AudD modern pass) with no mode choice; when the ambient pass hears nothing we
  // recognise, this SAME button becomes the hum/whistle/sing fallback.
  // `humFallback` is that mode, `heroBusy` stops a second capture stacking on a
  // pass already in flight.
  const [humFallback, setHumFallback] = useState(false);
  const [heroBusy, setHeroBusy] = useState(false);
  // The modern match the pipeline can produce is shown by the EXISTING
  // interstitial (owner rule 08-24: no auto-redirect; SMD primary, Musicnotes
  // secondary), rendered here instead of inside a second screen.
  const [modernSurface, setModernSurface] =
    useState<ModernSurfaceState>(IDLE_SURFACE);
  const [showModernInterstitial, setShowModernInterstitial] = useState(false);
  // Which pass the current capture belongs to — read by the stop handler and by
  // "Try Again", never from a stale state closure.
  const captureModeRef = useRef<'ambient' | 'hum'>('ambient');
  /** A recognition / hum request is in flight. */
  const requestInFlightRef = useRef(false);
  /** A stop is in flight (blocks a second, phantom stop). */
  const stoppingRef = useRef(false);
  /** The tracked retry auto-start (a bare 300ms timer raced the recorder). */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which next step the no-match card offers: the inline hum fallback (the
  // ambient miss) or the hum → modern bridge (the hum miss).
  const [noMatchOffer, setNoMatchOffer] = useState<'hum' | 'modern' | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pulsing animation for the mic indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Load initial data ──
  useEffect(() => {
    loadData();
  }, []);

  /**
   * The one medal check Home makes. `checkAndAwardMedals` is idempotent — a medal
   * is awarded exactly once and never removed — so this can run on every load,
   * pull-to-refresh and recognition without ever re-announcing anything. A fresh
   * unlock becomes a NON-BLOCKING toast plus the achievement card its Share
   * action opens; play is never interrupted by a dialog.
   */
  const refreshMedals = useCallback(async () => {
    const result = await checkAndAwardMedals();
    setMedalSummary(achievementsSummaryLine(result.stats, result.records));

    const unlock = result.unlocks[0];
    const medal = result.medals[0];
    if (!unlock || !medal) return;

    setMedalToast(medal);
    setMedalCard({
      medal,
      context: medalContext(unlock.contextTitle, unlock.contextSubtitle),
      progressLabel: medalProgressLabel(medal, medalMetricValue(medal, result.stats)),
    });
  }, []);

  // Medals settle whenever Home comes back into view (returning from a practice
  // run, the sheet reader or another tab) — the same idempotent check as loadData,
  // so a medal earned during play is announced as soon as play is over, never
  // during it. Cheap: a handful of AsyncStorage reads.
  useFocusEffect(
    useCallback(() => {
      void refreshMedals();
    }, [refreshMedals]),
  );

  const loadData = async () => {
    const [s, wg, ob, dc, minutes] = await Promise.all([
      getDisplayStreakLocal(),
      getWeeklyGoal(),
      getOnboardingAnswers(),
      getTodayChallenge(), // live catalog piece (null when unreachable)
      getTodayPracticeMinutes(),
    ]);
    setStreak(s);
    setWeeklyGoal(wg);
    setOnboarding(ob);
    setDailyChallenge(dc);
    setPracticeMinutes(minutes);
    setFreeRecognitions(await getRecognitionCount());
    setIsPro((await getProState()).isPro);
    // Medals ride the same load: settle anything already earned (idempotent) and
    // refresh the quiet entry card's line.
    await refreshMedals();
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();

    // Check for new badges on refresh
    const newBadges = await checkAndAwardBadges({
      totalRecognitions: undefined,
      totalSavedPieces: undefined,
    });
    if (newBadges.length > 0) {
      setBadgeToast(newBadges[0]);
    }

    setRefreshing(false);
  }, []);

  // ── Pulsing mic animation ──
  useEffect(() => {
    if (recorder.isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recorder.isRecording, pulseAnim]);

  // ── Demo recognition (skips mic, injects mock results) ──

  const handleDemo = useCallback(async () => {
    // Dev-only. The button below is already gated behind __DEV__; this guard
    // makes the handler itself inert in production builds (Metro compiles
    // __DEV__ to false in release bundles, so this returns immediately and
    // the mock path can never execute even if invoked programmatically).
    if (!__DEV__) {
      return;
    }
    // Brief loading phase
    setRecognitionPhase({ type: 'loading' });
    setShowRecognitionResults(true);

    // Simulate network delay, then inject mock success
    await new Promise((r) => setTimeout(r, 1200));

    // Public-domain PDF from Mutopia Project — real sheet music for demo
    const demoSheetUrl =
      'https://www.mutopiaproject.org/ftp/BachJS/BWV846/bwv-846-prelude/bwv-846-prelude-a4.pdf';

    const mockResponse: RecognitionResponse = {
      success: true,
      query_duration_ms: 234,
      db_available: true,
      matches: [
        {
          piece_id: 'debussy-clair-de-lune',
          title: 'Clair de Lune',
          composer: 'Claude Debussy',
          catalog: 'Suite bergamasque, L. 75',
          confidence: 0.94,
          album_art_url: null,
          sheet_music_url: demoSheetUrl,
          tab_url: null,
          matched_at_s: 12.5,
          is_public_domain: true,
          sheet_music_available: true,
          purchase_url: null,
        },
        {
          piece_id: 'debussy-reverie',
          title: 'Rêverie',
          composer: 'Claude Debussy',
          catalog: 'L. 68',
          confidence: 0.31,
          album_art_url: null,
          sheet_music_url: demoSheetUrl,
          tab_url: null,
          matched_at_s: 8.2,
          is_public_domain: false,
          sheet_music_available: false,
          // NO hand-written retailer link, even here. The affiliate URLs are
          // built by the BACKEND (Sheet Music Direct primary, ID 67650;
          // Musicnotes backup) and this mock used to hardcode Musicnotes plus
          // the DROPPED Sheet Music Plus. A dev demo has no backend response to
          // derive a link from, so it carries none — the honest "not linked yet"
          // card — instead of inventing one. The real CTA is one live
          // recognition away; src/services/purchaseCta.ts scans the source so a
          // hardcoded retailer link can never come back into the app.
          purchase_url: null,
        },
      ],
    };

    setRecognitionPhase({ type: 'success', response: mockResponse });

    // Save top match to history (mirrors real recognition flow)
    const topMatch = mockResponse.matches[0];
    await saveRecognition({
      id: topMatch.piece_id,
      title: topMatch.title,
      composer: topMatch.composer,
      savedAt: new Date().toISOString(),
      genre: resultGenreLabel(topMatch),
    });

    // Recognition still records the legacy activity counter, but the streak the
    // user sees is the engine's (practice history) — see reinforcementStore.ts.
    await recordPractice();
    setStreak(await getDisplayStreakLocal());

    // Refresh weekly goal
    const wg = await getWeeklyGoal();
    setWeeklyGoal(wg);

    // Check for badges
    const totalRecognitions = await getRecognitionCount();
    const newBadges = await checkAndAwardBadges({
      totalRecognitions,
      currentHour: new Date().getHours(),
    });
    if (newBadges.length > 0) {
      setBadgeToast(newBadges[0]);
    }
  }, []);

  // ── The one-tap pipeline ──
  // The hero state machine and every string it renders live in
  // src/services/frontDoor.ts (pure, tier1-tested); the screen only mirrors it.
  const hero = heroState({
    recording: recorder.isRecording,
    humFallback,
    busy: heroBusy,
  });

  // ── The v44 first-time coach mark (spec §7, still 04) ──
  // ONE TIME per install: the key is READ before it shows and WRITTEN the moment
  // it shows, so a dismissed tip can never come back (spec §7 "never re-show
  // after a dismiss"). It fires once, on the FIRST Home render after install, and
  // is dismissed by the first tap anywhere (the screen's onTouchStart + the hum
  // panel's own press) or by the 8 s timeout. Nothing here scrims the page: a dim
  // layer would darken the Listen panel and break the equality.
  const [splitTipVisible, setSplitTipVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(SPLIT_TIP.key);
        if (cancelled || !splitShouldShowTip(stored)) return;
        // Reduced motion: the bubble still shows — the pulse does not run.
        const reduced = await AccessibilityInfo.isReduceMotionEnabled().catch(
          () => false,
        );
        if (cancelled) return;
        setReduceMotion(reduced);
        setSplitTipVisible(true);
        await AsyncStorage.setItem(SPLIT_TIP.key, SPLIT_TIP.shownValue);
        AccessibilityInfo.announceForAccessibility(HOME_SPLIT_HUM_TIP);
      } catch {
        // A failed read/write only costs the tip; the door itself never breaks.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissSplitTip = useCallback(() => setSplitTipVisible(false), []);

  // The 8 s dismissal (spec §7). A visible tip always has this timer armed.
  useEffect(() => {
    if (!splitTipVisible) return;
    const timer = setTimeout(() => setSplitTipVisible(false), SPLIT_TIP.timeoutMs);
    return () => clearTimeout(timer);
  }, [splitTipVisible]);

  /** Everything a successful LIBRARY match does after the card is shown: save it,
   *  count the practice day, refresh the streak/week/badges. */
  const afterLibraryMatch = useCallback(async (topMatch: RecognitionMatch) => {
    await saveRecognition({
      id: topMatch.piece_id,
      title: topMatch.title,
      composer: topMatch.composer,
      savedAt: new Date().toISOString(),
      genre: resultGenreLabel(topMatch),
    });

    // Record the practice day (legacy counter) and re-read the engine streak
    await recordPractice();
    setStreak(await getDisplayStreakLocal());

    // Refresh weekly goal
    const wg = await getWeeklyGoal();
    setWeeklyGoal(wg);

    // Check for badges
    const totalRecognitions = await getRecognitionCount();
    setFreeRecognitions(totalRecognitions);
    const newBadges = await checkAndAwardBadges({
      totalRecognitions,
      currentHour: new Date().getHours(),
    });
    if (newBadges.length > 0) {
      setBadgeToast(newBadges[0]);
    }
  }, []);

  /**
   * PASS 1 + PASS 2 of the ONE TAP (front-door spec 09-24): our library landmark
   * match first, then the AudD modern pass on the SAME clip when the library has
   * nothing — the user never chooses a mode. A modern hit opens the EXISTING
   * interstitial (no auto-redirect); when both miss, the honest no-match card
   * goes up and the SAME button becomes the hum fallback.
   */
  const runAmbientPipeline = useCallback(
    async (uri: string, diagnostics?: CaptureDiagnostics) => {
      requestInFlightRef.current = true;
      setHeroBusy(true);
      setRecognitionPhase({ type: 'loading' });
      setShowRecognitionResults(true);
      try {
        const result = await recognizeAudio(uri, diagnostics);

        if (result.matches && result.matches.length > 0) {
          recorder.completeRecording();
          setRecognitionPhase({
            type: 'success',
            response: result,
            diagnostics,
          });
          await afterLibraryMatch(result.matches[0]);
          return;
        }

        // ── PASS 2: modern-song recognition (AudD, 100M+ fingerprints) ──
        // Deliberately wrapped in its own try: a modern-pass failure must never
        // hide the honest library no-match behind an error card. The user still
        // gets the no-match answer and the hum fallback (never a silent miss).
        let modern: ModernOutcome | null = null;
        try {
          const modernResponse = await recognizeModernSong(uri, diagnostics);
          // THE PD CROSS-CHECK (owner 09-25, build #3): when the recording the
          // provider identified is a RECORDING OF a public-domain work our own
          // library holds (Lang Lang's Für Elise), the free score is what the
          // user came for. The backend reaches that verdict by matching the
          // match's title + composer surname against the PD catalog and only
          // sends it when the mapping is confident; an ambiguous mapping is
          // absent and the modern card stays (honest-no-match rule).
          const pd = pdMatchFromModernResponse(modernResponse);
          if (pd) {
            await saveRecognition({
              id: pd.id,
              title: pd.title,
              composer: pd.composer,
              savedAt: new Date().toISOString(),
              // A public-domain work is never saved as a modern song: the
              // category is a fact about OUR library.
              genre: pd.genre ?? PUBLIC_DOMAIN_GENRE,
            });
            recorder.completeRecording();
            setShowRecognitionResults(true);
            setNoMatchOffer(null);
            setRecognitionPhase({
              type: 'success',
              response: pdLibraryResultResponse(pd),
              diagnostics,
            });
            return;
          }
          modern = modernOutcome(modernResponse);
        } catch {
          modern = null;
        }

        if (modern && modern.recognized && modern.match) {
          const m = modern.match;
          // Save-to-history FIRST (the retention lever the owner requires around
          // the affiliate moment), then the interstitial — an explicit tap, no
          // auto-redirect.
          //
          // TYPED AT THE SEAM (v36 fix 5 / backlog #33 — TYPE-ONLY, zero runtime
          // change): the record is declared as the SavedPiece the storage seam
          // takes, so the two honest contracts below are checked by the compiler
          // rather than in review — `modernGenreLabel` still yields the provider's
          // REAL genre or absent (never an invented category) and
          // `modernPurchaseUrls` still yields the backend's licensed links or null.
          await saveRecognition({
            id: m.isrc || m.song,
            title: m.song,
            composer: m.artist,
            savedAt: new Date().toISOString(),
            // Save the category WITH the record: a modern song must never reach
            // History genre-less and be filled in by a fallback later. The
            // provider's REAL genre when it sent one (owner request 09-25).
            genre: modernGenreLabel(m) ?? undefined,
            // Save the LICENSED LINKS the match arrived with (owner 10-01): the
            // saved row used to carry identity only, so tapping it in History
            // reached nothing and the sheet-music card was a dead end. This is
            // `null` when the backend supplied no URL — never an invented one,
            // and never used for a public-domain piece (those saves are above).
            purchaseUrls: modernPurchaseUrls(m),
          } satisfies SavedPiece);
          recorder.completeRecording();
          setShowRecognitionResults(false);
          setRecognitionPhase(null);
          setNoMatchOffer(null);
          setModernSurface({
            loading: false,
            error: null,
            match: m,
            recognized: true,
          });
          setShowModernInterstitial(true);
          return;
        }

        // Honest no-match. When the server declined to name a piece (ambiguous /
        // too weak) its own reason is surfaced instead of a generic message —
        // the launch rule is "no confident-wrong" — and the CARD offers the hum
        // way in as a labelled SECONDARY affordance (owner 09-25). The door is
        // NOT armed into hum mode here: the big red button stays identify-first,
        // so a failed listen never silently changes what the primary CTA does.
        recorder.completeRecording();
        setRecognitionPhase({
          type: 'no-match',
          message: result.no_confident_match_reason,
          server: result.received_audio,
          diagnostics,
        });
        setNoMatchOffer('hum');
      } catch (err) {
        recorder.completeRecording();
        const errPhase = isRecognitionLimitError(err)
          ? ({ type: 'limit', message: err.message } as const)
          : ({
              type: 'error',
              message:
                err instanceof Error ? err.message : 'Something went wrong.',
            } as const);
        setRecognitionPhase({ ...errPhase, diagnostics });
      } finally {
        requestInFlightRef.current = false;
        setHeroBusy(false);
      }
    },
    [recorder, afterLibraryMatch],
  );

  /**
   * The inline hum fallback's pass — the SAME button, the SAME recorder, posting
   * the clip to /api/hum. A match reuses the EXISTING result card
   * (humMatchToResultResponse: public domain, no retail redirect, honest
   * coming-soon score state); a miss offers the hum → modern bridge, so a hum we
   * don't hold is never a dead end.
   */
  const runHumPass = useCallback(
    async (uri: string, diagnostics?: CaptureDiagnostics) => {
      requestInFlightRef.current = true;
      setHeroBusy(true);
      setRecognitionPhase({ type: 'loading' });
      setShowRecognitionResults(true);
      try {
        const resp = await humToSearch(uri, diagnostics);
        const outcome = humOutcome(resp);
        if (outcome.ok && outcome.topMatch) {
          // Recognition of a hum counts as a practice day, exactly as the hum
          // screen does; the category is a fact (our own public-domain library).
          await saveRecognition({
            id: outcome.topMatch.piece_id,
            title: outcome.topMatch.title,
            composer: outcome.topMatch.composer,
            savedAt: new Date().toISOString(),
            genre: PUBLIC_DOMAIN_GENRE,
          });
          recorder.completeRecording();
          setHumFallback(false);
          setNoMatchOffer(null);
          // THE HOSTED SCORE, best effort (bundle A): a HumMatch carries identity
          // only, so the door looks the piece up in OUR catalog to get the score
          // the shared result surface renders INLINE — exactly as the hum screen
          // does. A miss (offline, unknown id, no curated score) is not an error:
          // the surface then says honestly that it holds no score for this one.
          // Nothing is ever invented here.
          let sheet: HumResolvedSheet | null = null;
          const info = await fetchPieceById(outcome.topMatch.piece_id);
          if (info) {
            sheet = {
              sheetMusicUrl: info.sheetMusicUrl,
              // The catalog's own gate. `?? undefined` keeps a MISSING flag
              // missing (the surface withholds the score only on an explicit
              // false — never because we dropped the value on the way through).
              sheetMusicAvailable: info.sheetMusicAvailable ?? undefined,
              isPublicDomain: info.isPublicDomain ?? undefined,
            };
          }
          setRecognitionPhase({
            type: 'success',
            response: humMatchToResultResponse(resp, outcome.matches, sheet),
          });
          return;
        }
        recorder.completeRecording();
        // Honest banded no-match copy (never a raw percentage, never a fabricated
        // title), plus the short-phrase hint when the server extracted too little.
        const hint = humPhraseHint(resp);
        const reason = humNoMatchMessage(outcome);
        setRecognitionPhase({
          type: 'no-match',
          message: hint ? `${reason}\n\n${hint}` : reason,
          // The hum pass's own capture numbers, so the no-match card can say
          // whether the microphone heard enough (V26, owner 09-25).
          diagnostics,
        });
        setNoMatchOffer('modern');
      } catch (err) {
        recorder.completeRecording();
        const errPhase = isRecognitionLimitError(err)
          ? ({ type: 'limit', message: err.message } as const)
          : ({
              type: 'error',
              message:
                err instanceof Error ? err.message : 'Something went wrong.',
            } as const);
        setRecognitionPhase(errPhase);
      } finally {
        requestInFlightRef.current = false;
        setHeroBusy(false);
      }
    },
    [recorder],
  );

  /**
   * Start a capture for one of the door's two passes. A failed start is NEVER
   * silent (tracked debt f9f8e4f3, the PR #115 rule): the old HomeScreen did
   * `if (!started) return;`, which set no state at all, so nothing rendered and
   * every retry tap was eaten. It now lands on the existing error card.
   */
  const startCapture = useCallback(
    async (mode: 'ambient' | 'hum') => {
      if (mode === 'hum') setHumFallback(true);
      captureModeRef.current = mode;
      recorder.clearError();
      setHeroBusy(true);
      const started = await recorder.startRecording();
      setHeroBusy(false);
      if (!started) {
        const failure = frontDoorStartFailure(recorder.takeStartFailure());
        // Permission problems keep the hook's inline error (and its Open
        // Settings affordance); everything else is surfaced once, here.
        if (!failure.keepHookError) recorder.clearError();
        setRecognitionPhase({ type: 'error', message: failure.message });
        setShowRecognitionResults(true);
        return;
      }
      timeoutRef.current = setTimeout(() => {
        void handleStopCapture();
      }, RECORDING_TIMEOUT_MS);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [recorder],
  );

  const handleStopCapture = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      // Clear the auto-stop timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const stopped = await recorder.stopRecording();
      if (!stopped) {
        const failure = recorder.takeStopFailure();
        const reason = failure ? failure.reason : 'no-recording';
        recorder.clearError();
        if (reason === 'empty') {
          // No clip at all. This used to arm the hum fallback and return with NO
          // surface at all — the door silently became "Tap to hum it" and the
          // user could not tell the microphone had recorded nothing (the v25
          // dead end). V26 (owner 09-25): show the honest tiny-capture card
          // ("We couldn't hear enough — try again closer to the music") with its
          // Retry, keep the hum way in as the card's SECONDARY affordance, and
          // leave the big button identify-first.
          setNoMatchOffer('hum');
          setRecognitionPhase({
            type: 'no-match',
            diagnostics: NO_AUDIO_DIAGNOSTICS,
          });
          setShowRecognitionResults(true);
          return;
        }
        // NEVER silently drop the user back to idle: every other stop failure
        // surfaces its own honest words.
        setRecognitionPhase({ type: 'error', message: STOP_FAILURE_COPY[reason] });
        setShowRecognitionResults(true);
        return;
      }
      const { uri, diagnostics } = stopped;
      if (captureModeRef.current === 'hum') {
        await runHumPass(uri, diagnostics);
        return;
      }
      await runAmbientPipeline(uri, diagnostics);
    } finally {
      stoppingRef.current = false;
    }
  }, [recorder, runAmbientPipeline, runHumPass]);

  /**
   * THE one hero tap. A live capture always stops on a tap (tap-to-stop, as
   * everywhere else); a pass in flight swallows the tap rather than stacking a
   * second capture; otherwise it starts the pass the door is in.
   */
  const handleHeroTap = useCallback(async () => {
    const action = heroTapAction({
      recording: recorder.isRecording,
      humFallback,
      busy: heroBusy,
    });
    if (action === 'wait') return;
    if (action === 'stop') {
      await handleStopCapture();
      return;
    }
    await startCapture(action === 'start-hum' ? 'hum' : 'ambient');
  }, [
    recorder.isRecording,
    humFallback,
    heroBusy,
    startCapture,
    handleStopCapture,
  ]);

  // ── Cleanup timers on unmount ──
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // ── Close recognition results ──
  const handleCloseRecognition = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    setNoMatchOffer(null);
    recorder.clearError();
  }, [recorder]);

  // ── Retry recognition ──
  // "Try Again" repeats the pass that produced the card — an ambient retry after
  // an ambient miss, a hum retry after a hum miss — so it never silently switches
  // the user's mode. The auto-start is tracked in a ref (a bare 300ms timer raced
  // the recorder and orphaned it — the pass-2 defect class).
  const handleRetryRecognition = useCallback(() => {
    const mode = captureModeRef.current;
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    setNoMatchOffer(null);
    recorder.resetForRetry();
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void startCapture(mode);
    }, RETRY_DELAY_MS);
  }, [recorder, startCapture]);

  // ── Upgrade to Pro (from the quota-exhausted modal) ──
  // Close the modal and open the Settings tab, where the transparent upgrade
  // flow (Stripe checkout + entitlement polling) already lives.
  const handleUpgradePro = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    setNoMatchOffer(null);
    navigation.navigate('Settings');
  }, [navigation]);

  // ── The no-match card's two ways forward (front-door spec 09-24) ──
  // 1. The inline hum fallback: close the card and leave the door in hum mode —
  //    the SAME button, no second flow to choose between.
  const handleHumFallbackFromCard = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    setNoMatchOffer(null);
    setHumFallback(true);
  }, []);

  // 2. The hum → modern bridge (owner-approved 09-22): our melody catalog is
  //    small, so a hum we don't hold must not be a dead end. This opens the
  //    existing "Find any song" screen, which identifies the actual recording
  //    (AudD) and links the official sheet music.
  const handleFindAnySongFromCard = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    setNoMatchOffer(null);
    setShowModernSearch(true);
  }, []);

  // ── The featured-piece view's OWN hardware-BACK gate (owner-specified, build
  // #3 — RC v26: BACK here exited the app) ──
  // The featured piece is rendered IN PLACE: this screen returns it in place of
  // its whole body, so the route never changes and only a hardware-back handler
  // can consume the press. Owner's behaviour, verbatim: BACK on the featured view
  // returns to the TOP OF THE HOME HERO ("Tap to identify"), and BACK on the HERO
  // itself exits the app.
  //
  // Two things make that true:
  //   • the handler unwinds ONE level — the score overlay when it is up (the
  //     hero's own "Practice today" path opens it directly), otherwise the
  //     featured piece — so a press never drops the user two screens back; and
  //   • the hook is GATED on the featured view being open. An always-on handler
  //     would swallow BACK at the hero too, and the user could never leave Home.
  //     (The hero body remounts when the featured view closes, i.e. it comes back
  //     scrolled to the top — the "top of the hero" the owner asked for.)
  // src/services/backExitContract.ts asserts both halves from this source.
  const featuredViewOpen =
    (showDetail && dailyChallenge !== null) || showScoreViewer;

  const handleFeaturedViewBack = useCallback(() => {
    if (showScoreViewer) {
      setShowScoreViewer(false);
      return true;
    }
    setShowDetail(false);
    return true;
  }, [showScoreViewer]);

  useHardwareBack(handleFeaturedViewBack, featuredViewOpen);

  // ── The hum way in, from HOME (owner 09-25; RC v26 Test 6 FAIL: "no 'Hum the
  // melody' CTA on the home screen — hum reachable only post-recognition") ──
  // A musician who cannot play the audio at all (or hums to look a tune up) needs
  // the hum/whistle/sing way in to be VISIBLE on the surface they land on. It is a
  // LABELLED SECONDARY path under the one hero button — never a rival mode CTA
  // (the big button stays identify-first; HUM_SECONDARY_CTA says in words that
  // this is the alternative) — and it opens the EXISTING hum flow
  // (HumSearchScreen: its own recorder, its own BACK exit, the same matcher), so
  // there is no second hum implementation to drift.
  const handleHumEntry = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    setNoMatchOffer(null);
    setShowHumSearch(true);
  }, []);

  // ── "Find a piece" (the secondary SEARCH entry under the one button): catalog
  // search by title/composer — no microphone involved, so it also works for a
  // learner who just knows the name of the piece and hasn't got the music
  // playing (or can't hum it). ──
  const handleOpenFindPiece = useCallback(() => {
    setShowFindPiece(true);
  }, []);

  // ── Medals entry + achievement card (owner-approved 08-25) ──
  /** Open the medals screen (quiet entry card, below the front door). */
  const handleOpenAchievements = useCallback(() => {
    setShowAchievements(true);
    // Settle anything earned since the last check so the screen is current.
    void refreshMedals();
  }, [refreshMedals]);
  /** Open the achievement card for the medal that just unlocked. */
  const openMedalShare = useCallback(() => {
    if (!medalCard) return;
    setShowMedalCard(true);
  }, [medalCard]);
  /** One dismissal authority for the card's BACK press and its close button. */
  const closeMedalShare = useCallback(() => {
    setShowMedalCard(false);
  }, []);

  // ── "⏱️ Practice today" tap (owner-reported dead card, v19 bug) ──
  // The card is a way INTO practice, so it opens today's featured piece: the
  // in-app sheet reader when the catalog has a curated score for it, otherwise
  // the piece page (where the practice coach lives). When the featured piece
  // never loaded it opens Find-a-Piece, so the tap always has a real destination.
  //
  // It deliberately does NOT call recordPractice(): a navigation tap is not a
  // practice session. The piece page records the run when the score is actually
  // opened (PieceDetailScreen), which keeps streaks and minutes honest.
  const handlePracticeTodayTap = useCallback(() => {
    switch (practiceTodayDestination(dailyChallenge)) {
      case 'find-piece':
        setShowFindPiece(true);
        return;
      case 'sheet':
        setShowScoreViewer(true);
        return;
      default:
        setShowDetail(true);
    }
  }, [dailyChallenge]);

  // ── The streak card's OWN tap is RETIRED (re-flow bundle D, owner 10-02) ──
  // It meant two different things — 0 days → today's piece, N days → the week
  // view (homeCards.streakDestination) — which is exactly the "one card, two
  // meanings" ambiguity the audit flagged. Band B's single card owns the only
  // practice destination on the door, and the streak NUMBERS live on as state
  // chips inside it (retention stays visible without competing). Nothing here
  // replaced the handler: a second destination is what was removed, so there is
  // no dead handler left behind and no second practice target.

  // ── "📋 This Week" tap ──
  // Opens the practice-week surface in place (see PracticeWeekScreen): the days
  // practised this week, minutes per day, and this week's coached takes.
  const handleOpenPracticeWeek = useCallback(() => {
    setShowPracticeWeek(true);
  }, []);

  // From the week view: close it, then run the same destination logic the card
  // uses (featured piece → sheet/piece page, otherwise Find-a-Piece).
  const handlePracticeFromWeek = useCallback(() => {
    setShowPracticeWeek(false);
    handlePracticeTodayTap();
  }, [handlePracticeTodayTap]);

  const handleFindPieceFromWeek = useCallback(() => {
    setShowPracticeWeek(false);
    setShowFindPiece(true);
  }, []);

  // ── The modern surfaces (the pipeline's pass 2, and the hum bridge) ──
  // From the modern interstitial (or the modern screen): jump to the hum flow,
  // which finds a FREE public-domain piece. One flow is mounted at a time.
  const handleHumItFromModern = useCallback(() => {
    setShowModernSearch(false);
    setShowModernInterstitial(false);
    setModernSurface(IDLE_SURFACE);
    setShowHumSearch(true);
  }, []);

  // The reverse bridge (owner-approved 09-22): a hum that misses our melody
  // catalog hands the user to the modern "Find any song" flow, which identifies
  // the actual recording (AudD) and links the official sheet music. Same
  // full-screen swap pattern as handleHumItFromModern — exactly one flow is
  // mounted at a time, and the modern screen's own onClose is the BACK path
  // back to Home.
  const handleSwitchToModernFromHum = useCallback(() => {
    setShowHumSearch(false);
    setShowModernSearch(true);
  }, []);

  // From the modern interstitial: open the free public-domain Library.
  const handleBrowseLibraryFromModern = useCallback(() => {
    setShowModernSearch(false);
    setShowModernInterstitial(false);
    setModernSurface(IDLE_SURFACE);
    navigation.navigate('Library');
  }, [navigation]);

  // From the modern interstitial: the find-a-song SEARCH for a match the backend
  // could NOT link to a licensed retailer (§E.2 row 2, bundle E). It reuses the
  // EXISTING `showFindPiece` flag and the EXISTING `FindPieceScreen` mount — one
  // search surface, never a second one. Two of the three lines are load-bearing:
  // the plain `showModernSearch`/`showModernInterstitial` flags are what decide
  // which screen Home returns (the modern screen is checked BEFORE the search
  // one, so leaving either true would swallow the search), and the interstitial
  // is a Modal, so it must come down before the search is swapped in.
  const handleSearchForItFromModern = useCallback(() => {
    setShowModernSearch(false);
    setShowModernInterstitial(false);
    setModernSurface(IDLE_SURFACE);
    setShowFindPiece(true);
  }, []);
  // Close the modern interstitial (its "Done"/✕/BACK all land here).
  const handleCloseModernInterstitial = useCallback(() => {
    setShowModernInterstitial(false);
    setModernSurface(IDLE_SURFACE);
  }, []);

  // "Try Again" on the modern interstitial: the door runs a fresh ambient pass
  // (one tap on the big button does the same thing — this only shortens it).
  const handleRetryModernInterstitial = useCallback(() => {
    handleCloseModernInterstitial();
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void startCapture('ambient');
    }, RETRY_DELAY_MS);
  }, [handleCloseModernInterstitial, startCapture]);

  // ── BAND B's ONE card: "Today's piece — practice it" (re-flow bundle D) ──
  // Two old cards are merged into this single tap, and BOTH of their bodies are
  // preserved here:
  //   • the featured-piece card's practice framing — record the practice day,
  //     refresh the streak + weekly goal, award anything newly earned (this is
  //     the streak the chips show, and it is the ONLY way the door starts a
  //     streak day);
  //   • "⏱️ Practice today"'s SINGLE destination decision — the sheet reader when
  //     the catalog holds a curated score, else the piece page (where the coach
  //     lives), else Find-a-Piece. It runs through `handlePracticeTodayTap`, so
  //     there is ONE destination function for today's piece on the door.
  // A removed card left no handler dead: the old pages this replaced are gone,
  // and the two that survive (this and the week chip) both have a real tap.
  const handleDailyChallengeTap = useCallback(async () => {
    await recordPractice();
    setStreak(await getDisplayStreakLocal());

    const wg = await getWeeklyGoal();
    setWeeklyGoal(wg);

    // Check for streak-related badges
    const newBadges = await checkAndAwardBadges({
      totalRecognitions: undefined,
    });
    if (newBadges.length > 0) {
      setBadgeToast(newBadges[0]);
    }

    handlePracticeTodayTap();
  }, [handlePracticeTodayTap]);

  // ── BAND A/Discover: the "Find a song" SEARCH BAR (bundle B → v45) ──
  // The full-width SEARCH BAR (v45: 56 dp, radius 16, "Find a song") in the
  // Discover band, so a musician who can neither play the audio nor hum it is one
  // tap from typing a title. It reuses the EXISTING `showFindPiece` flag and the existing
  // `FindPieceScreen` mount — no second search surface, no new box — and it is
  // deliberately NOT the hero handler (the one big button stays the only primary
  // CTA; frontDoor.findASongBarWired() asserts both halves).
  const handleFindAnySong = useCallback(() => {
    setShowFindPiece(true);
  }, []);

  // ── Permission denied state ──
  if (recorder.error && !recorder.isRecording) {
    // Only show a full error screen if the user can't proceed
  }

  // ── Build personalised recommendation text ──
  // RETIRED with the "🎯 For You" card (re-flow bundle D, owner 10-02): the card
  // promised picks the app cannot compute ("Piano picks for beginners") and its
  // tap opened a generic search. The personalised line, its byline and its
  // accessibility label are gone from the door AND from homeCards.ts — a breadcrumb
  // of that promise left behind is exactly what bundle E's scan hunts for.

  // The Home subtitle is the genre-neutral product promise (owner 09-24): it
  // used to render "Curated Classical" for anyone who skipped genre selection in
  // onboarding (the picker defaulted to ['classical']), which told a guitar or
  // pop learner the app was not for them. frontDoor.homePromiseCopy() makes it
  // instrument-aware too — guitar users get the live TAB promise.
  // (Rendered inline below from that helper — one source of truth.)

  // The one button, mirrored from the front door's state machine. (v44: the
  // button is the LISTEN panel of the equal split — its face is the brand
  // emblem, so the 🎤/🎙️ emoji is retired with the round disc.)

  /** The week is complete when the user hit the goal they set. */
  const weekComplete = weeklyGoal.current >= weeklyGoal.target;

  // The door's retention STATE, resolved ONCE: the streak/week chips inside band
  // B's card and the chips in band C both come from this single call, so the two
  // bands can never show different numbers. Each is a state chip (no
  // destination) except the two that really open a surface.
  const retention = retentionChips({
    currentDays: streak.currentDays,
    weekCurrent: weeklyGoal.current,
    weekTarget: weeklyGoal.target,
    weekComplete,
  });
  const todayCardChips = retention.filter((chip) => chip.where === 'today-card');
  const browseChips = retention.filter((chip) => chip.where === 'browse');

  // Band C's facet chips — ONLY the ones whose content exists today. Guitar &
  // keyboard is absent (frontDoorBands.guitarContentAvailable is false until a
  // screen surfaces the audited PD guitar batch), and an absent facet is the
  // honest answer: no "coming soon" chip, ever.
  const facets = bandFacets(FRONT_DOOR_FACET_FLAGS);

  // Positive framing only (owner rule, 2026-09-17): the streak line celebrates
  // what the streak is, it never threatens the user with losing it. The card
  // used to render `streakLine(streak)` here; with the standing streak card
  // merged into band B that nudge lives on in StreakNudgeCard below, which calls
  // the same reinforcement view layer.

  // Full-screen Tier-1 flows (owned recorders; rendered in place like the rest
  // of the app's full-screen readers).
  if (showHumSearch) {
    return (
      <HumSearchScreen
        onClose={() => setShowHumSearch(false)}
        onSwitchToModern={handleSwitchToModernFromHum}
      />
    );
  }
  if (showModernSearch) {
    return (
      <ModernSearchScreen
        onClose={() => setShowModernSearch(false)}
        onHumIt={handleHumItFromModern}
        onBrowseLibrary={handleBrowseLibraryFromModern}
        onSearchForIt={handleSearchForItFromModern}
      />
    );
  }
  // Catalog search by name — its own full-screen flow, no recorder.
  if (showFindPiece) {
    return <FindPieceScreen onClose={() => setShowFindPiece(false)} />;
  }

  // "📋 This Week" — the practice-week surface, rendered in place. Home owns the
  // practice destinations, so it passes them in (the week view has no recorder or
  // navigation of its own).
  if (showPracticeWeek) {
    return (
      <PracticeWeekScreen
        onClose={() => setShowPracticeWeek(false)}
        featuredTitle={dailyChallenge?.title ?? null}
        onPracticeToday={handlePracticeFromWeek}
        onFindPiece={handleFindPieceFromWeek}
      />
    );
  }

  // 🏅 Medals — the achievements surface, rendered in place like the flows above.
  // It owns its own Android BACK handling (useHardwareBack) and reads the medal
  // rules from src/services/medals.ts, so Home only supplies the exit.
  if (showAchievements) {
    return <AchievementsScreen onClose={() => setShowAchievements(false)} />;
  }

  // NOTE (owner-reported blank Home page, v22 → v24): the sheet-music viewer used
  // to be a body-replacement early return HERE (the whole Home body was replaced
  // by the viewer). That is the empty-body path: the viewer is a Modal whose
  // Android dialog can be dismissed natively (e.g. by the platform's back
  // handling) while `showScoreViewer` stays true, and a flag left true with no
  // dialog on screen rendered Home with NOTHING in it — the blank white body the
  // owner saw, with the tab bar still alive. The viewer is now an OVERLAY inside
  // this always-mounted body (see the sheet-music block in the JSX below), so no
  // state of the viewer can ever blank Home. Guarded by
  // src/services/backExitContract.ts (the blank-return contract).

  if (showDetail && dailyChallenge) {
    return (
      <PieceDetailScreen
        piece={dailyChallenge}
        onBack={() => setShowDetail(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Achievement/medal toast — ONE banner slot: a fresh medal wins it, and
          its Share action opens the achievement card. It is a banner, never a
          modal: an unlock cannot interrupt play. */}
      <BadgeToast
        badge={medalToast ?? badgeToast ?? { id: '', name: '', description: '', emoji: '' }}
        visible={medalToast !== null || badgeToast !== null}
        label={medalToast ? MEDAL_UNLOCK_LABEL : undefined}
        onAction={medalToast ? openMedalShare : undefined}
        actionLabel={MEDAL_TOAST_SHARE_LABEL}
        onDismiss={() => {
          setMedalToast(null);
          setBadgeToast(null);
        }}
      />

      {/* Modern-song match from the one-tap pipeline → the EXISTING interstitial.
          Owner rule (08-24) preserved: identity + metadata, an explicit
          "Get the Official Sheet Music" tap into our own in-app shell (SMD
          primary, ID 67650), the "Try Musicnotes" secondary CTA, and the
          retention levers — never an auto-redirect. */}
      <ModernSongInterstitial
        visible={showModernInterstitial}
        loading={modernSurface.loading}
        error={modernSurface.error}
        match={modernSurface.match}
        recognized={modernSurface.recognized}
        onClose={handleCloseModernInterstitial}
        onRetry={handleRetryModernInterstitial}
        onHumIt={handleHumItFromModern}
        onBrowseLibrary={handleBrowseLibraryFromModern}
        onSearchForIt={handleSearchForItFromModern}
      />

      {/* Recognition results modal. The no-match card carries the next step for
          whichever pass missed: the inline hum fallback (ambient miss) or the
          hum → modern bridge (hum miss). A MODERN match rendered here carries the
          same two retention levers as the interstitial (§E.2: a declined or
          missing retailer link is never a dead end) — the SAME handlers. */}
      <RecognitionResultView
        visible={showRecognitionResults}
        phase={recognitionPhase}
        onClose={handleCloseRecognition}
        onRetry={handleRetryRecognition}
        onUpgrade={handleUpgradePro}
        onHumFallback={noMatchOffer === 'hum' ? handleHumFallbackFromCard : undefined}
        onFindAnySong={noMatchOffer === 'modern' ? handleFindAnySongFromCard : undefined}
        onHumIt={handleHumItFromModern}
        onBrowseLibrary={handleBrowseLibraryFromModern}
      />

      {/* Full-screen sheet-music viewer — the same path the recognition result
          flow uses for pieces that have a curated sheet.

          It is an OVERLAY, never a body replacement (owner-reported blank Home
          page, v22 → v24): this body stays mounted underneath whatever the viewer
          does, so even a viewer flag left true by a natively dismissed dialog
          cannot leave Home blank. Guarded by src/services/backExitContract.ts. */}
      {showScoreViewer && dailyChallenge?.sheetMusicUrl && (
        <ScoreViewer
          url={dailyChallenge.sheetMusicUrl}
          title={dailyChallenge.title}
          composer={dailyChallenge.composer}
          onClose={() => setShowScoreViewer(false)}
        />
      )}

      {/* The ACHIEVEMENT CARD for a freshly earned medal — the EXISTING ShareCard
          component with its medal block (never a second card). It opens only from
          the toast's Share action, and it is an OVERLAY inside this
          always-mounted body: one dismissal authority (closeMedalShare) serves
          both the card's close button and the Android BACK press, so no state of
          the card can leave Home blank. */}
      <ShareCard
        visible={showMedalCard && medalCard !== null}
        medal={
          medalCard
            ? {
                emoji: medalCard.medal.emoji,
                name: medalCard.medal.name,
                progressLabel: medalCard.progressLabel,
              }
            : undefined
        }
        title={medalCard ? medalCardTitle(medalCard.medal, medalCard.context) : ''}
        composer={medalCard ? medalCardSubtitle(medalCard.medal, medalCard.context) : ''}
        headline={medalCard ? medalHeadline(medalCard.medal) : undefined}
        shareMessage={
          medalCard ? medalShareText(medalCard.medal, medalCard.context) : undefined
        }
        streak={streak.currentDays}
        practiceMinutes={practiceMinutes}
        onClose={closeMedalShare}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
          />
        }
      >
        {/* ── Header ── */}
        <Text style={styles.headerEmoji}>🎵</Text>
        <Text style={styles.title}>NoteSnap</Text>
        {/* Genre-neutral product promise, instrument-aware (owner 09-24). */}
        <Text style={styles.subtitle}>
          {homePromiseCopy(onboarding?.instrument)}
        </Text>

        {/* ══ BAND A — RECOGNISE MUSIC ══ (v44 EQUAL SPLIT, owner-approved 10-22)

            The user-test failure this replaces: the navy `#16213e` hum card with
            a teal outline read as INFORMATION, not as a BUTTON. The fix is
            structural, not verbal — TWO PEER PANELS of identical shape, size,
            fill weight and affordance (180 × 320 dp, radius 24, gap 12), so hum
            can never read as a sub-paragraph of Listen:

              · LISTEN (rose #F4586F → #C92A46) — the money-path door, still left,
                still the brand emblem; one tap runs the whole hybrid pipeline
                (our library landmark match, then the AudD modern pass), and when
                the ambient pass hears nothing the SAME door carries the inline
                hum fallback (frontDoor.heroState);
              · HUM & SING (electric indigo #7A45FF → #3B1AA8) — the melody door:
                handleHumEntry → HumSearchScreen, whose capture window starts
                recording on mount. No second hum implementation.

            Both panels are ONE component with a `variant` prop (two hand-copied
            styles drift, and drift is the failure the split removes). Every hex,
            dp, press delta and copy string lives in src/services/heroSplit.ts
            and frontDoor.ts; the tier-1 gate scans THIS source for the wiring.
            Spec: /home/team/shared/hum-button-concept/ENGINEER-NOTES.md. */}
        <View
          style={styles.band}
          testID={BAND_TEST_IDS.identify}
          onTouchStart={splitTipVisible ? dismissSplitTip : undefined}
        >
          {/* The section label above the pair (spec §1). */}
          <Text style={styles.splitSectionLabel}>{HOME_SPLIT_SECTION_LABEL}</Text>

          <View style={styles.heroPairWrap}>
            {/* The ONE-TIME first-run bubble (spec §7): above the pair, right-
                aligned over the hum panel, never a scrim, never over Listen. */}
            {splitTipVisible && <HumSplitCoachMark />}
            <View style={styles.heroPairRow}>
              <HeroSplitPanel
                variant="listen"
                style={styles.recognitionBtn}
                testID={SPLIT_TEST_IDS.listen}
                puckState={splitPuckState('listen', hero)}
                title={HOME_SPLIT_LISTEN_TITLE}
                body={splitPanelBody('listen', hero)}
                accessibilityLabel={
                  hero === 'idle'
                    ? HOME_SPLIT_LISTEN_A11Y
                    : heroAccessibilityLabel(hero)
                }
                onPress={handleHeroTap}
              />
              <HeroSplitPanel
                variant="hum"
                style={styles.humEntryBtn}
                testID={SPLIT_TEST_IDS.hum}
                puckState={splitPuckState('hum', hero)}
                title={HOME_SPLIT_HUM_TITLE}
                body={splitPanelBody('hum', hero)}
                accessibilityLabel={HOME_SPLIT_HUM_A11Y}
                onPress={handleHumEntry}
                tipRings={splitTipVisible && !reduceMotion}
              />
            </View>
          </View>

          {/* Mic permission error inline — a real error always reaches a surface */}
          {recorder.error && !recorder.isRecording && (
            <View style={styles.permissionError}>
              <Text style={styles.permissionErrorText}>{recorder.error}</Text>
              <TouchableOpacity
                style={styles.settingsBtn}
                onPress={recorder.openSettings}
              >
                <Text style={styles.settingsBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Recording indicator (the panel puck also carries the listening /
              recording treatment — spec §8 — this dot is the screen-level cue) */}
          {recorder.isRecording && (
            <Animated.View
              style={[
                styles.recordingIndicator,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <View style={styles.recordingDot} />
            </Animated.View>
          )}

          {/* THE ONE STATUS LINE under the pair (v45, designer notes §4 element 5):
              "5 free listens left" — 11.5 dp, centred, and driven by the REAL
              quota (freeRecognitions from getRecognitionCount + the enforced
              monthly cap in frontDoor.FREE_MONTHLY_LIMIT), never a literal.
              Every front-door state keeps words (frontDoor.heroSupport), so the
              screen is never a wordless spinner — but the idle state no longer
              prints the retired 16-word HERO_SUPPORT_IDLE sentence, and the
              BETA NOTE has MOVED off the front door (notes §6: it now renders
              where the limit actually bites — the recognition no-match card in
              components/RecognitionResultView.tsx and Discover's free-library
              row below). 37 words of prose under the hero → 4. */}
          <Text style={styles.splitSupportLine}>
            {heroSupport(hero, { isPro, freeRecognitions })}
          </Text>

          {/* Demo button — dev-only shortcut that skips microphone */}
          {__DEV__ && !recorder.isRecording && (
            <TouchableOpacity
              style={styles.demoBtn}
              onPress={handleDemo}
              activeOpacity={0.6}
            >
              <Text style={styles.demoBtnText}>🧪 Try Demo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* The old full-width HUM SIBLING CARD and its teach line are RETIRED
            here (v44 equal split, owner 10-22): hum is now the right-hand PEER of
            Listen, above this point, so neither the card nor the third row of
            text ("Hear it → Listen · Think it → Hum") has a job any more.
            The wrapper View that carried the retired card is gone WITH it — this
            close tag was its leftover, and it left band A's parent unbalanced
            (`Expected corresponding JSX closing tag for <ScrollView>`), which the
            babel pre-flight caught and the tier-1 tsc run could not, because
            tsconfig.tier1.json never includes the screens. */}

        {/* ══ DISCOVER BAND (v33 §E + §F3b, owner 10-04) ══
            The "Find a song" search bar has its OWN band now, directly under
            the Listen/Hum pair — it was inside band A beside the hum row, which
            the owner's device pass read as "does not fit the flow there". One
            entry, one job: open the real search field (FindPieceScreen), which is
            the app's money path (free scores + the official sheet music). Search
            is therefore reachable WITHOUT entering the hum flow, and the
            Listen/Hum block contains only the two listening doors. */}
        <View style={styles.band} testID={BAND_TEST_IDS.discover}>
          <Text style={styles.bandTitle}>{BAND_TITLES.discover}</Text>
          <Text style={styles.discoverNote}>{DISCOVER_BAND_NOTE}</Text>
          {/* v45 (owner 10-26, designer notes §3 row 3 + §7): the v33 chip is a
              full-width SEARCH BAR — 56 dp tall, radius 16, card fill + a 1 dp
              hairline, a drawn magnifier at the left and a chevron at the right,
              labelled "Find a song". It is the SAME wiring as the chip it
              replaces: handleFindAnySong → setShowFindPiece(true) → the existing
              FindPieceScreen, whose field mounts with autoFocus, so "one tap to
              type" is preserved exactly. It also becomes Discover's own door
              (the mock's "one search bar"), which is why the band's chip row is
              gone. Slice 2 folds band C's duplicate search row into this bar. */}
          <TouchableOpacity
            style={styles.findASongBar}
            onPress={handleFindAnySong}
            activeOpacity={0.6}
            accessibilityRole="search"
            accessibilityLabel={FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL}
          >
            <View style={styles.findASongBarIcon}>
              <View style={styles.findASongBarLens} />
              <View style={styles.findASongBarHandle} />
            </View>
            <Text style={styles.findASongBarLabel}>{FIND_ANY_SONG_CHIP_LABEL}</Text>
            <Text style={styles.findASongBarChevron}>›</Text>
          </TouchableOpacity>
        </View>


        {/* ══ BAND B — TODAY ══ (re-flow bundle D, owner 10-02)
            ONE card, ONE destination every day. It replaces four overlapping
            practice targets — the standing streak card, "⏱️ Practice today",
            "📋 This Week" and "🌟 Today's Featured Piece" — with a single meaning:

              • the streak and week STATE stays visible as small chips INSIDE the
                card (retention is a business priority; it just stops competing);
              • handleDailyChallengeTap keeps the practice framing (record the day,
                refresh the streak + weekly goal, award badges) and lands on
                handlePracticeTodayTap's ONE destination — the sheet reader when the
                catalog holds a curated score, else the piece page (where the coach
                lives), else Find-a-Piece;
              • the streak card's old two-way tap (0 days → practice, ≥1 day → week) is
                GONE with homeCards.streakDestination's door use, so no card here
                means two things.

            With no catalog the card shows the honest line and still lands on the
            search: band B is never empty and never a dead end. */}
        <View style={styles.band} testID={BAND_TEST_IDS.today}>
          <Text style={styles.bandTitle}>{BAND_TITLES.today}</Text>
          {/* ── TODAY'S PIECE, AS ONE CARD (v41 item 4 · designer spec §1) ──
              The band used to be a full-width block of stacked text that read as
              a DIVIDER, not as something you can open (owner 10-18). It is now one
              card — 358 × 92 dp at 16 dp side margins, radius 18, CARD fill and a
              1 dp CARD_LINE border — holding a 56 dp paper score tile, three type
              levels (eyebrow / title / composer) and ONE SUB chevron. The WHOLE
              CARD is the tap target: the chevron is the only affordance mark and is
              not its own hit region, so there is no "open" button to hunt for.
              Geometry and copy are asserted by services/uxrV41Contract
              .todayCardMatchesSpec, and every colour is an existing palette literal
              (dark #16213E on the gradient field, light #FFFFFF + hairline — the
              theme remap does that, no new tokens). */}
          <TouchableOpacity
            style={styles.todayCard}
            onPress={handleDailyChallengeTap}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={todayCardAccessibilityLabel(dailyChallenge)}
          >
            {/* The 56 dp score tile — the same "this is sheet music" idiom as the
                Library and History rows, paper-white in BOTH themes. */}
            <View style={styles.todayCardTile}>
              <View style={styles.todayCardStaffLine} />
              <View style={styles.todayCardStaffLine} />
              <View style={styles.todayCardStaffLine} />
              <View style={styles.todayCardStaffLine} />
              <View style={styles.todayCardStaffLine} />
              <View style={styles.todayCardNote} />
              <View style={[styles.todayCardNote, styles.todayCardNoteTwo]} />
            </View>
            <View style={styles.todayCardText}>
              <Text style={styles.todayCardEyebrow}>{TODAYS_PIECE_EYEBROW}</Text>
              <Text style={styles.todayCardPiece} numberOfLines={1}>
                {dailyChallenge ? dailyChallenge.title : TODAYS_PIECE_NO_PIECE_TITLE}
              </Text>
              <Text style={styles.todayCardComposer} numberOfLines={1}>
                {dailyChallenge
                  ? [dailyChallenge.composer, dailyChallenge.catalog]
                      .filter((part) => !!part && String(part).length > 0)
                      .join(' · ')
                  : TODAYS_PIECE_NO_PIECE_LINE}
              </Text>
            </View>
            <Text style={styles.todayCardChevron}>›</Text>
          </TouchableOpacity>
        </View>
          {/* The streak nudge (slice 2) is part of THIS band (owner 10-04 §F4):
              the practice group is one group, so the card the user is nudged
              toward and the nudge itself sit together — it is no longer floating
              between the listening band and today's card. It stays a BANNER: it
              adds no tap of its own (band B keeps exactly one onPress, its
              today card), it is quiet, dismissible, and never rendered while the
              mic is live or a result is on screen. */}
          <StreakNudgeCard
            surface="home"
            hidden={
              recorder.isRecording ||
              showRecognitionResults ||
              showScoreViewer ||
              showHumSearch ||
              showModernSearch ||
              showFindPiece
            }
          />

        {/* ══ BAND C — BROWSE + KEEP GOING ══ (re-flow bundle D, owner 10-02)
            One meaning per entry: the honest search row (the real field is one tap
            away — audit D9), the facet chips that are each backed by content that
            exists TODAY, the free library row, then the small chips.

            GUITAR & KEYBOARD IS DELIBERATELY ABSENT. Its content
            (PD_GUITAR_CATALOG + gateGuitarSheet) is audited and gate-cleared, but
            no screen surfaces it yet, so the facet does not render at all — no
            "coming soon" chip, ever (frontDoorBands.guitarContentAvailable, and
            bandFacetsAreBackedByRealContent fails if the flag is flipped alone). */}
        <View style={styles.band} testID={BAND_TEST_IDS.browse}>
          <Text style={styles.bandTitle}>{BAND_TITLES.browse}</Text>

          {/* The search entry: it used to be a hint line under the hero. It is a
              row in this band now, and one tap opens the real field. */}
          <TouchableOpacity
            style={styles.findPieceBtn}
            onPress={handleOpenFindPiece}
            activeOpacity={0.6}
            accessibilityRole="search"
            accessibilityLabel={FIND_PIECE_ENTRY_LABEL}
          >
            <Text style={styles.findPieceEmoji}>🔎</Text>
            <Text style={styles.findPieceText}>{FIND_PIECE_ENTRY_HINT}</Text>
          </TouchableOpacity>

          {/* Breadth, honestly — only the facets whose content exists today. */}
          {facets.length > 0 && (
            <View style={styles.bandChipRow}>
              {facets.map((facet) => (
                <TouchableOpacity
                  key={facet.id}
                  style={styles.bandChip}
                  onPress={handleOpenFindPiece}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={facet.label}
                >
                  <Text style={styles.bandChipText}>{facet.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* The free library — the hook (free content earns the trust the paid
              paths live on). Same destination the modern interstitial's own
              "browse the free library" lever uses. */}
          <TouchableOpacity
            style={styles.browseLibraryRow}
            onPress={handleBrowseLibraryFromModern}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={BROWSE_LIBRARY_ACCESSIBILITY_LABEL}
          >
            <Text style={styles.browseLibraryEmoji}>📚</Text>
            <View style={styles.browseLibraryInfo}>
              <Text style={styles.browseLibraryTitle}>{BROWSE_LIBRARY_LABEL}</Text>
              <Text style={styles.browseLibraryHint}>{BROWSE_LIBRARY_HINT}</Text>
              {/* The honest library-size note, RELOCATED here by v45 (designer
                  notes §6 "moves"): it left the hero, where it told a first-time
                  user the library was small before they had tapped anything,
                  and it now renders where a musician is actually choosing to
                  browse the free scores. Same constant, moved render — and the
                  same line is on the recognition no-match card. */}
              <Text style={styles.browseLibraryBetaNote}>{FRONT_DOOR_BETA_NOTE}</Text>
            </View>
            <Text style={styles.browseLibraryChevron}>›</Text>
          </TouchableOpacity>

          {/* The small chips: the streak STATE (no tap — it is a number, not a
              promise), the medals entry (kept, as a chip) and This Week. */}
          <View style={styles.bandChipRow}>
            {browseChips
              .filter((chip) => chip.destination === null)
              .map((chip) => (
                <View key={chip.id} style={styles.bandChip}>
                  <Text style={styles.bandChipText}>{chip.label}</Text>
                </View>
              ))}
            <TouchableOpacity
              style={styles.achievementsCard}
              onPress={handleOpenAchievements}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={ACHIEVEMENTS_ENTRY_LABEL}
            >
              <Text style={styles.achievementsEmoji}>🏅</Text>
              <Text style={styles.achievementsTitle}>
                {medalSummary || ACHIEVEMENTS_ENTRY_HINT}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bandChipButton}
              onPress={handleOpenPracticeWeek}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={WEEK_CHIP_ACCESSIBILITY_LABEL}
            >
              <Text style={styles.bandChipText}>{WEEK_CHIP_LABEL}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* v45 (owner 10-26, designer notes §3 row 4): THE BUILD STAMP IS OFF
            HOME. It was v43 item B1's footer line; the front door is now the
            smallest content area in the app and a version string in its footer
            was one of the things the owner read as clutter. Settings → About
            renders the SAME live line (SettingsScreen.tsx, guarded by
            v43UiContract.settingsShowsTheBuildStamp), and that is the one
            surface a tester is told to read (step 0 of every device pass).
            The retirement is guarded from the other side — v43UiContract
            .homeCarriesNoBuildStamp fails if a stamp sneaks back on Home. */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },

  // Header
  headerEmoji: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e94560',
    textAlign: 'center',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    marginBottom: 24,
  },

  // 🏅 The quiet medals entry — a small row, deliberately lighter than the
  // streak card so it never competes with the one-button front door.
  achievementsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  achievementsEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  achievementsTitle: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '600',
  },


  // Shared affordance line on the tappable summary cards (Practice today /
  // This Week / For You) — the card says where the tap goes instead of only
  // looking tappable.
  cardCta: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 12,
  },


  challengeMeta: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  challengeTag: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  challengeTagText: {
    color: '#c0c0d0',
    fontSize: 12,
    fontWeight: '600',
  },
  challengeDesc: {
    fontSize: 13,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 14,
  },


  // ── The v44 EQUAL SPLIT (owner 10-22) ──
  // The section label sits ABOVE the pair (spec §1: label, then the panels), and
  // the two slots below are just that: SLOTS. Both are `flex: 1` in one row with
  // a 12 dp gap, so the peers are always exactly equal — the fill, radius,
  // shadow, press deltas and copy inside them live in
  // src/components/HeroSplitPanel.tsx and src/services/heroSplit.ts. The names
  // `recognitionBtn` / `humEntryBtn` are kept on purpose: the tier-1 door
  // contracts look the two panels up by these markers.
  splitSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: '#8a8aa3',
    marginBottom: 10,
  },
  heroPairWrap: {
    position: 'relative',
    width: '100%',
  },
  heroPairRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    width: '100%',
  },
  recognitionBtn: {
    flex: 1,
  },
  humEntryBtn: {
    flex: 1,
  },
  // The honest support line under the pair (free-recognition count / state).
  splitSupportLine: {
    fontSize: 12,
    color: '#a0a0b8',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 17,
  },

  // Demo button (dev-only)
  demoBtn: {
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    backgroundColor: 'transparent',
  },
  demoBtnText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },

  // The secondary way in (the "Find a piece" SEARCH entry under the one button).
  // Styled as a search field — dimmed placeholder text, a magnifier, quieter
  // than the hero — because it must never read as a competing primary CTA.
  // (The old tier-1 row of hum/modern/find-piece buttons is gone: those modes
  //  collapsed into the one front door.)
  findPieceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  // v44 (owner 10-22): the navy sibling card, its title/body styles and the
  // teach line under it are GONE — the hum door is the right-hand PEER panel
  // above, painted by src/components/HeroSplitPanel.tsx. `humEntryBtn` is now
  // nothing but that panel's slot; the contract marker name is kept on purpose.
  discoverNote: {
    fontSize: 12,
    color: '#a0a0b8',
    marginBottom: 10,
  },
  findPieceEmoji: {
    fontSize: 18,
    marginRight: 10,
  },
  findPieceText: {
    flex: 1,
    color: '#8a8aa3',
    fontSize: 13,
    fontWeight: '600',
  },

  // Recording indicator
  recordingIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e94560',
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff6b6b',
  },

  // Permission error
  permissionError: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    width: '100%',
    borderWidth: 1,
    borderColor: '#e94560',
  },
  permissionErrorText: {
    color: '#ffb347',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 18,
  },
  settingsBtn: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'center',
  },
  settingsBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },

  // ── The front-door BANDS (re-flow bundle D, owner 10-02) ──
  // One container per band, A → B → C. The containers carry BAND_TEST_IDS, so the
  // source-scan guard in scripts/frontDoorBands.test.ts finds them and their order.
  band: {
    width: '100%',
    marginBottom: 18,
  },
  bandTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#8a8aa3',
    marginBottom: 8,
  },
  // A wrapping row of small chips / entries. flexWrap matters: the hum label is
  // long on purpose (it names all three capture modes) and must reflow rather
  // than clip on a 360dp screen.
  bandChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  bandChip: {
    backgroundColor: '#1a1a2e',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  // A chip that is also a tap (the band-C "This Week" chip).
  bandChipButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  bandChipText: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '600',
  },
  // THE SEARCH BAR (v45, designer notes §7): 358 × 56 dp at a 390 dp screen,
  // radius 16, CARD fill + 1 dp CARD_LINE hairline, the magnifier 20 dp at x+26,
  // the label 15 dp at x+48 and the chevron 20 dp in from the right edge.
  // It replaced the v33 "Find any song" CHIP (radius 999, no fill, 12 dp type):
  // same destination, same handler, a real bar the eye can find — the mock's
  // whole point. Both colours are existing palette literals, so the light-theme
  // remap repaints it with no new token.
  findASongBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#16213e',
    paddingHorizontal: 26,
  },
  findASongBarIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  // The drawn magnifier: a 13 dp lens ring + a 6 dp handle at 45° (no icon font,
  // no new asset, nothing to go missing on a device).
  findASongBarLens: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#a0a0b8',
  },
  findASongBarHandle: {
    position: 'absolute',
    width: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#a0a0b8',
    right: 0,
    bottom: 3,
    transform: [{ rotate: '45deg' }],
  },
  findASongBarLabel: {
    flex: 1,
    color: '#eaeaff',
    fontSize: 15,
    fontWeight: '600',
  },
  findASongBarChevron: {
    color: '#a0a0b8',
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 8,
  },
  // Band B — ONE card, one destination (owner 10-02).
  // ── Today's piece — ONE CARD (v41 item 4 · designer spec §1) ──────────────
  // 358 × 92 dp at 16 dp side margins (it never touches the screen edge), radius
  // 18, CARD fill + 1 dp CARD_LINE. Same numbers in both themes: the literals below
  // are the existing palette roles, so the light mode remap (services/themeApply)
  // repaints them and nothing new is invented.
  todayCard: {
    backgroundColor: '#16213e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
    marginHorizontal: 16,
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  // The 56 dp paper score tile — paper-white in BOTH themes (the theme remap
  // treats #ffffff as a surface, not as ink).
  todayCardTile: {
    width: 56,
    height: 56,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    marginRight: 14,
    justifyContent: 'center',
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  todayCardStaffLine: {
    height: 1,
    backgroundColor: '#c9cddb',
    marginVertical: 2,
  },
  todayCardNote: {
    position: 'absolute',
    width: 6,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#16213e',
    left: 15,
    top: 19,
  },
  todayCardNoteTwo: {
    left: 31,
    top: 29,
  },
  todayCardText: {
    flex: 1,
    justifyContent: 'center',
  },
  todayCardEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#4ecdc4',
    marginBottom: 2,
  },
  todayCardBadge: {
    marginTop: 10,
  },
  todayCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  todayCardPiece: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  todayCardComposer: {
    fontSize: 12,
    color: '#a0a0b8',
    marginTop: 2,
  },
  // The only affordance mark — decoration, never its own hit region.
  todayCardChevron: {
    fontSize: 14,
    color: '#a0a0b8',
    marginLeft: 10,
  },
  todayCardBody: {
    fontSize: 14,
    color: '#a0a0b8',
    lineHeight: 20,
    marginTop: 10,
  },
  // Band C's free-library row — a row, not a chip: it is the hook the paid paths
  // live on, so it keeps the quiet card treatment the medals entry no longer uses.
  browseLibraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
    minHeight: 56,
  },
  browseLibraryEmoji: {
    fontSize: 20,
    marginRight: 12,
  },
  browseLibraryInfo: {
    flex: 1,
  },
  browseLibraryTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  browseLibraryHint: {
    color: '#a0a0b8',
    fontSize: 12,
    marginTop: 2,
  },
  browseLibraryChevron: {
    color: '#4ecdc4',
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 8,
  },
  // The relocated beta note (v45): small and quiet, under the row's own hint.
  browseLibraryBetaNote: {
    color: '#6a6a8a',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 4,
  },

  bottomSpacer: {
    height: 60,
  },
});
