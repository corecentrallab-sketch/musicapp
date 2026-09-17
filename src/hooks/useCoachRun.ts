/**
 * useCoachRun — the practice-coach controller (slice 3).
 *
 * Owns the microphone flow for the coach card, REUSING the app's existing
 * recorder and permission handling (hooks/useAudioRecorder.ts — the same code
 * path the hum/recognition surfaces use, including its permission watchdog and
 * its "empty clip is a failure, not a success" rule), and drives the pure state
 * machine in services/coachRun.ts.
 *
 * The one thing it does NOT own is how a recording becomes samples: that is the
 * injected `SamplesProvider` (see services/coachCapture.ts). This is deliberate
 * — the app cannot decode AAC on-device today, so the decode step is the honest
 * seam, and the card must never show a score it did not measure.
 *
 * Persistence: a SCORED run is appended with savePracticeSessionLocal() (slice 1)
 * and the card's history numbers are then read back from the same store, so the
 * coach's accuracy/best always matches the practice history on the device.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useAudioRecorder } from './useAudioRecorder';
import {
  coachRunReducer,
  initialCoachRunState,
  isScorableOutcome,
  scoreCoachRun,
  summarizeHistory,
  coachUnavailableOutcome,
  EMPTY_COACH_HISTORY,
  type CoachHistoryView,
  type CoachRunOutcome,
  type CoachRunPhase,
} from '../services/coachRun';
import {
  captureErrorMessage,
  createDefaultSamplesProvider,
  isCaptureUnavailable,
  type SamplesProvider,
} from '../services/coachCapture';
import {
  getPracticeHistoryLocal,
  savePracticeSessionLocal,
} from '../services/practiceHistoryStore';

export interface UseCoachRunOptions {
  /** Stable piece id — the key practice history is stored under. */
  pieceId: string;
  /** Piece title, used in the coach's positive copy. */
  pieceTitle?: string;
  /** The piece's reference melody ('' → the card shows the honest coming-soon state). */
  abc: string;
  /** Optional tempo override; otherwise the ABC's Q:, then 100 bpm. */
  tempoBpm?: number;
  /** Swap the capture path (tests / a future in-app decoder). */
  samplesProvider?: SamplesProvider;
}

export interface CoachRunController {
  phase: CoachRunPhase;
  /** Most specific error we have: the recorder's, else the run's. */
  error: string | null;
  outcome: CoachRunOutcome | null;
  history: CoachHistoryView;
  isRecording: boolean;
  checkingPermissions: boolean;
  /** True when this piece has a reference melody to score against. */
  hasReference: boolean;
  /** True while the last measured run can be shown/saved. */
  scored: boolean;
  start: () => Promise<void>;
  stopAndScore: () => Promise<void>;
  reset: () => void;
  clearError: () => void;
  openSettings: () => void;
}

export function useCoachRun(options: UseCoachRunOptions): CoachRunController {
  const { pieceId, pieceTitle, abc, tempoBpm } = options;

  const recorder = useAudioRecorder();
  const [state, dispatch] = useReducer(coachRunReducer, initialCoachRunState);

  // The provider is resolved once: swapping it mid-recording would be a bug.
  const providerRef = useRef<SamplesProvider | null>(null);
  if (providerRef.current === null) {
    providerRef.current = options.samplesProvider ?? createDefaultSamplesProvider();
  }
  const provider = providerRef.current;

  /** Re-read this piece's stored runs (the card's last/best accuracy). */
  const reloadHistory = useCallback(async () => {
    try {
      const sessions = await getPracticeHistoryLocal(pieceId);
      dispatch({ type: 'history', history: summarizeHistory(sessions, pieceId) });
    } catch {
      dispatch({ type: 'history', history: { ...EMPTY_COACH_HISTORY } });
    }
  }, [pieceId]);

  // Load this piece's stored runs whenever the piece changes.
  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory]);

  const hasReference = typeof abc === 'string' && abc.trim().length > 0;

  const start = useCallback(async () => {
    if (!hasReference) return;
    dispatch({ type: 'record-started', at: Date.now() });
    const started = await recorder.startRecording();
    if (!started) {
      // The recorder owns the human-readable reason (permission denied, busy
      // audio session, …) — the card surfaces it from `error`, so this only has
      // to move the card out of the recording state.
      dispatch({ type: 'failed' });
    }
  }, [hasReference, recorder]);

  const stopAndScore = useCallback(async () => {
    if (!recorder.isRecording) return;

    const stopped = await recorder.stopRecording();
    if (!stopped) {
      // No clip on disk (or nothing was recorded): a real failure the recorder
      // has already labelled. Never scored, never saved.
      dispatch({ type: 'failed' });
      return;
    }

    dispatch({ type: 'captured' });

    const durationMs =
      typeof stopped.diagnostics?.durationMs === 'number' && stopped.diagnostics.durationMs > 0
        ? stopped.diagnostics.durationMs
        : null;

    let capturedDurationSec = durationMs != null ? durationMs / 1000 : 0;
    let samples: Float32Array | null = null;
    let sampleRate = 0;

    try {
      const captured = await provider(stopped.uri, { durationMs });
      samples = captured.samples;
      sampleRate = captured.sampleRate;
      if (captured.durationSec > 0) capturedDurationSec = captured.durationSec;
    } catch (err) {
      if (isCaptureUnavailable(err)) {
        // honest "we cannot hear you yet" state — no score, no history entry
        dispatch({
          type: 'finished',
          outcome: coachUnavailableOutcome({
            abc,
            tempoBpm,
            durationSec: capturedDurationSec,
          }),
        });
      } else {
        dispatch({ type: 'failed', message: captureErrorMessage(err) });
      }
      return;
    }

    const outcome = scoreCoachRun({
      samples,
      sampleRate,
      abc,
      pieceTitle,
      durationSec: capturedDurationSec,
      tempoBpm,
    });

    dispatch({ type: 'finished', outcome });

    if (isScorableOutcome(outcome) && outcome.accuracyPct != null) {
      try {
        await savePracticeSessionLocal({
          pieceId,
          accuracyPct: outcome.accuracyPct,
          durationSec: outcome.durationSec,
        });
      } catch {
        // Storage failure must not hide the result the user just earned.
      }
      await reloadHistory();
    }
  }, [abc, pieceId, pieceTitle, provider, recorder, reloadHistory, tempoBpm]);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const error = useMemo(() => recorder.error ?? state.error, [recorder.error, state.error]);

  return {
    phase: state.phase,
    error,
    outcome: state.outcome,
    history: state.history,
    isRecording: recorder.isRecording,
    checkingPermissions: recorder.checkingPermissions,
    hasReference,
    scored: isScorableOutcome(state.outcome),
    start,
    stopAndScore,
    reset,
    clearError: () => {
      recorder.clearError();
      dispatch({ type: 'reset' });
    },
    openSettings: recorder.openSettings,
  };
}

/** Default export kept for symmetry with the other hooks in this folder. */
export default useCoachRun;
