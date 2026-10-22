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
import { useThemedStyles } from '../services/themeStore';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AbcScoreView } from './AbcScoreView';
import { ExpandScoreButton } from './ExpandScoreButton';
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
import type { SavedCaptureTake } from '../services/midiExport';
/**
 * THE PAPER AND INK OF THE TAKE'S STAFF (v42 fix B1). They live in a pure module
 * so the GATE can assert they are readable together — the owner's v41 complaint
 * was that the notes rendered on a black screen and were invisible, and "is this
 * ink readable on this paper" is a fact about two colours, not a matter of taste.
 *
 * WHAT WAS WRONG. The paper was `DARK_THEME.surface` (#16213e) and the raw ink
 * `DARK_THEME.staffRawInk` (#9aa0b4), both handed to the renderer as PROPS. The
 * app-wide theme remapper (services/themeApply.ts) re-paints StyleSheets only, so
 * in LIGHT mode the card around the staff turned white while the staff itself
 * stayed a black block with dim grey notes on it — exactly what the owner saw.
 *
 * NOW: the same white notation paper the score reader draws on, and inks that
 * clear WCAG AA on it (services/takeStaffPalette.ts + services/inkContrast.ts,
 * asserted by scripts/uxr-v42-fixes.test.ts).
 */
export {
  TAKE_STAFF_CLEANED_INK,
  TAKE_STAFF_PAPER,
  TAKE_STAFF_RAW_INK,
} from '../services/takeStaffPalette';
import {
  TAKE_STAFF_CLEANED_INK,
  TAKE_STAFF_PAPER,
  TAKE_STAFF_RAW_INK,
} from '../services/takeStaffPalette';

/**
 * THE STAFF'S FLOOR ON SCREEN (v42 fix B2). It used to be a FIXED height of 132,
 * which is the second half of the owner's v41 complaint: "As you hummed it" showed
 * ONE bar. A take of any length was laid out inside a 132px box with
 * `overflow: 'hidden'` — a fixed box clips a document no matter how tall it is, and
 * the practice-video page (which already passed `interactive={false}`) clipped it
 * silently. A FLOOR lets the box grow to the take.
 */
const STAFF_MIN_HEIGHT = 132;

export interface TakeStaffCardProps {
  /** The take to draw (the flow's decoded take — the user's own, always). */
  take: SavedCaptureTake | null | undefined;
  /** The take's suggested chord names, for the row above the staff. */
  chordNames?: readonly string[] | null;
  /** Why there are no chords, when there are none (the analysis's own line). */
  chordHonestLine?: string | null;
  /** The take's title for the staff header ("My melody"). */
  title?: string | null;
  /**
   * Whether the two staves may receive touches. DEFAULT FALSE since v42 fix B2:
   * a non-interactive viewer MEASURES its own document and sizes itself to it
   * (services/scoreHeight.ts), which is what makes the whole take visible instead
   * of the first bar. It also closes the WebView's touch surface, so a finger on
   * the staff scrolls the PAGE the card sits in — the behaviour every other score
   * surface in the app has (see AbcScoreView's touch shield).
   *
   * A caller that genuinely wants a self-scrolling staff can still pass `true`;
   * nothing does today. */
  interactive?: boolean;
  /**
   * THE FULL-SCREEN EXPANDER (v43 fix batch, slice 3, item E4). When the host can
   * open a full-screen reading window for this take, it hands the opener here and
   * the card shows the one shared affordance top-right. One change covers every
   * surface that draws a take (the capture page, the practice-video page, the take
   * editor's read-only original view): none of them has to re-invent the button.
   * Without it the card is exactly what it was.
   */
  onExpand?: (() => void) | null;
}

export const TakeStaffCard: React.FC<TakeStaffCardProps> = ({
  take,
  chordNames,
  chordHonestLine,
  title,
  interactive = false,
  onExpand,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
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
      <View style={styles.cardHeader}>
        <Text style={styles.caption}>{STAFF_CAPTION}</Text>
        {onExpand && hasStaff ? <ExpandScoreButton onPress={onExpand} testID="take-staff-expand" /> : null}
      </View>

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
              interactive={interactive}
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
              interactive={interactive}
            />
          </View>
          <Text style={styles.honesty}>{STAFF_CLEANED_HONESTY}</Text>
        </>
      )}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  card: {
    // The DARK identity literal, which services/themeApply.ts re-paints to
    // theme.surface (#ffffff) in light mode — the card follows the app's theme;
    // the STAFF on it is notation paper in both (v42 fix B1).
    backgroundColor: '#16213e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  caption: { color: '#7d7d99', fontSize: 11, lineHeight: 16, flex: 1, paddingRight: 8 },
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
    // A FLOOR, never a fixed height (v42 fix B2): the viewer is non-interactive, so
    // it measures its own document and applies that height to itself — the box
    // grows and the whole take is drawn. A `height:` here clipped every take to
    // roughly one bar (the owner's "As you hummed it shows only one bar").
    minHeight: STAFF_MIN_HEIGHT,
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
