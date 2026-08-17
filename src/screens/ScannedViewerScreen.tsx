import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
import { AutoScrollControl } from '../components/AutoScrollControl';

type Props = NativeStackScreenProps<RootStackParamList, 'ScannedViewer'>;

/**
 * Simple paged viewer for scanned scores (a group of page images).
 * Swipe between pages; the page counter tracks the current one.
 * FEATURE BUILD 2 adds BPM-linked auto-scroll: a toolbar control (BPM +
 * beats/page steppers) and pause-on-tap while auto-scrolling.
 */
export const ScannedViewerScreen: React.FC<Props> = ({ route, navigation }) => {
  const { itemId } = route.params;
  const { width } = useWindowDimensions();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e94560" />
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

      {/* Auto-scroll control (FEATURE BUILD 2) */}
      <AutoScrollControl autoScroll={autoScroll} disabled={pages.length < 2} />

      <View style={styles.footer}>
        <Text style={styles.pageLabel}>
          Page {page} of {pages.length}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
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
  pageLabel: {
    color: '#a0a0b8',
    fontSize: 14,
    fontWeight: '600',
  },
});
