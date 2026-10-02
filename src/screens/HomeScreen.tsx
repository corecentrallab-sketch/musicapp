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
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
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
  HUM_FALLBACK_LIBRARY_NOTE,
  HUM_SECONDARY_CTA,
  frontDoorStartFailure,
  heroAccessibilityLabel,
  heroLabel,
  heroState,
  heroSupport,
  heroTapAction,
  heroTitle,
  homePromiseCopy,
  humMatchToResultResponse,
} from '../services/frontDoor';
// The hosted score the hum pass resolves for its top match (bundle A): the shared
// result surface renders it INLINE, so the door's own hum pass looks the piece up
// in our catalog exactly as the full hum screen does.
import type { HumResolvedSheet } from '../services/frontDoor';
// The front door's BAND MODEL and the "Find any song" chip's one source of copy
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
  FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL,
  FIND_ANY_SONG_CHIP_LABEL,
  FRONT_DOOR_BETA_NOTE,
  FRONT_DOOR_FACET_FLAGS,
  TODAY_CARD_TITLE,
  TODAY_CARD_UNAVAILABLE_BODY,
  WEEK_CHIP_ACCESSIBILITY_LABEL,
  WEEK_CHIP_LABEL,
  bandFacets,
  retentionChips,
  todayCardAccessibilityLabel,
  todayCardCta,
} from '../services/frontDoorBands';
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
import type {
  WeeklyGoal,
  DailyChallengePiece,
  OnboardingAnswers,
  Badge,
  RecognitionMatch,
  RecognitionResponse,
  RootTabParamList,
} from '../types';

/** Auto-stop recording after this many ms. Kept comfortably long so the recogniser
 *  gets enough signal from a room-recorded clip — a short capture starves the
 *  matcher and produces weak/uncertain confidence. */
const RECORDING_TIMEOUT_MS = 12000;

/** Pause between dismissing a result card and starting the next capture, so the
 *  recorder from the previous pass is fully released first. */
const RETRY_DELAY_MS = 300;

