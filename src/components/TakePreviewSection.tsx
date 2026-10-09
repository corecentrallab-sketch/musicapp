/**
 * TakePreviewSection — THE HUM-ALONG PREVIEW, docked inside the take-correction
 * editor (v33 slice G; owner-ratified option 4, 10-04: ONE control row inside the
 * editor above the sticky save bar — NOT a separate screen).
 *
 * WHAT IT PLAYS: the user's OWN corrected take, played back as the RECORDED
 * acoustic one-shot bank in `toneBank.ts` (v37; CC0/CC-BY samples, see
 * assets/tones/SAMPLES-LICENSES.md). It is not a recording of a song and not the
 * original song, and the caption on the surface says exactly that
 * (PREVIEW_ONLY_CAPTION).
 *
 * THE CONTROL ROW: prev / play-pause / next / loop, the note the preview clock is
 * inside (the same cursor the editor's note lane highlights), the PREVIEW-ONLY
 * tempo rail, and the instrument overlays (piano / guitar / sax / trumpet / harp).
 *
 * THE ONE RULE: the tempo is a PREVIEW CLOCK. Every control here routes into the
 * hook (useNotePreview), which only ever READS the notes — see
 * previewEngineNeverRewritesTheTake() in src/services/v33UiContract.ts, which
 * fails if any take-writing operation is ever imported into the engine, and
 * takePreview.PREVIEW_TEMPO_NEVER_REWRITES, asserted in the tier1 suite.
 */
import { useThemedStyles } from '../services/themeStore';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  PREVIEW_INSTRUMENTS,
  PREVIEW_LOOP_OFF_LABEL,
  PREVIEW_LOOP_ON_LABEL,
  PREVIEW_NEXT_LABEL,
  PREVIEW_ONLY_CAPTION,
  PREVIEW_PAUSE_LABEL,
  PREVIEW_PLAY_LABEL,
  PREVIEW_PREV_LABEL,
  PREVIEW_SECTION_TITLE,
  PREVIEW_TEMPO_CAPTION,
  PREVIEW_TEMPO_MAX_PCT,
  PREVIEW_TEMPO_MIN_PCT,
  PREVIEW_TEMPO_STEP_PCT,
  previewInstrument,
  previewTempoLabel,
} from '../services/takePreview';
import type { NotePreview } from '../hooks/useNotePreview';

/** The tempo rail's own label (never a claim about the take's real tempo). */
export const PREVIEW_TEMPO_LABEL = 'Preview tempo';
/** The caption over the tempo rail. */
export const PREVIEW_TEMPO_HONESTY = PREVIEW_TEMPO_CAPTION;
/** Said when the take has no notes to play (the empty state, never a fake play). */
export const PREVIEW_NO_TONES_LINE = 'No tone bank entry for this note.';

export interface TakePreviewSectionProps {
  /** The engine, owned by the editor (one instance, one preview). */
  preview: NotePreview;
}

