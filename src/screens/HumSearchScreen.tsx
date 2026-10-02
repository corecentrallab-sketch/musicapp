/**
 * HumSearchScreen — the tap-to-hum/whistle/sing-to-search flow (Tier-1
 * differentiator, distinct from the audio-recognize mode).
 *
 * The user hums/whistles/sings a melody into the mic; we record on-device
 * (reusing useAudioRecorder) and POST it to /api/hum. On a confident match we
 * hand the result to the ONE shared result surface
 * (`RecognitionResultView`, bundle A, owner 10-02): the screen's OWN result card
 * is retired, so a hum match is shown exactly like every other match — identity,
 * provenance ("You hummed it — here it is") and the piece's hosted score INLINE
 * in the card, with the reader one chip away. On no-match we show the honest
 * "hum a longer/clearer phrase" message and invite retry. We NEVER fabricate a
 * title.
 *
 * WHAT THIS SCREEN STILL OWNS (bundle A): the recorder, the upload, the honest
 * no-match/error cards, and the TAKE — the recording the user just made. The
 * take's "Export MIDI" is rendered by the shared surface from the contract this
 * screen passes down (`midiExport`), because the take, the export run and its
 * outcome sentence live here: the surface can never invent a take, and this
 * screen can never lose one (v30 feature, kept by bundle A).
 *
 * The no-match card also carries the HUM → MODERN BRIDGE (owner-approved 09-22,
 * src/services/humBridge.ts): our melody catalog is small, so a hum miss must
 * not be a dead end. "Play the song instead" hands the user to the modern
 * "Find any song" flow (its own recorder, AudD fingerprinting), which identifies
 * the actual recording and links the official sheet music through our affiliate
 * partner. The reverse lever (modern → hum) already exists and is untouched.
 *
 * A failed start is NEVER silent: if startRecording() returns false the screen
 * lands on the honest error card below (permission failures keep the hook's
 * "Open Settings" affordance), exactly like the modern flow does — see
 * humStartFailureOutcome().
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { fetchPieceById, humToSearch } from '../services/api';
import { humOutcome, humPhraseHint, humNoMatchMessage, type HumOutcome } from '../services/tier1';
import {
  HUM_RETRY_CTA,
  HUM_TO_MODERN_BLURB,
  HUM_TO_MODERN_CTA,
  humStartFailureOutcome,
} from '../services/humBridge';
// The hum result is mapped into the app's OWN recognition-response shape
// (frontDoor.humMatchToResultResponse) so the ONE result surface renders it — the
// function owns the honesty rules (public domain, therefore no purchase_url) and
// takes the hosted score the catalog resolved for this piece, when there is one.
import {
  humMatchToResultResponse,
  type HumResolvedSheet,
} from '../services/frontDoor';
import { saveRecognition, updateRecognitionCapture } from '../services/storage';
import { exportCaptureMidiFromRecording } from '../services/captureMidiExport';
// The shared result surface (bundle A): the ONE card every recognition outcome
// lands on. Mounted here as an overlay — this screen stays mounted underneath, so
// closing the card returns the user to the hum flow with nothing re-mounted.
import { RecognitionResultView } from '../components/RecognitionResultView';
// The detected key of the exported take, as text — "Key: G major" — or null
// when the take had no detected key (Batch A: the key the .mid was written in
// is shown, and nothing at all is shown when there was no verdict). The surface
// renders the line; THIS screen derives it, from the take's own key.
import { keyCaption } from '../services/keyDetection';
import type { RecognitionResponse } from '../types';

/** Auto-stop after this long so the melody extractor gets enough signal. */
const RECORDING_TIMEOUT_MS = 12000;

/**
 * 'result' is GONE (bundle A): a confident match no longer renders this screen's
 * own card — it opens the shared result surface, and the screen returns to idle
 * underneath it.
 */
type Stage = 'idle' | 'recording' | 'uploading' | 'no-match' | 'error';

interface HumSearchScreenProps {
  onClose: () => void;
  /** The HUM → MODERN bridge: leave this flow and open the modern "Find any
   *  song" screen (its own recorder), which identifies the actual recording via
   *  the licensed fingerprint service and links the official sheet music.
   *  Offered on the no-match card so a hum miss is never a dead end. */
  onSwitchToModern: () => void;
}

