import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { RootStackParamList } from '../types';
import {
  appendScanSessionPage,
  endScanSession,
  getOpenScanSession,
  removeScanSessionPage,
  startScanSession,
} from '../services/libraryStore';
import {
  SCAN_SAVED_AS_YOU_GO_LINE,
  scanFinishCta,
  scanSessionResumedLine,
  scanSessionTitle,
} from '../services/scanFind';
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
 * the licensed retailers already are. No OMR, no note reading, no edition claim,
 * no second search box, and no retailer URL is built here.
 */
export const ScanScoreScreen: React.FC<Props> = ({ navigation }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
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
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
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
  }, [capturing, sessionId]);

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

  // ─── Capture UI ────────────────────────────────────────────

  const lastPageUri = pages.length > 0 ? pages[pages.length - 1].uri : null;

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onMountError={() =>
          Alert.alert(
            'Camera unavailable',
            'Your device could not start the camera. Please try again.'
          )
        }
      />

      {/* Page thumbnail strip — the pages that are ALREADY in the Library. */}
      <ScrollView
        horizontal
        style={styles.strip}
        contentContainerStyle={styles.stripContent}
      >
        {pages.map((p, index) => (
          <View key={`${index}-${p.uri}`} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            <Text style={styles.thumbIndex}>{index + 1}</Text>
          </View>
        ))}
        {pages.length === 0 && (
          <Text style={styles.stripHint}>No pages captured yet</Text>
        )}
      </ScrollView>

      {/* THE SCAN'S OWN HONESTY + MONEY PATH (v39 fix 1a/1b). Scrollable: the
          camera keeps the room it needs and the notes below it are all reachable. */}
      <ScrollView style={styles.footerScroll} contentContainerStyle={styles.footer}>
        {scanSessionResumedLine(pages.length) ? (
          <Text style={styles.resumedLine}>
            {scanSessionResumedLine(pages.length)}
          </Text>
        ) : null}
        <Text style={styles.savedLine}>{SCAN_SAVED_AS_YOU_GO_LINE}</Text>
        {errorLine ? <Text style={styles.error}>{errorLine}</Text> : null}
        <ScanFindSection pageUri={lastPageUri} onSearch={setFindQuery} />
      </ScrollView>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          style={[styles.controlButton, pages.length === 0 && styles.controlDisabled]}
          onPress={() => void removeLast()}
          disabled={pages.length === 0}
          accessibilityLabel="Remove last page"
        >
          <Ionicons name="trash-outline" size={22} color={theme.text} />
          <Text style={styles.controlLabel}>Undo</Text>
        </Pressable>

        <Pressable
          style={styles.shutter}
          onPress={() => void capturePage()}
          disabled={capturing}
          accessibilityLabel="Capture page"
        >
          <View style={[styles.shutterInner, capturing && styles.shutterBusy]} />
        </Pressable>

        <Pressable
          style={[
            styles.controlButton,
            styles.doneButton,
            pages.length === 0 && styles.controlDisabled,
          ]}
          onPress={() => void finish()}
          disabled={pages.length === 0}
        >
          <Ionicons name="checkmark" size={22} color="#fff" />
          <Text style={styles.doneLabel}>{scanFinishCta(pages.length)}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#10101c',
  },
  /* v40 fix C — THE FOOTER BAR CANNOT EAT THE CAMERA OR THE CONTROLS ANY MORE.
     The column used to be: camera (flex: 1, no floor) + a 96pt strip + a scroll
     panel allowed to grow to 320pt + the controls. Nothing shrank, so on a short
     viewport (this screen is not portrait-locked) the panel pushed the Undo/Done
     row off the bottom edge and crushed the preview to a sliver — the owner's
     "the footer bar obscures the camera preview AND the Done/undo controls".
     Now the camera has a floor, the panel is BOUNDED and may shrink, and the
     controls are a fixed row that is never the last thing to be laid out past the
     bottom. The panel is also a themed surface with its own top edge, so it reads
     as part of the screen in both palettes instead of a blank white bar. */
  camera: {
    flex: 1,
    minHeight: 140,
  },
  strip: {
    maxHeight: 96,
    backgroundColor: '#10101c',
  },
  stripContent: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  stripHint: {
    color: '#8a8ab0',
    fontSize: 13,
    paddingVertical: 24,
  },
  thumbWrap: {
    position: 'relative',
  },
  thumb: {
    width: 60,
    height: 80,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  thumbIndex: {
    position: 'absolute',
    top: 2,
    left: 4,
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  footerScroll: {
    maxHeight: 200,
    flexShrink: 1,
    backgroundColor: '#12122b',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  footer: {
    backgroundColor: '#12122b',
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 4,
    gap: 6,
  },
  resumedLine: {
    color: '#eaeaff',
    fontSize: 12,
    lineHeight: 17,
  },
  savedLine: {
    color: '#8a8ab0',
    fontSize: 12,
    lineHeight: 17,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 12,
    lineHeight: 17,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 14,
    paddingBottom: 18,
    paddingHorizontal: 24,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    flexShrink: 0,
    zIndex: 2,
  },
  controlButton: {
    alignItems: 'center',
    gap: 2,
    minWidth: 72,
  },
  controlDisabled: {
    opacity: 0.35,
  },
  controlLabel: {
    color: '#a0a0b8',
    fontSize: 12,
  },
  shutter: {
    width: 68,
    height: 68,
    borderRadius: 34,
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
    borderRadius: 10,
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
