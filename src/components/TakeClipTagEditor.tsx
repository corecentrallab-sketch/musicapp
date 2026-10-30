/**
 * TakeClipTagEditor.tsx — THE CLIP + LABEL STEP OF THE PRACTICE-VIDEO SEND (v47
 * part B, item 2; owner GO 10-28).
 *
 * WHAT IT DOES. Two controls, one purpose: send the teacher a WINDOW of the take
 * and a few words about what to listen for.
 *
 *   • THE CLIP — a start and an end on the video's clock, moved one second at a
 *     time, with `Use the whole take` to clear it. The window is owned by the
 *     playback screen (it is stored on the row) and every member of the pair is
 *     derived from it in `takeClipTag.trimmedSendPair`, so this component never
 *     decides what travels.
 *   • THE LABEL — the take's own local text (the same `takeNote` the History card
 *     edits, services/takeNotes.ts) surfaced here as preset chips plus a free-text
 *     box, so the teacher reads what to listen for on the video, the PDF and the
 *     summary alike. Nothing is generated: the field only ever holds what the user
 *     typed or tapped.
 *
 * MOUNTED BY components/PracticeVideoSendToSheet.tsx, i.e. on the practice-video
 * send path the user actually walks — not merely imported somewhere. A take with no
 * label renders the empty box and nothing else, so older takes are unaffected.
 *
 * No network, no upload, no sharing: this surface edits two local fields.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  TAKE_TAG_CLEAR_CTA,
  TAKE_TAG_HINT,
  TAKE_TAG_LABEL,
  TAKE_TAG_MAX_CHARS,
  TAKE_TAG_PLACEHOLDER,
  TAKE_TAG_PRESETS,
  TAKE_TAG_PRESETS_LABEL,
  TRIM_CLEAR_CTA,
  TRIM_EARLIER_LABEL,
  TRIM_END_LABEL,
  TRIM_HINT,
  TRIM_LABEL,
  TRIM_LATER_LABEL,
  TRIM_START_LABEL,
  TRIM_STEP_SECONDS,
  TRIM_VIDEO_WHOLE_LINE,
  TRIM_WHOLE_TAKE_LINE,
  nudgeTrimSpan,
  normaliseTakeTag,
  tagPresetIsActive,
  trimSpanLabel,
  type TakeTrimSpan,
} from '../services/takeClipTag';
import { videoClock } from '../services/videoTakeSync';

export interface TakeClipTagEditorProps {
  /** The video's own length — the clip's outer bound. */
  durationSec: number;
  /** The stored window (null = the whole take). */
  span: TakeTrimSpan | null;
  /** The take's own label (null when it has none — an older take). */
  note: string | null;
  /** The screen persists the window on the row. */
  onSpanChange: (span: TakeTrimSpan | null) => void;
  /** The screen persists the label on the take (normalised by takeNotes.ts). */
  onNoteChange: (note: string) => void;
  /** The screen's own outcome sentence for the label write. */
  noteLine?: string | null;
  /** True while the label write is in flight. */
  noteBusy?: boolean;
}

