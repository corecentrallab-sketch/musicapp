/**
 * ScanFindSection — a scanned page's way into the app's ONE search and money path
 * (v39 fix 1b, owner 10-11; backlog: CAMERA SCAN-TO-LIBRARY FLOW).
 *
 * WHAT IT DOES. The user's own photo of a page, read ON DEVICE for the printed
 * words (the same recogniser the cover scan uses — this is not OMR and reads no
 * notes), the words shown in a field the user can correct, and one button that
 * hands the confirmed text to the host. The host puts that text into the SAME
 * search a typed title opens (the find-a-piece screen), which is where the public
 * domain catalog and the licensed-retailer money path already live. No second
 * search surface, no retailer URL built here, no auto-redirect: this component
 * opens nothing by itself.
 *
 * HONEST BY CONSTRUCTION. The pre-filled field is ONLY ever the recogniser's own
 * output (`services/coverScan`'s decision, via `services/scanFind`), so a blank
 * field means nothing was read — never a guess. An empty field searches nothing.
 * Every outcome renders a line: a read that worked, a page with no words on it, a
 * reader that is not in this build, a read that failed, and no page yet.
 *
 * WHY IT IS A COMPONENT: both doors to a scanned score (the scan screen right
 * after a capture, and the viewer for a saved scan) offer the same action, and
 * there is one implementation of it.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { readCoverText } from '../services/coverScanOcr';
import {
  SCAN_FIND_CONFIRM_HINT,
  SCAN_FIND_CONFIRM_LABEL,
  SCAN_FIND_CTA,
  SCAN_FIND_HINT,
  SCAN_FIND_NO_PAGE_LINE,
  SCAN_FIND_RAW_QUERY_NOTE,
  SCAN_FIND_READING_LINE,
  SCAN_FIND_SEARCH_CTA,
  scanFindView,
  type ScanFindView,
} from '../services/scanFind';

interface ScanFindSectionProps {
  /** The page photo to read — the page the user just took, or the one on screen. */
  pageUri: string | null;
  /** Hands the confirmed words to the host's ONE search surface. */
  onSearch: (query: string) => void;
}

export const ScanFindSection: React.FC<ScanFindSectionProps> = ({
  pageUri,
  onSearch,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [reading, setReading] = useState(false);
  const [view, setView] = useState<ScanFindView | null>(null);
  const [text, setText] = useState('');

  /**
   * Read the page's WORDS on this device. `readCoverText` reports its own failures
   * as a value rather than throwing, but a throw still lands in an honest state
   * instead of a silent no-op.
   */
  const read = useCallback(async () => {
    if (!pageUri) {
      setView({ status: 'idle', query: '', line: SCAN_FIND_NO_PAGE_LINE, canSearch: false });
      return;
    }
    setReading(true);
    try {
      const result = await readCoverText(pageUri);
      const next = scanFindView(result);
      setView(next);
      setText(next.query);
    } catch {
      setView(scanFindView({ text: '', failed: true }));
      setText('');
    } finally {
      setReading(false);
    }
  }, [pageUri]);

  const confirmed = text.trim();
  const canSearch = confirmed.length > 0;

  return (
    <View style={styles.section}>
      <Text style={styles.rawNote}>{SCAN_FIND_RAW_QUERY_NOTE}</Text>
      <Text style={styles.hint}>{SCAN_FIND_HINT}</Text>

      <Pressable
        style={({ pressed }) => [styles.findBtn, pressed && styles.pressed]}
        onPress={() => void read()}
        disabled={reading}
        accessibilityRole="button"
        accessibilityLabel={SCAN_FIND_CTA}
      >
        <Text style={styles.findBtnText}>{SCAN_FIND_CTA}</Text>
      </Pressable>

      {reading ? (
        <View style={styles.readingRow}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.hint}>{SCAN_FIND_READING_LINE}</Text>
        </View>
      ) : null}

      {view?.line ? <Text style={styles.line}>{view.line}</Text> : null}

      {view && view.canSearch ? (
        <>
          <Text style={styles.fieldLabel}>{SCAN_FIND_CONFIRM_LABEL}</Text>
          <TextInput
            style={styles.field}
            value={text}
            onChangeText={setText}
            placeholder={SCAN_FIND_CONFIRM_LABEL}
            placeholderTextColor={theme.subtext}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={SCAN_FIND_CONFIRM_LABEL}
          />
          <Text style={styles.hint}>{SCAN_FIND_CONFIRM_HINT}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.searchBtn,
              !canSearch && styles.disabled,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              if (!canSearch) return;
              onSearch(confirmed);
            }}
            disabled={!canSearch}
            accessibilityRole="button"
            accessibilityLabel={SCAN_FIND_SEARCH_CTA}
          >
            <Text style={styles.searchBtnText}>{SCAN_FIND_SEARCH_CTA}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  section: { marginTop: 14, gap: 6 },
  rawNote: { color: '#8a8ab0', fontSize: 12, lineHeight: 17 },
  hint: { color: '#a0a0b8', fontSize: 12, lineHeight: 17 },
  /* v40 fix B — THE "SEARCH FOR" FIELD'S CONTRAST. Every colour on this card is a
     PALETTE literal now, on purpose: the field used to sit on `#0f1630`, which the
     light palette does not know, so in light mode the field kept its dark fill
     while its own text colour was re-mapped to the dark ink token — the owner's
     "dark-on-dark" reading. `#16213e` is the palette's `surface` (dark navy in dark
     mode, paper-white in light) and `#eaeaff` its `text`, so the field is legible in
     BOTH modes by construction rather than by luck. The same rule removed the two
     stray light-blue literals (`#cfe4ff`) that would have gone almost invisible on
     a light card. */
  line: { color: '#eaeaff', fontSize: 13, lineHeight: 19 },
  fieldLabel: { color: '#eaeaff', fontSize: 13, fontWeight: '700', marginTop: 6 },
  field: {
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 8,
    color: '#eaeaff',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  findBtn: {
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    paddingHorizontal: 16,
  },
  findBtnText: { color: '#eaeaff', fontSize: 14, fontWeight: '700' },
  searchBtn: {
    backgroundColor: '#e94560',
    borderRadius: 10,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  searchBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
