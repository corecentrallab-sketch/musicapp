/**
 * ModernSearchScreen — the modern-song recognition flow (Tier-1 recognize→buy
 * funnel). Records audio on-device, POSTs it to /api/recognize-modern, and
 * shows the result in the ModernSongInterstitial (in-app, NO auto-redirect).
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { recognizeModernSong } from '../services/api';
import { modernOutcome } from '../services/tier1';
import { saveRecognition } from '../services/storage';
import {
  ModernSongInterstitial,
  type ModernInterstitialState,
} from '../components/ModernSongInterstitial';
import type { ModernMatch } from '../types';

const RECORDING_TIMEOUT_MS = 12000;

interface ModernSearchScreenProps {
  onClose: () => void;
  /** Switch to the hum/whistle/sing flow (find a free public-domain piece). */
  onHumIt: () => void;
  /** Navigate to the free public-domain Library. */
  onBrowseLibrary: () => void;
}

const IDLE_INTERSTITIAL: ModernInterstitialState = {
  loading: false,
  error: null,
  match: null,
  recognized: false,
};

export const ModernSearchScreen: React.FC<ModernSearchScreenProps> = ({
  onClose,
  onHumIt,
  onBrowseLibrary,
}) => {
  const recorder = useAudioRecorder();
  const [recording, setRecording] = useState(false);
  const [interstitial, setInterstitial] =
    useState<ModernInterstitialState>(IDLE_INTERSTITIAL);
  const [showInterstitial, setShowInterstitial] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleStart = useCallback(async () => {
    if (recorder.isRecording) {
      handleStop();
      return;
    }
    setRecording(false);
    const started = await recorder.startRecording();
    if (!started) return;
    setRecording(true);
    timeoutRef.current = setTimeout(() => handleStop(), RECORDING_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.isRecording, recorder.startRecording]);

  const handleStop = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setRecording(false);
    const stopped = await recorder.stopRecording();
    if (!stopped) {
      recorder.clearError();
      setInterstitial({
        loading: false,
        error: 'Recording failed — please try again.',
        match: null,
        recognized: false,
      });
      setShowInterstitial(true);
      return;
    }
    const { uri } = stopped;
    setInterstitial({ loading: true, error: null, match: null, recognized: false });
    setShowInterstitial(true);
    try {
      const resp = await recognizeModernSong(uri);
      const outcome = modernOutcome(resp);
      if (outcome.recognized && outcome.match) {
        // Save-to-history first (a retention lever the owner requires around
        // the affiliate moment), then show the interstitial.
        const m: ModernMatch = outcome.match;
        await saveRecognition({
          id: m.isrc || m.song,
          title: m.song,
          composer: m.artist,
          savedAt: new Date().toISOString(),
        });
      }
      setInterstitial({
        loading: false,
        error: null,
        match: outcome.match ?? null,
        recognized: outcome.recognized,
      });
    } catch (err) {
      recorder.completeRecording();
      setInterstitial({
        loading: false,
        error: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        match: null,
        recognized: false,
      });
    }
  }, [recorder]);

  const handleRetry = useCallback(() => {
    setShowInterstitial(false);
    setInterstitial(IDLE_INTERSTITIAL);
    setTimeout(() => handleStart(), 300);
  }, [handleStart]);

  return (
    <View style={styles.container}>
      <ModernSongInterstitial
        visible={showInterstitial}
        loading={interstitial.loading}
        error={interstitial.error}
        match={interstitial.match}
        recognized={interstitial.recognized}
        onClose={() => {
          setShowInterstitial(false);
          setInterstitial(IDLE_INTERSTITIAL);
        }}
        onRetry={handleRetry}
        onHumIt={onHumIt}
        onBrowseLibrary={onBrowseLibrary}
      />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find any song</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heroEmoji}>💿</Text>
        <Text style={styles.title}>Find any song & get the sheet music</Text>
        <Text style={styles.subtitle}>
          Recognizes modern, copyrighted songs too — then links you to the
          official sheet music at a licensed retailer. NoteSnap never hosts the
          copyrighted file; we just point you to where you can buy it.
        </Text>

        {recorder.error && !recorder.isRecording && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{recorder.error}</Text>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={recorder.openSettings}
            >
              <Text style={styles.settingsBtnText}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.micBtn, recorder.isRecording && styles.micBtnActive]}
          onPress={recorder.isRecording ? handleStop : handleStart}
          disabled={recorder.checkingPermissions}
          activeOpacity={0.7}
        >
          <Text style={styles.micBtnIcon}>
            {recorder.isRecording ? '⏹' : '🎤'}
          </Text>
        </TouchableOpacity>

        {recorder.isRecording && (
          <Text style={styles.hint}>Listening... tap again to stop & identify.</Text>
        )}
        {!recorder.isRecording && (
          <Text style={styles.hint}>
            Tap the mic and play the music around you ({'\n'}8–12s), then stop to
            identify it.
          </Text>
        )}
      </ScrollView>
    </View>
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
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  backBtn: { marginRight: 12 },
  backText: { color: '#e94560', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 60,
    alignItems: 'center',
  },
  heroEmoji: { fontSize: 56, marginBottom: 8 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  errorCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    width: '100%',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e94560',
    alignItems: 'center',
  },
  errorText: {
    color: '#ffb347',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 18,
  },
  settingsBtn: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  settingsBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  micBtn: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#e94560',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    shadowColor: '#e94560',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  micBtnActive: { backgroundColor: '#ff6b6b' },
  micBtnIcon: { fontSize: 44, color: '#ffffff' },
  hint: {
    fontSize: 13,
    color: '#a0a0b8',
    textAlign: 'center',
    marginTop: 18,
  },
});
