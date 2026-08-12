import React, { useCallback, useRef, useState } from 'react';
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
import { createScannedScore } from '../services/libraryStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanScore'>;

interface CapturedPage {
  uri: string;
  size?: number;
}

/**
 * Camera capture flow for scanning a paper score into the library.
 * Take one photo per page, review the thumbnail strip, then save as a
 * single "scanned score" item with pages in order.
 */
export const ScanScoreScreen: React.FC<Props> = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [capturing, setCapturing] = useState(false);

  const capturePage = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
      });
      if (photo) {
        setPages((prev) => [...prev, { uri: photo.uri }]);
      }
    } catch {
      Alert.alert('Capture failed', 'The photo could not be taken.');
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const removeLast = useCallback(() => {
    setPages((prev) => prev.slice(0, -1));
  }, []);

  const saveScore = useCallback(async () => {
    if (pages.length === 0) {
      Alert.alert('No pages', 'Capture at least one page first.');
      return;
    }
    try {
      const item = await createScannedScore(pages);
      Alert.alert(
        'Score saved',
        `"${item.title}" (${item.pageCount} pages) was added to your library.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert(
        'Save failed',
        e instanceof Error ? e.message : 'The scanned score could not be saved.'
      );
    }
  }, [pages, navigation]);

  // ─── Permission not granted yet ────────────────────────────

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={56} color="#e94560" />
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

      {/* Page thumbnail strip */}
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

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          style={[styles.controlButton, pages.length === 0 && styles.controlDisabled]}
          onPress={removeLast}
          disabled={pages.length === 0}
          accessibilityLabel="Remove last page"
        >
          <Ionicons name="trash-outline" size={22} color="#eaeaff" />
          <Text style={styles.controlLabel}>Undo</Text>
        </Pressable>

        <Pressable
          style={styles.shutter}
          onPress={capturePage}
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
          onPress={saveScore}
          disabled={pages.length === 0}
        >
          <Ionicons name="checkmark" size={22} color="#fff" />
          <Text style={styles.doneLabel}>
            Save ({pages.length})
          </Text>
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
  camera: {
    flex: 1,
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
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
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
