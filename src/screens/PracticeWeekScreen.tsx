/**
 * PracticeWeekScreen — the surface behind Home's "📋 This Week" card.
 *
 * Owner-reported on device (v19 / 0.1.14): the card showed "x/5 days practiced"
 * and did nothing when tapped. The app has no practice-history tab — the coach
 * takes live on the piece page and the practice record lives on-device (practice
 * days + minutes in services/storage.ts, coached runs in the practice history) —
 * so this screen is that surface: which days of THIS week were practised, the
 * minutes on each, and this week's coached takes, with a real way to practise
 * again at the bottom.
 *
 * Read-only over what other features already persisted; it computes nothing
 * beyond the pure helpers in services/homeCards.ts (unit-tested under plain
 * Node). Rendered in place by Home, like the app's other full-screen flows.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getPracticeDaysLocal,
  getPracticeMinutes,
  getWeeklyGoal,
} from '../services/storage';
import { getPracticeHistoryLocal } from '../services/practiceHistoryStore';
import { useHardwareBack } from '../hooks/useHardwareBack';
import type { WeeklyGoal } from '../types';
import {
  buildWeekView,
  coachedTakeCopy,
  coachedTakeSummary,
  practiceWeekCta,
  weekDayStatusText,
  weekPercent,
  weekProgressCopy,
  weekTotalCopy,
  type CoachedTakeSummary,
  type WeekView,
} from '../services/homeCards';

interface PracticeWeekScreenProps {
  /** Back to Home. */
  onClose: () => void;
  /** Today's featured piece title, or null when the catalog did not load. */
  featuredTitle: string | null;
  /** Open today's featured piece (score + practice coach) — Home owns that flow. */
  onPracticeToday: () => void;
  /** Find-a-piece, the destination when there is no featured piece. */
  onFindPiece: () => void;
}

interface WeekData {
  goal: WeeklyGoal;
  weekView: WeekView;
  takes: CoachedTakeSummary;
}

const DEFAULT_GOAL: WeeklyGoal = { target: 5, current: 0, weekStart: '' };

export const PracticeWeekScreen: React.FC<PracticeWeekScreenProps> = ({
  onClose,
  featuredTitle,
  onPracticeToday,
  onFindPiece,
}) => {
  const [data, setData] = useState<WeekData | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  // Android hardware BACK (in-place flow — owner bug class 09-23). Home renders
  // this surface by replacing its whole tab body, so the route never changes and
  // an unconsumed BACK press reaches React Navigation, which has nothing to pop
  // and finishes the activity (the app "exits"). Consume it and go back to Home.
  // Guarded by src/services/backExitContract.ts.
  useHardwareBack(() => {
    onClose();
    return true;
  });

  const load = useCallback(async () => {
    const now = new Date();
    try {
      const [goal, practiceDays, minutesByDay, sessions] = await Promise.all([
        getWeeklyGoal(),
        getPracticeDaysLocal(),
        getPracticeMinutes(),
        getPracticeHistoryLocal(),
      ]);
      const weekView = buildWeekView({ now, practiceDays, minutesByDay });
      setData({
        goal,
        weekView,
        takes: coachedTakeSummary(
          sessions,
          weekView.days.map((day) => day.date),
        ),
      });
      setReadFailed(false);
    } catch {
      // Never a blank screen: fall back to the empty week and say so.
      const weekView = buildWeekView({ now });
      setData({
        goal: DEFAULT_GOAL,
        weekView,
        takes: coachedTakeSummary([], weekView.days.map((day) => day.date)),
      });
      setReadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Back to Discover"
        hitSlop={8}
      >
        <Text style={styles.backText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>This Week</Text>
    </View>
  );

  if (!data) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#e94560" />
          <Text style={styles.centerSubtext}>Loading your practice week…</Text>
        </View>
      </View>
    );
  }

  const { goal, weekView, takes } = data;
  const cta = practiceWeekCta(featuredTitle);
  const goPractise = featuredTitle ? onPracticeToday : onFindPiece;

  return (
    <View style={styles.container}>
      {header}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary — the same numbers Home's card shows. */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>📋 This Week</Text>
          <Text style={styles.summaryValue}>
            {weekProgressCopy(goal.current, goal.target)}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${weekPercent(goal.current, goal.target)}%` },
                goal.current >= goal.target && styles.progressFillComplete,
              ]}
            />
          </View>
          <Text style={styles.summarySub}>{weekTotalCopy(weekView.minutesTotal)}</Text>
          {readFailed ? (
            <Text style={styles.summaryWarn}>
              We couldn't read your practice record just now — the counts below
              may be incomplete.
            </Text>
          ) : null}
        </View>

        {/* Day by day */}
        <Text style={styles.sectionTitle}>Day by day</Text>
        <View style={styles.daysCard}>
          {weekView.days.map((day) => (
            <View
              key={day.date}
              style={[styles.dayRow, day.isToday && styles.dayRowToday]}
            >
              <View style={styles.dayInfo}>
                <Text style={[styles.dayName, day.isToday && styles.dayNameToday]}>
                  {day.weekday} {day.label}
                </Text>
                {day.isToday ? <Text style={styles.todayTag}>Today</Text> : null}
              </View>
              <Text
                style={[
                  styles.dayStatus,
                  day.practiced ? styles.dayStatusDone : styles.dayStatusIdle,
                ]}
              >
                {weekDayStatusText(day)}
              </Text>
            </View>
          ))}
        </View>

        {/* Coached takes this week */}
        <Text style={styles.sectionTitle}>Coached takes</Text>
        <View style={styles.takesCard}>
          <Text style={styles.takesLine}>{coachedTakeCopy(takes)}</Text>
          <Text style={styles.takesSub}>
            The coach scores you as you play a piece from its sheet — accuracy and
            feedback land on the piece page.
          </Text>
        </View>

        {/* Real ways to practise now */}
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={goPractise}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={cta}
        >
          <Text style={styles.primaryBtnText}>{cta}</Text>
        </TouchableOpacity>

        {featuredTitle ? (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onFindPiece}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Find a piece by title or composer"
          >
            <Text style={styles.secondaryBtnText}>Find another piece →</Text>
          </TouchableOpacity>
        ) : null}

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  backBtn: {
    marginRight: 12,
  },
  backText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerSubtext: {
    color: '#a0a0b8',
    marginTop: 12,
    fontSize: 14,
  },

  // Summary (same shape as Home's weekly card)
  summaryCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  summaryValue: {
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
  summarySub: {
    fontSize: 13,
    color: '#a0a0b8',
    marginTop: 10,
  },
  summaryWarn: {
    fontSize: 13,
    color: '#ffb347',
    marginTop: 8,
    lineHeight: 18,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e94560',
    marginTop: 22,
    marginBottom: 10,
  },

  // Day rows
  daysCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#0f3460',
  },
  dayRowToday: {
    backgroundColor: '#1a1a2e',
  },
  dayInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  dayName: {
    fontSize: 15,
    color: '#c0c0d0',
    fontWeight: '600',
  },
  dayNameToday: {
    color: '#ffffff',
    fontWeight: '700',
  },
  todayTag: {
    marginLeft: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#e94560',
  },
  dayStatus: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
  },
  dayStatusDone: {
    color: '#4ecdc4',
  },
  dayStatusIdle: {
    color: '#8a8aa3',
  },

  // Coached takes
  takesCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  takesLine: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  takesSub: {
    fontSize: 13,
    color: '#a0a0b8',
    marginTop: 8,
    lineHeight: 19,
  },

  // CTAs
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  secondaryBtnText: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 20,
  },
});
