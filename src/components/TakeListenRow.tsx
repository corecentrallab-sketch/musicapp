/**
 * TakeListenRow — "Play your Take" + "Play this Version" (v40 fix H).
 *
 * THE OWNER'S ASK (10-14 corrections email, verbatim): "After video practice has
 * been recorded, the app takes you to Correct your Take section. From here there
 * needs to be a Play your Take button to listen to what was recorded. There is not
 * one. There is also a 'Play this Version' button needed for the quantized version.
 * Both versions need to be heard."
 *
 * WHAT IT IS. One row, two controls, on the take-correction page:
 *   • PLAY YOUR TAKE — the RECORDING the user made (the clip path the editor is
 *     already handed), played by `hooks/useTakeClipPlayer.ts`;
 *   • PLAY THIS VERSION — the corrected/quantized take, played by the page's own
 *     Hum-Along preview engine (`hooks/useNotePreview.ts`), which re-synthesises
 *     from the tone bank. Its caption says so, on the surface, always.
 *
 * The labels, the disabled states and both captions come from the PURE model
 * (`services/takePlayback.takeListenModel`), so the gate proves both controls exist
 * and that neither is ever a dead button. This component decides nothing itself
 * and builds no audio — it only renders the model and forwards two taps, which is
 * what keeps it the same row on the editor and on the tab page.
 */
import { useThemedStyles } from '../services/themeStore';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TAKE_LISTEN_HEADING, takeListenModel } from '../services/takePlayback';

export interface TakeListenRowProps {
  /** The recording is on this device (services/takePlayback.takePlaybackAvailable). */
  takeAvailable: boolean;
  takePlaying: boolean;
  takeBusy: boolean;
  onToggleTake: () => void;
  /** The corrected take holds notes to play back. */
  versionAvailable: boolean;
  versionPlaying: boolean;
  onToggleVersion: () => void;
  /** An outcome sentence from the recording player (never swallowed). */
  note?: string | null;
}

export const TakeListenRow: React.FC<TakeListenRowProps> = ({
  takeAvailable,
  takePlaying,
  takeBusy,
  onToggleTake,
  versionAvailable,
  versionPlaying,
  onToggleVersion,
  note,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const model = takeListenModel({
    takeAvailable,
    takePlaying,
    takeBusy,
    versionAvailable,
    versionPlaying,
  });

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{TAKE_LISTEN_HEADING}</Text>

      <TouchableOpacity
        style={[styles.btn, takePlaying && styles.btnOn, model.take.disabled && styles.btnOff]}
        onPress={onToggleTake}
        disabled={model.take.disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={model.take.label}
        accessibilityState={{ disabled: model.take.disabled }}
      >
        <Text style={styles.btnText}>{model.take.label}</Text>
      </TouchableOpacity>
      <Text style={styles.caption}>{model.take.caption}</Text>

      <TouchableOpacity
        style={[
          styles.btn,
          versionPlaying && styles.btnOn,
          model.version.disabled && styles.btnOff,
        ]}
        onPress={onToggleVersion}
        disabled={model.version.disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={model.version.label}
        accessibilityState={{ disabled: model.version.disabled }}
      >
        <Text style={styles.btnText}>{model.version.label}</Text>
      </TouchableOpacity>
      <Text style={styles.caption}>{model.version.caption}</Text>

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    padding: 12,
    marginTop: 12,
  },
  heading: { color: '#eaeaff', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  btn: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    backgroundColor: '#0f3460',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
  },
  btnOn: { backgroundColor: '#e94560', borderColor: '#e94560' },
  btnOff: { opacity: 0.45 },
  btnText: { color: '#eaeaff', fontSize: 15, fontWeight: '700' },
  caption: { color: '#a0a0b8', fontSize: 11, lineHeight: 16, marginTop: 5 },
  note: { color: '#eaeaff', fontSize: 12, lineHeight: 17, marginTop: 8 },
});
