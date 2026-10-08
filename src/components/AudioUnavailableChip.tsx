/**
 * AudioUnavailableChip — THE VISIBLE REASON (v34).
 *
 * The owner's v33 pass could not say WHY the app was quiet, because the audio
 * paths failed silently. This chip is mounted once at the app root and shows the
 * latest audio failure as one line — "Audio unavailable: the preview tones could
 * not be loaded from this build" — with a ✕ that dismisses it. A device pass can
 * now read the reason off the screen instead of guessing.
 *
 * It renders NOTHING when the audio stack is healthy, so a healthy build looks
 * exactly as it did before (no permanent banner, no dead area).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  audioChipText,
  clearAudioFailure,
  currentAudioFailure,
  subscribeAudioFailure,
  type AudioFailure,
} from '../services/audioDiagnostics';

/** The dismiss control's own label (a target the size of the chip's height). */
export const AUDIO_CHIP_DISMISS_LABEL = 'Dismiss audio message';

export const AudioUnavailableChip: React.FC = () => {
  const [failure, setFailure] = useState<AudioFailure | null>(() => currentAudioFailure());

  useEffect(() => {
    // Re-read on every report/clear: the store is the single source of truth, so
    // a screen that never re-renders still shows the current reason when it does.
    const unsubscribe = subscribeAudioFailure(() => setFailure(currentAudioFailure()));
    setFailure(currentAudioFailure());
    return unsubscribe;
  }, []);

  const dismiss = useCallback(() => {
    clearAudioFailure();
    setFailure(null);
  }, []);

  if (!failure) return null;

  return (
    <View style={styles.wrap} accessibilityRole="alert" pointerEvents="box-none">
      <View style={styles.chip} testID="audio-unavailable-chip">
        <Text style={styles.text} numberOfLines={3}>
          {audioChipText(failure)}
        </Text>
        <TouchableOpacity
          style={styles.dismiss}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={AUDIO_CHIP_DISMISS_LABEL}
        >
          <Text style={styles.dismissText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingBottom: 84,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7a1f2b',
    borderWidth: 1,
    borderColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 4,
    maxWidth: 560,
  },
  text: { color: '#ffe6ea', fontSize: 12, lineHeight: 17, flexShrink: 1 },
  dismiss: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: { color: '#ffe6ea', fontSize: 16, fontWeight: '800' },
});
