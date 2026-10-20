/**
 * ScanFindSection — THE ONE RESOLVE PAGE for a photographed page (v43 item C3,
 * owner decisions 10-20; originally v39 fix 1b).
 *
 * WHAT IT DOES. The user's own photo, read ON DEVICE for the printed words (the
 * same recogniser the app has always used — this reads WORDS, never notes, and
 * there is no edition claim anywhere), and then ONE honest page of outcomes:
 *
 *   • SUGGESTIONS — up to three pieces the read actually answers, ranked by
 *     `services/ocrTitleCandidates`. Tapping one opens the piece (the host's
 *     `onOpenPiece`), which is where the licensed-retailer money path already is.
 *     A song we do not hold a score for is marked as such and goes to the search
 *     that offers the official sheet music — never a fake piece page.
 *   • THE WORDS THAT WERE READ — in an editable field, ONLY when the read could be
 *     a title (`quality !== 'garbage'`), with the v42 note that these words came
 *     from the photo and not from the user.
 *   • [Search these words] — SECONDARY, never the red primary: it is a proposal the
 *     user confirms, not the app's own conclusion.
 *   • [Retake photo] — the way out that always exists.
 *
 * THE GARBAGE PATH (the owner's actual on-device case: "4ox 2Apx ors white Freddie
 * Mer"). A read that is debris, or a PAGE OF PRINTED MUSIC rather than a cover,
 * renders the honest line and a field for the user's OWN title. There is no
 * "search these words" control at all — the flag that would render it is false in
 * `services/scanFind`'s pure model, and the tier1 suite proves it.
 *
 * WHY IT IS A COMPONENT: both surviving doors to a scanned page (the scan screen
 * right after a capture, and the viewer for a saved scan) render the same resolve
 * page, and there is one implementation of it.
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
import type { OcrTitleCandidate, OcrTitleCorpusEntry } from '../services/ocrTitleCandidates';
import {
  SCAN_FIND_CANDIDATES_LABEL,
  SCAN_FIND_CANDIDATE_HINT,
  SCAN_FIND_CONFIRM_HINT,
  SCAN_FIND_CONFIRM_LABEL,
  SCAN_FIND_COVER_ONLY_LINE,
  SCAN_FIND_CTA,
  SCAN_FIND_HINT,
  SCAN_FIND_MODERN_HINT,
  SCAN_FIND_NO_PAGE_LINE,
  SCAN_FIND_RAW_QUERY_NOTE,
  SCAN_FIND_READING_LINE,
  SCAN_FIND_RETAKE_CTA,
  SCAN_FIND_SEARCH_CTA,
  SCAN_FIND_TYPED_LABEL,
  SCAN_FIND_TYPED_SEARCH_CTA,
  scanFindActions,
  scanFindView,
  type ScanFindView,
} from '../services/scanFind';

interface ScanFindSectionProps {
  /** The page photo to read — the page the user just took, or the one on screen. */
  pageUri: string | null;
  /** Hands the confirmed words to the host's ONE search surface. */
  onSearch: (query: string) => void;
  /**
   * Opens a suggested piece. Optional so a host that has no piece page still
   * works: the suggestion then searches for that piece's own title instead
   * (`candidate.query`), which is the same money path one tap further along.
   */
  onOpenPiece?: (candidate: OcrTitleCandidate) => void;
  /** Take the photo again. Optional: a saved scan has no camera to return to. */
  onRetake?: () => void;
  /** Titles to rank the read against (the live catalog), when the host has them. */
  corpus?: ReadonlyArray<OcrTitleCorpusEntry> | null;
}

