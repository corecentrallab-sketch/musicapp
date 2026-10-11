import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import type { LibraryItem } from '../types';
import { getLibraryItem } from '../services/libraryStore';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { usePageTurnSpeed } from '../hooks/usePageTurnSpeed';
import { AutoScrollControl } from '../components/AutoScrollControl';
import { ScanFindSection } from '../components/ScanFindSection';
import { FindPieceScreen } from './FindPieceScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'ScannedViewer'>;

/**
 * Simple paged viewer for scanned scores (a group of page images).
 * Swipe between pages; the page counter tracks the current one.
 * FEATURE BUILD 2 adds BPM-linked auto-scroll: a toolbar control (BPM +
 * beats/page steppers) and pause-on-tap while auto-scrolling.
 */
export const ScannedViewerScreen: React.FC<Props> = ({ route, navigation }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const { itemId } = route.params;
  const { width } = useWindowDimensions();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  // The confirmed words a page's on-device read produced (v39 fix 1b). Non-null =
  // the app's ONE search is open in place, on this score's own words.
  const [findQuery, setFindQuery] = useState<string | null>(null);

  const pages = item?.pageUris ?? [];
  const listRef = useRef<FlatList<string>>(null);
  const pageRef = useRef(page);

  // Auto-scroll (BPM-linked): the hook owns the timer; the page turner scrolls
  // the FlatList to the next page. scrollToOffset is deterministic because
  // every page is exactly `width` wide (horizontal paging).
  const autoScroll = useAutoScroll({
    currentPage: page,
    pageCount: pages.length,
    onTurnPage: useCallback(() => {
      // `page` is 1-based; the next page's 0-based index equals `page`.
      listRef.current?.scrollToOffset({ offset: pageRef.current * width, animated: true });
    }, [width]),
  });
  const {
    status: autoScrollStatus,
    toggle: toggleAutoScroll,
  } = autoScroll;

  // SPEED PROFILES + PER-PIECE MEMORY (owner 10-10, backlog 7f64272f) — the same
  // hook the PDF viewer uses, keyed on the scanned score's library item id, so
  // both readers remember a piece's speed identically.
  const speedProfiles = usePageTurnSpeed(itemId, autoScroll);

  // Keep the page ref fresh for the auto-scroll page turner.
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: item?.title ?? 'Scanned score',
    });
  }, [navigation, item]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await getLibraryItem(itemId);
      if (cancelled) return;
      setItem(found && found.kind === 'scanned' ? found : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // THE SEARCH, ON THIS SCAN'S OWN WORDS (v39 fix 1b): the same find-a-piece
  // surface a typed title opens, rendered in place so its back returns here. It
  // replaces this screen's body while it is open — no second search surface, and
  // the reader is exactly where the user left it when they come back.
  if (findQuery !== null) {
    return (
      <FindPieceScreen initialQuery={findQuery} onClose={() => setFindQuery(null)} />
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (pages.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>This scanned score has no pages.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.scoreArea}>
        <FlatList
          ref={listRef}
          data={pages}
          keyExtractor={(uri, index) => `${index}-${uri}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(
              e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width
            );
            setPage(next + 1);
          }}
          renderItem={({ item: uri }) => (
            <View style={[styles.page, { width }]}>
              {/* Image without resizeMode="cover" — contentMode fit is the
                  default when no resizeMode is passed, which preserves the
                  score's aspect ratio. */}
              <Image
                source={{ uri }}
                style={styles.pageImage}
                resizeMode="contain"
              />
            </View>
          )}
        />

        {/* Pause-on-tap: while auto-scroll is active, any tap toggles
            pause/resume. The overlay is absent when idle, so normal swipe
            page turning is completely untouched. */}
        {autoScrollStatus !== 'idle' && (
          <Pressable
            style={styles.tapOverlay}
            onPress={toggleAutoScroll}
            accessibilityRole="button"
            accessibilityLabel={
              autoScrollStatus === 'running'
                ? 'Pause auto-scroll'
                : 'Resume auto-scroll'
            }
          />
        )}
      </View>

      {/* Auto-scroll control (FEATURE BUILD 2 + owner 10-10 speed presets) */}
      <AutoScrollControl
        autoScroll={autoScroll}
        disabled={pages.length < 2}
        speedProfiles={speedProfiles}
      />

      {/* THE SAVED SCAN'S WAY INTO THE MONEY PATH (v39 fix 1b, owner 10-11). The
          page on screen is read on device for its printed WORDS — not the notes —
          and the confirmed words open the app's ONE search in place, which is where
          the licensed retailers already are. One surface for a typed title and a
          scanned one, and no retailer URL is built here. It scrolls so the score
          above it keeps its room. */}
      <ScrollView style={styles.findBar} contentContainerStyle={styles.findBody}>
        <ScanFindSection
          pageUri={pages[Math.min(page, pages.length) - 1] ?? pages[0] ?? null}
          onSearch={setFindQuery}
        />
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.pageLabel}>
          Page {page} of {pages.length}
        </Text>
      </View>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#10101c',
  },
  scoreArea: {
    flex: 1,
    position: 'relative',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10101c',
  },
  pageImage: {
    width: '100%',
    height: '100%',
  },
  tapOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10101c',
    padding: 24,
  },
  emptyText: {
    color: '#a0a0b8',
    fontSize: 16,
    textAlign: 'center',
  },
  footer: {
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  /** The scan's way into the search (v39 fix 1b) — bounded so the score keeps room. */
  findBar: {
    maxHeight: 300,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  findBody: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  pageLabel: {
    color: '#a0a0b8',
    fontSize: 14,
    fontWeight: '600',
  },
});
