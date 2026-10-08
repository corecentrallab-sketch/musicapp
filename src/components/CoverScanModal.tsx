/**
 * CoverScanModal — "Scan a cover": photograph the title page of a score, read the
 * words on it on-device, and land on the SAME search a typed title produces
 * (v33 §H, owner 10-04; the read itself is v36 fix 4, owner FAIL 10-08 — "snaps
 * but does not scan").
 *
 * WHAT IT IS. The camera affordance that sits on the find-a-piece search bar
 * (the Discover band's chip opens that screen). The user photographs the cover,
 * the on-device recogniser (services/coverScanOcr.ts) reads the printed text, the
 * field below is PRE-FILLED with that reading so the user can fix it, and the
 * ordinary catalog search runs — one search, one result surface, the same money
 * path as a typed query. No second matching path exists here and no new screen
 * was added for it.
 *
 * THE HONEST PART. Three distinct states, never blurred together:
 *   • READ — the field carries what the recogniser actually returned, and the
 *     user can correct it before searching;
 *   • READ NOTHING USABLE — the model's own `no-text` line, empty field;
 *   • THE READ FAILED (module missing on this device, recogniser rejected the
 *     image) — the model's own `ocr-failed` line, empty field;
 * and in no state is text EVER invented: the field is only ever filled from the
 * recogniser's own output (`result.text`), never from a guess, and an empty field
 * runs no search at all (see `confirm`). The photo itself is the user's own
 * capture, kept on the device for this flow only: it is read for identification
 * (title/composer) and never uploaded, hosted or cached. Score interiors are
 * never read into note data — the recogniser reads WORDS, this is not OMR, and
 * that is the separate workstream explicitly out of scope here.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { readCoverText, type CoverOcrRead } from '../services/coverScanOcr';
import {
  COVER_SCAN_BODY,
  COVER_SCAN_CANCEL_CTA,
  COVER_SCAN_CONFIRM_HINT,
  COVER_SCAN_CONFIRM_LABEL,
  COVER_SCAN_FALLBACK_LINE,
  COVER_SCAN_OCR_AVAILABLE,
  COVER_SCAN_PERMISSION_CTA,
  COVER_SCAN_PERMISSION_LINE,
  COVER_SCAN_READING_LINE,
  COVER_SCAN_RETAKE_CTA,
  COVER_SCAN_SEARCH_CTA,
  COVER_SCAN_TEXT_ONLY_LINE,
  COVER_SCAN_TITLE,
  coverQueryFromScan,
} from '../services/coverScan';

interface CoverScanModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * The confirmed query. This is the ONLY thing that leaves this modal, and it
   * goes to the search field the user typed into — the photo never does.
   */
  onConfirm: (query: string) => void;
}

