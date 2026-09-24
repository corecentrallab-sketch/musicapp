/**
 * AchievementsScreen — the medals surface (owner-approved 08-25 retention build).
 *
 * Reached from Home's quiet "🏅 Achievements" card, rendered IN PLACE (Home's
 * body is replaced, exactly like PracticeWeekScreen / FindPieceScreen), so it
 * registers `useHardwareBack` — BACK leaves this screen, never the app (see
 * src/services/backExitContract.ts).
 *
 * WHAT IT SHOWS
 *   • the two numbers already live in the app: the current streak day count and
 *     the total practice minutes;
 *   • "Next to earn" — the unearned medal closest to its threshold, with the
 *     honest progress line and a bar;
 *   • every medal in the catalog, earned ones carrying their unlock date and a
 *     Share action.
 *
 * WHERE THE NUMBERS COME FROM: src/services/medals.ts (rules + copy) over
 * src/services/medalStore.ts (device reads/writes). Opening this screen runs the
 * same `checkAndAwardMedals()` the Home toast path runs, and that call is
 * idempotent — a medal is never awarded twice and an earned medal is never
 * removed, so simply opening the screen can only ever SETTLE a medal the user
 * already qualified for.
 *
 * SHARING: an earned medal opens the EXISTING ShareCard component (extended with
 * its `medal` block — never forked), carrying the piece/song context that was on
 * screen when the medal unlocked. The card is rendered as an overlay in this
 * screen's always-mounted body (never as its whole body — the blank-page class,
 * see src/services/backExitContract.ts), and one handler closes it from both the
 * on-screen close and the Android BACK dismissal.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { ShareCard } from '../components/ShareCard';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { checkAndAwardMedals, getMedalRecordsLocal } from '../services/medalStore';
import {
  ACHIEVEMENTS_ALL_EARNED_COPY,
  ACHIEVEMENTS_CURRENT_STREAK_LABEL,
  ACHIEVEMENTS_EARNED_LABEL,
  ACHIEVEMENTS_EMPTY_COPY,
  ACHIEVEMENTS_MINUTES_LABEL,
  ACHIEVEMENTS_NEXT_LABEL,
  ACHIEVEMENTS_SCREEN_TITLE,
  EMPTY_MEDAL_STATS,
  MEDAL_SHARE_CTA,
  earnedDateLabel,
  medalCardSubtitle,
  medalCardTitle,
  medalHeadline,
  medalProgressLabel,
  medalProgressList,
  medalShareAccessibilityLabel,
  medalShareText,
  nextMedalToEarn,
  type MedalProgress,
  type MedalStats,
} from '../services/medals';

interface AchievementsScreenProps {
  onClose: () => void;
}

export const AchievementsScreen: React.FC<AchievementsScreenProps> = ({ onClose }) => {
  const [rows, setRows] = useState<MedalProgress[]>([]);
  const [next, setNext] = useState<MedalProgress | null>(null);
  const [stats, setStats] = useState<MedalStats>(EMPTY_MEDAL_STATS);
  /** The medal whose share card is open (null = none). */
  const [share, setShare] = useState<MedalProgress | null>(null);

  // Android BACK leaves this screen (never the app). Enabled false while the
  // share card is up, so the card's own onRequestClose owns that press first.
  useHardwareBack(() => {
    if (share !== null) {
      setShare(null);
      return true;
    }
    onClose();
    return true;
  });

  const load = useCallback(async () => {
    // Idempotent: settles anything already qualified for, awards nothing twice.
    const result = await checkAndAwardMedals();
    const records = result.records.length > 0 ? result.records : await getMedalRecordsLocal();
    setStats(result.stats);
    setRows(medalProgressList(result.stats, records));
    setNext(nextMedalToEarn(result.stats, records));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Open the share card for an earned medal (the viral loop). */
  const openMedalShare = useCallback((row: MedalProgress) => {
    setShare(row);
  }, []);

  const closeMedalShare = useCallback(() => {
    setShare(null);
  }, []);

  const earnedCount = rows.filter((row) => row.earned).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
        >
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{ACHIEVEMENTS_SCREEN_TITLE}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* The two live numbers, both from the engines that already own them. */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEmoji}>🔥</Text>
            <Text style={styles.summaryValue}>{stats.currentStreakDays}</Text>
            <Text style={styles.summaryLabel}>{ACHIEVEMENTS_CURRENT_STREAK_LABEL}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEmoji}>⏱️</Text>
            <Text style={styles.summaryValue}>{stats.totalMinutes}</Text>
            <Text style={styles.summaryLabel}>{ACHIEVEMENTS_MINUTES_LABEL}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEmoji}>🏅</Text>
            <Text style={styles.summaryValue}>{earnedCount}</Text>
            <Text style={styles.summaryLabel}>{ACHIEVEMENTS_EARNED_LABEL}</Text>
          </View>
        </View>

        {/* Next to earn — or the honest "all done" line. */}
        {next ? (
          <View style={styles.nextCard}>
            <Text style={styles.nextLabel}>{ACHIEVEMENTS_NEXT_LABEL}</Text>
            <Text style={styles.nextEmoji}>{next.medal.emoji}</Text>
            <Text style={styles.nextName}>{next.medal.name}</Text>
            <Text style={styles.nextProgress}>
              {medalProgressLabel(next.medal, next.value)}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${next.percent}%` }]} />
            </View>
            <Text style={styles.nextDescription}>{next.medal.description}</Text>
          </View>
        ) : (
          <View style={styles.nextCard}>
            <Text style={styles.nextLabel}>{ACHIEVEMENTS_NEXT_LABEL}</Text>
            <Text style={styles.nextName}>{ACHIEVEMENTS_ALL_EARNED_COPY}</Text>
          </View>
        )}

        {earnedCount === 0 ? (
          <Text style={styles.emptyCopy}>{ACHIEVEMENTS_EMPTY_COPY}</Text>
        ) : null}

        {/* Every medal: progress while unearned, then the share action. */}
        {rows.map((row) => (
          <View
            key={row.medal.id}
            style={[styles.medalRow, row.earned && styles.medalRowEarned]}
          >
            <View style={styles.medalRowTop}>
              <Text style={[styles.medalEmoji, !row.earned && styles.medalEmojiLocked]}>
                {row.medal.emoji}
              </Text>
              <View style={styles.medalInfo}>
                <Text style={styles.medalName}>{row.medal.name}</Text>
                <Text style={styles.medalDescription}>{row.medal.description}</Text>
                {row.earned ? (
                  <Text style={styles.medalEarnedLine}>
                    {row.earnedAt ? `Earned ${earnedDateLabel(row.earnedAt)}` : 'Earned'}
                    {row.context.title ? ` · ${row.context.title}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.medalProgressText}>
                    {medalProgressLabel(row.medal, row.value)}
                  </Text>
                )}
              </View>
              <Text style={styles.medalState}>{row.earned ? '✓' : `${row.percent}%`}</Text>
            </View>

            {!row.earned ? (
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${row.percent}%` }]} />
              </View>
            ) : null}

            {row.earned ? (
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={() => openMedalShare(row)}
                accessibilityRole="button"
                accessibilityLabel={medalShareAccessibilityLabel(row.medal)}
              >
                <Text style={styles.shareBtnText}>{MEDAL_SHARE_CTA}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* The achievement card — the EXISTING ShareCard with its medal block.
          An overlay inside this always-mounted body, never a body replacement. */}
      <ShareCard
        visible={share !== null}
        medal={
          share
            ? {
                emoji: share.medal.emoji,
                name: share.medal.name,
                progressLabel: share.progressLabel,
              }
            : undefined
        }
        title={share ? medalCardTitle(share.medal, share.context) : ''}
        composer={share ? medalCardSubtitle(share.medal, share.context) : ''}
        headline={share ? medalHeadline(share.medal) : undefined}
        shareMessage={share ? medalShareText(share.medal, share.context) : undefined}
        streak={stats.currentStreakDays}
        practiceMinutes={stats.totalMinutes}
        minutesLabel="min total"
        onClose={closeMedalShare}
      />
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
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  backBtn: {
    minWidth: 64,
    minHeight: 44,
    justifyContent: 'center',
  },
  backBtnText: {
    color: '#4ecdc4',
    fontSize: 15,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingVertical: 14,
  },
  summaryEmoji: {
    fontSize: 20,
    marginBottom: 4,
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  summaryLabel: {
    color: '#a0a0b8',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 2,
  },
  nextCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e94560',
    padding: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  nextLabel: {
    color: '#e94560',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  nextEmoji: {
    fontSize: 36,
    marginBottom: 6,
  },
  nextName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  nextProgress: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  nextDescription: {
    color: '#a0a0b8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0f3460',
    width: '100%',
    overflow: 'hidden',
    marginTop: 12,
  },
  barFill: {
    height: 8,
    backgroundColor: '#e94560',
  },
  emptyCopy: {
    color: '#a0a0b8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 16,
  },
  medalRow: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 14,
    marginBottom: 10,
  },
  medalRowEarned: {
    borderColor: '#4ecdc4',
  },
  medalRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  medalEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  medalEmojiLocked: {
    opacity: 0.45,
  },
  medalInfo: {
    flex: 1,
  },
  medalName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  medalDescription: {
    color: '#a0a0b8',
    fontSize: 12,
    marginTop: 2,
  },
  medalEarnedLine: {
    color: '#4ecdc4',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  medalProgressText: {
    color: '#c0c0d0',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  medalState: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 8,
  },
  shareBtn: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4ecdc4',
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  shareBtnText: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 24,
  },
});
