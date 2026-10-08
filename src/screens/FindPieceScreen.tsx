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
 * THE SEARCH BOX NOW RESOLVES TO A MONEY PATH (owner direction 10-01): "the front
 * page search box should show results for everything in both internal results of
 * search and external affiliate results for search from notesnap". So while a
 * non-empty query is active the screen shows TWO result sets:
 *   • our own public-domain / classical catalog (the free, in-app offer), and
 *   • an "Official sheet music" section — the licensed retailers, deep-linked
 *     with the query the user typed (Sheet Music Direct with the affiliate id,
 *     plus the UX-only Musicnotes CTA), opened in the shared in-app browser shell
 *     on an explicit tap only.
 * The section is gated on the QUERY, never on our own results: a song our library
 * does not hold at all ("Fields of Gold") is exactly the case the money path
 * exists for, so the zero-match state points straight at it instead of stopping
 * at "no match" (plan 09-28: "any search in NoteSnap should not be a dead end").
 *
 * Behaviour:
 *   • empty query → the catalog's own first page (the browse state), no external
 *     section (nothing to search for);
 *   • ~300 ms debounce per settled query, newest response wins (a slow request
 *     for "fur" can never overwrite the results for "für elise");
 *   • no match  → "No pieces match — try another title or composer" PLUS the
 *     retailer section with the honest "not in our free library" hint — but only
 *     after the TYPO LADDER has been tried (v33 §F3): the user's own words first,
 *     then the model's variants of them, re-run through this same catalog search;
 *     when a variant is what matched, `retryNoticeLine` says so above the list and
 *     the honesty of the empty state is preserved when nothing matched;
 *   • failure   → honest error with a Retry button (never an empty list);
 *   • sheet badge → "🎼 Sheet music" only when the catalog really has a
 *     curated score, otherwise "Coming soon" (no invented links);
 *   • tapping a row opens PieceDetailScreen in place, exactly like History and
 *     the hum flow do, and best-effort fills in the catalog's coach data;
 *   • tapping a retailer card opens that retailer's OWN search page (previews +
 *     checkout live there) inside our app shell — we host and cache nothing.
 *
 * The logic (parsing, sorting, URL building, row → detail mapping, and the
 * external-section decision) lives in services/catalogSearch.ts and
 * services/searchExternal.ts and is unit-tested; this screen is a thin caller.
 * The wiring itself is guarded by services/searchExternalContract.ts.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
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
// Typo tolerance (v33 §F3, owner 10-04: "Toccata & Fugue does not surface, even
// when typed as a common misspelling like 'toccatta and fugue'"). The ladder and
// the honest notice come from the model — this screen may not invent either.
import { queryVariants, rankFuzzyMatches, retryNoticeLine } from '../services/fuzzySearch';
import {
  EXTERNAL_NO_MATCH_HINT,
  externalSearchSection,
} from '../services/searchExternal';
import { SearchExternalSection } from '../components/SearchExternalSection';
// v33 §H (owner 10-04): "Scan a cover" — photograph a score's title page and
// land on THIS screen's own search. The label and the honest no-OCR state come
// from the model (services/coverScan.ts); this screen never invents either.
import { CoverScanModal } from '../components/CoverScanModal';
import { coverScanAffordanceLabel } from '../services/coverScan';
import { PurchaseWebView } from '../components/PurchaseWebView';
import { mergeCatalogIntoDetail } from '../services/historyPiece';
import { PieceDetailScreen } from './PieceDetailScreen';
import { useHardwareBack } from '../hooks/useHardwareBack';
import type { CatalogPiece, DailyChallengePiece } from '../types';

type Status = 'loading' | 'ready' | 'empty' | 'error';

interface FindPieceScreenProps {
  onClose: () => void;
}

