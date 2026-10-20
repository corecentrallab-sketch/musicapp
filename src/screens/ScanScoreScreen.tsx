import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../types';
import {
  appendScanSessionPage,
  endScanSession,
  getOpenScanSession,
  removeScanSessionPage,
  startScanSession,
} from '../services/libraryStore';
import {
  SCAN_COVER_ONLY_HINT,
  SCAN_FIND_CTA,
  SCAN_SAVED_AS_YOU_GO_LINE,
  scanFinishCta,
  scanSessionResumedLine,
  scanSessionTitle,
} from '../services/scanFind';
import type { OcrTitleCandidate } from '../services/ocrTitleCandidates';
import {
  DEFAULT_SCAN_FLASH_MODE,
  SCAN_CHIP_TRANSLUCENT,
  SCAN_CONTROL_GAP,
  SCAN_EMPTY_HINT,
  SCAN_FILMSTRIP_HEIGHT,
  SCAN_FRAMING_HINT_MAX_HEIGHT,
  SCAN_PILL_RADIUS,
  SCAN_SHUTTER_SIZE,
  SCAN_SURFACE_TRANSLUCENT,
  SCAN_TOUCH_MIN,
  nextScanFlashMode,
  scanControlState,
  scanDockBottomInset,
  scanFindPanel,
  scanFindSheetMaxHeight,
  scanFlashControlLabel,
  scanFlashIcon,
  scanFlashShortLabel,
  scanFramingHintTop,
  scanPageCountLabel,
  scanTopChipInset,
} from '../services/scanViewport';
import { ScanFindSection } from '../components/ScanFindSection';
import { FindPieceScreen } from './FindPieceScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanScore'>;

interface CapturedPage {
  uri: string;
  size?: number;
}

/**
 * Camera capture flow for scanning a paper score into the library.
 * Take one photo per page, review the thumbnail strip, then finish.
 *
 * WHAT CHANGED IN v39 (fix 1a, owner 10-11: "after taking a photo the app
 * minimises itself back to the menu — the photo never persists and nothing
 * appears in Library camera scores"). The session used to live ONLY in this
 * component's React state: pages were held in memory and the score was written
 * once, when the user pressed Save. A capture that ended earlier than that — for
 * any reason — left nothing at all behind.
 *
 * Now the score is real from the FIRST page: each capture is copied into the
 * library's own directory and registered immediately (`startScanSession` for page
 * one, `appendScanSessionPage` for the rest), the row is marked open while the
 * scan runs, and this screen picks an unfinished scan back up on mount. The
 * strip is therefore a view of what is ALREADY on disk, and the two controls are
 * "Undo" (drop the page just taken) and "Done" (close the scan and return to the
 * Library). Nothing here needs the screen to survive in order to keep the pages.
 *
 * The money path (fix 1b) is the shared `ScanFindSection`: the page's printed
 * WORDS are read on device and handed to the app's ONE search — the same
 * find-a-piece surface a typed title opens, where the public-domain catalog and
 * the licensed retailers already are. No note reading, no edition claim, no second
 * search box, and no retailer URL is built here.
 *
 * WHAT CHANGED IN UX ROUND 2 STEP 1 (owner green-lit 10-18, owner item C). The
 * owner's on-device report: "the heavy bottom white bar STILL obscures the
 * camera/Done/Bin controls" — and their spec for the redesign: "Edge-to-Edge
 * Camera: let the camera view take up the entire screen. Floating Minimalist Bar:
 * replace the heavy bottom container with a semi-transparent floating pill hosting
 * only the essential controls: a crisp shutter button, a flash toggle, and a clear
 * Done / Finish action. Ensure no UI elements block or overlap critical controls."
 *
 * THIS IS A RELAYOUT AND NOTHING ELSE. The column of camera + strip + help panel +
 * control row is gone; in its place are three floating layers over a full-bleed
 * preview:
 *
 *   • the PREVIEW is pinned to all four edges (`camera` fills the window) and this
 *     screen hides the navigator's own header, so nothing letterboxes it;
 *   • the BOTTOM DOCK is a transparent, bottom-anchored column of floating pieces:
 *     an error banner when a capture failed, the filmstrip of pages already saved,
 *     the collapsible find-this-music panel, and — last, so nothing can sit on top
 *     of it — the semi-transparent PILL holding the shutter, the flash toggle,
 *     Undo and Done;
 *   • the TOP CHIP says how many pages this scan has, and carries the way out.
 *
 * Every handler, every state, every navigation call and every line of user-facing
 * copy below is the v39/v40 one, unchanged: the same `capturePage`, `removeLast`,
 * `finish`, the same immediate library writes, the same shared reader and the same
 * ONE find-a-piece surface. The dense helper text the owner called out is not
 * deleted — it moved into the collapsible panel, one tap away.
 *
 * The numbers and decisions this layout needs (where the dock sits, the pill's
 * radius, the flash cycle, WHICH control is enabled) live in the pure
 * `services/scanViewport` module so they can be proved before a build, and the
 * structure itself is pinned by `services/uxr2ScanViewportContract`.
 */