export const ScanFindSection: React.FC<ScanFindSectionProps> = ({
  pageUri,
  onSearch,
  onOpenPiece,
  onRetake,
  corpus,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [reading, setReading] = useState(false);
  const [view, setView] = useState<ScanFindView | null>(null);
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');

  /**
   * Read the page's WORDS on this device. `readCoverText` reports its own failures
   * as a value rather than throwing, but a throw still lands in an honest state
   * instead of a silent no-op.
   */
  const read = useCallback(async () => {
    if (!pageUri) {
      // No page yet is its own honest state — not a failed read, not a guess.
      setView({ ...scanFindView(null), line: SCAN_FIND_NO_PAGE_LINE });
      return;
    }
    setReading(true);
    try {
      const result = await readCoverText(pageUri);
      const next = scanFindView(result, corpus ?? null);
      setView(next);
      // The field only ever carries words that could be a title — a garbage read
      // has none, and the user's own typing is what the garbage path asks for.
      setText(next.quality === 'garbage' ? '' : next.cleanedRead || next.query);
    } catch {
      setView(scanFindView({ text: '', failed: true }));
      setText('');
    } finally {
      setReading(false);
    }
  }, [corpus, pageUri]);

  const actions = scanFindActions(view);
  const confirmed = text.trim();
  const canSearch = confirmed.length > 0;
  const typedTitle = typed.trim();

  const openCandidate = useCallback(
    (candidate: OcrTitleCandidate) => {
      if (onOpenPiece) {
        onOpenPiece(candidate);
        return;
      }
      // No piece page on this host: the candidate's own words are the search, so
      // the money path is still one tap away and nothing is invented.
      onSearch(candidate.query);
    },
    [onOpenPiece, onSearch],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.rawNote}>{SCAN_FIND_RAW_QUERY_NOTE}</Text>
      <Text style={styles.hint}>{SCAN_FIND_HINT}</Text>
      <Text style={styles.hint}>{SCAN_FIND_COVER_ONLY_LINE}</Text>

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

      {/* ── THE SUGGESTIONS ───────────────────────────────────────────────────
          Only for a read that could be a title. Each row opens the piece (money
          path unchanged) or, for a song we do not hold, the search that offers
          the official sheet music. */}
      {actions.offerCandidates ? (
        <View style={styles.candidateBlock}>
          <Text style={styles.fieldLabel}>{SCAN_FIND_CANDIDATES_LABEL}</Text>
          {view?.candidates.map((candidate) => (
            <Pressable
              key={`${candidate.source}-${candidate.id ?? candidate.title}`}
              style={({ pressed }) => [styles.candidateRow, pressed && styles.pressed]}
              onPress={() => openCandidate(candidate)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${candidate.title}`}
            >
              <Text style={styles.candidateTitle}>{candidate.title}</Text>
              {candidate.composer ? (
                <Text style={styles.candidateMeta}>{candidate.composer}</Text>
              ) : null}
              {candidate.source === 'modern' ? (
                <Text style={styles.candidateMeta}>{SCAN_FIND_MODERN_HINT}</Text>
              ) : null}
            </Pressable>
          ))}
          <Text style={styles.hint}>{SCAN_FIND_CANDIDATE_HINT}</Text>
        </View>
      ) : null}

      {/* ── THE WORDS THAT WERE READ (only when they could be a title) ──────── */}
      {actions.showReadWords ? (
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
          {/* SECONDARY ON PURPOSE (owner 10-20): searching what the app read is a
              proposal the user confirms, never the red primary action. */}
          {actions.offerReadSearch ? (
            <Pressable
              style={({ pressed }) => [
                styles.secondaryBtn,
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
              <Text style={styles.secondaryBtnText}>{SCAN_FIND_SEARCH_CTA}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {/* ── THE USER'S OWN TITLE (the way out of every state, including garbage) */}
      {actions.offerTypedSearch ? (
        <>
          <Text style={styles.fieldLabel}>{SCAN_FIND_TYPED_LABEL}</Text>
          <TextInput
            style={styles.field}
            value={typed}
            onChangeText={setTyped}
            placeholder={SCAN_FIND_TYPED_LABEL}
            placeholderTextColor={theme.subtext}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            onSubmitEditing={() => {
              if (typedTitle.length === 0) return;
              onSearch(typedTitle);
            }}
            accessibilityLabel={SCAN_FIND_TYPED_LABEL}
          />
          <Pressable
            style={({ pressed }) => [
              styles.secondaryBtn,
              typedTitle.length === 0 && styles.disabled,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              if (typedTitle.length === 0) return;
              onSearch(typedTitle);
            }}
            disabled={typedTitle.length === 0}
            accessibilityRole="button"
            accessibilityLabel={SCAN_FIND_TYPED_SEARCH_CTA}
          >
            <Text style={styles.secondaryBtnText}>{SCAN_FIND_TYPED_SEARCH_CTA}</Text>
          </Pressable>
        </>
      ) : null}

      {actions.offerRetake && onRetake ? (
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={onRetake}
          accessibilityRole="button"
          accessibilityLabel={SCAN_FIND_RETAKE_CTA}
        >
          <Text style={styles.secondaryBtnText}>{SCAN_FIND_RETAKE_CTA}</Text>
        </Pressable>
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
  /* v43 item C3 — the suggestions. Quiet cards: the piece title in the reading
     size, the composer under it, and a modern song's honest note below. */
  candidateBlock: { gap: 6, marginTop: 6 },
  candidateRow: {
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  candidateTitle: { color: '#eaeaff', fontSize: 15, fontWeight: '700' },
  candidateMeta: { color: '#a0a0b8', fontSize: 12, lineHeight: 17 },
  /* The secondary controls (search the read, type a title, retake): outlined, so
     the ONE filled control on the page is the read itself. */
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  secondaryBtnText: { color: '#4ecdc4', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
