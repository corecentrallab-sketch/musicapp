/**
 * LyricsSheetCard — THE LYRIC SHEET SURFACE (v45 slice 6, owner THREE-WAY
 * LYRICS SCOPE 2026-10-26).
 *
 * ONE card, one text field. It shows the user their own words for their own
 * tune, and lets them type or fix them. The three legal sources are decided by
 * `kind` (services/lyricsSheet.ts) — this file draws the take / composition
 * kinds, and it has no way to fetch words from anywhere:
 *
 *   • no network call, no lyrics database, no API — the only text that can
 *     appear here is `value`, which the screen holds and the user typed;
 *   • no audio input and no transcription — nothing on this card sees a vocal;
 *   • no generation — an empty sheet stays empty and says so;
 *   • nothing is described as an official text: the one line about it is the
 *     model's own denial (`LYRICS_NOT_OFFICIAL_LINE`).
 *
 * The words are saved through the screen's own seam (`services/lyricsStore`,
 * which the take-correction editor calls with the History row's id), so what the
 * user reads back is exactly what was written for that take.
 */
import { useThemedStyles } from '../services/themeStore';
import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  LYRICS_INPUT_HINT,
  LYRICS_INPUT_LABEL,
  LYRICS_INPUT_PLACEHOLDER,
  LYRICS_MAX_CHARS,
  LYRICS_NOT_OFFICIAL_LINE,
  LYRICS_SAVE_BUSY_LABEL,
  LYRICS_SAVE_CTA,
  lyricLineCount,
  lyricSheetFor,
  type LyricsSourceKind,
} from '../services/lyricsSheet';

export interface LyricsSheetCardProps {
  /** WHICH of the three legal sources this sheet is (the user's own, here). */
  kind: LyricsSourceKind;
  /** The words on screen — the parent's state, loaded from the store. */
  value: string;
  /** Every keystroke, straight back to the parent. */
  onChangeText: (next: string) => void;
  /** Write the words through the store seam (the parent owns the write). */
  onSave: () => void;
  /** A write is in flight. */
  saving?: boolean;
  /** False while the tune has no History row to attach words to. */
  canSave?: boolean;
  /** The store's honest sentence about the last attempt, if any. */
  line?: string | null;
}

export const LyricsSheetCard: React.FC<LyricsSheetCardProps> = ({
  kind,
  value,
  onChangeText,
  onSave,
  saving,
  canSave,
  line,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  // The heading and the honest description come from the model — never typed
  // here — so the card and the tier1 proof read the same words.
  const sheet = lyricSheetFor({ kind, text: value });
  const lineCount = lyricLineCount(value);

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.label}>{sheet.label}</Text>
        <Text style={styles.count}>{lineCount > 0 ? `${lineCount} lines` : ''}</Text>
      </View>
      <Text style={styles.hint}>{sheet.hint}</Text>

      <TextInput
        style={styles.input}
        multiline
        value={value}
        onChangeText={onChangeText}
        placeholder={LYRICS_INPUT_PLACEHOLDER}
        placeholderTextColor="#6f6f8a"
        maxLength={LYRICS_MAX_CHARS}
        accessibilityLabel={LYRICS_INPUT_LABEL}
        accessibilityHint={LYRICS_INPUT_HINT}
        textAlignVertical="top"
      />

      <Text style={styles.note}>{LYRICS_NOT_OFFICIAL_LINE}</Text>

      <TouchableOpacity
        style={[styles.saveBtn, (saving || !canSave) && styles.saveBtnOff]}
        onPress={onSave}
        disabled={!!saving || !canSave}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={LYRICS_SAVE_CTA}
      >
        <Text style={styles.saveText}>{saving ? LYRICS_SAVE_BUSY_LABEL : LYRICS_SAVE_CTA}</Text>
      </TouchableOpacity>

      {line ? <Text style={styles.line}>{line}</Text> : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 16,
    marginTop: 16,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: '#eaeaff',
    fontSize: 16,
    fontWeight: '700',
  },
  count: {
    color: '#a0a0b8',
    fontSize: 12,
  },
  hint: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  input: {
    minHeight: 96,
    maxHeight: 200,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    color: '#eaeaff',
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  note: {
    color: '#a0a0b8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  saveBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0f3460',
  },
  saveBtnOff: {
    opacity: 0.5,
  },
  saveText: {
    color: '#eaeaff',
    fontSize: 13,
    fontWeight: '700',
  },
  line: {
    color: '#9fd8c8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});
