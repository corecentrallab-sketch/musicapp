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
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { classifyScanPhoto, type ScanPhotoClassification } from '../services/scanClassify';
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
  SCAN_FIND_NO_WORDS_LINE,
  SCAN_FIND_RAW_QUERY_NOTE,
  SCAN_FIND_READING_LINE,
  SCAN_FIND_RETAKE_CTA,
  SCAN_FIND_SEARCH_WORDS_CTA,
  SCAN_FIND_TYPED_HINT,
  SCAN_FIND_TYPED_LABEL,
  SCAN_FIND_TYPED_SEARCH_CTA,
  SCAN_FIND_WHAT_WE_READ_LABEL,
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
   * WHAT WAS PHOTOGRAPHED (v44 #59). Defaults to 'cover'. A host that is showing a
   * page of a scanned SCORE (the saved-scan viewer, an extra page in the scanner)
   * passes 'page', and the same pure model then refuses an uncorroborated read a
   * query instead of filling the box with the recogniser's debris.
   */
  photoKind?: 'cover' | 'page';
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
  /**
   * READ THE PHOTO AS SOON AS IT IS HERE (v45 slice 4, owner 2026-10-26 — the
   * "scan → OCR → auto-search" headline). The scanner sets this for the photo it
   * just took, so the read happens without a second tap. It is a REQUEST, not a
   * decision: what may happen with the result is `services/scanClassify`'s, and
   * only a good cover read that names a piece we hold may look itself up.
   */
  autoRead?: boolean;
  /**
   * WHAT THE READ SAYS THIS PHOTO IS (v45 slice 4). The classification goes to the
   * host, which keeps it as the scan's own state — the scanner's photo door
   * (`scanPhotoKindFor`) and its auto-search gate both read it from there, so the
   * two surfaces can never disagree about the same photo.
   */
  onClassified?: (classification: ScanPhotoClassification) => void;
}

