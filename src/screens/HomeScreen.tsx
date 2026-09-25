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
// The categories a result is allowed to claim — never a hardcoded genre.
import { PUBLIC_DOMAIN_GENRE } from '../services/resultGenre';
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
  streakLine,
} from '../services/practiceReinforcementView';
import { StreakNudgeCard } from '../components/StreakNudgeCard';
import {
  FOR_YOU_CTA,
  WEEK_CTA,
  featuredPieceCta,
  forYouAccessibilityLabel,
  forYouByline,
  practiceTodayDestination,
  streakAccessibilityLabel,
  streakCta,
  streakDestination,
  weekProgressCopy,
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
          modern = modernOutcome(await recognizeModernSong(uri, diagnostics));
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
          setRecognitionPhase({
            type: 'success',
            response: humMatchToResultResponse(resp, outcome.matches),
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

  // ── 🔥 Streak card tap (the last owner-reported dead card, v19 bug) ──
  // Same honesty rule as the other cards: this is navigation, not a practice
  // session, so it never calls recordPractice() — a streak day comes from an
  // actual coached run, recorded when the piece's score is opened.
  //   0 days → today's featured piece, through the SAME mapping as
  //            "⏱️ Practice today" (sheet reader → piece page → Find-a-Piece),
  //            so the card is a way to START the streak it is showing.
  //   N days → the practice-week view — the same surface "📋 This Week" opens.
  const handleStreakCardTap = useCallback(() => {
    if (streakDestination(streak.currentDays) === 'week') {
      setShowPracticeWeek(true);
      return;
    }
    handlePracticeTodayTap();
  }, [streak.currentDays, handlePracticeTodayTap]);

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

  // ── Daily challenge tap: record practice (streak framing), then open the
  // piece's sheet music in the in-app viewer when available; otherwise show
  // the honest "coming soon" state (PieceDetailScreen) instead of a dead end.
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

    if (dailyChallenge?.sheetMusicUrl) {
      setShowScoreViewer(true);
    } else {
      setShowDetail(true);
    }
  }, [dailyChallenge]);

  // ── Permission denied state ──
  if (recorder.error && !recorder.isRecording) {
    // Only show a full error screen if the user can't proceed
  }

  // ── Build personalised recommendation text ──
  const personalisedCopy = onboarding
    ? onboarding.instrument === 'both'
      ? `Piano & Guitar picks for ${onboarding.level}s`
      : `${onboarding.instrument === 'piano' ? 'Piano' : 'Guitar'} picks for ${
          onboarding.level
        }s`
    : 'Discover sheet music';

  // The Home subtitle is the genre-neutral product promise (owner 09-24): it
  // used to render "Curated Classical" for anyone who skipped genre selection in
  // onboarding (the picker defaulted to ['classical']), which told a guitar or
  // pop learner the app was not for them. frontDoor.homePromiseCopy() makes it
  // instrument-aware too — guitar users get the live TAB promise.
  // (Rendered inline below from that helper — one source of truth.)

  // The one button, mirrored from the front door's state machine.
  const heroEmoji = recorder.isRecording ? '🎙️' : '🎤';

  const streakText =
    streak.currentDays > 0
      ? `🔥 ${streak.currentDays}-day streak`
      : 'Start your streak today!';

  // Positive framing only (owner rule, 2026-09-17): the streak line celebrates
  // what the streak is, it never threatens the user with losing it. Copy comes
  // from the reinforcement view layer so every surface phrases it the same way.
  const streakNudge =
    streakLine(streak)?.text ??
    'A few minutes of practice today starts your streak.';

  const weekProgress = weekProgressCopy(weeklyGoal.current, weeklyGoal.target);
  const weekPercent = Math.min(
    (weeklyGoal.current / weeklyGoal.target) * 100,
    100,
  );
  const weekComplete = weeklyGoal.current >= weeklyGoal.target;

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
          hum → modern bridge (hum miss). */}
      <RecognitionResultView
        visible={showRecognitionResults}
        phase={recognitionPhase}
        onClose={handleCloseRecognition}
        onRetry={handleRetryRecognition}
        onUpgrade={handleUpgradePro}
        onHumFallback={noMatchOffer === 'hum' ? handleHumFallbackFromCard : undefined}
        onFindAnySong={noMatchOffer === 'modern' ? handleFindAnySongFromCard : undefined}
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

        {/* ── ONE-BUTTON FRONT DOOR (owner-approved 09-24) ──
            The ONLY primary action on this screen. One tap runs the whole hybrid
            pipeline (our library landmark match, then the AudD modern pass) with
            no mode choice; when the ambient pass hears nothing we recognise, this
            SAME button becomes the hum/whistle/sing fallback — inline, never a
            rival button. Every state's words come from src/services/frontDoor.ts. */}
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

          {/* The secondary way in: KNOW the piece's name. This used to be a third
              hero button ("Find a piece"); the owner's decision (09-24) is that it
              is a search field, not a competing CTA. */}
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

          {/* Honest beta note — the recognition library is small and growing.
              In hum mode it says what the hum fallback can actually do. */}
          <Text style={styles.tier1BetaNote}>
            {humFallback
              ? HUM_FALLBACK_LIBRARY_NOTE
              : 'Beta: our recognition library is still growing — well-known classical melodies match best; not every song will match yet.'}
          </Text>
        </View>


        {/* ── Streak Card ── */}
        {/* Tappable (v19 bug: "Start your streak today!" and the button did
            nothing). 0 days → today's featured piece, the SAME destination as
            "⏱️ Practice today"; an active streak → the practice-week view. The
            copy above the CTA keeps its positive framing — this only adds where
            the tap goes. */}
        <TouchableOpacity
          style={styles.streakCard}
          onPress={handleStreakCardTap}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={streakAccessibilityLabel(
            streak.currentDays,
            dailyChallenge,
          )}
        >
          <View style={styles.streakRow}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View style={styles.streakInfo}>
              <Text style={styles.streakCount}>{streakText}</Text>
              <Text style={styles.streakBest}>
                Best: {streak.longestDays} days
              </Text>
            </View>
          </View>
          <Text style={styles.streakNudge}>{streakNudge}</Text>
          <Text style={styles.cardCta}>
            {streakCta(streak.currentDays, dailyChallenge)}
          </Text>
        </TouchableOpacity>

        {/* Outside-play streak nudge (slice 2): quiet, dismissible, and never
            rendered while the mic is live or a result is on screen. */}
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

        {/* 🏅 Achievements — the QUIET medals entry (owner-approved 08-25). It
            sits BELOW the one-button front door and below the streak card so it
            is never a competing CTA: a small row, a line of progress, and the
            medals screen behind it. The line comes from the medal rules
            (achievementsSummaryLine), never from a number typed here. */}
        <TouchableOpacity
          style={styles.achievementsCard}
          onPress={handleOpenAchievements}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={ACHIEVEMENTS_ENTRY_LABEL}
        >
          <Text style={styles.achievementsEmoji}>🏅</Text>
          <View style={styles.achievementsInfo}>
            <Text style={styles.achievementsTitle}>{ACHIEVEMENTS_ENTRY_LABEL}</Text>
            <Text style={styles.achievementsHint}>
              {medalSummary || ACHIEVEMENTS_ENTRY_HINT}
            </Text>
          </View>
          <Text style={styles.achievementsChevron}>›</Text>
        </TouchableOpacity>

        {/* ⏱️ Practice today — tappable (v19 bug: this card looked tappable and
            did nothing). Opens today's featured piece: the sheet reader when the
            catalog has a curated score, else the piece page with the coach; when
            no featured piece loaded it opens Find-a-Piece. */}
        <TouchableOpacity
          style={styles.practiceCard}
          onPress={handlePracticeTodayTap}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            dailyChallenge
              ? `Practice today — open ${dailyChallenge.title}`
              : 'Practice today — find a piece to practice'
          }
        >
          <Text style={styles.practiceTitle}>⏱️ Practice today</Text>
          <Text style={styles.practiceValue}>You practiced {Math.round(practiceMinutes)} minutes today</Text>
          <Text style={styles.cardCta}>{featuredPieceCta(dailyChallenge)}</Text>
        </TouchableOpacity>

        {/* ── Weekly Goals ── */}
        {/* Tappable (v19 bug): opens the practice-week surface — the days
            practised this week, minutes per day, this week's coached takes. */}
        <TouchableOpacity
          style={styles.goalCard}
          onPress={handleOpenPracticeWeek}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`This week — ${weekProgress}. Open your practice week`}
        >
          <View style={styles.goalHeader}>
            <Text style={styles.goalTitle}>📋 This Week</Text>
            {weekComplete && <Text style={styles.goalComplete}>🎉 Done!</Text>}
          </View>
          <Text style={styles.goalProgress}>{weekProgress}</Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${weekPercent}%` },
                weekComplete && styles.progressFillComplete,
              ]}
            />
          </View>
          {weekComplete && (
            <Text style={styles.goalCelebrate}>
              You crushed your goal this week!
            </Text>
          )}
          <Text style={styles.cardCta}>{WEEK_CTA}</Text>
        </TouchableOpacity>

        {/* ── Daily Challenge ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🌟 Today's Featured Piece</Text>
        </View>

        {dailyChallenge ? (
          <TouchableOpacity
            style={styles.challengeCard}
            onPress={handleDailyChallengeTap}
            activeOpacity={0.7}
          >
            <Text style={styles.challengeEmoji}>🎼</Text>
            <Text style={styles.challengeTitle}>{dailyChallenge.title}</Text>
            <Text style={styles.challengeComposer}>
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
            <View style={styles.challengeCta}>
              <Text style={styles.challengeCtaText}>
                {dailyChallenge.sheetMusicAvailable === false
                  ? 'View piece ▶ — sheet music coming soon'
                  : 'View & Practice →'}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.challengeCard}
            onPress={loadData}
            activeOpacity={0.7}
          >
            <Text style={styles.challengeEmoji}>🎼</Text>
            <Text style={styles.challengeTitle}>
              Featured piece unavailable
            </Text>
            <Text style={styles.challengeComposer}>
              Couldn't reach the piece catalog. Check your connection.
            </Text>
            <View style={styles.challengeCta}>
              <Text style={styles.challengeCtaText}>Retry →</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Personalised Recommendations ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🎯 For You</Text>
        </View>
        {/* A real card now (v19 bug: this looked like a card and had no tap at
            all). The personalised line is the title, the tap opens catalog
            browse/search — the honest destination today — and the byline says so
            instead of claiming a feed the app cannot show yet. */}
        <TouchableOpacity
          style={styles.forYouCard}
          onPress={handleOpenFindPiece}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={forYouAccessibilityLabel(personalisedCopy)}
        >
          <Text style={styles.recoLabel}>{personalisedCopy}</Text>
          <Text style={styles.recoByline}>{forYouByline(onboarding !== null)}</Text>
          <Text style={styles.cardCta}>{FOR_YOU_CTA}</Text>
        </TouchableOpacity>


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

  // Streak
  streakCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  // 🏅 The quiet medals entry — a small row, deliberately lighter than the
  // streak card so it never competes with the one-button front door.
  achievementsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    minHeight: 56,
  },
  achievementsEmoji: {
    fontSize: 22,
    marginRight: 12,
  },
  achievementsInfo: {
    flex: 1,
  },
  achievementsTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  achievementsHint: {
    color: '#a0a0b8',
    fontSize: 12,
    marginTop: 2,
  },
  achievementsChevron: {
    color: '#4ecdc4',
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 8,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  streakEmoji: {
    fontSize: 36,
    marginRight: 14,
  },
  streakInfo: {
    flex: 1,
  },
  streakCount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  streakBest: {
    fontSize: 14,
    color: '#ffb347',
    marginTop: 2,
  },
  streakNudge: {
    fontSize: 14,
    color: '#ffb347',
    fontWeight: '600',
    marginTop: 4,
  },

  // Practice
  practiceCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  practiceTitle: { fontSize: 16, fontWeight: '700', color: '#ffffff', marginBottom: 6 },
  practiceValue: { fontSize: 15, color: '#c0c0d0' },

  // Shared affordance line on the tappable summary cards (Practice today /
  // This Week / For You) — the card says where the tap goes instead of only
  // looking tappable.
  cardCta: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 12,
  },

  // Weekly goal
  goalCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  goalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  goalComplete: {
    fontSize: 14,
    color: '#4ecdc4',
    fontWeight: '700',
  },
  goalProgress: {
    fontSize: 15,
    color: '#c0c0d0',
    fontWeight: '600',
    marginBottom: 10,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#e94560',
    borderRadius: 4,
  },
  progressFillComplete: {
    backgroundColor: '#4ecdc4',
  },
  goalCelebrate: {
    fontSize: 13,
    color: '#4ecdc4',
    fontWeight: '600',
    marginTop: 10,
  },

  // Daily challenge
  sectionHeader: {
    marginBottom: 12,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e94560',
  },
  challengeCard: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 22,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#e94560',
    borderStyle: 'dashed',
  },
  challengeEmoji: {
    fontSize: 40,
    textAlign: 'center',
    marginBottom: 8,
  },
  challengeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 2,
  },
  challengeComposer: {
    fontSize: 15,
    color: '#a0a0b8',
    textAlign: 'center',
    marginBottom: 12,
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
  challengeCta: {
    alignItems: 'center',
  },
  challengeCtaText: {
    color: '#e94560',
    fontSize: 15,
    fontWeight: '700',
  },

  // Recommendations
  forYouCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  recoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  recoByline: {
    fontSize: 13,
    color: '#a0a0b8',
    marginBottom: 0,
    lineHeight: 19,
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

  bottomSpacer: {
    height: 60,
  },
});
