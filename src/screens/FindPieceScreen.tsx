/**
 * FindPieceScreen — "Find a piece": search the NoteSnap catalog by title or
 * composer, straight from the live catalog endpoint `GET /api/pieces?q=`.
 *
 * Why this screen exists: recognition (audio + hum) needs the user to already
 * have the music in the room or in their head. A learner who simply knows the
 * name of a piece — "Für Elise", "Beethoven" — had no way in. This is that way
 * in, and it is also how the sheet-music-ready part of the catalog gets
 * discovered (real curated scores → the piece page → practice).
 *
 * Behaviour:
 *   • empty query → the catalog's own first page (the browse state);
 *   • ~300 ms debounce per settled query, newest response wins (a slow request
 *     for "fur" can never overwrite the results for "für elise");
 *   • no match  → "No pieces match — try another title or composer";
 *   • failure   → honest error with a Retry button (never an empty list);
 *   • sheet badge → "🎼 Sheet music" only when the catalog really has a
 *     curated score, otherwise "Coming soon" (no invented links);
 *   • tapping a row opens PieceDetailScreen in place, exactly like History and
 *     the hum flow do, and best-effort fills in the catalog's coach data.
 *
 * The logic (parsing, sorting, URL building, row → detail mapping) lives in
 * services/catalogSearch.ts and is unit-tested; this screen is a thin caller.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { fetchPieceById, searchPieces } from '../services/api';
import {
  CATALOG_SEARCH_DEBOUNCE_MS,
  NO_MATCH_MESSAGE,
  SEARCH_ERROR_MESSAGE,
  catalogPieceToDetail,
  normalizeQuery,
  resultsHeaderText,
  sheetBadgeLabel,
  sortPiecesForDisplay,
} from '../services/catalogSearch';
import { mergeCatalogIntoDetail } from '../services/historyPiece';
import { PieceDetailScreen } from './PieceDetailScreen';
import { useHardwareBack } from '../hooks/useHardwareBack';
import type { CatalogPiece, DailyChallengePiece } from '../types';

type Status = 'loading' | 'ready' | 'empty' | 'error';

interface FindPieceScreenProps {
  onClose: () => void;
}

export const FindPieceScreen: React.FC<FindPieceScreenProps> = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [pieces, setPieces] = useState<CatalogPiece[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  // Bumped by the Retry button to re-run the current query.
  const [reloadToken, setReloadToken] = useState(0);
  // Full-screen piece page for a tapped row (rendered in place, like History).
  const [showDetail, setShowDetail] = useState<DailyChallengePiece | null>(null);
  // Guards against a stale response replacing newer results.
  const searchRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  // Debounced catalog search: one request per settled query.
  useEffect(() => {
    const trimmed = normalizeQuery(query);
    const token = ++searchRequestRef.current;
    setStatus('loading');

    const timer = setTimeout(() => {
      void searchPieces(trimmed)
        .then((res) => {
          if (token !== searchRequestRef.current) return;
          const sorted = sortPiecesForDisplay(res.pieces);
          setPieces(sorted);
          setTotal(res.total);
          setStatus(sorted.length === 0 ? 'empty' : 'ready');
        })
        .catch(() => {
          if (token !== searchRequestRef.current) return;
          setPieces([]);
          setTotal(0);
          setStatus('error');
        });
    }, CATALOG_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, reloadToken]);

  /**
   * Open a search result on the piece page. The row already carries the
   * catalog's identity, difficulty and curated sheet URL, so the page opens
   * instantly; the /api/pieces/:id lookup afterwards only fills in what the
   * search row does not carry (the coach's ABC reference melody). A failed
   * lookup leaves the page as it is — never an error, never a blocked tap.
   */
  const handleOpenPiece = useCallback((piece: CatalogPiece) => {
    const token = ++detailRequestRef.current;
    setShowDetail(catalogPieceToDetail(piece));
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
    detailRequestRef.current++;
    setShowDetail(null);
  }, []);

  const handleClearQuery = useCallback(() => {
    setQuery('');
  }, []);

  const renderItem = ({ item }: { item: CatalogPiece }) => {
    const meta = [item.composer, item.catalog].filter(
      (part): part is string => !!part && part.length > 0,
    );
    return (
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => handleOpenPiece(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title} by ${item.composer}`}
      >
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {meta.length > 0 ? (
            <Text style={styles.itemComposer} numberOfLines={1}>
              {meta.join(' · ')}
            </Text>
          ) : null}
          {item.difficultyLabel ? (
            <Text style={styles.itemDifficulty}>{item.difficultyLabel}</Text>
          ) : null}
        </View>
        <Text
          style={[
            styles.badge,
            item.sheetMusicAvailable ? styles.badgeReady : styles.badgeSoon,
          ]}
          numberOfLines={1}
        >
          {sheetBadgeLabel(item.sheetMusicAvailable)}
        </Text>
      </TouchableOpacity>
    );
  };

  // Android hardware BACK (in-place flow — owner bug class 09-23). Find-a-Piece
  // replaces its host tab's whole body, so nothing else consumes the BACK press:
  // without this it reaches React Navigation, which has no route to pop and
  // finishes the activity (the app "exits"). Unwind ONE level: out of the opened
  // piece first, then back to whoever opened the search. Guarded by
  // src/services/backExitContract.ts.
  useHardwareBack(() => {
    if (showDetail) {
      handleCloseDetail();
      return true;
    }
    onClose();
    return true;
  });
  // Full-screen piece page for a tapped row (same in-place pattern as History).
  if (showDetail) {
    return <PieceDetailScreen piece={showDetail} onBack={handleCloseDetail} />;
  }

  const header = resultsHeaderText(total, query, pieces.length);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close search"
          hitSlop={8}
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find a piece</Text>
      </View>

      {/* Query field — focused on open so the keyboard is ready for a title. */}
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔎</Text>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by title or composer"
          placeholderTextColor="#8a8aa3"
          autoFocus
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          accessibilityLabel="Search the catalog by title or composer"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={handleClearQuery}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.subtitle}>
        Free public-domain and classical pieces — search, then open the score.
      </Text>

      {status === 'loading' && pieces.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#e94560" />
          <Text style={styles.centerSubtext}>Searching the catalog...</Text>
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>⚠️</Text>
          <Text style={styles.emptyTitle}>Couldn't load the catalog</Text>
          <Text style={styles.emptyText}>{SEARCH_ERROR_MESSAGE}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setReloadToken((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel="Retry the catalog search"
          >
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {status === 'empty' ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={styles.emptyTitle}>No match</Text>
          <Text style={styles.emptyText}>{NO_MATCH_MESSAGE}</Text>
        </View>
      ) : null}

      {status === 'ready' ? (
        <FlatList
          data={pieces}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            header.length > 0 ? (
              <Text style={styles.listHeader}>{header}</Text>
            ) : null
          }
        />
      ) : null}
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

  // Search field
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 16,
    paddingVertical: 12,
  },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  clearBtnText: {
    color: '#e94560',
    fontSize: 13,
    fontWeight: '700',
  },
  subtitle: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    marginHorizontal: 20,
    marginTop: 10,
  },

  // States
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
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 18,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Results
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
    marginRight: 10,
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
  itemDifficulty: {
    fontSize: 12,
    color: '#4ecdc4',
    fontWeight: '600',
    marginTop: 6,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  badgeReady: {
    color: '#4ecdc4',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  badgeSoon: {
    color: '#8a8aa3',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
});