export const ScanFindSection: React.FC<ScanFindSectionProps> = ({
  pageUri,
  onSearch,
  photoKind = 'cover',
  onOpenPiece,
  onRetake,
  corpus,
  autoRead = false,
  onClassified,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [reading, setReading] = useState(false);
  const [view, setView] = useState<ScanFindView | null>(null);
  // THE ONE FIELD (v45 slice 4). It is seeded with what the recogniser read and it
  // is what the single CTA searches — the second "type the title" input this page
  // used to carry is gone; the user's own words go in the same box.
  const [text, setText] = useState('');
  // The classification goes to the host through a ref, so the read callback never
  // has to be rebuilt (and re-run) just because the host passed a new function.
  const onClassifiedRef = useRef(onClassified);
  useEffect(() => {
    onClassifiedRef.current = onClassified;
  }, [onClassified]);
  // Which photo has already been auto-read, so one capture is read exactly once.
  const autoReadRef = useRef<string | null>(null);

  /**
   * Read the page's WORDS on this device. `readCoverText` reports its own failures
   * as a value rather than throwing, but a throw still lands in an honest state
   * instead of a silent no-op. The photo's KIND goes with the read, so the one pure
   * model can tell a title page from a page of music (v44 #59) — and the same read
   * is CLASSIFIED (v45 slice 4) and handed to the host, which decides whether this
   * photo is a cover or a page of music and whether it may look itself up.
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
      // WHAT THIS PHOTO IS, from the read's own evidence (services/scanClassify).
      const classification = classifyScanPhoto({ ...result, photoKind }, corpus ?? null);
      const next = scanFindView({ ...result, photoKind }, corpus ?? null);
      setView(next);
      // The field only ever carries words that could be a title — a garbage read
      // has none, and the user's own typing is what the garbage path asks for. A
      // page of music is the same: nothing from it is pre-filled.
      setText(next.quality === 'garbage' ? '' : next.cleanedRead || next.query);
      onClassifiedRef.current?.(classification);
    } catch {
      setView(scanFindView({ text: '', failed: true, photoKind }));
      setText('');
      onClassifiedRef.current?.(
        classifyScanPhoto({ text: '', failed: true, photoKind }, corpus ?? null),
      );
    } finally {
      setReading(false);
    }
  }, [corpus, pageUri, photoKind]);

  /**
   * THE AUTO STEP (v45 slice 4). When the host asks for it, the photo it just
   * handed us is read once — no second tap between "take the photo" and "we read
   * it". Nothing is decided here: the classification travels to the host, which
   * consults `services/scanClassify`'s gate before anything is searched.
   */
  useEffect(() => {
    if (autoRead !== true) return;
    if (typeof pageUri !== 'string' || pageUri.length === 0) return;
    if (autoReadRef.current === pageUri) return;
    autoReadRef.current = pageUri;
    void read();
  }, [autoRead, pageUri, read]);

  const actions = scanFindActions(view);
  // THE ONE FIELD'S WORDS. `confirmed` is the name the v39/v43 contracts pin (the
  // words the user has seen and may correct); `typedTitle` is the same string now
  // that the read's box and the typed box are one field.
  const confirmed = text.trim();
  const typedTitle = confirmed;
  const canSearch = confirmed.length > 0;
  // WHICH WORDING the one field and the one CTA carry, from the pure model: the
  // read's own words when the model says they may be searched (never for a garbage
  // read — `offerReadSearch` is false there), the user's own title otherwise.
  const readWordsAreSearchable = actions.showReadWords && actions.offerReadSearch;
  const searchLabel = readWordsAreSearchable
    ? SCAN_FIND_SEARCH_WORDS_CTA
    : SCAN_FIND_TYPED_SEARCH_CTA;
  const fieldLabel = readWordsAreSearchable
    ? view?.uncorroborated
      ? SCAN_FIND_WHAT_WE_READ_LABEL
      : SCAN_FIND_CONFIRM_LABEL
    : SCAN_FIND_TYPED_LABEL;

  /** The single CTA: search exactly what the one field holds. */
  const submitSearch = useCallback(() => {
    if (confirmed.length === 0) return;
    onSearch(confirmed);
  }, [confirmed, onSearch]);

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

      {/* ── ONE FIELD, ONE CTA (v45 slice 4, owner 2026-10-26) ─────────────────
          WHAT WAS MERGED AWAY. This page used to render TWO inputs: the words the
          read produced (with its own "Search these words" control) AND, beside it,
          a second "Type the title" field with a second CTA. On a phone that read as
          a read-only box next to an edit button, with two ways to do one thing. The
          owner asked for the suggestion/confirmation box to BE the editable search
          field: one field, one CTA.

          So there is exactly one `TextInput` on this page now, and it is the one
          `text` state the read fills in (`next.cleanedRead`, never a garbage read's
          debris — `next.quality === 'garbage' ? ''`). It is seeded with what the
          recogniser read, it is editable, and it is what the single control below
          searches. The label and the control's wording follow the PURE model:
            • the read answered something (`actions.showReadWords`) → labelled as
              what it is ("What we read on the photo" for an uncorroborated read,
              v44 #59) and the CTA says "Search these words";
            • anything else (a debris read, a page of music, a fresh field) → the
              typed-title wording, same field.
          v44 #59 SURVIVES THE MERGE: the CTA still PRINTS the words it will search,
          in bold, from the same string it submits — so the search shown is the
          search that runs. */}
      {actions.offerTypedSearch || actions.showReadWords ? (
        <>
          <Text style={styles.fieldLabel}>{fieldLabel}</Text>
          <TextInput
            style={styles.field}
            value={text}
            onChangeText={setText}
            placeholder={SCAN_FIND_TYPED_LABEL}
            placeholderTextColor={theme.subtext}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            onSubmitEditing={() => {
              if (typedTitle.length === 0) return;
              onSearch(typedTitle);
            }}
            accessibilityLabel={fieldLabel}
          />
          <Text style={styles.hint}>
            {actions.showReadWords ? SCAN_FIND_CONFIRM_HINT : SCAN_FIND_TYPED_HINT}
          </Text>
          {actions.showReadWords && !canSearch ? (
            <Text style={styles.hint}>{SCAN_FIND_NO_WORDS_LINE}</Text>
          ) : null}
          {/* SECONDARY ON PURPOSE (owner 10-20): searching what the app read is a
              proposal the user confirms, never the red primary action. */}
          <Pressable
            style={({ pressed }) => [
              styles.secondaryBtn,
              !canSearch && styles.disabled,
              pressed && styles.pressed,
            ]}
            onPress={submitSearch}
            disabled={!canSearch}
            accessibilityRole="button"
            accessibilityLabel={searchLabel}
          >
            <Text style={styles.secondaryBtnText}>{searchLabel}</Text>
            {/* THE WORDS IT WILL ACTUALLY SEARCH (v44 #59) — never an empty
                control that searches something the user cannot see. */}
            {actions.showReadWords ? (
              <Text style={styles.searchWordsBold} numberOfLines={2}>
                {confirmed}
              </Text>
            ) : null}
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
  /* v44 #59 — THE WORDS THE CONTROL WILL SEARCH, IN BOLD. The owner's report: the
     "Search these words" box "showed nothing in bold" — the words were in the
     field above and the control said only its own label, so the one thing that
     mattered (what will actually be searched) was invisible at the point of tap.
     It is printed here, in the palette's own `text` token so it stays legible in
     BOTH modes (v40 fix B's rule). */
  searchWordsBold: {
    color: '#eaeaff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
