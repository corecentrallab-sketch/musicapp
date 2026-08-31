/**
 * HumSearchScreen — the tap-to-hum/whistle/sing-to-search flow (Tier-1
 * differentiator, distinct from the audio-recognize mode).
 *
 * The user hums/whistles/sings a melody into the mic; we record on-device
 * (reusing useAudioRecorder) and POST it to /api/hum. On a confident match we
 * show the matched piece and let the user open it in the existing
 * PieceDetailScreen; on no-match we show the honest "hum a longer/clearer
 * phrase" message and invite retry. We NEVER fabricate a title.
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
import { humToSearch } from '../services/api';
import { humOutcome, humPhraseHint, type HumOutcome } from '../services/tier1';
import { saveRecognition } from '../services/storage';
import { PieceDetailScreen } from './PieceDetailScreen';
import type { DailyChallengePiece, HumMatch } from '../types';

/** Auto-stop after this long so the melody extractor gets enough signal. */
const RECORDING_TIMEOUT_MS = 12000;

type Stage =
  | 'idle'
  | 'recording'
  | 'uploading'
  | 'result'
  | 'no-match'
  | 'error';

interface HumSearchScreenProps {
  onClose: () => void;
}

/** Build a DailyChallengePiece from a hum match for PieceDetailScreen. A hum
 *  result carries no sheet URL, so PieceDetail renders its honest "coming
 *  soon" score state — never a broken link. */
function matchToPiece(match: HumMatch): DailyChallengePiece {
  return {
    id: match.piece_id,
    title: match.title,
    composer: match.composer,
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: `Hum/whistle/sing matched with ${Math.round(
      match.confidence * 100,
    )}% confidence`,
  };
}

export const HumSearchScreen: React.FC<HumSearchScreenProps> = ({ onClose }) => {
  const recorder = useAudioRecorder();
  const [stage, setStage] = useState<Stage>('idle');
  const [outcome, setOutcome] = useState<HumOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hub, setHub] = useState<string | undefined>(undefined);
  const [showDetail, setShowDetail] = useState<DailyChallengePiece | null>(null);
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
    if (!started) return;
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
        setOutcome(res);
        setStage('result');
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
    setStage('idle');
    setTimeout(() => handleStart(), 300);
  }, [handleStart]);

  // ── Piece detail (full-screen, as the rest of the app does) ──
  if (showDetail) {
    return (
      <PieceDetailScreen piece={showDetail} onBack={() => setShowDetail(null)} />
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hum it</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heroEmoji}>🎤</Text>
        <Text style={styles.title}>Hum, whistle or sing the melody</Text>
        <Text style={styles.subtitle}>
          Can't play the audio out loud? No problem — hum the tune you hear in
          your head and we'll find the piece. It's like recognition, but from
          your voice.
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
            Humming... tap again to stop & search.
          </Text>
        )}
        {!recorder.isRecording && stage === 'idle' && (
          <Text style={styles.recordingHint}>
            Tap the mic, hum a phrase (8–12s is ideal), then stop.
          </Text>
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

        {/* No match — honest, with retry */}
        {stage === 'no-match' && outcome && (
          <View style={styles.resultCard}>
            <Text style={styles.resultEmoji}>🔍</Text>
            <Text style={styles.resultTitle}>No match for that hum</Text>
            <Text style={styles.resultText}>
              {outcome.reason ??
                "We couldn't identify that melody — hum or whistle a longer, clearer phrase and try again."}
            </Text>
            {hub && <Text style={styles.hintText}>{hub}</Text>}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
              <Text style={styles.primaryBtnText}>Hum Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Result — matched piece(s) */}
        {stage === 'result' && outcome && outcome.topMatch && (
          <View style={styles.resultCard}>
            <Text style={styles.resultEmoji}>🎵</Text>
            <Text style={styles.resultTitle}>We found it!</Text>
            {hub && <Text style={styles.hintText}>{hub}</Text>}
            <View style={styles.matchCard}>
              <Text style={styles.matchTitle}>{outcome.topMatch.title}</Text>
              <Text style={styles.matchComposer}>
                {outcome.topMatch.composer}
              </Text>
              <Text style={styles.matchConfidence}>
                {Math.round(outcome.topMatch.confidence * 100)}% match
              </Text>
            </View>
            {outcome.matches.length > 1 && (
              <View style={styles.otherMatches}>
                <Text style={styles.otherMatchesTitle}>Other matches:</Text>
                {outcome.matches.slice(1, 4).map((m, i) => (
                  <Text key={m.piece_id ?? i} style={styles.otherMatch}>
                    {m.title} — {m.composer} (
                    {Math.round(m.confidence * 100)}%)
                  </Text>
                ))}
              </View>
            )}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setShowDetail(matchToPiece(outcome.topMatch!))}
            >
              <Text style={styles.primaryBtnText}>View Piece Details</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
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
  matchCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#4ecdc4',
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
