import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Pdf from 'react-native-pdf';
import type { RootStackParamList } from '../types';
import {
  getLibraryItem,
  updateLibraryItem,
} from '../services/libraryStore';

type Props = NativeStackScreenProps<RootStackParamList, 'PdfViewer'>;

/**
 * Minimal PDF viewer (Phase 4a). Renders the imported PDF with swipe page
 * navigation (enablePaging), a page indicator, and prev/next + tap-to-turn
 * controls driven by the native setPage API. Full reader polish
 * (autoscroll, annotations) is a later phase.
 */
export const PdfViewerScreen: React.FC<Props> = ({ route, navigation }) => {
  const { itemId } = route.params;
  const pdfRef = useRef<React.ElementRef<typeof Pdf>>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [viewWidth, setViewWidth] = useState(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title || 'PDF',
    });
  }, [navigation, title]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const item = await getLibraryItem(itemId);
      if (cancelled) return;
      if (!item || item.kind !== 'pdf' || !item.fileUri) {
        setFailed(true);
        return;
      }
      setUri(item.fileUri);
      setTitle(item.title);
      setFailed(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const handleLoadComplete = useCallback(
    (numberOfPages: number) => {
      setPageCount(numberOfPages);
      if (numberOfPages > 0) {
        // Persist the page count for the library list.
        updateLibraryItem(itemId, { pageCount: numberOfPages }).catch(() => {});
      }
    },
    [itemId]
  );

  const handlePageChanged = useCallback(
    (currentPage: number) => setPage(currentPage),
    []
  );

  const handleError = useCallback(() => {
    setFailed(true);
    Alert.alert(
      'Could not open PDF',
      'The file could not be rendered. It is still saved in your library.'
    );
  }, []);

  const goToPage = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(target, pageCount || target));
      pdfRef.current?.setPage(clamped);
      setPage(clamped);
    },
    [pageCount]
  );

  /** Tap on left third → previous page, right two thirds → next. */
  const handleSingleTap = useCallback(
    (currentPage: number, x: number) => {
      if (pageCount === 0 || viewWidth === 0) return;
      const third = viewWidth / 3;
      if (x < third) {
        goToPage(currentPage - 1);
      } else {
        goToPage(currentPage + 1);
      }
    },
    [pageCount, viewWidth, goToPage]
  );

  if (failed) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#e94560" />
        <Text style={styles.errorText}>
          This PDF could not be opened.
        </Text>
        <Pressable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Back to library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      onLayout={(e) => setViewWidth(e.nativeEvent.layout.width)}
    >
      {uri ? (
        <Pdf
          ref={pdfRef}
          source={{ uri }}
          onLoadComplete={handleLoadComplete}
          onPageChanged={handlePageChanged}
          onError={handleError}
          onPageSingleTap={handleSingleTap}
          page={page}
          enablePaging
          fitPolicy={0}
          style={styles.pdf}
        />
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#e94560" />
        </View>
      )}

      {/* Page indicator + controls */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.footerButton, page <= 1 && styles.footerButtonDisabled]}
          onPress={() => goToPage(page - 1)}
          disabled={page <= 1}
          accessibilityLabel="Previous page"
        >
          <Ionicons name="chevron-up" size={20} color="#eaeaff" />
        </Pressable>
        <Text style={styles.pageLabel}>
          Page {pageCount > 0 ? page : '–'} of {pageCount > 0 ? pageCount : '–'}
        </Text>
        <Pressable
          style={[
            styles.footerButton,
            pageCount > 0 && page >= pageCount && styles.footerButtonDisabled,
          ]}
          onPress={() => goToPage(page + 1)}
          disabled={pageCount > 0 && page >= pageCount}
          accessibilityLabel="Next page"
        >
          <Ionicons name="chevron-down" size={20} color="#eaeaff" />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#10101c',
  },
  pdf: {
    flex: 1,
    backgroundColor: '#10101c',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10101c',
    gap: 16,
    padding: 24,
  },
  errorText: {
    color: '#a0a0b8',
    fontSize: 16,
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: '#e94560',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  footerButton: {
    width: 40,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  footerButtonDisabled: {
    opacity: 0.35,
  },
  pageLabel: {
    color: '#a0a0b8',
    fontSize: 14,
    fontWeight: '600',
  },
});
