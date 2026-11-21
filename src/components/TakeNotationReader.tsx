/**
 * TakeNotationReader — THE TAKE'S NOTATION, FULL SCREEN (vc61 spec, part 3).
 *
 * THE OWNER (11-17), verbatim: *"I am unable to read the score as the print is so compressed.
 * There needs to be a full screen option to be able to read notation. This really needs a
 * fix."* The take's staff is a card on a page that also carries a video, a trim editor, chords
 * and buttons; at card width one line of music is about four bars of very small print. This
 * is the card, full bleed, with the size under the user's control.
 *
 * WHAT IT DOES NOT DO. It does not re-read, re-clean, re-time or save anything: it is handed
 * the SAME ABC the card draws (`TakeStaffCard` → `takeStaffRows`), so opening it cannot
 * change what the user is looking at, and closing it returns to the take unchanged. There is
 * no rehearsal bar, no synth and no share sheet here — those are the later slice in
 * VC61-FULLSCREEN-READER.md, which stays backlog.
 *
 * HOW THE SIZE WORKS. ABCjs lays the music out to the width of the box it is given, so a
 * NARROWER box means fewer bars to the line and the same music drawn larger. Zoom therefore
 * renders the score into a narrower container and scales that container back up to the screen
 * — real, adjustable enlargement with no new dependency and no gesture library (see
 * services/takeNotationReader.ts for the measurement this was chosen from).
 *
 * ANDROID BACK. The modal carries `onRequestClose`, so BACK closes the reader ALONE and
 * leaves the take underneath exactly as it was (`services/modalBackContract.ts` source-scans
 * every `<Modal>` in src/ and fails the gate without it).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemedStyles } from '../services/themeStore';
import { AbcScoreView } from './AbcScoreView';
import {
  TAKE_STAFF_CLEANED_INK,
  TAKE_STAFF_PAPER,
} from '../services/takeStaffPalette';
import {
  NOTATION_READER_CLOSE_LABEL,
  NOTATION_READER_EMPTY_LINE,
  NOTATION_READER_HINT,
  NOTATION_READER_TITLE,
  NOTATION_ZOOM_IN_LABEL,
  NOTATION_ZOOM_OUT_LABEL,
  NOTATION_ZOOM_RESET_LABEL,
  clampNotationZoom,
  notationReaderLengthLine,
  notationRenderWidth,
  notationZoomLabel,
  rememberReaderPosition,
  rememberedReaderPosition,
  stepNotationZoom,
} from '../services/takeNotationReader';

export interface TakeNotationReaderProps {
  /** Whether the reader is open. The surface owns this. */
  visible: boolean;
  /** Close it. Called by the ✕ and by Android BACK. */
  onClose: () => void;
  /** The take's own ABC — the SAME string the card draws. */
  abc: string | null | undefined;
  /** The take's title, for the header. */
  title?: string | null;
  /** The key this take's position is remembered under (services/takeNotationReader). */
  positionKey: string;
}