export const CoverScanModal: React.FC<CoverScanModalProps> = ({
  visible,
  onClose,
  onConfirm,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  // The captured photo (on-device only). null = still on the camera step.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // What the on-device recogniser returned for that photo (null = nothing read
  // yet). Nothing else can produce the confirm field's contents.
  const [read, setRead] = useState<CoverOcrRead | null>(null);
  // The confirm field. It is filled ONLY from the read above, so the user can fix
  // the recogniser's wording — it is never filled from a guess.
  const [confirmText, setConfirmText] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [reading, setReading] = useState(false);

  // What the photo produced. `read` is null until the recogniser answers, so this
  // is the model's honest "nothing read yet" state until a real read lands; a
  // failed read is its own state (`ocr-failed`) and never a fabricated query.
  const scanned = coverQueryFromScan({
    ocrText: read?.text ?? null,
    ocrFailed: read?.failed === true,
    ocrAvailable: COVER_SCAN_OCR_AVAILABLE,
  });

  const close = useCallback(() => {
    setPhotoUri(null);
    setRead(null);
    setConfirmText('');
    onClose();
  }, [onClose]);

  const capture = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo) {
        setPhotoUri(photo.uri);
        setRead(null);
        setConfirmText('');
        // READ THE PHOTO (v36 fix 4): the words on the cover, on this device. The
        // call cannot throw — it returns an honest failure — so the screen always
        // lands in one of the three states above.
        setReading(true);
        const result = await readCoverText(photo.uri);
        setRead(result);
        // The field's ONLY source: the normalisation of what was actually read.
        setConfirmText(
          coverQueryFromScan({ ocrText: result.text, ocrFailed: result.failed }).query,
        );
      }
    } catch {
      Alert.alert('Capture failed', 'The photo could not be taken.');
    } finally {
      setCapturing(false);
      setReading(false);
    }
  }, [capturing]);

  const retake = useCallback(() => {
    setPhotoUri(null);
    setRead(null);
    setConfirmText('');
  }, []);

  const confirmed = confirmText.trim();
  const canSearch = confirmed.length > 0;

  const confirm = useCallback(() => {
    const text = confirmText.trim();
    // An empty field never runs a search: the user's own words are what search,
    // exactly as if they had typed them into the search bar.
    if (!text) return;
    setPhotoUri(null);
    setConfirmText('');
    onConfirm(text);
  }, [confirmText, onConfirm]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
      transparent={false}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{COVER_SCAN_TITLE}</Text>
          <Pressable
            onPress={close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={COVER_SCAN_CANCEL_CTA}
          >
            <Text style={styles.cancel}>{COVER_SCAN_CANCEL_CTA}</Text>
          </Pressable>
        </View>

        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.accent} />
          </View>
        ) : !permission.granted ? (
          /* The camera is the app's own permission and it can be refused. Either
             way the search is still one tap away (no dead end). */
          <View style={styles.center}>
            <Text style={styles.body}>{COVER_SCAN_PERMISSION_LINE}</Text>
            <Pressable style={styles.primaryBtn} onPress={requestPermission}>
              <Text style={styles.primaryBtnText}>Allow camera access</Text>
            </Pressable>
            {!permission.canAskAgain ? (
              <Pressable onPress={() => Linking.openSettings()}>
                <Text style={styles.link}>{COVER_SCAN_PERMISSION_CTA}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.honest}>{COVER_SCAN_FALLBACK_LINE}</Text>
          </View>
        ) : photoUri === null ? (
          <>
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
            <Text style={styles.body}>{COVER_SCAN_BODY}</Text>
            <Pressable
              style={styles.shutter}
              onPress={capture}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel="Take the photo"
            >
              <Text style={styles.shutterText}>
                {capturing ? 'One moment…' : '📷 Take the photo'}
              </Text>
            </Pressable>
            <Text style={styles.honest}>{COVER_SCAN_FALLBACK_LINE}</Text>
          </>
        ) : (
          /* CONFIRM — the recogniser's own reading, in the user's own field, before
             any search runs. While the read is in flight the field is empty and
             says so; when it lands the field carries exactly what was read. */
          <View style={styles.confirmWrap}>
            <Text style={styles.label}>{COVER_SCAN_CONFIRM_LABEL}</Text>
            {reading ? (
              <View style={styles.readingRow}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={styles.readingText}>{COVER_SCAN_READING_LINE}</Text>
              </View>
            ) : null}
            <TextInput
              style={styles.confirmInput}
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder={COVER_SCAN_CONFIRM_HINT}
              placeholderTextColor={theme.subtext}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              accessibilityLabel={COVER_SCAN_CONFIRM_LABEL}
            />
            {/* The model's own answer for this state: the read's wording, its
                honest "no title found", or its honest failure line. */}
            <Text style={styles.honest}>{scanned.line}</Text>
            <Text style={styles.honest}>{COVER_SCAN_TEXT_ONLY_LINE}</Text>
            <Pressable
              style={[styles.primaryBtn, (!canSearch || reading) && styles.primaryBtnDisabled]}
              onPress={confirm}
              disabled={!canSearch || reading}
              accessibilityRole="button"
              accessibilityLabel={COVER_SCAN_SEARCH_CTA}
            >
              <Text style={styles.primaryBtnText}>{COVER_SCAN_SEARCH_CTA}</Text>
            </Pressable>
            <Pressable onPress={retake} accessibilityRole="button">
              <Text style={styles.link}>{COVER_SCAN_RETAKE_CTA}</Text>
            </Pressable>
            <Text style={styles.honest}>{COVER_SCAN_FALLBACK_LINE}</Text>
          </View>
        )}
      </View>
    </Modal>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  cancel: {
    color: '#e94560',
    fontSize: 15,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  camera: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  body: {
    color: '#a0a0b8',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginHorizontal: 24,
    marginTop: 14,
  },
  shutter: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 14,
  },
  shutterText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  confirmWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 12,
  },
  label: {
    color: '#8a8ab0',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  confirmInput: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#eaeaff',
    fontSize: 15,
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  readingText: {
    color: '#a0a0b8',
    fontSize: 13,
  },
  honest: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  link: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
});
