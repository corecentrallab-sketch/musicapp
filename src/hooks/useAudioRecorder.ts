/**
 * Audio recording hook for NoteSnap.
 *
 * Uses expo-av with the HIGH_QUALITY preset to record microphone audio
 * as AAC (.m4a). The uploaded filename/type in api.ts mirrors that; the
 * backend sniffs content rather than trusting the label.
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
  evaluateLoudness,
  gateFromMetering,
  type LoudnessMetrics,
} from '../services/loudnessGate';

export type RecordingPhase = 'idle' | 'recording' | 'processing' | 'done';

/** How often we sample the recorder's live metering (dB) while capturing. */
const METERING_INTERVAL_MS = 200;

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
  /** Pre-upload loudness/quality gate verdict for the actual captured buffer. */
  gate: LoudnessMetrics;
}

/**
 * Hermes-safe AAC -> PCM decode seam.
 *
 * The authoritative loudness gate must run on the DECODED audio of the uploaded
 * buffer (the expo-av AGC meter cannot measure real loudness — see
 * loudnessGate.ts). Hermes has no WebAssembly and Android MediaRecorder cannot
 * emit raw PCM, and a bundled pure-JS AAC decoder is not yet available, so this
 * seam returns null today and the recorder falls back to `gateFromMetering`,
 * which blocks only unambiguous dead captures. Wire a native MediaCodec / JSC-WASM
 * decode here to enable full decoded-PCM gating (block silent, too-short and
 * not-spread, per the validated `evaluateLoudness` thresholds).
 */
async function decodeCaptureToPcm(
  _uri: string,
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  return null;
}

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
   * Request microphone permission.
   * Returns true if granted, false if denied.
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setCheckingPermissions(true);
    setError(null);

    // Safety watchdog: if the permission check hangs — e.g. a redundant second
    // native dialog never resolves, or the system dialog is lost when the app
    // is backgrounded — force `checkingPermissions` back to false so the UI can
    // never get stuck on "Checking...". The watchdog never starts a recording;
    // it only unsticks the button and surfaces a clear error.
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      setCheckingPermissions(false);
      setError(
        'Could not finish checking microphone permission. Please tap again to retry.',
      );
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
      // lost), treat this as an aborted check: return false so we never start a
      // phantom recording based on a stale grant.
      if (watchdogFired) {
        setError('Microphone permission check timed out. Please tap again to retry.');
        return false;
      }

      if (!permitted) {
        setError(
          'Microphone access is required to recognize music. Please grant permission in your device settings.',
        );
        return false;
      }

      return true;
    } catch (err) {
      setError('Failed to check microphone permissions.');
      return false;
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
   */
  const startRecording = useCallback(async (): Promise<boolean> => {
    setError(null);

    const permitted = await requestPermission();
    if (!permitted) return false;

    try {
      // Configure audio mode for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

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
    } catch (err) {
      setError('Failed to start recording. Please try again.');
      return false;
    }
  }, [requestPermission]);

  /**
   * Stop recording and return the finalised audio file URI.
   *
   * Never silently succeeds with a dead end: if no clip could be produced (no
   * recording in progress, the recorder never finalised, or the file is empty)
   * it returns `null` AND sets a human-readable `error`. The caller is expected
   * to surface that error to the user — it must NOT silently reset to idle.
   */
  const stopRecording = useCallback(async (): Promise<StoppedRecording | null> => {
    const recording = recordingRef.current;
    if (!recording) {
      setIsRecording(false);
      setPhase('idle');
      setError('No recording in progress. Please try again.');
      return null;
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

    // Stop + unload, but treat a thrown stop error as a signal to discard the
    // clip (e.g. Android E_AUDIO_NODATA when nothing was recorded) rather than
    // letting it abort silently. We still verify the file on disk below, so a
    // throw that left a valid file can still be salvaged.
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // Swallowed — the on-disk existence/size check below is authoritative.
    }
    recordingRef.current = null;
    setIsRecording(false);

    // Always release the audio session back to normal playback mode.
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch {
      // Non-fatal — recording is already finalised.
    }

    if (!uri) {
      setPhase('idle');
      setError('Recording failed to save. Please try again.');
      return null;
    }

    // The file must actually exist and contain audio. A null/0-byte clip is a
    // real failure (mic captured nothing), not a successful stop.
    if (!(await hasNonEmptyFile(uri))) {
      setPhase('idle');
      setError('Recording was empty. Please move closer to the music and try again.');
      return null;
    }

    setPhase('processing');

    // Build capture-path telemetry (format, sample rate, channels, dBFS, bytes)
    // from the finalised clip so the next test can read off exactly what the
    // mic recorded. Never throws on an unparseable clip.
    let diagnostics: CaptureDiagnostics;
    try {
      diagnostics = await buildCaptureTelemetry(uri, { durationMs, metering });
    } catch {
      diagnostics = {
        durationMs,
        sampleRate: null,
        channels: null,
        peakDbFS: null,
        rmsDbFS: null,
        bytes: null,
        format: null,
      };
    }
    // eslint-disable-next-line no-console
    console.log(
      `[recognition] capture done: dur=${String(diagnostics.durationMs)}ms ` +
        `rate=${String(diagnostics.sampleRate)}Hz ch=${String(diagnostics.channels)} ` +
        `peak=${String(diagnostics.peakDbFS)}dB rms=${String(diagnostics.rmsDbFS)}dB ` +
        `bytes=${String(diagnostics.bytes)} fmt=${String(diagnostics.format)}`,
    );

    // ── Pre-upload loudness/quality gate ──
    // Prefer the authoritative decoded-PCM gate when a Hermes-safe AAC decode is
    // available; otherwise fall back to the conservative metering+metadata gate.
    // On a "block" verdict the caller must NOT upload a useless/silent clip.
    let gate: LoudnessMetrics;
    try {
      const decoded = await decodeCaptureToPcm(uri);
      if (decoded) {
        gate = evaluateLoudness(decoded.samples, decoded.sampleRate);
      } else {
        gate = gateFromMetering(
          metering,
          durationMs,
          diagnostics.bytes,
        );
      }
    } catch {
      gate = gateFromMetering(metering, durationMs, diagnostics.bytes);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[recognition] gate: ${gate.verdict} (${gate.reason}) ` +
        `peak=${String(gate.peakDb)}dB rms=${String(gate.rmsDb)}dB ` +
        `active=${String(Math.round((gate.activeFraction ?? 0) * 100))}%`,
    );

    return { uri, diagnostics, gate };
  }, []);

  return {
    phase,
    isRecording,
    error,
    checkingPermissions,
    startRecording,
    stopRecording,
    completeRecording,
    openSettings,
    clearError: () => setError(null),
  };
}
