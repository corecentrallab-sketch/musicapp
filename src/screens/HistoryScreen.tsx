/**
 * HistoryScreen — saved recognitions + streak summary.
 *
 * Lists every piece saved from a recognition (AsyncStorage-backed via
 * @notesnap/recognitionHistory), newest first, with per-item removal,
 * a streak header card, and pull-to-refresh. Refreshes whenever the tab
 * gains focus so a recognition on the Discover tab shows up immediately.
 *
 * Tapping a row opens the piece page (PieceDetailScreen, rendered in place) —
 * the sheet, the coach and the share card all live there. The row opens from the
 * saved record immediately, then fills in the catalog's curated sheet URL via
 * /api/pieces/:id (see services/historyPiece.ts for the pure mapping).
 */
import React, { useCallback, useRef, useState } from 'react';
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
} from '../services/storage';
import {
  getDisplayStreakLocal,
  type DisplayStreak,
} from '../services/reinforcementStore';
import { EMPTY_STREAK_SUMMARY, streakLine } from '../services/practiceReinforcementView';
import { fetchPieceById } from '../services/api';
import {
  mergeCatalogIntoDetail,
  savedPieceToDetail,
} from '../services/historyPiece';
import { PieceDetailScreen } from './PieceDetailScreen';
import type { DailyChallengePiece, SavedPiece } from '../types';

/** Zeroed streak (engine-derived) used until the first read resolves. */
const EMPTY_STREAK: DisplayStreak = EMPTY_STREAK_SUMMARY;

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
  const [streak, setStreak] = useState<DisplayStreak>(EMPTY_STREAK);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Full-screen piece page for a tapped row — the app renders PieceDetailScreen
  // in place (like Home and the hum flow) rather than as a tab route.
  const [showDetail, setShowDetail] = useState<DailyChallengePiece | null>(null);
  // Guards the catalog lookup against a stale response (tap A, back, tap B).
  const detailRequestRef = useRef(0);

  const reload = useCallback(async () => {
    // Streak from the reinforcement engine (practice history) — same number as
    // Home and the coach card show.
    const [history, streakData] = await Promise.all([
      getRecognitionHistory(),
      getDisplayStreakLocal(),
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

  /**
   * Open a saved recognition on the piece page (the v18 fix: rows were inert).
   *
   * The saved record carries identity + date only, so the page opens instantly
   * from what we hold and then — best effort — fills in the catalog's record for
   * the piece (curated sheet URL, honest difficulty/public-domain signals). A
   * failed lookup leaves the page's honest "Sheet music coming soon" state; it
   * never blocks the tap and never shows an error.
   */
  const handleOpenPiece = useCallback((piece: SavedPiece) => {
    const token = ++detailRequestRef.current;
    setShowDetail(savedPieceToDetail(piece));
    void fetchPieceById(piece.id).then((info) => {
      if (!info || token !== detailRequestRef.current) return;
      setShowDetail((current) =>
        current && current.id === piece.id
          ? mergeCatalogIntoDetail(current, info)
          : current,
      );
    });
  }, []);

  const handleCloseDetail = useCallback(() => {
    // Invalidate any in-flight lookup so a late response can't reopen the page.
    detailRequestRef.current++;
    setShowDetail(null);
  }, []);

  const streakText =
    streak.currentDays > 0
      ? `🔥 ${streak.currentDays}-day streak`
      : 'Start your streak today!';
  // Positive framing only — no "don't break it" pressure (owner rule 09-17).
  const streakBest =
    streak.longestDays > 0
      ? `Best: ${streak.longestDays} days`
      : streakLine(streak)?.text ?? 'A coached practice run starts your streak';

  const renderItem = ({ item }: { item: SavedPiece }) => (
    /* The whole card opens the piece page (fix: the row used to be inert).
       The ✕ keeps its own press — a nested Touchable wins the responder, so
       removing a piece never opens it. */
    <TouchableOpacity
      style={styles.itemCard}
      onPress={() => handleOpenPiece(item)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.title} by ${item.composer}`}
    >
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
    </TouchableOpacity>
  );

  // Full-screen piece page for a tapped row — PieceDetailScreen is not a tab
  // route, so it is rendered in place exactly like Home / the hum flow do.
  if (showDetail) {
    return <PieceDetailScreen piece={showDetail} onBack={handleCloseDetail} />;
  }

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
              Saved recognitions ({items.length}) · tap a piece to open it
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