export const ScanScoreScreen: React.FC<Props> = ({ navigation }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [capturing, setCapturing] = useState(false);
  // The open scan's library id — the row every further page is appended to.
  const [sessionId, setSessionId] = useState<string | null>(null);
  // The honest line from a capture that could not be written.
  const [errorLine, setErrorLine] = useState<string | null>(null);
  // The confirmed words a scan produced, when the user asked to find the music.
  const [findQuery, setFindQuery] = useState<string | null>(null);
  // UX round 2, layout only: the camera's flash setting, and whether the
  // find-this-music panel is open (it starts collapsed — see services/scanViewport).
  const [flash, setFlash] = useState(DEFAULT_SCAN_FLASH_MODE);
  const [findOpen, setFindOpen] = useState(false);

  /**
   * THE PREVIEW OWNS THE WHOLE WINDOW. The route is registered with the stack's
   * standard header ("Scan score"), and an opaque header is exactly the kind of
   * shell that stops a camera screen being edge to edge — so this screen turns it
   * off for itself and offers the same way out as a floating chip (the system BACK
   * gesture still works, and leaving an unfinished scan is safe by design: its
   * pages are already in the Library and this screen picks the scan back up).
   */
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  /**
   * AN UNFINISHED SCAN IS PICKED BACK UP (v39 fix 1a). Its pages are already in
   * the library, so the strip shows them again and the next capture continues the
   * same score instead of starting a second one.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const open = await getOpenScanSession();
      if (!alive || !open) return;
      setSessionId(open.id);
      setPages((open.pageUris ?? []).map((uri) => ({ uri })));
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * TAKE A PAGE, AND WRITE IT DOWN IMMEDIATELY (v39 fix 1a). The photo is copied
   * into the library and the row updated before this resolves; the strip only ever
   * shows pages that are truly on disk, read back from the store.
   */
  const capturePage = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    setErrorLine(null);
    try {
      // v43 item C5 — THE FIRST PAGE IS THE ONE THAT GETS READ. It is captured at
      // full quality (1.0): the resolve panel ranks the printed TITLE from this
      // photo, and 0.85 is a lossy JPEG of small cover type. Later pages are
      // pages of music kept for the library, so they stay at 0.85 (storage).
      // A top-45% crop before the read would need expo-image-manipulator — a NEW
      // native dependency, deliberately NOT added here (flagged to the lead).
      const quality = pages.length === 0 ? 1.0 : 0.85;
      const photo = await cameraRef.current.takePictureAsync({ quality });
      if (!photo?.uri) {
        setErrorLine('The photo could not be taken. Nothing was saved — try again.');
        return;
      }
      const saved = sessionId
        ? await appendScanSessionPage(sessionId, photo.uri)
        : await startScanSession(photo.uri, scanSessionTitle(new Date().toLocaleDateString()));
      if (!saved) {
        setErrorLine(
          'This scan is no longer in your Library, so the page could not be added. Take a page to start a new scan.',
        );
        setSessionId(null);
        setPages([]);
        return;
      }
      setSessionId(saved.id);
      setPages((saved.pageUris ?? []).map((uri) => ({ uri })));
    } catch {
      setErrorLine('The photo could not be saved. Nothing was added — try again.');
    } finally {
      setCapturing(false);
    }
  }, [capturing, pages.length, sessionId]);

  /**
   * UNDO removes the LAST page from this scan's own entry. It goes through the
   * store, so the disk and the strip never disagree; the pages before it stay
   * exactly where they were.
   */
  const removeLast = useCallback(async () => {
    if (!sessionId || pages.length === 0) return;
    setErrorLine(null);
    try {
      const updated = await removeScanSessionPage(sessionId);
      setPages((updated?.pageUris ?? []).map((uri) => ({ uri })));
      if (!updated) {
        // That was the only page: the empty scan's row went with it.
        setSessionId(null);
      }
    } catch {
      setErrorLine('That page could not be removed. Nothing else changed.');
    }
  }, [pages.length, sessionId]);

  /**
   * DONE closes the scan (the row stays in the Library, "still being scanned" is
   * lifted) and returns to the Library, where the score is already waiting.
   */
  const finish = useCallback(async () => {
    if (!sessionId || pages.length === 0) {
      Alert.alert('No pages', 'Capture at least one page first.');
      return;
    }
    try {
      await endScanSession(sessionId);
    } catch {
      // The pages are already saved; a failed flag flip is not a lost scan.
    }
    navigation.goBack();
  }, [navigation, pages.length, sessionId]);

  /**
   * A SUGGESTION THE READ PRODUCED (v43 item C3). This screen holds no catalog
   * row of its own, so it cannot mount a piece page from a title alone — what it
   * does instead is open the app's ONE search with that piece's OWN title, where
   * the piece row (and its official-sheet-music CTA) is the first thing the user
   * sees. The money path is unchanged: search → piece page → licensed retailers.
   * A host that does hold the catalog row passes `onOpenPiece` and gets the piece
   * page directly.
   */
  const openSuggestedPiece = useCallback((candidate: OcrTitleCandidate) => {
    const words = candidate.query || candidate.title;
    if (!words) return;
    setFindOpen(false);
    setFindQuery(words);
  }, []);

  /**
   * THE MONEY PATH (v39 fix 1b). The section read the page's words and the user
   * confirmed them: the app's own find-a-piece surface opens IN PLACE with that
   * query — one search surface, the same results the user would get by typing it,
   * including the licensed retailers. Its own back returns to this scan.
   */
  if (findQuery !== null) {
    return (
      <FindPieceScreen initialQuery={findQuery} onClose={() => setFindQuery(null)} />
    );
  }

  // ─── Permission not granted yet ────────────────────────────

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={56} color={theme.accent} />
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          NoteSnap uses your camera to photograph sheet music pages and store
          them as a scanned score. Photos never leave your device.
        </Text>
        <Pressable
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>Allow camera access</Text>
        </Pressable>
        {!permission.canAskAgain && (
          <Pressable
            style={styles.settingsLink}
            onPress={() => Linking.openSettings()}
          >
            <Text style={styles.settingsLinkText}>Open Settings</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // ─── Capture UI: a full-bleed preview with floating layers over it ─────

  const lastPageUri = pages.length > 0 ? pages[pages.length - 1].uri : null;
  // WHICH CONTROL IS ENABLED is the pre-existing capture flow's own rule,
  // moved into the pure model so a relayout cannot change what a tap does.
  const controls = scanControlState({ capturing, pageCount: pages.length });
  // The detail panel's state comes from the pure rule as well: it opens closed.
  const findPanel = scanFindPanel(findOpen);

  return (
    <View style={styles.container}>
      {/* EDGE TO EDGE: the preview is pinned to all four edges of the window
          (services/scanViewport owns every offset used below). */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        flash={flash}
        onMountError={() =>
          Alert.alert(
            'Camera unavailable',
            'Your device could not start the camera. Please try again.'
          )
        }
      />

      {/* THE FLOATING TOP LAYER: how many pages this scan has, and the way out.
          It is a chip, not a bar — it carries no fill of its own, so the preview
          is visible right up to the status bar. */}
      <View
        style={[styles.topFloat, { top: scanTopChipInset(insets.top) }]}
        pointerEvents="box-none"
      >
        <Pressable
          style={styles.backChip}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Leave this scan"
        >
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </Pressable>
        <View style={styles.statusChip}>
          <Text style={styles.statusCount}>
            {pages.length > 0 ? scanPageCountLabel(pages.length) : SCAN_EMPTY_HINT}
          </Text>
        </View>
      </View>

      {/* ═══════ HOW TO FRAME THE SHOT — ON THE SCREEN, ALWAYS (v43 item C5b) ═══════
          The owner's headline requirement (10-20, said three times): while framing
          a shot the user must be TOLD to fit the TITLE/HEADING of the score into
          the frame, not the whole piece — otherwise the photo cannot be matched to
          a title. So this is not a toast, not a help page and not a sub-menu: it is
          a permanent translucent panel over the viewfinder, rendered from the
          moment this screen opens (before any photo is taken) and while framing
          every shot. It sits between the top chip and the centre of the preview so
          it never covers the area the title is being framed in, and the copy is the
          named constant `SCAN_COVER_ONLY_HINT` (services/scanFind) so a source scan
          can assert this screen really shows it. */}
      <View
        style={[styles.framingHintWrap, { top: scanFramingHintTop(insets.top) }]}
        pointerEvents="none"
      >
        <View style={styles.framingHintPanel}>
          <Text style={styles.framingHintTitle}>FRAMING TIP</Text>
          <Text style={styles.framingHintText}>{SCAN_COVER_ONLY_HINT}</Text>
        </View>
      </View>

      {/* THE FLOATING BOTTOM DOCK: transparent, bottom-anchored, and stacking its
          layers in render order so the pill is the LAST — nothing can cover it. */}
      <View
        style={[styles.dock, { paddingBottom: scanDockBottomInset(insets.bottom) }]}
        pointerEvents="box-none"
      >
        {errorLine ? (
          <View style={styles.errorFloat}>
            <Text style={styles.error}>{errorLine}</Text>
          </View>
        ) : null}

        {pages.length > 0 ? (
          <View style={styles.filmstrip}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filmstripBody}
            >
              {pages.map((p, index) => (
                <View key={`${index}-${p.uri}`} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Text style={styles.thumbIndex}>{index + 1}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {findPanel.open ? (
          <View
            style={[styles.findSheet, { maxHeight: scanFindSheetMaxHeight(windowHeight) }]}
          >
            <View style={styles.findSheetHeader}>
              <Text style={styles.findSheetTitle}>{SCAN_FIND_CTA}</Text>
              <Pressable
                style={styles.findSheetClose}
                onPress={() => setFindOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Hide this panel"
              >
                <Ionicons name="chevron-down" size={22} color={theme.text} />
              </Pressable>
            </View>
            {/* The dense lines the owner called out live HERE, one tap away, in a
                bounded and scrollable panel — the same two lines as before. */}
            <ScrollView
              style={styles.findSheetScroll}
              contentContainerStyle={styles.findSheetBody}
            >
              {scanSessionResumedLine(pages.length) ? (
                <Text style={styles.resumedLine}>
                  {scanSessionResumedLine(pages.length)}
                </Text>
              ) : null}
              <Text style={styles.savedLine}>{SCAN_SAVED_AS_YOU_GO_LINE}</Text>
              <ScanFindSection
                pageUri={lastPageUri}
                onSearch={setFindQuery}
                onOpenPiece={openSuggestedPiece}
                onRetake={() => setFindOpen(false)}
              />
            </ScrollView>
          </View>
        ) : (
          <Pressable
            style={styles.findChip}
            onPress={() => setFindOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={SCAN_FIND_CTA}
          >
            <Ionicons name="search-outline" size={16} color={theme.text} />
            <Text style={styles.findChipLabel}>{SCAN_FIND_CTA}</Text>
          </Pressable>
        )}

        <View style={styles.controlPill}>
          <Pressable
            style={[styles.pillControl, !controls.undo && styles.controlDisabled]}
            onPress={() => void removeLast()}
            disabled={!controls.undo}
            accessibilityRole="button"
            accessibilityLabel="Remove last page"
          >
            <Ionicons name="trash-outline" size={22} color={theme.text} />
            <Text style={styles.controlLabel}>Undo</Text>
          </Pressable>

          <Pressable
            style={[styles.pillControl, !controls.flash && styles.controlDisabled]}
            onPress={() => setFlash(nextScanFlashMode(flash))}
            disabled={!controls.flash}
            accessibilityRole="button"
            accessibilityLabel={scanFlashControlLabel(flash)}
          >
            <Ionicons name={scanFlashIcon(flash)} size={22} color={theme.text} />
            <Text style={styles.controlLabel}>{scanFlashShortLabel(flash)}</Text>
          </Pressable>

          <Pressable
            style={styles.shutter}
            onPress={() => void capturePage()}
            disabled={!controls.shoot}
            accessibilityRole="button"
            accessibilityLabel="Capture page"
          >
            <View style={[styles.shutterInner, capturing && styles.shutterBusy]} />
          </Pressable>

          <Pressable
            style={[
              styles.pillControl,
              styles.doneButton,
              !controls.finish && styles.controlDisabled,
            ]}
            onPress={() => void finish()}
            disabled={!controls.finish}
            accessibilityRole="button"
            accessibilityLabel={scanFinishCta(pages.length)}
          >
            <Ionicons name="checkmark" size={22} color="#fff" />
            <Text style={styles.doneLabel}>{scanFinishCta(pages.length)}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#10101c',
  },
  /* UX ROUND 2 STEP 1 — THE PREVIEW IS THE WHOLE WINDOW. A camera with a floor in
     a column is what letterboxed this screen: on a short viewport the panel below
     it still won, and the owner saw a sliver of camera with controls pushed off
     the bottom edge. Pinned to all four edges instead, with no height of its own,
     the preview cannot be squeezed by anything — the layers above it float. */
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  /* THE TOP LAYER: a chip and a way out. No fill of its own, so it never reads as
     a bar across the picture. */
  topFloat: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  backChip: {
    width: SCAN_TOUCH_MIN,
    height: SCAN_TOUCH_MIN,
    borderRadius: SCAN_TOUCH_MIN / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCAN_CHIP_TRANSLUCENT,
  },
  statusChip: {
    flexShrink: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: SCAN_CHIP_TRANSLUCENT,
  },
  statusCount: {
    color: '#eaeaff',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  /* v43 item C5b — THE FRAMING TIP. A translucent panel on a dark scrim, so the
     words stay legible over ANY viewfinder image (a white title page included),
     and `pointerEvents="none"` on its wrapper so it never eats a tap meant for
     the camera. It is capped at SCAN_FRAMING_HINT_MAX_HEIGHT and sits below the
     top chip, clear of the area the user is framing. */
  framingHintWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  framingHintPanel: {
    maxHeight: SCAN_FRAMING_HINT_MAX_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(78,205,196,0.55)',
    backgroundColor: 'rgba(9,11,22,0.78)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  framingHintTitle: {
    color: '#4ecdc4',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  framingHintText: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  /* THE BOTTOM LAYER: transparent by construction — it exists only to stack the
     floating pieces. Its only colour is the translucent pill at the end of it. */
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 10,
    gap: SCAN_CONTROL_GAP,
  },
  /* The honest line from a failed capture: floating, so it can never sit on the
     shutter or the Done button. */
  errorFloat: {
    maxWidth: '92%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(70,14,22,0.86)',
  },
  error: {
    color: '#ffb3b3',
    fontSize: 12,
    lineHeight: 17,
  },
  /* The pages that are ALREADY in the Library: a rounded row of thumbnails, not
     the old opaque 96pt strip. */
  filmstrip: {
    height: SCAN_FILMSTRIP_HEIGHT,
    maxWidth: '92%',
    borderRadius: 18,
    backgroundColor: SCAN_CHIP_TRANSLUCENT,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  filmstripBody: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  thumbWrap: {
    alignItems: 'center',
  },
  thumb: {
    width: 40,
    height: 48,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  thumbIndex: {
    color: '#c8c8e0',
    fontSize: 10,
    fontWeight: '700',
  },
  /* THE COLLAPSED FACE OF THE DETAIL PANEL: one chip, the shared label. */
  findChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: SCAN_TOUCH_MIN,
    paddingHorizontal: 16,
    borderRadius: SCAN_TOUCH_MIN / 2,
    backgroundColor: SCAN_CHIP_TRANSLUCENT,
  },
  findChipLabel: {
    color: '#eaeaff',
    fontSize: 13,
    fontWeight: '600',
  },
  /* THE OPEN PANEL: bounded by services/scanViewport from the window's own height,
     so it cannot grow over the controls the way the v40 footer did. */
  findSheet: {
    width: '92%',
    borderRadius: 20,
    backgroundColor: SCAN_SURFACE_TRANSLUCENT,
    overflow: 'hidden',
  },
  findSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 6,
  },
  findSheetTitle: {
    color: '#eaeaff',
    fontSize: 14,
    fontWeight: '700',
  },
  findSheetClose: {
    width: SCAN_TOUCH_MIN,
    height: SCAN_TOUCH_MIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findSheetScroll: {
    flexGrow: 0,
  },
  findSheetBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 6,
  },
  resumedLine: {
    color: '#eaeaff',
    fontSize: 12,
    lineHeight: 17,
  },
  savedLine: {
    color: '#c8c8e0',
    fontSize: 12,
    lineHeight: 17,
  },
  /* THE PILL: semi-transparent, rounded well past its own height, centred at its
     own width, holding the shutter, the flash toggle, Undo and Done — and nothing
     else. It is the LAST piece in the dock, so no other layer can cover it. */
  controlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SCAN_CONTROL_GAP,
    borderRadius: SCAN_PILL_RADIUS,
    backgroundColor: SCAN_SURFACE_TRANSLUCENT,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '96%',
  },
  pillControl: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: SCAN_TOUCH_MIN,
    minHeight: SCAN_TOUCH_MIN,
  },
  controlDisabled: {
    opacity: 0.35,
  },
  controlLabel: {
    color: '#c8c8e0',
    fontSize: 11,
  },
  shutter: {
    width: SCAN_SHUTTER_SIZE,
    height: SCAN_SHUTTER_SIZE,
    borderRadius: SCAN_SHUTTER_SIZE / 2,
    borderWidth: 4,
    borderColor: '#e94560',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  shutterInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
  },
  shutterBusy: {
    backgroundColor: '#e94560',
  },
  doneButton: {
    backgroundColor: '#e94560',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  doneLabel: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    padding: 32,
    gap: 12,
  },
  permissionTitle: {
    color: '#eaeaff',
    fontSize: 20,
    fontWeight: '700',
  },
  permissionBody: {
    color: '#a0a0b8',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: '#e94560',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 8,
  },
  permissionButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  settingsLink: {
    marginTop: 12,
  },
  settingsLinkText: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