export const TakePreviewSection: React.FC<TakePreviewSectionProps> = ({ preview }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const instrument = previewInstrument(preview.instrument);
  const tempos: number[] = [];
  for (let pct = PREVIEW_TEMPO_MIN_PCT; pct <= PREVIEW_TEMPO_MAX_PCT; pct += PREVIEW_TEMPO_STEP_PCT) {
    tempos.push(pct);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{PREVIEW_SECTION_TITLE}</Text>
      {/* The honest state line: playing/paused, which note, looping or not. */}
      <Text style={styles.status}>{preview.statusLine}</Text>

      {/* THE CONTROL ROW (play-pause, prev/next, loop) — every target ≥44dp. */}
      <View style={styles.controlRow}>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => preview.step(-1)}
          accessibilityRole="button"
          accessibilityLabel={PREVIEW_PREV_LABEL}
        >
          <Text style={styles.controlText}>{PREVIEW_PREV_LABEL}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, styles.controlPrimary]}
          onPress={preview.toggle}
          accessibilityRole="button"
          accessibilityLabel={preview.playing ? PREVIEW_PAUSE_LABEL : PREVIEW_PLAY_LABEL}
        >
          <Text style={styles.controlPrimaryText}>
            {preview.playing ? PREVIEW_PAUSE_LABEL : PREVIEW_PLAY_LABEL}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => preview.step(1)}
          accessibilityRole="button"
          accessibilityLabel={PREVIEW_NEXT_LABEL}
        >
          <Text style={styles.controlText}>{PREVIEW_NEXT_LABEL}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, preview.loop && styles.controlOn]}
          onPress={preview.toggleLoop}
          accessibilityRole="button"
          accessibilityLabel={preview.loop ? PREVIEW_LOOP_ON_LABEL : PREVIEW_LOOP_OFF_LABEL}
        >
          <Text style={styles.controlText}>
            {preview.loop ? PREVIEW_LOOP_ON_LABEL : PREVIEW_LOOP_OFF_LABEL}
          </Text>
        </TouchableOpacity>
      </View>

      {/* THE PREVIEW-ONLY TEMPO RAIL. It cannot touch the take: the hook only
          rebuilds the preview clock from the notes it reads. */}
      <Text style={styles.label}>
        {PREVIEW_TEMPO_LABEL} · {previewTempoLabel(preview.tempoPct)}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tempoRail}>
        <View style={styles.tempoRow}>
          {tempos.map((pct) => (
            <TouchableOpacity
              key={pct}
              style={[styles.tempoChip, pct === preview.tempoPct && styles.tempoChipOn]}
              onPress={() => preview.setTempoPct(pct)}
              accessibilityRole="button"
              accessibilityLabel={`Preview at ${pct} percent`}
            >
              <Text
                style={[styles.tempoChipText, pct === preview.tempoPct && styles.tempoChipTextOn]}
              >
                {pct}%
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <Text style={styles.honesty}>{PREVIEW_TEMPO_HONESTY}</Text>

      {/* THE INSTRUMENT OVERLAYS — the timbre is named honestly per instrument. */}
      <Text style={styles.label}>Hear it as</Text>
      <View style={styles.controlRow}>
        {PREVIEW_INSTRUMENTS.map((entry) => (
          <TouchableOpacity
            key={entry.id}
            style={[styles.controlBtn, preview.instrument === entry.id && styles.controlOn]}
            onPress={() => preview.setInstrument(entry.id)}
            accessibilityRole="button"
            accessibilityLabel={`Hear it as ${entry.label}`}
          >
            <Text style={styles.controlText}>{entry.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.honesty}>{instrument.timbre}.</Text>

      {/* THE HONESTY LINE THE SURFACE MAY NEVER DROP. */}
      <Text style={styles.previewOnly}>{PREVIEW_ONLY_CAPTION}</Text>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    padding: 14,
    marginTop: 14,
  },
  title: { color: '#4ecdc4', fontSize: 15, fontWeight: '800' },
  status: { color: '#c0c0d0', fontSize: 12, lineHeight: 17, marginTop: 6 },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  controlBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    backgroundColor: '#0f3460',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 8,
  },
  controlPrimary: { backgroundColor: '#e94560', borderColor: '#e94560' },
  controlOn: { borderColor: '#ffb347' },
  controlText: { color: '#4ecdc4', fontSize: 13, fontWeight: '700' },
  controlPrimaryText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  label: { color: '#7d7d99', fontSize: 11, marginTop: 12 },
  tempoRail: { marginTop: 8, maxHeight: 56 },
  tempoRow: { flexDirection: 'row', alignItems: 'center' },
  tempoChip: {
    minHeight: 44,
    minWidth: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#12122b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  tempoChipOn: { borderColor: '#4ecdc4', backgroundColor: '#0f3460' },
  tempoChipText: { color: '#c0c0d0', fontSize: 12, fontWeight: '700' },
  tempoChipTextOn: { color: '#4ecdc4' },
  honesty: { color: '#7d7d99', fontSize: 11, lineHeight: 16, marginTop: 8 },
  previewOnly: { color: '#a0a0b8', fontSize: 11, lineHeight: 16, marginTop: 12 },
});
