/**
 * Audio recording hook for NoteSnap.
 *
 * Uses expo-av with an explicit AAC (.m4a) RecordingOptions. The uploaded
 * filename/type in api.ts mirrors that; the backend sniffs content rather than
 * trusting the label.
 *
 * SECOND-CAPTURE SAFETY (owner repro 09-22): the same hook backs the modern
 * "Find any song" flow, whose retry resamples immediately after a first pass.
 * Three guarantees make that second capture reliable, and each one is asserted
 * by src/services/modernRetryContract.ts + scripts/recognitionRetry.test.ts:
 *
 *   1. every recording is bounded — `stopAndUnloadAsync()`, the audio-mode
 *      release, the on-disk check and telemetry are all raced against a timeout,
 *      because the caller only shows its loading/error surface AFTER the stop
 *      resolves. An unbounded stop that never resolves is a blank screen.
 *   2. a new capture tears down any recorder still held, so pass 2 cannot race
 *      pass 1's orphaned recorder on a dirty audio session.
 *   3. every failure is readable by the caller immediately (via the ref-based
 *      takeStartFailure() / takeStopFailure(), which do not suffer the stale
 *      closure of React state read right after an await) so a failure can always
 *      become an honest, user-visible message.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import {
  buildCaptureTelemetry,
  type CaptureDiagnostics,
} from '../services/captureTelemetry';
import {
  startFailure,
  stopFailure,
  START_FAILURE_COPY,
  type StartFailure,
  type StartFailureReason,
  type StopFailure,
  type StopFailureReason,
} from '../services/recognitionRetry';

export type RecordingPhase = 'idle' | 'recording' | 'processing' | 'done';

/** How often we sample the recorder's live metering (dB) while capturing. */
const METERING_INTERVAL_MS = 200;

/**
 * Upper bounds (ms) on every step that the caller has to wait for. The
 * recognition screens only render their loading/result/error surface once
 * `stopRecording()` resolves, so none of these may wait forever.
 */
const STOP_UNLOAD_TIMEOUT_MS = 5000;
const AUDIO_MODE_TIMEOUT_MS = 2000;
const FILE_CHECK_TIMEOUT_MS = 3000;
const TELEMETRY_TIMEOUT_MS = 5000;

/**
 * Await `p` for at most `ms`. If it has not settled (or rejected) in time,
 * resolve `fallback` instead. Used so a hung native call degrades into an honest
 * error message rather than a screen that never updates.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Explicit recording options for NoteSnap recognition.
 *
 * We intentionally do NOT rely on the bundled HIGH_QUALITY preset here: we
 * spell out the exact per-platform codec so it is immune to any preset drift in
 * expo-av, and so the produced file is always an AAC (.m4a) on both platforms —
 * which is exactly what the backend's @audio/decode-aac pipeline expects. The
 * backend sniffs content bytes, but a correct extension/MIME keeps the upload
 * label honest too.
 *
 * Android: .m4a / MPEG-4 container / AAC encoder, 44.1kHz, stereo, 128kbps.
 * iOS:    .m4a / MPEG4AAC, high audio quality, 44.1kHz, stereo, 128kbps.
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/mp4',
    bitsPerSecond: 128000,
  },
};

/**
 * True only if the file at `uri` currently exists on disk and is non-empty.
 * A missing/0-byte file means the microphone delivered no audio (e.g. the
 * recorder was stopped before any data was flushed) — such a clip would only
 * fail downstream, so we reject it here instead of silently continuing.
 */
async function hasNonEmptyFile(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!info && info.exists && info.size > 0;
  } catch {
    return false;
  }
}

export interface AudioRecorderState {
  /** Current lifecycle phase for the recording/recognition UI. */
  phase: RecordingPhase;
  /** Whether a recording is currently in progress. */
  isRecording: boolean;
  /** Error message string, or null if no error. */
  error: string | null;
  /** Whether we're waiting for permissions to be checked. */
  checkingPermissions: boolean;
}

export interface StoppedRecording {
  uri: string;
  /** Capture-path diagnostics collected at stop time (see captureTelemetry). */
  diagnostics: CaptureDiagnostics;
}

