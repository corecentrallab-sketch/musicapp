/**
 * HistoryScreen — saved recognitions + streak summary.
 *
 * Lists every piece saved from a recognition (AsyncStorage-backed via
 * @notesnap/recognitionHistory), newest first, with per-item removal,
 * a streak header card, and pull-to-refresh. Refreshes whenever the tab
 * gains focus so a recognition on the Discover tab shows up immediately.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getRecognitionHistory,
  removeRecognition,
  getStreakData,
} from '../services/storage';
import type { SavedPiece, StreakData } from '../types';

const EMPTY_STREAK: StreakData = {
  currentStreak: 0,
  lastPracticeDate: null,
  bestStreak: 0,
};

/** Format an ISO savedAt timestamp as a short local date, e.g. "Aug 17, 2026". */
function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const HistoryScreen: React.FC = () => {
  const [items, setItems] = useState<SavedPiece[]>([]);
  const [streak, setStreak] = useState<StreakData>(EMPTY_STREAK);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const [history, streakData] = await Promise.all([
      getRecognitionHistory(),
      getStreakData(),
    ]);
    setItems(history);
    setStreak(streakData);
    setLoading(false);
  }, []);

  // Reload every time the tab gains focus (e.g. after a new recognition).
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const handleRemove = useCallback(
    (piece: SavedPiece) => {
      Alert.alert(
        'Remove from history?',
        `"${piece.title}" will be removed from your saved recognitions.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await removeRecognition(piece.id);
                await reload();
              } catch {
                Alert.alert(
                  'Could not remove',
                  'Something went wrong while removing this piece. Please try again.',
                );
              }
            },
          },
        ],
      );
    },
    [reload],
  );

  const streakText =
    streak.currentStreak > 0
      ? `🔥 ${streak.currentStreak}-day streak`
      : 'Start your streak today!';
  const streakBest =
    streak.bestStreak > 0
      ? `Best: ${streak.bestStreak} days`
      : 'Recognize a song to start your streak';

  const renderItem = ({ item }: { item: SavedPiece }) => (
    <View style={styles.itemCard}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.itemComposer} numberOfLines={1}>
          {item.composer}
        </Text>
        <View style={styles.itemMeta}>
          {item.genre ? (
            <Text style={styles.itemGenre} numberOfLines={1}>
              {item.genre}
            </Text>
          ) : null}
          <Text style={styles.itemDate}>
            {formatSavedDate(item.savedAt)}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.removeBtn}
        onPress={() => handleRemove(item)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.title} from history`}
        hitSlop={8}
      >
        <Text style={styles.removeBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.centerSubtext}>Loading history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Streak header card */}
      <View style={styles.streakCard}>
        <Text style={styles.streakEmoji}>🔥</Text>
        <View style={styles.streakInfo}>
          <Text style={styles.streakCount}>{streakText}</Text>
          <Text style={styles.streakBest}>{streakBest}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={styles.listHeader}>
              Saved recognitions ({items.length})
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyTitle}>No recognitions yet</Text>
            <Text style={styles.emptyText}>
              Tap the mic on the Discover tab to identify a song — every match
              is saved here.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#e94560"
          />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  center: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSubtext: {
    color: '#a0a0b8',
    marginTop: 12,
    fontSize: 14,
  },

  // Streak header
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  streakEmoji: {
    fontSize: 32,
    marginRight: 14,
  },
  streakInfo: {
    flex: 1,
  },
  streakCount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  streakBest: {
    fontSize: 13,
    color: '#a0a0b8',
    marginTop: 2,
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  listHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e94560',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  itemComposer: {
    fontSize: 14,
    color: '#a0a0b8',
    marginTop: 2,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  itemGenre: {
    fontSize: 12,
    color: '#4ecdc4',
    fontWeight: '600',
    backgroundColor: '#1a1a2e',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  itemDate: {
    fontSize: 12,
    color: '#a0a0b8',
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  removeBtnText: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '700',
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 24,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
  },
});
