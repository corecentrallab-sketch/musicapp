import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import type { LibraryItem } from '../types';
import { getLibraryItem } from '../services/libraryStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ScannedViewer'>;

/**
 * Simple paged viewer for scanned scores (a group of page images).
 * Swipe between pages; the page counter tracks the current one.
 */
export const ScannedViewerScreen: React.FC<Props> = ({ route, navigation }) => {
  const { itemId } = route.params;
  const { width } = useWindowDimensions();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

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

  const pages = item?.pageUris ?? [];

  if (pages.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>This scanned score has no pages.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
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
