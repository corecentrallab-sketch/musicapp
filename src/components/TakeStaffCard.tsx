/**
 * TakeStaffCard — the user's OWN take drawn as a staff (v33 slice C, brief §C).
 *
 * WHAT IT SHOWS, in the order the design reference
 * (/home/team/shared/design-capture-page-v33) sets out:
 *   1. the SUGGESTED chord row, as chips above the staff (or the honest line
 *      saying why there are none);
 *   2. the take exactly as the tracker heard it — the RAW trace, drawn in a
 *      dimmed grey ink so the eye reads it as "before";
 *   3. the "auto-clean ✦" divider;
 *   4. the AUTO-CLEANED line, drawn crisp in the app's teal (#4ecdc4);
 *   5. the two honest lines under the staves (raw = unedited, cleaned =
 *      quantized, never a studio transcription).
 *
 * EVERY NOTE HERE IS THE USER'S. The raw trace is the take the pitch pipeline
 * read, the cleaned line is the app's own quantization of that same take
 * (melodyCapture.autoCleanTake — the SAME function the text sequence and the
 * MIDI export use, so the staff cannot drift from them), and the chords are the
 * take's own SUGGESTED harmonisation. A modern-song match never renders
 * generated notation (standing rule) — this card is only ever handed a take the
 * user made, and the caption says so.
 *
 * The renderer is the app's existing ABCjs WebView (AbcScoreView) fed ABC built
 * by the pure module src/services/takeStaff.ts — no new renderer, and every
 * spelling/bar/rest rule is asserted by scripts/v33TakeEditor.test.ts.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AbcScoreView } from './AbcScoreView';
import { autoCleanTake } from '../services/melodyCapture';
import {
  STAFF_CAPTION,
  STAFF_CLEANED_HONESTY,
  STAFF_EMPTY_LINE,
  STAFF_RAW_HONESTY,
  staffHasNotes,
  staffKeyFromKey,
  takeStaffRows,
} from '../services/takeStaff';
import { DARK_THEME } from '../services/theme';
import type { SavedCaptureTake } from '../services/midiExport';

/** The dimmed ink the RAW trace is drawn in (theme token, never a stray hex). */
export const TAKE_STAFF_RAW_INK = DARK_THEME.staffRawInk;
/** The crisp ink the AUTO-CLEANED line is drawn in (the app's teal accent). */
export const TAKE_STAFF_CLEANED_INK = '#4ecdc4';
/** The card's own paper colour (the surface it sits on). */
export const TAKE_STAFF_PAPER = DARK_THEME.surface;

/** The staff's own height on screen (a WebView needs a real box to draw in). */
const STAFF_HEIGHT = 132;

export interface TakeStaffCardProps {
  /** The take to draw (the flow's decoded take — the user's own, always). */
  take: SavedCaptureTake | null | undefined;
  /** The take's suggested chord names, for the row above the staff. */
  chordNames?: readonly string[] | null;
  /** Why there are no chords, when there are none (the analysis's own line). */
  chordHonestLine?: string | null;
  /** The take's title for the staff header ("My melody"). */
  title?: string | null;
}

export const TakeStaffCard: React.FC<TakeStaffCardProps> = ({
  take,
  chordNames,
  chordHonestLine,
  title,
}) => {
  const rows = useMemo(() => {
    const notes = Array.isArray(take?.notes) ? take!.notes : [];
    // The cleaned line comes from the app's ONE cleaning pass, fed the same
    // notes the text sequence is built from — no second cleaning rule can drift.
    const cleaned = autoCleanTake(notes, take?.key ?? null).notes;
    return takeStaffRows({
      rawNotes: notes,
      cleanedNotes: cleaned,
      key: staffKeyFromKey(take?.key ?? null),
      tempoBpm: take?.tempoBpm ?? null,
      chordNames,
      chordHonestLine,
      title,
    });
  }, [take, chordNames, chordHonestLine, title]);

  const hasStaff = staffHasNotes(rows);

  return (
    <View style={styles.card}>
      <Text style={styles.caption}>{STAFF_CAPTION}</Text>

      {/* ── THE CHORD ROW (above the staff, as the notation would carry it) ──
          Always the take's own SUGGESTED chords; the editor is where a chord
          becomes the user's ("yours"). */}
      <View style={styles.chordRow}>
        {rows.chordRow.length > 0 ? (
          rows.chordRow.map((name, index) => (
            <View key={`${name}-${index}`} style={styles.chordChip}>
              <Text style={styles.chordChipText}>{name}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.chordHonest}>
            {rows.chordHonestLine ?? 'No suggested chords for this take.'}
          </Text>
        )}
      </View>

      {!hasStaff ? (
        <Text style={styles.emptyLine}>{STAFF_EMPTY_LINE}</Text>
      ) : (
        <>
          {/* 1. THE RAW TRACE — dimmed, labelled as exactly what it is. */}
          <Text style={styles.rowLabel}>{rows.rawLabel}</Text>
          <View style={styles.staffBox}>
            <AbcScoreView
              abc={rows.rawAbc ?? ''}
              ink={TAKE_STAFF_RAW_INK}
              background={TAKE_STAFF_PAPER}
            />
          </View>
          <Text style={styles.honesty}>{STAFF_RAW_HONESTY}</Text>

          {/* 2. THE DIVIDER — the one place the cleaning step is named. */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>{rows.dividerLabel}</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* 3. THE AUTO-CLEANED LINE — crisp, teal, the take the app will
              export and the editor starts from. */}
          <Text style={styles.cleanedRowLabel}>{rows.cleanedLabel}</Text>
          <View style={styles.staffBox}>
            <AbcScoreView
              abc={rows.cleanedAbc ?? ''}
              ink={TAKE_STAFF_CLEANED_INK}
              background={TAKE_STAFF_PAPER}
            />
          </View>
          <Text style={styles.honesty}>{STAFF_CLEANED_HONESTY}</Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#16213e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 16,
    marginBottom: 12,
  },
  caption: { color: '#7d7d99', fontSize: 11, lineHeight: 16 },
  chordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 10,
    minHeight: 26,
  },
  chordChip: {
    backgroundColor: '#0f3460',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 6,
  },
  chordChipText: { color: '#4ecdc4', fontSize: 13, fontWeight: '800' },
  chordHonest: { color: '#7d7d99', fontSize: 11, lineHeight: 16 },
  rowLabel: { color: '#a0a0b8', fontSize: 12, fontWeight: '700', marginTop: 8 },
  cleanedRowLabel: { color: '#4ecdc4', fontSize: 12, fontWeight: '800', marginTop: 4 },
  staffBox: {
    height: STAFF_HEIGHT,
    marginTop: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  honesty: { color: '#7d7d99', fontSize: 11, lineHeight: 16, marginTop: 6 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#0f3460' },
  dividerLabel: {
    color: '#ffb347',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginHorizontal: 10,
  },
  emptyLine: { color: '#a0a0b8', fontSize: 13, lineHeight: 19, marginTop: 10 },
});
