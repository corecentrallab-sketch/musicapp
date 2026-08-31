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
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { BadgeToast } from '../components/BadgeToast';
import {
  RecognitionResultView,
  type RecognitionPhase,
} from '../components/RecognitionResultView';
import { ScoreViewer } from '../components/ScoreViewer';
import { PieceDetailScreen } from './PieceDetailScreen';
import { HumSearchScreen } from './HumSearchScreen';
import { ModernSearchScreen } from './ModernSearchScreen';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import {
  recognizeAudio,
  isRecognitionLimitError,
} from '../services/api';
import {
  getStreakData,
  recordPractice,
  getWeeklyGoal,
  getOnboardingAnswers,
  saveRecognition,
  getRecognitionCount,
  getTodayPracticeMinutes,
  getProState,
} from '../services/storage';
import { checkAndAwardBadges } from '../services/achievements';
import { getTodayChallenge } from '../services/dailyChallenge';
import type {
  StreakData,
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

export const HomeScreen: React.FC = () => {
  // Tab-navigation handle (used to jump to Settings → Pro upgrade from the
  // quota-exhausted modal).
  const navigation =
    useNavigation<BottomTabNavigationProp<RootTabParamList>>();

  // ── Core data state ──
  const [streak, setStreak] = useState<StreakData>({
    currentStreak: 0,
    lastPracticeDate: null,
    bestStreak: 0,
  });
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pulsing animation for the mic indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Load initial data ──
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [s, wg, ob, dc, minutes] = await Promise.all([
      getStreakData(),
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
          purchase_url: {
            musicnotes: 'https://www.musicnotes.com/sheetmusic/mtd.asp?ppn=MN0217881',
            sheetmusicplus: 'https://www.sheetmusicplus.com/title/clair-de-lune-digital-sheet-music/19377456',
          },
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
      genre: topMatch.catalog ?? undefined,
    });

    // Increment streak
    const newStreak = await recordPractice();
    setStreak(newStreak);

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

  // ── Recognition flow ──

  const handleStartListening = useCallback(async () => {
    // If already recording, stop it
    if (recorder.isRecording) {
      handleStopRecording();
      return;
    }

    const started = await recorder.startRecording();
    if (!started) return;

    // Auto-stop after timeout
    timeoutRef.current = setTimeout(() => {
      handleStopRecording();
    }, RECORDING_TIMEOUT_MS);
  }, [recorder.isRecording, recorder.startRecording]);

  const handleStopRecording = useCallback(async () => {
    // Clear the auto-stop timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const stopped = await recorder.stopRecording();
    if (!stopped) {
      // NEVER silently drop the user back to idle. A dead recording (null URI,
      // failed finalize, or an empty/0-byte clip) must surface an explicit
      // error state so the flow can't loop "Listening → Tap to identify".
      // Clear the hook's inline permission-style error too, so we don't ALSO
      // render the "Open Settings" block under the recording card for what is
      // a recording failure, not a permission denial.
      recorder.clearError();
      setRecognitionPhase({
        type: 'error',
        message: 'Recording failed — please try again.',
      });
      setShowRecognitionResults(true);
      return;
    }
    const { uri, diagnostics } = stopped;

    // Show loading phase
    setRecognitionPhase({ type: 'loading' });
    setShowRecognitionResults(true);

    try {
      const result = await recognizeAudio(uri);

      // Attach capture-path telemetry to the first result phase (whichever it
      // is) so the owner can read off what the mic recorded next to the result.
      const outcome =
        result.matches && result.matches.length > 0
          ? ({ type: 'success', response: result } as const)
          : ({
              type: 'no-match',
              message: result.no_confident_match_reason,
              server: result.received_audio,
            } as const);
      setRecognitionPhase({ ...outcome, diagnostics });

      // Handle success: check for matches
      if (result.matches && result.matches.length > 0) {
        recorder.completeRecording();

        // Save top match to history
        const topMatch: RecognitionMatch = result.matches[0];
        await saveRecognition({
          id: topMatch.piece_id,
          title: topMatch.title,
          composer: topMatch.composer,
          savedAt: new Date().toISOString(),
          genre: topMatch.catalog ?? undefined,
        });

        // Increment streak (recognition counts as practice)
        const newStreak = await recordPractice();
        setStreak(newStreak);

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
      } else {
        // API returned success but no matches. If the server declined to name a
        // piece (ambiguous / too weak), surface its honest reason instead of a
        // generic message — the launch rule is "no confident-wrong"; an honest
        // "play longer & clearer" is the correct UX.
        recorder.completeRecording();
      }
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
    }
  }, [recorder]);

  // ── Cleanup timeout on unmount ──
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // ── Close recognition results ──
  const handleCloseRecognition = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    recorder.clearError();
  }, [recorder]);

  // ── Retry recognition ──
  const handleRetryRecognition = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    // Auto-start listening again
    setTimeout(() => handleStartListening(), 300);
  }, [handleStartListening]);

  // ── Upgrade to Pro (from the quota-exhausted modal) ──
  // Close the modal and open the Settings tab, where the transparent upgrade
  // flow (Stripe checkout + entitlement polling) already lives.
  const handleUpgradePro = useCallback(() => {
    setShowRecognitionResults(false);
    setRecognitionPhase(null);
    navigation.navigate('Settings');
  }, [navigation]);

  // ── Tier-1 full-screen flows ──
  // Hum/whistle/sing-to-search: opens HumSearchScreen (its own recorder).
  const handleOpenHumSearch = useCallback(() => {
    setShowHumSearch(true);
  }, []);

  // Modern-song search: opens ModernSearchScreen (its own recorder).
  const handleOpenModernSearch = useCallback(() => {
    setShowModernSearch(true);
  }, []);

  // From the modern interstitial: jump to the hum flow (find a free PD piece).
  const handleHumItFromModern = useCallback(() => {
    setShowModernSearch(false);
    setShowHumSearch(true);
  }, []);

  // From the modern interstitial: open the free public-domain Library.
  const handleBrowseLibraryFromModern = useCallback(() => {
    setShowModernSearch(false);
    navigation.navigate('Library');
  }, [navigation]);

  // ── Daily challenge tap: record practice (streak framing), then open the
  // piece's sheet music in the in-app viewer when available; otherwise show
  // the honest "coming soon" state (PieceDetailScreen) instead of a dead end.
  const handleDailyChallengeTap = useCallback(async () => {
    const newStreak = await recordPractice();
    setStreak(newStreak);

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

  const genreCopy =
    onboarding?.genres?.length
      ? `Curated ${onboarding.genres
          .map((g) =>
            g === 'jazz-ragtime'
              ? 'Jazz & Ragtime'
              : g.charAt(0).toUpperCase() + g.slice(1),
          )
          .join(', ')}`
      : 'All genres';

  const streakText =
    streak.currentStreak > 0
      ? `🔥 ${streak.currentStreak}-day streak`
      : 'Start your streak today!';

  const streakNudge =
    streak.currentStreak > 0 && streak.currentStreak < 7
      ? "Keep it going — don't break your streak!"
      : streak.currentStreak >= 7
        ? "Amazing consistency! You're on fire! 🔥"
        : 'Practice today to start your streak!';

  const weekProgress = `${weeklyGoal.current}/${weeklyGoal.target} days practiced`;
  const weekPercent = Math.min(
    (weeklyGoal.current / weeklyGoal.target) * 100,
    100,
  );
  const weekComplete = weeklyGoal.current >= weeklyGoal.target;

  // Full-screen Tier-1 flows (owned recorders; rendered in place like the rest
  // of the app's full-screen readers).
  if (showHumSearch) {
    return <HumSearchScreen onClose={() => setShowHumSearch(false)} />;
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

  // Full-screen sheet music viewer — the same path the recognition result flow
  // uses for pieces that have a curated sheet.
  if (showScoreViewer && dailyChallenge?.sheetMusicUrl) {
    return (
      <ScoreViewer
        url={dailyChallenge.sheetMusicUrl}
        title={dailyChallenge.title}
        composer={dailyChallenge.composer}
        onClose={() => setShowScoreViewer(false)}
      />
    );
  }

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
      {/* Badge toast overlay */}
      <BadgeToast
        badge={badgeToast ?? { id: '', name: '', description: '', emoji: '' }}
        visible={badgeToast !== null}
        onDismiss={() => setBadgeToast(null)}
      />

      {/* Recognition results modal */}
      <RecognitionResultView
        visible={showRecognitionResults}
        phase={recognitionPhase}
        onClose={handleCloseRecognition}
        onRetry={handleRetryRecognition}
        onUpgrade={handleUpgradePro}
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
        <Text style={styles.subtitle}>{genreCopy}</Text>

        {/* ── Recognition CTA ── */}
        <View style={styles.recognitionCard}>
          <Text style={styles.recognitionEmoji}>
            {recorder.isRecording ? '🎙️' : '🎤'}
          </Text>
          <Text style={styles.recognitionTitle}>
            {recorder.isRecording ? 'Listening...' : 'Recognize a Song'}
          </Text>
          <Text style={styles.recognitionDesc}>
            {recorder.isRecording
              ? 'Recording audio — move closer to the music source for best results.'
              : isPro
                ? 'Hear a song you want to play? Tap to identify it and get the sheet music instantly. Unlimited recognitions.'
                : `Hear a song you want to play? Tap to identify it and get the sheet music instantly. (${freeRecognitions}/5 free recognitions)`}
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

          <TouchableOpacity
            style={[
              styles.recognitionBtn,
              recorder.isRecording && styles.recognitionBtnActive,
            ]}
            onPress={handleStartListening}
            disabled={recorder.checkingPermissions}
            activeOpacity={0.7}
          >
            <Text style={styles.recognitionBtnText}>
              {recorder.checkingPermissions
                ? 'Checking...'
                : recorder.isRecording
                  ? 'Stop & Identify'
                  : 'Tap to Identify'}
            </Text>
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

          {/* Tier-1 secondary modes (distinct from audio-recognize above) */}
          {!recorder.isRecording && !recorder.checkingPermissions && (
            <View style={styles.tier1Row}>
              <TouchableOpacity
                style={styles.tier1Btn}
                onPress={handleOpenHumSearch}
                activeOpacity={0.6}
              >
                <Text style={styles.tier1BtnEmoji}>🎤</Text>
                <Text style={styles.tier1BtnText}>
                  Hum, whistle or sing the melody
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tier1Btn}
                onPress={handleOpenModernSearch}
                activeOpacity={0.6}
              >
                <Text style={styles.tier1BtnEmoji}>💿</Text>
                <Text style={styles.tier1BtnText}>
                  Find any song & get the sheet music
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>


        {/* ── Streak Card ── */}
        <View style={styles.streakCard}>
          <View style={styles.streakRow}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View style={styles.streakInfo}>
              <Text style={styles.streakCount}>{streakText}</Text>
              <Text style={styles.streakBest}>
                Best: {streak.bestStreak} days
              </Text>
            </View>
          </View>
          <Text style={styles.streakNudge}>{streakNudge}</Text>
        </View>

        <View style={styles.practiceCard}>
          <Text style={styles.practiceTitle}>⏱️ Practice today</Text>
          <Text style={styles.practiceValue}>You practiced {Math.round(practiceMinutes)} minutes today</Text>
        </View>

        {/* ── Weekly Goals ── */}
        <View style={styles.goalCard}>
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
        </View>

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
                  ? '🎼 Sheet music coming soon'
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
        <Text style={styles.recoLabel}>{personalisedCopy}</Text>
        <Text style={styles.recoByline}>
          {onboarding
            ? 'Based on your instrument, level, and genre preferences.'
            : 'Complete onboarding to personalise your feed.'}
        </Text>


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
    fontSize: 13,
    color: '#a0a0b8',
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
  recoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  recoByline: {
    fontSize: 13,
    color: '#a0a0b8',
    marginBottom: 22,
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

  // Tier-1 secondary modes (hum / modern-song)
  tier1Row: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 14,
  },
  tier1Btn: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  tier1BtnEmoji: {
    fontSize: 22,
    marginBottom: 4,
  },
  tier1BtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 16,
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
