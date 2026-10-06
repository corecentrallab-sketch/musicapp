/**
 * CoverScanModal — "Scan a cover": photograph the title page of a score and land
 * on the SAME search a typed title produces (v33 §H, owner 10-04).
 *
 * WHAT IT IS. The camera affordance that sits on the find-a-piece search bar
 * (the Discover band's chip opens that screen). The user photographs the cover,
 * CONFIRMS the title in a field, and the ordinary catalog search runs — one
 * search, one result surface, the same money path as a typed query. No second
 * matching path exists here and no new screen was added for it.
 *
 * THE HONEST PART — NO OCR IN THIS BUILD (the decision stands). On-device text
 * recognition is a NATIVE module (ML Kit / equivalents) and this build has none
 * wired: COVER_SCAN_OCR_AVAILABLE === false. So the confirm field starts EMPTY,
 * the surface says plainly that reading the photo is not in this build
 * (`scanned.line` IS COVER_SCAN_NO_OCR_LINE for this build), and NOTHING is ever
 * guessed from a photo — no fake OCR, no invented title. Filling the field in is
 * the user's act, and it is what makes the search honest.
 *
 * The photo itself is the user's own capture, kept on the device for this flow
 * only, used for identification (title/composer) and never uploaded, hosted or
 * cached. Score interiors are never read into note data — that is the separate
 * OMR workstream, explicitly out of v33.
 */
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
import {
  COVER_SCAN_BODY,
  COVER_SCAN_CANCEL_CTA,
  COVER_SCAN_CONFIRM_HINT,
  COVER_SCAN_CONFIRM_LABEL,
  COVER_SCAN_FALLBACK_LINE,
  COVER_SCAN_OCR_AVAILABLE,
  COVER_SCAN_PERMISSION_CTA,
  COVER_SCAN_PERMISSION_LINE,
  COVER_SCAN_RETAKE_CTA,
  COVER_SCAN_SEARCH_CTA,
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
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  // The captured photo (on-device only). null = still on the camera step.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // The confirm field. It starts EMPTY and nothing here can fill it in: this
  // build has no reader, and a prefilled guess would be a fabricated read.
  const [confirmText, setConfirmText] = useState('');
  const [capturing, setCapturing] = useState(false);

  // What the photo produced in THIS build. With no recogniser wired the model's
  // own answer is the honest 'no-ocr' state and its line is COVER_SCAN_NO_OCR_LINE
  // — we show the model's answer rather than a second copy of the sentence.
  const scanned = coverQueryFromScan({
    ocrText: null,
    ocrAvailable: COVER_SCAN_OCR_AVAILABLE,
  });

  const close = useCallback(() => {
    setPhotoUri(null);
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
        // Deliberately EMPTY: nothing was read, so nothing is written here.
        setConfirmText('');
      }
    } catch {
      Alert.alert('Capture failed', 'The photo could not be taken.');
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const retake = useCallback(() => {
    setPhotoUri(null);
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
            <ActivityIndicator size="large" color="#e94560" />
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
          /* CONFIRM — the user's own words, in their own field, before any search
             runs. The field is empty because this build read nothing. */
          <View style={styles.confirmWrap}>
            <Text style={styles.label}>{COVER_SCAN_CONFIRM_LABEL}</Text>
            <TextInput
              style={styles.confirmInput}
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder={COVER_SCAN_CONFIRM_HINT}
              placeholderTextColor="#8a8aa3"
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              accessibilityLabel={COVER_SCAN_CONFIRM_LABEL}
            />
            <Text style={styles.honest}>{scanned.line}</Text>
            <Pressable
              style={[styles.primaryBtn, !canSearch && styles.primaryBtnDisabled]}
              onPress={confirm}
              disabled={!canSearch}
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

const styles = StyleSheet.create({
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