export const TakeNotationReader: React.FC<TakeNotationReaderProps> = ({
  visible,
  onClose,
  abc,
  title,
  positionKey,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  /** The score document's own height at the CURRENT zoom (reported by the viewer). */
  const [documentHeight, setDocumentHeight] = useState(0);
  /** The scroll offset to restore once the content has been laid out. */
  const pendingScrollRef = useRef<number | null>(null);
  const scrollYRef = useRef(0);

  const lengthLine = notationReaderLengthLine(abc ?? '');
  const hasScore = !!lengthLine && typeof abc === 'string' && abc.length > 0;
  const renderWidth = notationRenderWidth(bodyWidth || 320, zoom);
  const contentHeight =
    documentHeight > 0 ? Math.round(documentHeight * zoom) : undefined;

  /**
   * OPENING: the position this take was left at, and the scroll to put back once the score
   * has laid out (the content does not exist yet on the first frame, so the restore waits for
   * `onContentSizeChange` rather than guessing a delay).
   */
  useEffect(() => {
    if (!visible) return;
    const saved = rememberedReaderPosition(positionKey);
    setZoom(saved.zoom);
    setDocumentHeight(0);
    scrollYRef.current = saved.scrollY;
    pendingScrollRef.current = saved.scrollY > 0 ? saved.scrollY : null;
  }, [visible, positionKey]);

  const remember = useCallback(
    (nextZoom: number, scrollY: number) => {
      rememberReaderPosition(positionKey, { zoom: nextZoom, scrollY });
    },
    [positionKey],
  );

  const handleClose = useCallback(() => {
    remember(zoom, scrollYRef.current);
    onClose();
  }, [onClose, remember, zoom]);

  const changeZoom = useCallback(
    (next: number) => {
      const bounded = clampNotationZoom(next);
      setZoom(bounded);
      remember(bounded, scrollYRef.current);
    },
    [remember],
  );

  const restoreScroll = useCallback(() => {
    const pending = pendingScrollRef.current;
    if (pending === null) return;
    pendingScrollRef.current = null;
    scrollRef.current?.scrollTo({ y: pending, animated: false });
  }, []);

  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      statusBarTranslucent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {title ?? NOTATION_READER_TITLE}
            </Text>
            {/* THE LENGTH LINE, ALWAYS ON SCREEN — "Bars 1–12 of 12", from the take's own
                ABC (services/scoreLength.ts). A genuinely short take and a clipped render
                read the same without it. */}
            {lengthLine ? (
              <Text style={styles.lengthLine} testID="notation-reader-length">
                {lengthLine}
              </Text>
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={NOTATION_READER_CLOSE_LABEL}
            testID="notation-reader-close"
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color={theme.text} />
          </Pressable>
        </View>

        {/* THE ZOOM ROW: two controls and a fit, each a 44pt target. */}
        <View style={styles.zoomRow}>
          <Pressable
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.zoomBtnPressed]}
            onPress={() => changeZoom(stepNotationZoom(zoom, -1))}
            accessibilityRole="button"
            accessibilityLabel={NOTATION_ZOOM_OUT_LABEL}
            testID="notation-reader-smaller"
          >
            <Text style={styles.zoomBtnText}>{NOTATION_ZOOM_OUT_LABEL}</Text>
          </Pressable>
          <Text style={styles.zoomLabel} testID="notation-reader-zoom">
            {notationZoomLabel(zoom)}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.zoomBtnPressed]}
            onPress={() => changeZoom(stepNotationZoom(zoom, 1))}
            accessibilityRole="button"
            accessibilityLabel={NOTATION_ZOOM_IN_LABEL}
            testID="notation-reader-bigger"
          >
            <Text style={styles.zoomBtnText}>{NOTATION_ZOOM_IN_LABEL}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.zoomBtnPressed]}
            onPress={() => changeZoom(1)}
            accessibilityRole="button"
            accessibilityLabel={NOTATION_ZOOM_RESET_LABEL}
            testID="notation-reader-fit"
          >
            <Text style={styles.zoomBtnText}>{NOTATION_ZOOM_RESET_LABEL}</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>{NOTATION_READER_HINT}</Text>

        <View
          style={styles.body}
          onLayout={(event) => {
            const width = Math.round(event.nativeEvent.layout.width);
            if (width > 0 && width !== bodyWidth) setBodyWidth(width);
          }}
        >
          {!hasScore ? (
            <Text style={styles.emptyLine}>{NOTATION_READER_EMPTY_LINE}</Text>
          ) : (
            <ScrollView
              ref={scrollRef}
              style={styles.scroller}
              contentContainerStyle={styles.scrollerContent}
              scrollEventThrottle={32}
              onScroll={(event) => {
                scrollYRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
              }}
              onScrollEndDrag={() => remember(zoom, scrollYRef.current)}
              onMomentumScrollEnd={() => remember(zoom, scrollYRef.current)}
              onContentSizeChange={restoreScroll}
            >
              {/* The box that reserves the SCALED height, so the scroll view scrolls the
                  enlarged score rather than the un-scaled layout box. */}
              <View style={[styles.scaledBox, { width: bodyWidth || 320, height: contentHeight }]}>
                <View
                  style={{
                    width: renderWidth,
                    transform: [{ scale: zoom }],
                    transformOrigin: 'top left',
                  }}
                >
                  <AbcScoreView
                    // A NEW DOCUMENT PER ZOOM LEVEL: ABCjs lays the music out to the width
                    // it is given at render time, so the viewer must re-render at the new
                    // width rather than be resized after the fact.
                    key={`reader-${zoom}`}
                    abc={abc ?? ''}
                    ink={TAKE_STAFF_CLEANED_INK}
                    background={TAKE_STAFF_PAPER}
                    interactive={false}
                    // D40: FIT MEANS FIT-TO-WIDTH WITH WRAPPING. This reader used to
                    // draw the CARD document, which abcjs lays out at its 740 px
                    // default and CSS then shrinks into the box — so "Fit" on a long
                    // take meant one microscopic line, and Bigger only shrank the box
                    // further. The wrapped document lays the music out at the width it
                    // has and continues onto the next system: Fit now fills the width
                    // and the systems stack down the page, and Bigger gives fewer bars
                    // per system with bigger marks.
                    wrapSystems
                    onDocumentHeight={(height) => {
                      if (height > 0) setDocumentHeight(height);
                    }}
                  />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const baseStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#12122b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  headerText: { flex: 1, paddingRight: 12 },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  lengthLine: { color: '#cfe4ff', fontSize: 12, fontWeight: '700', marginTop: 4 },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  closeButtonPressed: { backgroundColor: '#16213e' },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  zoomBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#16213e',
  },
  zoomBtnPressed: { opacity: 0.7 },
  zoomBtnText: { color: '#4ecdc4', fontSize: 13, fontWeight: '800' },
  zoomLabel: { color: '#cfe4ff', fontSize: 12, fontWeight: '700', marginHorizontal: 4 },
  hint: { color: '#9aa0b5', fontSize: 11, lineHeight: 16, paddingHorizontal: 16, marginTop: 6 },
  body: { flex: 1, marginTop: 8 },
  scroller: { flex: 1 },
  scrollerContent: { paddingHorizontal: 8, paddingBottom: 24 },
  scaledBox: { overflow: 'hidden' },
  emptyLine: { color: '#9aa0b5', fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
});
