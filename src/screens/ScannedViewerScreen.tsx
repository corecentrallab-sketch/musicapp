import { useThemedStyles } from '../services/themeStore';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import { ScanFindSection } from '../components/ScanFindSection';
import { FindPieceScreen } from './FindPieceScreen';
// THE FULL-SCREEN SCAN (v43 fix batch, slice 3, item E12). A photographed page is
// the surface where full screen helps most: the same page images, contain-fit,
// starting at the page the user is already on — and no OMR/score-following claim
// is made by any of it.
import { FullScreenScore } from '../components/FullScreenScore';
import { ExpandScoreButton } from '../components/ExpandScoreButton';

type Props = NativeStackScreenProps<RootStackParamList, 'ScannedViewer'>;

/**
 * THE LINE THAT REPLACED THE DEAD CONTROLS (v42 fix C). Exported so the gate
 * asserts the words the user actually reads, and so the reason can never be
 * deleted while the controls stay away.
 */
export const SCANNED_NO_AUTOSCROLL_LINE =
  'Swipe to turn pages. Auto-scroll needs a score the app can read — this page is a photo.';

/**
 * Simple paged viewer for scanned scores (a group of page images).
 * Swipe between pages; the page counter tracks the current one.
 *
 * NO AUTO-SCROLL ON THIS SURFACE (v42 fix C — owner, v41 device pass 10-20: "the
 * Play button does nothing and the BPM Autoscroll control does not work off the
 * scanned score").
 *
 * THE HONEST-SCOPE RULE (business plan, 09-28: the app must never pretend). A
 * scanned score is a PHOTO. The app reads printed WORDS off it on device (see
 * ScanFindSection) but it does NOT read notes — there is no OMR, no score
 * following, and no audio for a raw page image. BPM auto-scroll is a
 * score-FOLLOWING control: it exists to advance a page when the music reaches the
 * end of it. Off a photo it can only turn pages on a timer that is blind to the
 * music, which is exactly why it read as broken to the owner, and a Play button
 * that turns nothing (a single-page scan, a timer the user cannot hear) reads as a
 * dead control.
 *
 * SO IT IS GONE FROM HERE, not disabled: a greyed-out control on a page that can
 * never honestly use it is still a promise. The page swipe and the page counter
 * stay, and the line below says why there is nothing to start. The PDF reader
 * (PdfViewerScreen) KEEPS the same control: its pages are real pages of a
 * document the app lays out itself, and the page-turn presets were built for it —
 * this is a per-surface decision, not the feature's removal.
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
  // The full-screen scan (v43 slice 3, item E12). It opens ON the page the user is
  // looking at, so expanding never loses their place.
  const [expandOpen, setExpandOpen] = useState(false);

  const pages = item?.pageUris ?? [];
  const listRef = useRef<FlatList<string>>(null);

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

        {/* THE EXPANDER (v43 slice 3, item E12) — the shared affordance, floating
            over the page so it is reachable without leaving the score. */}
        <View style={styles.expandDock}>
          <ExpandScoreButton onPress={() => setExpandOpen(true)} testID="scan-expand" />
        </View>
      </View>

      {/* THE FULL-SCREEN SCAN (v43 slice 3, item E12). The SAME page images, in
          the app's one full-screen window, contain-fit and paged — opened at the
          page the user is already reading. */}
      <FullScreenScore
        visible={expandOpen}
        onClose={() => setExpandOpen(false)}
        title={item?.title ?? 'Scanned score'}
        subtitle={`Page ${page} of ${pages.length}`}
      >
        <FlatList
          data={pages}
          keyExtractor={(uri, index) => `full-${index}-${uri}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(page, pages.length) - 1}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          renderItem={({ item: uri }) => (
            <View style={[styles.fullPage, { width }]}>
              <Image source={{ uri }} style={styles.pageImage} resizeMode="contain" />
            </View>
          )}
        />
      </FullScreenScore>

      {/* WHY THERE IS NO PLAY/AUTO-SCROLL HERE (v42 fix C). Said out loud rather
          than left as an absence: the user who looks for it gets the reason, and
          the swipe hint that does work. See this screen's header comment for the
          honest-scope decision (no OMR, no score following, no audio). */}
      <View style={styles.autoScrollNoteRow}>
        <Ionicons name="hand-left-outline" size={14} color={theme.subtext} />
        <Text style={styles.autoScrollNote}>{SCANNED_NO_AUTOSCROLL_LINE}</Text>
      </View>

      {/* THE SAVED SCAN'S WAY INTO THE MONEY PATH (v39 fix 1b, owner 10-11). The
          page on screen is read on device for its printed WORDS — not the notes —
          and the confirmed words open the app's ONE search in place, which is where
          the licensed retailers already are. One surface for a typed title and a
          scanned one, and no retailer URL is built here. It scrolls so the score
          above it keeps its room.

          v44 #59 — THIS IS THE PAGE-OF-MUSIC DOOR (`photoKind="page"`). Every page
          in this viewer is a page of a scanned SCORE, so a page of music is exactly
          what the recogniser is looking at: the owner's Bohemian Rhapsody page came
          back as the debris "Auio - Metal" in the "Search for…" box. With the page
          kind set, the shared model offers an uncorroborated read NO query at all
          and shows the honest page-of-music line instead; a read that actually
          answers a piece still offers its suggestions, and the typed title and the
          page swipe remain the ways forward. */}
      <ScrollView style={styles.findBar} contentContainerStyle={styles.findBody}>
        <ScanFindSection
          pageUri={pages[Math.min(page, pages.length) - 1] ?? pages[0] ?? null}
          photoKind="page"
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
  /** The floating expander (v43 slice 3, item E12). */
  expandDock: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  /** One page inside the full-screen window (v43 slice 3, item E12). */
  fullPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  autoScrollNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  autoScrollNote: {
    flex: 1,
    color: '#a0a0b8',
    fontSize: 11,
    lineHeight: 15,
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