export const HomeScreen: React.FC = () => {
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
          await saveRecognition({
            id: m.isrc || m.song,
            title: m.song,
            composer: m.artist,
            savedAt: new Date().toISOString(),
            // Save the category WITH the record: a modern song must never reach
            // History genre-less and be filled in by a fallback later. The
            // provider's REAL genre when it sent one (owner request 09-25).
            genre: modernGenreLabel(m),
            // Save the LICENSED LINKS the match arrived with (owner 10-01): the
            // saved row used to carry identity only, so tapping it in History
            // reached nothing and the sheet-music card was a dead end. This is
            // `null` when the backend supplied no URL — never an invented one,
            // and never used for a public-domain piece (those saves are above).
            purchaseUrls: modernPurchaseUrls(m),
          });
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

  // ── BAND B/A: "Find any song" chip (re-flow bundle B, owner 10-02) ──
  // The compact way into the find-a-song SEARCH, sitting beside the hum row so a
  // musician who can neither play the audio nor hum it is one tap from typing a
  // title. It reuses the EXISTING `showFindPiece` flag and the existing
  // `FindPieceScreen` mount — no second search surface, no new box — and it is
  // deliberately NOT the hero handler (the one big button stays the only primary
  // CTA; frontDoor.findAnySongChipWired() asserts both halves).
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

  // The one button, mirrored from the front door's state machine.
  const heroEmoji = recorder.isRecording ? '🎙️' : '🎤';

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
            tintColor="#e94560"
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

        {/* ══ BAND A — IDENTIFY ══ (re-flow bundle D, owner build-go 10-02)
            The hero card exactly as it was: emoji, title, support, the ONE button,
            the hum row with the new "Find any song" chip beside it, and the honest
            beta note. Nothing in this band is re-ordered — the audit's band A is
            "identify (hero, unchanged)".

            ONE-BUTTON FRONT DOOR (owner-approved 09-24): the ONLY primary action on
            this screen. One tap runs the whole hybrid pipeline (our library landmark
            match, then the AudD modern pass) with no mode choice; when the ambient
            pass hears nothing we recognise, this SAME button becomes the
            hum/whistle/sing fallback — inline, never a rival button. Every state's
            words come from src/services/frontDoor.ts. */}
        <View style={styles.band} testID={BAND_TEST_IDS.identify}>
        <View style={styles.recognitionCard}>
          <Text style={styles.recognitionEmoji}>{heroEmoji}</Text>
          <Text style={styles.recognitionTitle}>{heroTitle(hero)}</Text>
          <Text style={styles.recognitionDesc}>
            {heroSupport(hero, { isPro, freeRecognitions })}
          </Text>

          {/* Mic permission error inline */}
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

          {/* Recording indicator */}
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

          {/* THE one button. In hum-fallback mode it is the SAME button — the
              user never picks a mode. */}
          <TouchableOpacity
            style={[
              styles.recognitionBtn,
              recorder.isRecording && styles.recognitionBtnActive,
            ]}
            onPress={handleHeroTap}
            disabled={recorder.checkingPermissions || hero === 'busy'}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={heroAccessibilityLabel(hero)}
          >
            <Text style={styles.recognitionBtnText}>{heroLabel(hero)}</Text>
          </TouchableOpacity>

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

          {/* The two secondary ways in, SIDE BY SIDE (re-flow bundle B, owner
              10-02): the hum row (owner 09-25) and the new "Find any song" chip.
              The hum entry stays FIRST, so the door's priority order is unchanged
              (frontDoor.humEntryWired), and the chip renders AFTER it in source
              order (frontDoor.findAnySongChipWired) — it must never disturb the
              hero's own order.

              The chip is deliberately LIGHTER than the recognition core: no fill,
              a hairline border, smaller type, its own style — never
              styles.recognitionBtn, never the hero handler. It opens the EXISTING
              find-a-song search (the same showFindPiece flag + FindPieceScreen
              mount the band-C row uses), so there is no second search surface and
              no new box. §B.1's honest limit: this chip opens the title/artist
              SEARCH, not the recording door (that sentence belongs to
              HUM_TO_MODERN_BLURB / the modern route). */}
          <View style={styles.frontDoorRow}>
          <TouchableOpacity
            style={styles.humEntryBtn}
            onPress={handleHumEntry}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={HUM_SECONDARY_CTA}
          >
            <Text style={styles.humEntryEmoji}>🎤</Text>
            <Text style={styles.humEntryText}>{HUM_SECONDARY_CTA}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.findAnySongChip}
            onPress={handleFindAnySong}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL}
          >
            <Text style={styles.findAnySongChipText}>{FIND_ANY_SONG_CHIP_LABEL}</Text>
          </TouchableOpacity>
          </View>

          {/* Honest beta note — the recognition library is small and growing.
              In hum mode it says what the hum fallback can actually do. */}
          <Text style={styles.tier1BetaNote}>
            {humFallback ? HUM_FALLBACK_LIBRARY_NOTE : FRONT_DOOR_BETA_NOTE}
          </Text>
        </View>
        </View>


        {/* Outside-play streak nudge (slice 2): quiet, dismissible, and never
            rendered while the mic is live or a result is on screen. It is a
            BANNER, not a door entry, so it belongs to no band — the bands below
            carry the door's tappable meanings. */}
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
          <TouchableOpacity
            style={styles.todayCard}
            onPress={handleDailyChallengeTap}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={todayCardAccessibilityLabel(dailyChallenge)}
          >
            <Text style={styles.todayCardTitle}>{TODAY_CARD_TITLE}</Text>
            {dailyChallenge ? (
              <>
                <Text style={styles.todayCardPiece}>{dailyChallenge.title}</Text>
                <Text style={styles.todayCardComposer}>
                  {dailyChallenge.composer}
                </Text>
                <View style={styles.challengeMeta}>
                  {dailyChallenge.genre ? (
                    <View style={styles.challengeTag}>
                      <Text style={styles.challengeTagText}>
                        {dailyChallenge.genre}
                      </Text>
                    </View>
                  ) : null}
                  {dailyChallenge.catalog ? (
                    <View style={styles.challengeTag}>
                      <Text style={styles.challengeTagText}>
                        {dailyChallenge.catalog}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.challengeTag}>
                    <Text style={styles.challengeTagText}>
                      {dailyChallenge.difficulty === 'Beginner'
                        ? '🌱'
                        : dailyChallenge.difficulty === 'Intermediate'
                          ? '🌿'
                          : '🌳'}{' '}
                      {dailyChallenge.difficulty}
                    </Text>
                  </View>
                </View>
                {dailyChallenge.description ? (
                  <Text style={styles.challengeDesc} numberOfLines={2}>
                    {dailyChallenge.description}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.todayCardBody}>
                {TODAY_CARD_UNAVAILABLE_BODY}
              </Text>
            )}

            {/* Retention as STATE, not as rival cards. */}
            <View style={styles.bandChipRow}>
              {todayCardChips.map((chip) => (
                <View key={chip.id} style={styles.bandChip}>
                  <Text style={styles.bandChipText}>{chip.label}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.cardCta}>{todayCardCta(dailyChallenge)}</Text>
          </TouchableOpacity>
        </View>

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

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
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


  // Recognition CTA
  recognitionCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
    marginBottom: 16,
  },
  recognitionEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  recognitionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  recognitionDesc: {
    fontSize: 13,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  recognitionBtn: {
    backgroundColor: '#e94560',
    borderRadius: 90,
    width: 172,
    height: 172,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#e94560',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  recognitionBtnActive: {
    backgroundColor: '#ff6b6b',
  },
  recognitionBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
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
  // The hum/whistle/sing entry (owner 09-25). Deliberately lighter than the
  // find-a-piece row and than the big red hero button: it is a labelled
  // secondary path, not a second hero — no filled background, no accent border.
  humEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  humEntryEmoji: {
    fontSize: 16,
    marginRight: 8,
  },
  humEntryText: {
    fontSize: 14,
    color: '#a0a0b8',
    textDecorationLine: 'underline',
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
  tier1BetaNote: {
    color: '#8a8aa3',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 2,
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
    textTransform: 'uppercase',
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
  // Band A's two secondary entries side by side: the hum row and the "Find any
  // song" chip (bundle B). The row wraps, so neither label is clipped.
  frontDoorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
  },
  // The "Find any song" chip — the LIGHTEST tappable thing on the door: no fill,
  // a hairline border, smaller type than the hero CTA, and never
  // styles.recognitionBtn. This is the owner's weight rule (§B.4) in pixels.
  findAnySongChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  findAnySongChipText: {
    color: '#a0a0b8',
    fontSize: 12,
    fontWeight: '600',
  },
  // Band B — ONE card, one destination (owner 10-02).
  todayCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  todayCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  todayCardPiece: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 10,
  },
  todayCardComposer: {
    fontSize: 14,
    color: '#a0a0b8',
    marginTop: 2,
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

  bottomSpacer: {
    height: 60,
  },
});