/** What a permission check resolved to, in a form the caller can surface. */
type PermissionOutcome =
  | { ok: true }
  | { ok: false; reason: StartFailureReason; message: string };

export function useAudioRecorder() {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [checkingPermissions, setCheckingPermissions] = useState(false);
  // Live dB metering samples collected while recording (for peak/RMS dBFS).
  const meteringRef = useRef<number[]>([]);
  const meteringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Durations captured before final teardown (expo-av may lose this after unload).
  const durationMsRef = useRef<number | null>(null);
  // A start attempt is in flight — a second concurrent start would create a
  // second Audio.Recording and orphan the first one (mic session never released).
  const startInFlightRef = useRef(false);
  // Last failure, readable by the caller IMMEDIATELY after the await returns
  // (React state read through a render closure would still be the old value).
  const lastStartFailureRef = useRef<StartFailure | null>(null);
  const lastStopFailureRef = useRef<StopFailure | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (meteringTimerRef.current) clearInterval(meteringTimerRef.current);
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, []);

  /**
   * Release a recorder we still hold: stop the metering sampler, stop+unload
   * with a bound, and drop the reference. Used before starting a new capture so
   * a retry always runs on a clean audio session, and by stopRecording().
   */
  const releaseRecording = useCallback(
    async (recording: Audio.Recording | null): Promise<void> => {
      if (meteringTimerRef.current) {
        clearInterval(meteringTimerRef.current);
        meteringTimerRef.current = null;
      }
      if (!recording) return;
      await withTimeout(
        recording.stopAndUnloadAsync().catch(() => undefined),
        STOP_UNLOAD_TIMEOUT_MS,
        undefined,
      );
    },
    [],
  );

  /**
   * Resolve whether the microphone may be used, setting the hook's `error` on
   * refusal. Returns the reason alongside the message so the caller can surface
   * it without reading React state (which would still be stale right after an
   * await — exactly how the pass-2 failure went silent, owner repro 09-22).
   */
  const resolvePermission = useCallback(async (): Promise<PermissionOutcome> => {
    const fail = (reason: StartFailureReason): PermissionOutcome => {
      const message = START_FAILURE_COPY[reason];
      setError(message);
      return { ok: false, reason, message };
    };

    // Safety watchdog: if the permission check hangs — e.g. a redundant second
    // native dialog never resolves, or the system dialog is lost when the app
    // is backgrounded — force `checkingPermissions` back to false so the UI can
    // never get stuck on "Checking...". The watchdog never starts a recording;
    // it only unsticks the button and surfaces a clear error.
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      setCheckingPermissions(false);
      setError(START_FAILURE_COPY['permission-timeout']);
    }, 8000);

    try {
      // Resolve whether the microphone is permitted, using the correct
      // authoritative path for each platform:
      //  - Android: the platform RECORD_AUDIO runtime permission IS the mic
      //    permission. Asking for it again via Audio.requestPermissionsAsync()
      //    issues a redundant second platform request that can hang or never
      //    resolve on Android/Expo 52 builds — so we skip it entirely once
      //    PermissionsAndroid has granted the mic. expo-av records through the
      //    same RECORD_AUDIO permission already granted here, so nothing is lost.
      //  - iOS: Audio.requestPermissionsAsync() is the proper request path.
      let permitted = false;

      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message:
              'NoteSnap needs access to your microphone to identify music playing around you.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          },
        );
        permitted = granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        permitted = status === 'granted';
      }

      // If the watchdog already fired (the check ran too long / a dialog was
      // lost), treat this as an aborted check: return the timeout failure so we
      // never start a phantom recording based on a stale grant.
      if (watchdogFired) return fail('permission-timeout');

      if (!permitted) return fail('permission-denied');

      return { ok: true };
    } catch {
      return fail('permission-error');
    } finally {
      // Fail-safe: no matter which path ran (success, denial, error, timeout,
      // or a hung promise), clear the watchdog and guarantee `checkingPermissions`
      // resets to false.
      clearTimeout(watchdog);
      setCheckingPermissions(false);
    }
  }, []);

  /** Mark the recognition request complete so the UI can return to idle/done. */
  const completeRecording = useCallback(() => setPhase('done'), []);

  /** Take the failure from the last startRecording() call that failed. */
  const takeStartFailure = useCallback((): StartFailure | null => {
    const failure = lastStartFailureRef.current;
    lastStartFailureRef.current = null;
    return failure;
  }, []);

  /** Take the failure from the last stopRecording() call that returned null. */
  const takeStopFailure = useCallback((): StopFailure | null => {
    const failure = lastStopFailureRef.current;
    lastStopFailureRef.current = null;
    return failure;
  }, []);

  /**
   * Prepare for a fresh pass (the retry/resample path): drop any stale error and
   * phase so the second capture starts from a clean state instead of carrying
   * pass 1's 'processing'/'done' phase or its error card.
   */
  const resetForRetry = useCallback(() => {
    lastStartFailureRef.current = null;
    lastStopFailureRef.current = null;
    setError(null);
    setPhase('idle');
  }, []);

  /** Open the device Settings app so the user can manually grant permission. */
  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      Alert.alert(
        'Settings',
        'Please open your device settings and grant microphone access to NoteSnap.',
      );
    });
  }, []);

  /**
   * Start recording audio from the microphone.
   * Requests permission if not already granted.
   *
   * Returns true only when the mic is genuinely capturing. On any failure it
   * returns false AND records why (takeStartFailure()), so the caller can show
   * the user an honest message instead of returning silently.
   */
  const startRecording = useCallback(async (): Promise<boolean> => {
    setError(null);
    lastStartFailureRef.current = null;

    // Never stack a second capture on top of a start that is still running: the
    // second Audio.Recording() would overwrite the ref and orphan the first one.
    if (startInFlightRef.current) {
      lastStartFailureRef.current = startFailure('busy');
      return false;
    }
    startInFlightRef.current = true;

    try {
      const permission = await resolvePermission();
      if (!permission.ok) {
        lastStartFailureRef.current = startFailure(permission.reason);
        return false;
      }

      // Pass-2 safety: tear down any recorder still held from an earlier pass
      // BEFORE creating a new one, so the fresh capture never races an orphaned
      // recorder for the mic (the second-recording dead-end, owner repro 09-22).
      if (recordingRef.current) {
        const stale = recordingRef.current;
        recordingRef.current = null;
        await releaseRecording(stale);
      }

      // Configure audio mode for recording. Bounded: a hung audio-mode call must
      // not be able to leave the UI waiting forever.
      await withTimeout(
        Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        }),
        AUDIO_MODE_TIMEOUT_MS,
        undefined,
      );

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setPhase('recording');

      // Start sampling the live metering (dB) so we can report peak/RMS level of
      // the captured buffer. Best-effort — a recorder that doesn't support
      // metering simply yields no samples.
      meteringRef.current = [];
      durationMsRef.current = null;
      if (meteringTimerRef.current) clearInterval(meteringTimerRef.current);
      meteringTimerRef.current = setInterval(() => {
        recording
          .getStatusAsync()
          .then((status) => {
            if (status && typeof (status as { metering?: number }).metering === 'number') {
              const m = (status as { metering: number }).metering;
              if (Number.isFinite(m)) meteringRef.current.push(m);
            }
            if (
              status &&
              typeof (status as { durationMillis?: number }).durationMillis === 'number'
            ) {
              durationMsRef.current = (status as { durationMillis: number }).durationMillis;
            }
          })
          .catch(() => {});
      }, METERING_INTERVAL_MS);

      return true;
    } catch {
      lastStartFailureRef.current = startFailure('start-error');
      setError(START_FAILURE_COPY['start-error']);
      return false;
    } finally {
      startInFlightRef.current = false;
    }
  }, [releaseRecording, resolvePermission]);

  /**
   * Stop recording and return the finalised audio file URI.
   *
   * Never silently succeeds with a dead end: if no clip could be produced (no
   * recording in progress, the recorder never finalised, or the file is empty)
   * it returns `null` AND records why (takeStopFailure()) with a human-readable
   * message. The caller is expected to surface that — it must NOT silently reset
   * to idle. Every wait in here is bounded, because the caller's loading surface
   * only appears once this resolves.
   */
  const stopRecording = useCallback(async (): Promise<StoppedRecording | null> => {
    const noteStopFailure = (reason: StopFailureReason): null => {
      setPhase('idle');
      const failure = stopFailure(reason);
      lastStopFailureRef.current = failure;
      setError(failure.message);
      return null;
    };

    const recording = recordingRef.current;
    if (!recording) {
      setIsRecording(false);
      return noteStopFailure('no-recording');
    }

    // Capture the URI BEFORE tearing the recorder down. The prepared file path
    // is already known the moment prepareToRecordAsync() succeeded, and reading
    // it after stopAndUnloadAsync() can return null on some Android/expo-av
    // builds — which is exactly the silent "loop back to Tap to identify" the
    // user was hitting. Snapshotting it first removes that whole class of bug.
    const uri = recording.getURI();

    // Stop the metering sampler before tearing the recorder down.
    if (meteringTimerRef.current) {
      clearInterval(meteringTimerRef.current);
      meteringTimerRef.current = null;
    }
    const metering = meteringRef.current.slice();
    // Capture the recorded duration from the last status read (expo-av loses
    // durationMillis after unload).
    const durationMs = durationMsRef.current;

    // Stop + unload, but treat a thrown or hung stop as a signal to discard the
    // clip (e.g. Android E_AUDIO_NODATA when nothing was recorded) rather than
    // letting it abort silently. The stop is BOUNDED: a recorder that never
    // reports "stopped" must not hang the caller's whole screen. We still verify
    // the file on disk below, so a hung stop that left a valid file is salvaged.
    recordingRef.current = null;
    await releaseRecording(recording);
    setIsRecording(false);

    // Always release the audio session back to normal playback mode (bounded).
    await withTimeout(
      Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }),
      AUDIO_MODE_TIMEOUT_MS,
      undefined,
    );

    if (!uri) return noteStopFailure('no-uri');

    // The file must actually exist and contain audio. A null/0-byte clip is a
    // real failure (mic captured nothing), not a successful stop. The check is
    // bounded too: an unreadable-in-time clip is reported as a save failure
    // rather than stalling the caller forever.
    const exists = await withTimeout(
      hasNonEmptyFile(uri),
      FILE_CHECK_TIMEOUT_MS,
      null as boolean | null,
    );
    if (exists === false) return noteStopFailure('empty');
    if (exists === null) return noteStopFailure('no-uri');

    setPhase('processing');

    // Build capture-path telemetry (format, sample rate, channels, dBFS, bytes)
    // from the finalised clip so the next test can read off exactly what the
    // mic recorded. Never throws on an unparseable clip, and never blocks the
    // caller for longer than its bound.
    const diagnostics: CaptureDiagnostics =
      (await withTimeout(
        buildCaptureTelemetry(uri, { durationMs, metering }),
        TELEMETRY_TIMEOUT_MS,
        null as CaptureDiagnostics | null,
      )) ?? {
        durationMs,
        sampleRate: null,
        channels: null,
        peakDbFS: null,
        rmsDbFS: null,
        bytes: null,
        format: null,
      };
    // eslint-disable-next-line no-console
    console.log(
      `[recognition] capture done: dur=${String(diagnostics.durationMs)}ms ` +
        `rate=${String(diagnostics.sampleRate)}Hz ch=${String(diagnostics.channels)} ` +
        `peak=${String(diagnostics.peakDbFS)}dB rms=${String(diagnostics.rmsDbFS)}dB ` +
        `bytes=${String(diagnostics.bytes)} fmt=${String(diagnostics.format)}`,
    );

    lastStopFailureRef.current = null;
    return { uri, diagnostics };
  }, [releaseRecording]);

  return {
    phase,
    isRecording,
    error,
    checkingPermissions,
    startRecording,
    stopRecording,
    completeRecording,
    resetForRetry,
    takeStartFailure,
    takeStopFailure,
    openSettings,
    clearError: () => setError(null),
  };
}