export const HumSearchScreen: React.FC<HumSearchScreenProps> = ({
  onClose,
  onSwitchToModern,
}) => {
  const recorder = useAudioRecorder();
  const [stage, setStage] = useState<Stage>('idle');
  const [outcome, setOutcome] = useState<HumOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hub, setHub] = useState<string | undefined>(undefined);
  // The RESULT the shared surface renders (bundle A): the hum match mapped into
  // the app's own recognition-response shape, with the hosted score the catalog
  // resolved for it. Non-null = the surface is open, which is what replaced this
  // screen's own 'result' stage.
  const [humResult, setHumResult] = useState<RecognitionResponse | null>(null);
  // The take the user just recorded (MIDI export Batch A). Kept as the
  // recording's own URI: "Export MIDI" serializes THIS take and nothing else.
  const [takeUri, setTakeUri] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  // The key the exported .mid was written in ("Key: G major"), set from the
  // export outcome's own key and null when the take had none.
  const [exportKey, setExportKey] = useState<string | null>(null);
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
    setErrorMessage(null);
    setOutcome(null);
    const started = await recorder.startRecording();
    if (!started) {
      // NEVER a silent dead end (the PR #115 rule, now applied here too). The
      // pre-fix code did `if (!started) return;`, which set NOTHING: no error
      // card, no message, no retry — the screen simply sat there and ate taps.
      // Every failed start now lands on the honest error card below.
      const failedStart = humStartFailureOutcome(recorder.takeStartFailure());
      if (!failedStart.keepHookError) recorder.clearError();
      setErrorMessage(failedStart.message);
      setStage(failedStart.stage);
      return;
    }
    setStage('recording');
    timeoutRef.current = setTimeout(() => handleStop(), RECORDING_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.isRecording, recorder.startRecording]);

  const handleStop = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const stopped = await recorder.stopRecording();
    if (!stopped) {
      recorder.clearError();
      setStage('error');
      setErrorMessage('Recording failed — please try again.');
      return;
    }
    const { uri } = stopped;
    // The take we can export later (MIDI export Batch A).
    setTakeUri(stopped.uri);
    setExportNote(null);
    setStage('uploading');
    try {
      const resp = await humToSearch(uri);
      const res = humOutcome(resp);
      setHub(humPhraseHint(resp));
      if (res.ok && res.topMatch) {
        // Save the recognized piece to History (recognition counts as practice).
        await saveRecognition({
          id: res.topMatch.piece_id,
          title: res.topMatch.title,
          composer: res.topMatch.composer,
          savedAt: new Date().toISOString(),
        });
        // THE HOSTED SCORE, best effort (bundle A): a HumMatch carries identity
        // only, so we look the piece up in OUR catalog to get the score the shared
        // surface renders INLINE. A miss (offline, unknown id, no curated score)
        // is not an error — the surface then says honestly that it holds no score
        // for this one. Nothing is ever invented here.
        let sheet: HumResolvedSheet | null = null;
        const info = await fetchPieceById(res.topMatch.piece_id);
        if (info) {
          sheet = {
            sheetMusicUrl: info.sheetMusicUrl,
            // The catalog's own gate. `?? undefined` keeps a MISSING flag
            // missing (the surface only withholds the score on an explicit
            // false — never because we dropped the value on the way through).
            sheetMusicAvailable: info.sheetMusicAvailable ?? undefined,
            isPublicDomain: info.isPublicDomain ?? undefined,
          };
        }
        setOutcome(res);
        setStage('idle');
        setHumResult(humMatchToResultResponse(resp, res.matches, sheet));
      } else {
        setOutcome(res);
        setStage('no-match');
      }
    } catch (err) {
      recorder.completeRecording();
      setStage('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    }
  }, [recorder]);

  const handleRetry = useCallback(() => {
    setOutcome(null);
    setHumResult(null);
    setStage('idle');
    setTimeout(() => handleStart(), 300);
  }, [handleStart]);

  /**
   * "Export MIDI" (Batch A): the user's own take as a Standard MIDI File. The
   * recorded clip is decoded through the app's existing capture seam, tracked by
   * the existing pitch tracker, and written to a .mid that opens in any DAW.
   * Every outcome is surfaced in the card — no silent dead button, and a take
   * with no melody says so instead of writing an empty file. On success the take
   * is stored on the History row so History can export it again later.
   */
  const handleExportMidi = useCallback(async () => {
    if (exporting) return;
    if (!takeUri) {
      setExportNote('Record a take first — then we can write it out as MIDI.');
      return;
    }
    setExporting(true);
    setExportNote(null);
    setExportKey(null);
    try {
      const piece = outcome?.topMatch;
      const result = await exportCaptureMidiFromRecording({
        uri: takeUri,
        title: piece?.title,
      });
      setExportNote(result.message);
      // The key the FILE was written in (the SMF key-signature verdict), or null
      // when the take was too thin to name one — in which case the card prints
      // no key line at all.
      setExportKey(keyCaption(result.key));
      if (result.status === 'exported' && result.take && piece?.piece_id) {
        // Keep the take on the saved row so History can export it again
        // (offline, no re-decode). A missing row is not a failure.
        await updateRecognitionCapture(piece.piece_id, result.take);
      }
    } catch (err) {
      setExportNote(
        err instanceof Error && err.message
          ? err.message
          : 'Could not write the MIDI file on this device — please try again.',
      );
    } finally {
      setExporting(false);
    }
  }, [exporting, takeUri, outcome]);

  // Android hardware BACK (in-place flow — owner bug class 09-23). This screen
  // is not a route and not a modal: its host tab replaces its whole body with it,
  // so an unconsumed BACK press pops React Navigation's last route and finishes
  // the activity (the app "exits"). Consume it here, unwinding ONE level: the
  // shared result surface (a Modal, which handles its own BACK while it is open)
  // first, then back to the screen that opened the hum flow.
  // Guarded by src/services/backExitContract.ts.
  useHardwareBack(() => {
    if (humResult) {
      setHumResult(null);
      return true;
    }
    onClose();
    return true;
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hum, whistle or sing</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heroEmoji}>🎤</Text>
        <Text style={styles.title}>Hum, whistle or sing the melody</Text>
        <Text style={styles.subtitle}>
          Can't play the audio out loud? No problem — hum, whistle or sing the
          tune you hear in your head and we'll find the piece. It's like
          recognition, but from your voice.
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

        {/* Uploading spinner */}
        {stage === 'uploading' && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#e94560" />
            <Text style={styles.loadingText}>Listening to your melody...</Text>
            <Text style={styles.loadingSubtext}>Matching against the catalog</Text>
          </View>
        )}

        {/* Recording / idle trigger */}
        {stage !== 'uploading' && (
          <TouchableOpacity
            style={[styles.micBtn, recorder.isRecording && styles.micBtnActive]}
            onPress={stage === 'recording' ? handleStop : handleStart}
            disabled={recorder.checkingPermissions}
            activeOpacity={0.7}
          >
            <Text style={styles.micBtnIcon}>{recorder.isRecording ? '⏹' : '🎤'}</Text>
          </TouchableOpacity>
        )}

        {recorder.isRecording && (
          <Text style={styles.recordingHint}>
            Recording your melody... tap again to stop & search.
          </Text>
        )}
        {!recorder.isRecording && stage === 'idle' && (
          <>
            <Text style={styles.recordingHint}>
              Tap the mic, hum, whistle or sing a phrase (8–12s is ideal), then
              stop.
            </Text>
            <Text style={styles.idleBetaNote}>
              Library is still growing — try a well-known melody (Für Elise, Ode to Joy).
            </Text>
          </>
        )}

        {/* Error */}
        {stage === 'error' && !recorder.isRecording && (
          <View style={styles.resultCard}>
            <Text style={styles.resultEmoji}>⚠️</Text>
            <Text style={styles.resultTitle}>Something went wrong</Text>
            <Text style={styles.resultText}>
              {errorMessage ?? 'Please try again.'}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* No match — honest, banded, with retry. The copy comes from
            humNoMatchMessage(): "we were close" (best candidate near/above the
            server's floor) vs "we're not sure — library still growing". Never
            a raw percentage, never a fabricated title. */}
        {stage === 'no-match' && outcome && (
          <View style={styles.resultCard}>
            <Text style={styles.resultEmoji}>🔍</Text>
            <Text style={styles.resultTitle}>No match for that melody</Text>
            <Text style={styles.resultText}>{humNoMatchMessage(outcome)}</Text>
            {hub && <Text style={styles.hintText}>{hub}</Text>}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
              <Text style={styles.primaryBtnText}>{HUM_RETRY_CTA}</Text>
            </TouchableOpacity>
            {/* THE BRIDGE (owner-approved 09-22): our melody catalog is small,
                so a hum we don't hold must not be the end of the road. This
                hands the user to the modern "Find any song" flow, where the
                actual recording is identified and the official sheet music is
                linked. Honest wording — we identify the recording, and link the
                sheet music when there is a match. */}
            <TouchableOpacity
              style={styles.bridgeBtn}
              onPress={onSwitchToModern}
              activeOpacity={0.7}
            >
              <Text style={styles.bridgeBtnText}>{HUM_TO_MODERN_CTA}</Text>
              <Text style={styles.bridgeBtnHint}>{HUM_TO_MODERN_BLURB}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* \u2500\u2500 THE ONE RESULT SURFACE (bundle A) \u2500\u2500
            A confident hum match no longer renders a card of its own: it opens the
            SAME result surface every other match uses, which shows the piece's
            hosted score INLINE, the hum provenance, the printed-arrangement search
            the backend supplied, and \u2014 from the contract below \u2014 the export of the
            take this screen just recorded. The screen stays mounted underneath, so
            Done/BACK simply reveals the hum flow again. */}
        {humResult ? (
          <RecognitionResultView
            visible
            phase={{ type: 'success', response: humResult }}
            onClose={() => setHumResult(null)}
            onRetry={handleRetry}
            midiExport={{
              takeUri,
              exporting,
              note: exportNote,
              keyLine: exportKey,
              onExport: handleExportMidi,
            }}
          />
        ) : null}
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
  backBtn: {
    marginRight: 12,
  },
  backText: {
    color: '#e94560',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 60,
    alignItems: 'center',
  },
  heroEmoji: {
    fontSize: 56,
    marginBottom: 8,
  },
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
  micBtn: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#e94560',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 18,
    shadowColor: '#e94560',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  micBtnActive: {
    backgroundColor: '#ff6b6b',
  },
  micBtnIcon: {
    fontSize: 44,
    color: '#ffffff',
  },
  recordingHint: {
    fontSize: 13,
    color: '#a0a0b8',
    textAlign: 'center',
    marginBottom: 20,
  },
  idleBetaNote: {
    fontSize: 12,
    color: '#7d7d99',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: -12,
    marginBottom: 20,
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
  settingsBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingCard: {
    alignItems: 'center',
    marginTop: 10,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 12,
  },
  loadingSubtext: {
    fontSize: 13,
    color: '#a0a0b8',
    marginTop: 4,
  },
  resultCard: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  resultEmoji: {
    fontSize: 44,
    marginBottom: 8,
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  resultText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 16,
  },
  hintText: {
    fontSize: 12,
    color: '#4ecdc4',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  matchTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  matchComposer: {
    fontSize: 15,
    color: '#a0a0b8',
    marginTop: 2,
  },
  matchConfidence: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  otherMatches: {
    width: '100%',
    marginTop: 8,
    marginBottom: 16,
  },
  otherMatchesTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#a0a0b8',
    marginBottom: 6,
  },
  otherMatch: {
    fontSize: 13,
    color: '#c0c0d0',
    marginBottom: 4,
  },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  /** The HUM → MODERN bridge action: bordered in the app's teal accent so it
   *  reads as a route onward, not as a second retry. */
  bridgeBtn: {
    backgroundColor: '#0f3460',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },
  bridgeBtnText: {
    color: '#4ecdc4',
    fontSize: 15,
    fontWeight: '700',
  },
  bridgeBtnHint: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
  },
  /** The MIDI export action: bordered in the app's teal accent (like the hum →
   *  modern bridge) so it reads as an added capability, not a second retry. */
  midiBtn: {
    backgroundColor: '#0f3460',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },
  midiBtnText: {
    color: '#4ecdc4',
    fontSize: 15,
    fontWeight: '700',
  },
  midiBtnHint: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
  },
  /** The detected key of the exported take ("Key: G major") — shown only when
   *  the take really had one, so it reads as a fact about the file. */
  exportKeyText: {
    color: '#4ecdc4',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  secondaryBtn: {
    marginTop: 10,
    padding: 8,
  },
  secondaryBtnText: {
    color: '#a0a0b8',
    fontSize: 14,
    fontWeight: '600',
  },
});
