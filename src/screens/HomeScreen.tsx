/**
 * HomeScreen (Discover tab) — the main hub.
 * Shows: recognition prompt, streak counter, weekly goals, daily challenge,
 * and personalised recommendation copy.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { BadgeToast } from '../components/BadgeToast';
import { PieceDetailScreen } from './PieceDetailScreen';
import {
  getStreakData,
  recordPractice,
  getWeeklyGoal,
  getOnboardingAnswers,
} from '../services/storage';
import { checkAndAwardBadges } from '../services/achievements';
import { getTodayChallenge } from '../services/dailyChallenge';
import type {
  StreakData,
  WeeklyGoal,
  DailyChallengePiece,
  OnboardingAnswers,
  Badge,
} from '../types';

export const HomeScreen: React.FC = () => {
  // State
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
  const [refreshing, setRefreshing] = useState(false);

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [s, wg, ob, dc] = await Promise.all([
      getStreakData(),
      getWeeklyGoal(),
      getOnboardingAnswers(),
      Promise.resolve(getTodayChallenge()),
    ]);
    setStreak(s);
    setWeeklyGoal(wg);
    setOnboarding(ob);
    setDailyChallenge(dc);
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

  // Simulate "practice" action for demonstration — tap daily challenge counts
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

    setShowDetail(true);
  }, []);

  // Build personalised recommendation text
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
              : g.charAt(0).toUpperCase() + g.slice(1)
          )
          .join(', ')}`
      : 'All genres';

  const streakText =
    streak.currentStreak > 0
      ? `🔥 ${streak.currentStreak}-day streak`
      : 'Start your streak today!';

  const streakNudge =
    streak.currentStreak > 0 && streak.currentStreak < 7
      ? 'Keep it going — don\'t break your streak!'
      : streak.currentStreak >= 7
      ? 'Amazing consistency! You\'re on fire! 🔥'
      : 'Practice today to start your streak!';

  const weekProgress = `${weeklyGoal.current}/${weeklyGoal.target} days practiced`;
  const weekPercent = Math.min(
    (weeklyGoal.current / weeklyGoal.target) * 100,
    100
  );
  const weekComplete = weeklyGoal.current >= weeklyGoal.target;

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

        {dailyChallenge && (
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
              <View style={styles.challengeTag}>
                <Text style={styles.challengeTagText}>
                  {dailyChallenge.genre}
                </Text>
              </View>
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
            <Text style={styles.challengeDesc} numberOfLines={2}>
              {dailyChallenge.description}
            </Text>
            <View style={styles.challengeCta}>
              <Text style={styles.challengeCtaText}>View & Practice →</Text>
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

        {/* ── Recognition CTA ── */}
        <View style={styles.recognitionCard}>
          <Text style={styles.recognitionEmoji}>🎤</Text>
          <Text style={styles.recognitionTitle}>Recognize a Song</Text>
          <Text style={styles.recognitionDesc}>
            Hear a song you want to play? Tap to identify it and get the sheet
            music instantly.
          </Text>
          <TouchableOpacity style={styles.recognitionBtn}>
            <Text style={styles.recognitionBtnText}>Start Listening</Text>
          </TouchableOpacity>
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
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  recognitionBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  bottomSpacer: {
    height: 60,
  },
});
