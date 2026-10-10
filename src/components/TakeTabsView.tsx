/**
 * TakeTabsView.tsx — THE TAKE AS GUITAR TAB (v37 item 8, backlog ee3a6e13).
 *
 * THE OWNER'S PLACEMENT (re-confirmed 10-09): a "Tabs" button sits just above the
 * "Chords" section and underneath the tap-a-note lane. Tapping it opens THIS page:
 * the same corrected take, laid out on the fretboard — standard tuning EADGBE,
 * one line per string, the fret number where each note is played.
 *
 * THE PIANO NOTATION IS UNTOUCHED. The staff on the editor is still drawn exactly
 * as it was (owner: "The piano notation is correct and needs to remain"); this
 * page is ADDITIVE and never replaces it. Nothing here writes to the take: it is a
 * read-only view of `buildGuitarTab`, the pure model in services/guitarTab.ts.
 *
 * IT IS HONESTLY LABELLED AUTO-GENERATED. There is no official tab of a hummed
 * melody, so the page says what it is — a NoteSnap rendering of the user's own
 * take — and what the layout did (which hand position, which notes sit outside it,
 * which were moved by whole octaves to fit the instrument).
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  TAB_EMPTY_LINE,
  TAB_HONEST_LINE,
  TAB_LABEL,
  TAB_NOTES_CAPTION,
  TAB_TITLE,
  TAB_TUNING_LINE,
  buildGuitarTab,
  tabHasNotes,
  tabHonestyLine,
  tabLines,
  tabNoteReadout,
  tabPitchSummary,
} from '../services/guitarTab';
import type { SavedCaptureTake } from '../services/midiExport';

/** The way back to the take. */
export const TAKE_TABS_BACK_CTA = '← Back to my take';
/** The caption over the grid (what the six lines are). */
export const TAKE_TABS_GRID_CAPTION = 'Guitar tab, standard tuning — top line is the thinnest string.';

export interface TakeTabsViewProps {
  /** Whether the page is open (the editor owns this). */
  visible: boolean;
  /** The corrected take to lay out (the user's own). */
  take: SavedCaptureTake | null | undefined;
  /** A title for the share/print caption (optional). */
  title?: string | null;
  onClose: () => void;
}

export const TakeTabsView: React.FC<TakeTabsViewProps> = ({
  visible,
  take,
  title,
  onClose,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  /**
   * The layout is derived, never stored: the tab is a VIEW of the take the editor
   * holds, so a correction the user makes and this page can never disagree.
   */
  const layout = useMemo(() => buildGuitarTab(take?.notes ?? null), [take]);
  const lines = useMemo(() => (tabHasNotes(layout) ? tabLines(layout) : []), [layout]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={TAKE_TABS_BACK_CTA}
          >
            <Text style={styles.backText}>{TAKE_TABS_BACK_CTA}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{TAB_TITLE}</Text>
          <Text style={styles.subtitle}>{title ? title : TAB_LABEL}</Text>
        </View>

        <ScrollView style={styles.page} contentContainerStyle={styles.body}>
          <Text style={styles.honest}>{TAB_HONEST_LINE}</Text>

          {tabHasNotes(layout) ? (
            <>
              <Text style={styles.caption}>{TAKE_TABS_GRID_CAPTION}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                style={styles.gridBox}
                accessibilityLabel="Guitar tablature of your take"
              >
                <View style={styles.grid}>
                  {lines.map((line, index) => (
                    <Text key={`tab-line-${index}`} style={styles.gridLine}>
                      {line}
                    </Text>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.tuning}>{TAB_TUNING_LINE}</Text>
              <Text style={styles.honest}>{tabHonestyLine(layout)}</Text>
              <Text style={styles.caption}>{TAB_NOTES_CAPTION}</Text>
              <Text style={styles.readout}>{tabNoteReadout(layout)}</Text>
              <Text style={styles.caption}>Notes: {tabPitchSummary(layout)}</Text>
            </>
          ) : (
            <Text style={styles.honest}>{TAB_EMPTY_LINE}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
};

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12122b' },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  backBtn: { minHeight: 44, justifyContent: 'center' },
  backText: { color: '#e94560', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginTop: 2 },
  subtitle: { color: '#9aa0b5', fontSize: 12, marginTop: 2 },
  page: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 32 },
  honest: {
    color: '#9aa0b5',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  caption: { color: '#4ecdc4', fontSize: 12, fontWeight: '700', marginTop: 14 },
  gridBox: {
    backgroundColor: '#0b0b1c',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#243055',
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  grid: {},
  gridLine: {
    color: '#e6e6f0',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  tuning: { color: '#6f7590', fontSize: 12, marginTop: 10 },
  readout: { color: '#cfd3e2', fontSize: 12, lineHeight: 18, marginTop: 6 },
});
