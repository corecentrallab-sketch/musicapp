/**
 * Audio recording hook for NoteSnap.
 *
 * Uses expo-av with the HIGH_QUALITY preset to record microphone audio
 * as AAC (.m4a). The uploaded filename/type in api.ts mirrors that; the
 * backend sniffs content rather than trusting the label.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';

export type RecordingPhase = 'idle' | 'recording' | 'processing' | 'done';

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

export function useAudioRecorder() {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [checkingPermissions, setCheckingPermissions] = useState(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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

    try {
      // Android requires explicit runtime permission
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
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setError(
            'Microphone access is required to recognize music. Please grant permission in your device settings.',
          );
          setCheckingPermissions(false);
          return false;
        }
      }

      // iOS and Android: expo-av permission
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setError(
          'Microphone access is required to recognize music. Please grant permission in your device settings.',
        );
        setCheckingPermissions(false);
        return false;
      }

      setCheckingPermissions(false);
      return true;
    } catch (err) {
      setError('Failed to check microphone permissions.');
      setCheckingPermissions(false);
      return false;
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
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setPhase('recording');
      return true;
    } catch (err) {
      setError('Failed to start recording. Please try again.');
      return false;
    }
  }, [requestPermission]);

  /**
   * Stop recording and return the audio file URI.
   * Returns null if no recording was in progress or on failure.
   */
  const stopRecording = useCallback(async (): Promise<string | null> => {
    try {
      if (!recordingRef.current) {
        setIsRecording(false);
        setPhase('idle');
        return null;
      }

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      setPhase('processing');

      // Reset audio mode after recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      return uri;
    } catch (err) {
      setIsRecording(false);
      setPhase('idle');
      recordingRef.current = null;
      setError('Failed to stop recording.');
      return null;
    }
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
