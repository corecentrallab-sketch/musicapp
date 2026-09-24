/**
 * ModernSearchScreen — the modern-song recognition flow (Tier-1 recognize→buy
 * funnel). Records audio on-device, POSTs it to /api/recognize-modern, and
 * shows the result in the ModernSongInterstitial (in-app, NO auto-redirect).
 *
 * RETRY / RESAMPLE (owner repro 09-22 — second pass showed NOTHING at all): the
 * pass-2 decision is no longer spread across three silent early-returns. Every
 * branch is taken from src/services/recognitionRetry.ts, and every one of them
 * ends in a visible surface:
 *
 *   - a failed start → the interstitial's error card ("Couldn't start recording
 *     — please try again", or the permission message with its Settings affordance);
 *   - a start in flight → the mic hint says "Getting the mic ready…" instead of
 *     an inert screen with a disabled button;
 *   - a stop that produced nothing → "Recording was empty — move closer to the
 *     music", etc.;
 *   - a request in flight → the loading surface stays up until it resolves.
 *
 * src/services/modernRetryContract.ts + scripts/recognitionRetry.test.ts guard
 * this class of "silent" defect in the source itself.
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
import { useHardwareBack } from '../hooks/useHardwareBack';
import { recognizeModernSong } from '../services/api';
import { modernOutcome } from '../services/tier1';
import { saveRecognition } from '../services/storage';
import { ModernSongInterstitial } from '../components/ModernSongInterstitial';
import {
  IDLE_SURFACE,
  isPermissionFailure,
  micBusy,
  micHint,
  planRetry,
  planTap,
  shouldSurfaceStopFailure,
  startFailureSurface,
  stopFailureSurface,
  type ModernSurfaceState,
} from '../services/recognitionRetry';
import type { ModernMatch } from '../types';

const RECORDING_TIMEOUT_MS = 12000;
/** Pause between dismissing the interstitial and starting the next capture. */
const RETRY_DELAY_MS = 300;

interface ModernSearchScreenProps {
  onClose: () => void;
  /** Switch to the hum/whistle/sing flow (find a free public-domain piece). */
  onHumIt: () => void;
  /** Navigate to the free public-domain Library. */
  onBrowseLibrary: () => void;
}

export const ModernSearchScreen: React.FC<ModernSearchScreenProps> = ({
  onClose,
  onHumIt,
  onBrowseLibrary,
}) => {
  const recorder = useAudioRecorder();
  const [recording, setRecording] = useState(false);
  /** A capture start is in flight (permission / prepare / startAsync). */
  const [starting, setStarting] = useState(false);
  const [interstitial, setInterstitial] =
    useState<ModernSurfaceState>(IDLE_SURFACE);
  const [showInterstitial, setShowInterstitial] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The retry auto-start handle — tracked so it can be cancelled (see below). */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A /api/recognize-modern POST is in flight. */
  const requestInFlightRef = useRef(false);
  /** A stop is in flight (blocks a second, phantom stop). */
  const stoppingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  /**
   * Start a fresh capture. The hook tears down any recorder still held from an
   * earlier pass first, so a retry can never race pass 1's recorder.
   */
  const startNewPass = useCallback(async () => {
    setStarting(true);
    setRecording(false);
    const started = await recorder.startRecording();
    setStarting(false);
    if (!started) {
      // NEVER a silent dead-end. A failed start always becomes an honest
      // surface: the interstitial error card (permission failures keep the
      // hook's inline error + Open Settings affordance behind it).
      const failure = recorder.takeStartFailure();
      if (!failure || !isPermissionFailure(failure.reason)) {
        recorder.clearError();
      }
      setInterstitial(startFailureSurface(failure));
      setShowInterstitial(true);
      return;
    }
    setRecording(true);
    timeoutRef.current = setTimeout(() => {
      void handleStop();
    }, RECORDING_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  /** The mic button: stop a live capture, or start one — never stack a second. */
  const handleStart = useCallback(async () => {
    const action = planTap({
      recording: recorder.isRecording,
      starting,
      requestInFlight: requestInFlightRef.current,
    });
    if (action === 'wait') return;
    if (action === 'stop') {
      void handleStop();
      return;
    }
    await startNewPass();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.isRecording, starting, startNewPass]);

  const handleStop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRecording(false);
      const stopped = await recorder.stopRecording();
      if (!stopped) {
        const failure = recorder.takeStopFailure();
        const reason = failure ? failure.reason : 'no-recording';
        // A late/stray stop with a result already on screen must not replace it.
        if (
          shouldSurfaceStopFailure(reason, {
            interstitialVisible: showInterstitial,
            requestInFlight: requestInFlightRef.current,
          })
        ) {
          recorder.clearError();
          setInterstitial(stopFailureSurface(failure));
          setShowInterstitial(true);
        } else {
          recorder.clearError();
        }
        return;
      }
      const { uri } = stopped;
      requestInFlightRef.current = true;
      setInterstitial({
        loading: true,
        error: null,
        match: null,
        recognized: false,
      });
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
          error:
            err instanceof Error
              ? err.message
              : 'Something went wrong. Please try again.',
          match: null,
          recognized: false,
        });
      } finally {
        requestInFlightRef.current = false;
      }
    } finally {
      stoppingRef.current = false;
    }
  }, [recorder, showInterstitial]);

  /**
   * "Try Again" from the interstitial. Always a start (never routed into a stop,
   * and never a second capture on top of one already starting/in flight), and
   * the timer is tracked so a mic tap during the 300ms cannot double-start.
   */
  const handleRetry = useCallback(() => {
    if (
      planRetry({
        recording: recorder.isRecording,
        starting,
        requestInFlight: requestInFlightRef.current,
      }) === 'wait'
    ) {
      return;
    }
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    // A pending auto-stop belongs to the pass we are abandoning — clearing it
    // stops the 12s capture timeout from firing into the NEW pass's recorder.
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setShowInterstitial(false);
    setInterstitial(IDLE_SURFACE);
    recorder.resetForRetry();
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void startNewPass();
    }, RETRY_DELAY_MS);
  }, [recorder, starting, startNewPass]);

  // Android hardware BACK (in-place flow — owner bug class 09-23). "Find any
  // song" replaces its host tab's whole body, so its route never changes: a BACK
  // press nothing consumes reaches React Navigation, which has no route to pop
  // and finishes the activity (the app "exits"). The interstitial and the
  // retailer shell are Modals and consume the press themselves
  // (onRequestClose), so this only runs when the plain screen is the surface.
  // Guarded by src/services/backExitContract.ts.
  useHardwareBack(() => {
    onClose();
    return true;
  });

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
          setInterstitial(IDLE_SURFACE);
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
          style={[
            styles.micBtn,
            (recorder.isRecording || starting) && styles.micBtnActive,
          ]}
          onPress={recorder.isRecording ? handleStop : handleStart}
          disabled={micBusy({
            recording: recorder.isRecording,
            starting,
            checkingPermissions: recorder.checkingPermissions,
          })}
          activeOpacity={0.7}
        >
          <Text style={styles.micBtnIcon}>
            {recorder.isRecording ? '⏹' : '🎤'}
          </Text>
        </TouchableOpacity>

        {/* Every capture state has words — including "getting the mic ready",
            which used to render nothing while the button sat inert (the silent
            window in the owner's pass-2 repro). */}
        <Text style={styles.hint}>
          {micHint({
            recording: recorder.isRecording,
            starting,
            checkingPermissions: recorder.checkingPermissions,
          })}
        </Text>
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