export const TakeClipTagEditor: React.FC<TakeClipTagEditorProps> = ({
  durationSec,
  span,
  note,
  onSpanChange,
  onNoteChange,
  noteLine,
  noteBusy,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const [draft, setDraft] = useState(note ?? '');

  /** A label saved elsewhere (or cleared) is reflected here, never overwritten. */
  useEffect(() => {
    setDraft(note ?? '');
  }, [note]);

  const saveLabel = useCallback(() => {
    const next = normaliseTakeTag(draft);
    if ((note ?? null) === next) return;
    onNoteChange(next ?? '');
  }, [draft, note, onNoteChange]);

  const pickPreset = useCallback(
    (preset: string) => {
      setDraft(preset);
      onNoteChange(preset);
    },
    [onNoteChange],
  );

  const clearLabel = useCallback(() => {
    setDraft('');
    onNoteChange('');
  }, [onNoteChange]);

  const step = useCallback(
    (edge: 'start' | 'end', delta: number) => {
      const next = nudgeTrimSpan(span, edge, delta, durationSec);
      if (next) onSpanChange(next);
    },
    [durationSec, onSpanChange, span],
  );

  const whole = trimSpanLabel(span);

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>{TRIM_LABEL}</Text>
      <Text style={styles.hint}>{TRIM_HINT}</Text>

      <View style={styles.trimRow}>
        <Text style={styles.trimLabel}>{TRIM_START_LABEL}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => step('start', -TRIM_STEP_SECONDS)}
          accessibilityRole="button"
          accessibilityLabel="Start the clip one second earlier"
        >
          <Text style={styles.stepBtnText}>{TRIM_EARLIER_LABEL}</Text>
        </TouchableOpacity>
        <Text style={styles.trimValue}>{videoClock(span?.startSec ?? 0)}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => step('start', TRIM_STEP_SECONDS)}
          accessibilityRole="button"
          accessibilityLabel="Start the clip one second later"
        >
          <Text style={styles.stepBtnText}>{TRIM_LATER_LABEL}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.trimRow}>
        <Text style={styles.trimLabel}>{TRIM_END_LABEL}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => step('end', -TRIM_STEP_SECONDS)}
          accessibilityRole="button"
          accessibilityLabel="End the clip one second earlier"
        >
          <Text style={styles.stepBtnText}>{TRIM_EARLIER_LABEL}</Text>
        </TouchableOpacity>
        <Text style={styles.trimValue}>{videoClock(span?.endSec ?? durationSec)}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => step('end', TRIM_STEP_SECONDS)}
          accessibilityRole="button"
          accessibilityLabel="End the clip one second later"
        >
          <Text style={styles.stepBtnText}>{TRIM_LATER_LABEL}</Text>
        </TouchableOpacity>
      </View>

      {span ? (
        <>
          <Text style={styles.line}>{whole ? `Clip: ${whole}` : null}</Text>
          <Text style={styles.hint}>{TRIM_VIDEO_WHOLE_LINE}</Text>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => onSpanChange(null)}
            accessibilityRole="button"
            accessibilityLabel={TRIM_CLEAR_CTA}
          >
            <Text style={styles.secondaryBtnText}>{TRIM_CLEAR_CTA}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.hint}>{TRIM_WHOLE_TAKE_LINE}</Text>
      )}

      <Text style={[styles.sectionTitle, styles.labelGap]}>{TAKE_TAG_LABEL}</Text>
      <Text style={styles.hint}>{TAKE_TAG_HINT}</Text>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        onBlur={saveLabel}
        onSubmitEditing={saveLabel}
        placeholder={TAKE_TAG_PLACEHOLDER}
        placeholderTextColor="#6f7590"
        maxLength={TAKE_TAG_MAX_CHARS}
        returnKeyType="done"
        accessibilityLabel={TAKE_TAG_LABEL}
      />
      <Text style={styles.presetsLabel}>{TAKE_TAG_PRESETS_LABEL}</Text>
      <View style={styles.presetRow}>
        {TAKE_TAG_PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset}
            style={[styles.presetChip, tagPresetIsActive(preset, note) && styles.presetChipOn]}
            onPress={() => pickPreset(preset)}
            accessibilityRole="button"
            accessibilityLabel={preset}
          >
            <Text style={styles.presetText}>{preset}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {note ? (
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={clearLabel}
          accessibilityRole="button"
          accessibilityLabel={TAKE_TAG_CLEAR_CTA}
        >
          <Text style={styles.secondaryBtnText}>{TAKE_TAG_CLEAR_CTA}</Text>
        </TouchableOpacity>
      ) : null}
      {noteLine ? <Text style={styles.line}>{noteLine}</Text> : null}
      {noteBusy ? <Text style={styles.hint}>{'Saving…'}</Text> : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  wrap: {
    backgroundColor: '#161634',
    borderColor: '#25324f',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  sectionTitle: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  labelGap: { marginTop: 18 },
  hint: { color: '#9aa0b5', fontSize: 12, lineHeight: 17, marginTop: 6 },
  line: { color: '#4ecdc4', fontSize: 12, lineHeight: 17, marginTop: 8 },
  trimRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  trimLabel: { color: '#9aa0b5', fontSize: 12, marginRight: 8, width: 58 },
  stepBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f4370',
    backgroundColor: '#1b2a4a',
  },
  stepBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  trimValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginHorizontal: 12,
    minWidth: 48,
    textAlign: 'center',
  },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f4370',
    backgroundColor: '#101024',
    color: '#ffffff',
    paddingHorizontal: 12,
    marginTop: 10,
    fontSize: 14,
  },
  presetsLabel: { color: '#9aa0b5', fontSize: 12, marginTop: 12 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  presetChip: {
    backgroundColor: '#1b2a4a',
    borderColor: '#2f4370',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    marginBottom: 6,
  },
  presetChipOn: { borderColor: '#4ecdc4', backgroundColor: '#12243a' },
  presetText: { color: '#cfe4ff', fontSize: 12, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: '#1b2a4a',
    borderColor: '#2f4370',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
  },
  secondaryBtnText: { color: '#cfe4ff', fontSize: 14, fontWeight: '600' },
});