export const FindPieceScreen: React.FC<FindPieceScreenProps> = ({ onClose }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [query, setQuery] = useState('');
  const [pieces, setPieces] = useState<CatalogPiece[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  // The honest "which query actually found these" line (v33 §F3). Set ONLY when
  // the user's own words found nothing and a variant of them did — never on a
  // first-try hit, where there is nothing to explain.
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  // Bumped by the Retry button to re-run the current query.
  const [reloadToken, setReloadToken] = useState(0);
  // Full-screen piece page for a tapped row (rendered in place, like History).
  const [showDetail, setShowDetail] = useState<DailyChallengePiece | null>(null);
  // The licensed retailer the user tapped (opened in the in-app shell). Never
  // set by anything but a tap — no auto-redirect (owner 08-24).
  const [retailerUrl, setRetailerUrl] = useState<string | null>(null);
  // v33 §H: the cover-photo flow (camera → confirm → THIS screen's search). It is
  // opened only by the affordance's own tap, and it adds no second search: the
  // confirmed text is written into `query`, the field the user types into.
  const [showCoverScan, setShowCoverScan] = useState(false);
  // Guards against a stale response replacing newer results.
  const searchRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  // Debounced catalog search: one request per settled query.
  useEffect(() => {
    const trimmed = normalizeQuery(query);
    const typed = trimmed;
    const token = ++searchRequestRef.current;
    setStatus('loading');

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await searchPieces(trimmed);
          if (token !== searchRequestRef.current) return;
          const sorted = sortPiecesForDisplay(res.pieces);

          // ── The typo ladder (v33 §F3) ──
          // The user's own words are always tried FIRST (above). Only when they
          // find nothing does the screen re-run the SAME catalog search with the
          // model's variants, in the model's order, and rank what comes back. The
          // winner is what the user sees, and the notice names the query that
          // actually matched — no silent substitution, no invented results.
          if (sorted.length === 0 && typed.length > 0) {
            for (const variant of queryVariants(typed)) {
              if (variant === typed) continue;
              const retry = await searchPieces(variant);
              if (token !== searchRequestRef.current) return;
              const ranked = rankFuzzyMatches(variant, sortPiecesForDisplay(retry.pieces));
              if (ranked.length > 0) {
                const matched = ranked.map((entry) => entry.item);
                setPieces(matched);
                setTotal(matched.length);
                setRetryNotice(retryNoticeLine(typed, variant));
                setStatus('ready');
                return;
              }
            }
            // Every variant came up empty too: the honest empty state stands, with
            // the retailers below it (the no-dead-end rule from 09-28).
            setPieces([]);
            setTotal(0);
            setRetryNotice(null);
            setStatus('empty');
            return;
          }

          setPieces(sorted);
          setTotal(res.total);
          setRetryNotice(null);
          setStatus(sorted.length === 0 ? 'empty' : 'ready');
        } catch {
          if (token !== searchRequestRef.current) return;
          setPieces([]);
          setTotal(0);
          setRetryNotice(null);
          setStatus('error');
        }
      })();
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

  /**
   * Open a retailer card in the in-app browser shell. Tap-driven only: this is
   * the ONLY writer of `retailerUrl`, so no code path can redirect the user to a
   * store on its own (the owner's 08-24 no-auto-redirect rule).
   */
  const handleOpenRetailer = useCallback((url: string) => {
    setRetailerUrl(url);
  }, []);

  const handleCloseRetailer = useCallback(() => {
    setRetailerUrl(null);
  }, []);

  /**
   * v33 §H — "Scan a cover". The affordance opens the camera surface; the photo
   * itself never becomes a query. The user confirms the text in the modal's own
   * field (EMPTY in this build: there is no on-device reader, and a prefilled
   * guess would be a fabricated read), and what they confirm comes back through
   * `handleCoverQuery` — the same entry point as typing.
   */
  const handleScanCover = useCallback(() => {
    setShowCoverScan(true);
  }, []);

  const handleCloseCoverScan = useCallback(() => {
    setShowCoverScan(false);
  }, []);

  const handleCoverQuery = useCallback((text: string) => {
    setShowCoverScan(false);
    // The ONE search entry point: the debounced effect above, unchanged. A
    // scanned title therefore produces exactly the results a typed one does
    // (internal catalog + the official sheet music money path).
    setQuery(text);
  }, []);

  /**
   * The external half of the results — a licensed-retailer search for whatever
   * the user typed. SIMPLE dependency on the query (and the internal match count,
   * which only changes the honest subtitle): no request, no debounce, nothing
   * that can fail, so it is present even when our own catalog timed out or
   * matched nothing. Empty query → `visible: false` → the section renders nothing.
   */
  const external = externalSearchSection(query, pieces.length);

  // The affordance's own label (v33 §H). It names what the user does — photograph
  // a cover — and, while this build has no on-device reader, it does not claim
  // the photo will be read for them.
  const coverScanLabel = coverScanAffordanceLabel();

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
    if (showCoverScan) {
      handleCloseCoverScan();
      return true;
    }
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
          placeholderTextColor={theme.subtext}
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

      {/* v33 §H: the camera affordance sits with the search field it feeds —
          one small row, no new screen. Its label comes from coverScan.ts, so the
          copy and the honest "no reader in this build" state stay in one place.
          Zero-promise: it promises a search, never that we read the photo. */}
      <TouchableOpacity
        style={styles.coverScanRow}
        onPress={handleScanCover}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={coverScanLabel}
      >
        <Text style={styles.coverScanText}>{coverScanLabel}</Text>
      </TouchableOpacity>

      <Text style={styles.subtitle}>
        Free public-domain and classical pieces — search, then open the score.
      </Text>

      {/* What actually matched (v33 §F3): shown only when the user's own words
          found nothing and a variant of them did. It sits above the results so
          the list can never look like a first-try hit for a typo'd query. */}
      {retryNotice ? (
        <Text style={styles.retryNotice}>{retryNotice}</Text>
      ) : null}

      {status === 'loading' && pieces.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
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
          {/* The no-dead-end line (owner 10-01): a song our free library does not
              hold still has a money path, and it is right below this text. */}
          {external.visible ? (
            <Text style={styles.emptyText}>{EXTERNAL_NO_MATCH_HINT}</Text>
          ) : null}
        </View>
      ) : null}

      {status === 'ready' ? (
        <FlatList
          style={styles.resultsList}
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

      {/* ── EXTERNAL RESULTS — the licensed retailers (owner direction 10-01) ──
          Rendered whenever the QUERY is non-empty, deliberately OUTSIDE every
          internal-status branch. That placement is the whole no-dead-end rule:
          "Fields of Gold" matches nothing in our public-domain library, and that
          zero-match case is exactly the one this section exists for — so it must
          survive `empty`, and it stays available while our catalog is still
          loading or has failed outright. Tap-through only (each card opens the
          retailer in the shell below); we host and cache nothing. */}
      {external.visible ? (
        <ScrollView
          style={styles.externalWrap}
          contentContainerStyle={styles.externalContent}
          keyboardShouldPersistTaps="handled"
        >
          <SearchExternalSection section={external} onOpen={handleOpenRetailer} />
        </ScrollView>
      ) : null}

      {/* The retailer's own search page (previews + checkout), in the shared
          in-app shell: Modal root, BACK / "← Back to NoteSnap" return HERE, and
          it only ever opens from a tap. */}
      {/* The camera surface (v33 §H): capture → confirm → the search above.
          Tap-driven only — it exists solely behind the affordance's onPress. */}
      <CoverScanModal
        visible={showCoverScan}
        onClose={handleCloseCoverScan}
        onConfirm={handleCoverQuery}
      />

      <PurchaseWebView
        url={retailerUrl}
        title={
          external.query
            ? `Official sheet music · ${external.query}`
            : 'Official sheet music'
        }
        onClose={handleCloseRetailer}
      />
    </View>
  );
};

const baseStyles = StyleSheet.create({
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

  // The "Scan a cover" affordance (v33 §H): a quiet row under the search field,
  // never a second primary action on this screen.
  coverScanRow: {
    alignSelf: 'flex-start',
    marginHorizontal: 20,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#16213e',
  },
  coverScanText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '600',
  },

  // The "what actually matched" line for a typo'd query (v33 §F3): quiet, above
  // the list, never a warning — it explains the results, it does not scold.
  retryNotice: {
    color: '#4ecdc4',
    fontSize: 13,
    lineHeight: 19,
    marginHorizontal: 20,
    marginTop: 10,
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
  resultsList: {
    flexGrow: 1,
    flexShrink: 1,
  },
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

  // External (licensed-retailer) results — the money path under our own list.
  // Bounded height + shrink so a long internal list or a short phone screen never
  // squeezes the cards out of reach; the section scrolls inside its own frame.
  externalWrap: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: 340,
  },
  externalContent: {
    paddingBottom: 20,
  },
});
