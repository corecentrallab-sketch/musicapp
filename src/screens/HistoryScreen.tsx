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
 *
 * SEARCH SCOPE (owner 10-01): the search box in this list header searches the
 * SAVED RECOGNITIONS ONLY, in memory. It used to open FindPieceScreen — the
 * general catalog search over every piece we hold, including ones this user never
 * recognized — which is not what "find the piece I just played" means in History.
 * Global catalog discovery still lives on Home's own Find-a-piece entry.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
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
  filterSavedPieces,
  mergeCatalogIntoDetail,
  savedPieceToDetail,
} from '../services/historyPiece';
import {
  historyStreakDestination,
  streakAccessibilityLabel,
  streakCta,
} from '../services/homeCards';
import { PieceDetailScreen } from './PieceDetailScreen';
import { PracticeWeekScreen } from './PracticeWeekScreen';
// The row's own purchase action (bundle C / D7, owner 10-02): a saved MODERN row
// carries the licensed retailer links it was saved with, so the sheet music is two
// taps away (History → 🛒) instead of three (History → piece page → card). The URL
// resolves through the money-path helper and opens in the app's ONE retailer shell,
// mounted here, so BACK returns to History.
import { PurchaseWebView } from '../components/PurchaseWebView';
import { primaryPurchaseUrl } from '../services/purchaseCta';
import { exportCaptureMidiFromTake } from '../services/captureMidiExport';
import {
  MIDI_EXPORT_BUSY_LABEL,
  MIDI_EXPORT_LABEL,
  captureTakeLabel,
} from '../services/midiExport';
// The detected key of the row's own take, as text — "Key: C minor" — or null
// when the take was too thin to name one (Batch A: the key the export writes
// into the .mid is the key the row shows, and nothing is shown without one).
import { keyCaption } from '../services/keyDetection';
// A PERSONAL MELODY row (owner 10-02): the user's own hummed/whistled/sung take,
// saved by the capture window. `personalMelodyFromRow()` is the pure decision that
// a row is a melody rather than a recognized piece — a melody id resolves to no
// catalog piece, so tapping one must NOT go to the piece page (it would be an
// honest "coming soon" with the user's own tune behind it, i.e. a dead end).
import { personalMelodyFromRow } from '../services/melodyCapture';
// The capture window itself, mounted in place to re-open a saved melody.
import { HumSearchScreen } from './HumSearchScreen';
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
  /**
   * A PERSONAL MELODY from the melody-capture window (owner 10-02), re-opened in
   * place: the capture window shows that same take again — its notes, its key,
   * its suggested chords — with no recorder and no library pass.
   *
   * It is its own state, not a shape of `showDetail`, because a melody row is NOT
   * a piece: it has no catalog id, so the piece page would land on an honest
   * "coming soon" with nothing behind it. The user's own tune gets its own
   * destination, and the ✕/BACK always comes back to this list.
   */
  const [openMelody, setOpenMelody] = useState<SavedPiece | null>(null);
  /**
   * The History search box's query (owner 10-01). It filters the SAVED
   * recognitions in memory — no network, no catalog — so looking for "the piece I
   * just played" can only ever surface rows the user actually recognized.
   */
  const [query, setQuery] = useState('');
  // The box lives in the list header; the streak/week exits below focus it so
  // "practise this week" lands on the same one search surface History always
  // offers, instead of the old global catalog search.
  const searchInputRef = useRef<TextInput>(null);
  // Practice-week view (v22): the destination for the streak card once a streak
  // is live — the same screen Home's "📋 This Week" card opens, rendered in place
  // like the app's other full-screen flows.
  const [showPracticeWeek, setShowPracticeWeek] = useState(false);
  // Guards the catalog lookup against a stale response (tap A, back, tap B).
  const detailRequestRef = useRef(0);
  // MIDI export (Batch A): which row is mid-export, and the honest sentence the
  // finished attempt left behind — shown on that row only.
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<{ id: string; text: string } | null>(null);
  /**
   * The row's purchase action opens the licensed retailer in the app's ONE
   * in-app shell, mounted at THIS screen's root (bundle C, owner 10-02), so the
   * shell's "← Back to NoteSnap" and hardware BACK both land back on History —
   * the row's own surface. Null = closed. (The full-screen Modal also makes the
   * double-open impossible: while it is up, the list behind it cannot be tapped.)
   */
  const [purchaseWebUrl, setPurchaseWebUrl] = useState<string | null>(null);
  /** The header line the shell shows — the row the user tapped. */
  const [purchaseShellTitle, setPurchaseShellTitle] = useState('');

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

  /**
   * "Export MIDI" on a capture row (Batch A). The row carries the take that was
   * derived from the user's own hum/whistle/sing recording, so this needs no
   * network and no re-decode: encode the stored take, write the .mid, open the
   * share sheet. Every outcome lands in a sentence on that row.
   */
  const handleExportTake = useCallback(
    async (item: SavedPiece) => {
      if (exportingId || !item.capture) return;
      setExportingId(item.id);
      setExportNote(null);
      try {
        const result = await exportCaptureMidiFromTake(item.capture, { title: item.title });
        setExportNote({ id: item.id, text: result.message });
      } catch (err) {
        setExportNote({
          id: item.id,
          text:
            err instanceof Error && err.message
              ? err.message
              : 'Could not write the MIDI file on this device — please try again.',
        });
      } finally {
        setExportingId(null);
      }
    },
    [exportingId],
  );

  /**
   * The History streak card's tap (v22). This is the SAME card Home shows (same
   * copy, same styling) and Home's is wired, so this one must go somewhere real
   * too — it used to be a plain View with no onPress at all. The destination
   * comes from the tested mapping in services/homeCards.ts, so the CTA text on
   * the card and the screen it opens can never disagree:
   *   • 0 days → the History search box (start with what you played)
   *   • a live streak → the practice-week view, rendered in place
   */
  const focusHistorySearch = useCallback(() => {
    // The box is in the list header, so it exists only once the FlatList is the
    // rendered body again — focus after this render, never before it.
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const handleStreakCardTap = useCallback(() => {
    if (historyStreakDestination(streak.currentDays) === 'week') {
      setShowPracticeWeek(true);
      return;
    }
    focusHistorySearch();
  }, [streak.currentDays, focusHistorySearch]);

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
    // The row body and the row's purchase action lead to different surfaces, so a
    // pending shell is closed before the piece page takes over (one surface, one
    // purchase action at a time).
    setPurchaseWebUrl(null);
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

  /**
   * A row's tap. A PERSONAL MELODY re-opens in the capture window (it is the
   * user's own take, and there is no catalog piece behind it); every other row
   * keeps today's behaviour and opens the piece page.
   */
  const handleRowTap = useCallback(
    (piece: SavedPiece) => {
      if (personalMelodyFromRow(piece)) {
        setOpenMelody(piece);
        return;
      }
      handleOpenPiece(piece);
    },
    [handleOpenPiece],
  );

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

  /**
   * What the list shows: the saved recognitions, narrowed by the search box.
   * `filterSavedPieces` is pure and in-memory (services/historyPiece.ts) — an
   * empty query returns the full list, and it can never reach the network or the
   * catalog, so a History search can only ever surface rows the user saved.
   */
  const filteredItems = useMemo(
    () => filterSavedPieces(items, query),
    [items, query],
  );

  const renderItem = ({ item }: { item: SavedPiece }) => {
    /**
     * The row's ONE purchase action (bundle C / D7, owner 10-02): the licensed
     * retailer link the modern recognition was SAVED with, resolved through the
     * money path's `primaryPurchaseUrl()` (primary retailer first). Undefined for
     * a public-domain / hum / find-a-piece save — those never carry a purchase map
     * (`publicDomainSaveOmitsPurchaseUrls()` keeps it that way) — and an undefined
     * resolution renders NO action at all: never a disabled button, never a
     * placeholder card.
     */
    const rowPurchaseUrl = primaryPurchaseUrl(item.purchaseUrls);
    return (
      /* The whole card opens the piece page (fix: the row used to be inert).
         The ✕ keeps its own press — a nested Touchable wins the responder, so
         removing a piece never opens it. */
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => handleRowTap(item)}
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
          {/* The row's purchase action. Its own press (a nested Touchable wins
              the responder) opens the retailer INSIDE the app, over History. */}
          {rowPurchaseUrl ? (
            <TouchableOpacity
              style={styles.sheetBtn}
              onPress={() => {
                setPurchaseShellTitle(`${item.title} — official sheet music`);
                setPurchaseWebUrl(rowPurchaseUrl);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Get sheet music for ${item.title}`}
              accessibilityHint="Opens the licensed retailer page inside NoteSnap"
            >
              <Text style={styles.sheetBtnText}>🛒 Get sheet music</Text>
            </TouchableOpacity>
          ) : null}
          {/* A row saved from a hum/whistle/sing capture carries the user's OWN
              take — so it can write it out as MIDI (Batch A). Rows without a
              capture get no button (nothing to export). The take's DETECTED KEY
              is rendered from that same take, exactly as detected: with no key
              there is no key line at all (never a placeholder, never a guess). */}
          {item.capture?.notes?.length ? (
            <>
              <Text style={styles.itemTakeLabel} numberOfLines={1}>
                {captureTakeLabel(item.capture)}
              </Text>
              {keyCaption(item.capture?.key) && (
                <Text style={styles.itemTakeKey} numberOfLines={1}>
                  {keyCaption(item.capture?.key)}
                </Text>
              )}
              <TouchableOpacity
                style={styles.midiBtn}
                onPress={() => handleExportTake(item)}
                disabled={exportingId === item.id}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${MIDI_EXPORT_LABEL} for ${item.title}`}
              >
                <Text style={styles.midiBtnText}>
                  {exportingId === item.id ? MIDI_EXPORT_BUSY_LABEL : MIDI_EXPORT_LABEL}
                </Text>
              </TouchableOpacity>
              {exportNote?.id === item.id && (
                <Text style={styles.midiNote}>{exportNote.text}</Text>
              )}
            </>
          ) : null}
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
  };

  // Practice-week view for the streak card (v22). History has no featured piece
  // to practise, so BOTH of the week view's practice exits land on the SAME
  // surface History always offers — its own search over the saved recognitions
  // (owner 10-01: one History surface, one rule). They used to open the global
  // catalog search, which is a different question from "what did I just play".
  if (showPracticeWeek) {
    return (
      <PracticeWeekScreen
        onClose={() => setShowPracticeWeek(false)}
        featuredTitle={null}
        onPracticeToday={() => {
          setShowPracticeWeek(false);
          focusHistorySearch();
        }}
        onFindPiece={() => {
          setShowPracticeWeek(false);
          focusHistorySearch();
        }}
      />
    );
  }

  // Full-screen piece page for a tapped row — PieceDetailScreen is not a tab
  // route, so it is rendered in place exactly like Home / the hum flow do.
  if (showDetail) {
    return <PieceDetailScreen piece={showDetail} onBack={handleCloseDetail} />;
  }

  // A tapped PERSONAL MELODY re-opens the capture window on that take, in place,
  // exactly like the piece page above. `reopen` is what makes it a replay instead
  // of a recording: no mic, no library pass, and its own back path (onClose) out
  // of here. The window is not a route and not a modal, so this return IS the
  // History tab's body while it is open — BACK lands back in this list.
  if (openMelody) {
    return (
      <HumSearchScreen
        reopen={openMelody}
        onClose={() => setOpenMelody(null)}
      />
    );
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
      {/* Streak header card — TAPPABLE (v22). It carried Home's exact copy and
          styling but was a plain View: the dead card the owner reported. It now
          reuses Home's tested mapping and affordance — same destination rule,
          same CTA line, same accessibility label. */}
      <TouchableOpacity
        style={styles.streakCard}
        onPress={handleStreakCardTap}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={streakAccessibilityLabel(streak.currentDays, null)}
      >
        <View style={styles.streakRow}>
          <Text style={styles.streakEmoji}>🔥</Text>
          <View style={styles.streakInfo}>
            <Text style={styles.streakCount}>{streakText}</Text>
            <Text style={styles.streakBest}>{streakBest}</Text>
          </View>
        </View>
        {/* Where the tap goes — the same cardCta treatment Home's card uses. */}
        <Text style={styles.streakCta}>{streakCta(streak.currentDays, null)}</Text>
      </TouchableOpacity>

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* Search the SAVED RECOGNITIONS (owner 10-01): in-memory over `items`
                — no network, no catalog, nothing the user never recognized. */}
            <View style={styles.searchRow}>
              <Text style={styles.searchEmoji}>🔎</Text>
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search saved by title or composer"
                placeholderTextColor="#707090"
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                accessibilityLabel="Search your saved recognitions by title or composer"
              />
              {query.length > 0 ? (
                <TouchableOpacity
                  style={styles.searchClear}
                  onPress={() => setQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear the saved-recognition search"
                  hitSlop={8}
                >
                  <Text style={styles.searchClearText}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {items.length > 0 ? (
              <Text style={styles.listHeader}>
                Saved recognitions ({items.length}) · tap a piece to open it
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          items.length > 0 ? (
            /* A query that matches nothing: the honest empty state for THIS
               search — never a suggestion to go search the wider catalog. */
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🔍</Text>
              <Text style={styles.emptyTitle}>
                No saved recognitions match
              </Text>
              <Text style={styles.emptyText}>
                Nothing in your saved recognitions matches “{query.trim()}”. Try
                another title or composer — this box searches only what you have
                recognized.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🔍</Text>
              <Text style={styles.emptyTitle}>No recognitions yet</Text>
              <Text style={styles.emptyText}>
                Tap the mic on the Discover tab to identify a song — every match
                is saved here.
              </Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#e94560"
          />
        }
      />

      {/* History's ONE in-app retailer shell (bundle C, owner 10-02). Mounted at
          the screen's root and opened by a saved MODERN row's action: the shell's
          "← Back to NoteSnap" header and hardware BACK both return the user to
          History — the surface they tapped from — and nothing here ever leaves
          the app (purchaseCta.noPurchaseActionLeavesTheApp). */}
      {purchaseWebUrl && (
        <PurchaseWebView
          url={purchaseWebUrl}
          title={purchaseShellTitle}
          onClose={() => setPurchaseWebUrl(null)}
        />
      )}
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

  // Streak header — a column card: the 🔥 row, then the CTA line saying where
  // the tap goes (same shape as Home's streak card).
  streakCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  streakCta: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '700',
    color: '#e94560',
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

  // The History search box (saved recognitions only, owner 10-01).
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  searchEmoji: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13,
    paddingVertical: 10,
  },
  searchClear: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  searchClearText: {
    color: '#a0a0b8',
    fontSize: 14,
    fontWeight: '700',
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
  /** The captured take line on a row that came from a hum/whistle/sing capture. */
  itemTakeLabel: {
    fontSize: 12,
    color: '#4ecdc4',
    marginTop: 6,
  },
  /** The take's detected key ("Key: G major") — rendered only when the take
   *  really had one, so the row never claims a key it cannot support. */
  itemTakeKey: {
    fontSize: 12,
    color: '#a0a0b8',
    marginTop: 2,
  },
  /** The row's purchase action (bundle C, owner 10-02) — the same "buy" weight the
   *  piece page's card carries, quieter than the row title. Rendered only when the
   *  row's saved purchase map resolves to a licensed retailer URL. */
  sheetBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f3460',
    borderColor: '#e94560',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  sheetBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  /** The row's MIDI export action (v29 Batch A) — teal outline, like the app's
   *  other "extra capability" actions. It presses independently of the card. */
  midiBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f3460',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  midiBtnText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '700',
  },
  midiNote: {
    fontSize: 12,
    color: '#a0a0b8',
    lineHeight: 17,
    marginTop: 6,
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
