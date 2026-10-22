/**
 * NotationEditorScreen — Notation Editor v1: transpose.
 *
 * Lets the user transpose a public-domain sheet-music score by a semitone /
 * key shift (ABC-based), see the transposed score re-render live in a WebView
 * (ABCjs), and save the transposed copy to their library as a distinct,
 * labeled ABC item.
 *
 * Copyright scope: transpose/save is offered ONLY for public-domain pieces.
 * The bundled score list is entirely public domain, and saved ABC copies
 * originate here (also PD). No copyrighted/modern music flows through this
 * editor. Full note-by-note editing is a later phase — this is transpose-only.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { AbcScoreView } from '../components/AbcScoreView';
import { ExpandScoreButton } from '../components/ExpandScoreButton';
import { FullScreenScore, useFullScreenScoreBox } from '../components/FullScreenScore';
import { canExpandScore, scoreExpandSubtitle } from '../services/scoreExpand';
import { SampleBadge } from '../components/SampleBadge';
import { ScoreLengthLine } from '../components/ScoreLengthLine';
import {
  NOTATION_PICKER_TAG,
  choosePieceLabel,
} from '../services/notationPicker';
import {
  PUBLIC_DOMAIN_ABC_SCORES,
  type AbcScore,
} from '../data/abcScores';
import {
  addAbcToLibrary,
  getLibraryItem,
  readAbcText,
} from '../services/libraryStore';
import {
  REVERT_ORIGINAL_LABEL,
  clampSemitones,
  extractAbcKey,
  originalScorePlan,
  transposeAbc,
  transposeKeyLabel,
} from '../services/abcTranspose';
import {
  isSampleScore,
  transposedCopyTitle,
} from '../services/transposedScore';

type Props = NativeStackScreenProps<RootStackParamList, 'NotationEditor'>;

const MIN_OFFSET = -11;
const MAX_OFFSET = 11;
/**
 * THE SCORE'S BOX MAY NOT COLLAPSE (v36 fix 3) — a FLOOR, and since v42 the only
 * height rule this screen applies. See `scoreStaffBox` in the render body: the
 * viewer owns its own height now (the whole-work band), so this card no longer
 * grows a `minHeight` from a clamped measurement.
 */
const SCORE_STAFF_MIN_HEIGHT = 240;

/**
 * THE DOOR TO THE FULL-SCORE READER (v39 Part 2). One label, exported, so the
 * guard over the entry point asserts the same words the user sees.
 */
export const READER_OPEN_LABEL = 'View full score';

/** Simple AbcScore wrapper used for a library-loaded (already-transposed) copy. */
function scoreFromAbc(abc: string, title: string): AbcScore {
  return {
    id: 'from-library',
    title,
    composer: 'Your library',
    keyLabel: extractAbcKey(abc) ?? 'C',
    isPublicDomain: true,
    // A saved copy is whatever the user saved; this bundle never claims more.
    scope: 'A saved copy from your library',
    abc,
  };
}

export const NotationEditorScreen: React.FC<Props> = ({ route, navigation }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  /**
   * THE FULL-SCREEN READING WINDOW (v43 slice 3, item E1). The card's staff is
   * readable but narrow; this opens the SAME transposed notation at full size.
   * The box it hands the renderer is the modal's own viewport, so a full-length
   * piece scrolls inside the window instead of clipping (services/scoreExpand).
   */
  const [scoreExpanded, setScoreExpanded] = useState(false);
  const expandBoxHeight = useFullScreenScoreBox();
  const [selected, setSelected] = useState<AbcScore | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * THE ABC THIS EDITOR LOADED (v37 item 2, backlog a3a6da0c). Held — not
   * recomputed — because transposition is not invertible to look at: the user
   * may have stepped the offset several times, and only the loaded text can be
   * put back exactly. It is set at EVERY load point below: the library read, the
   * requested public-domain piece, and the bundled default.
   */
  const [sourceAbc, setSourceAbc] = useState('');
  const sourcePieceId = route.params?.sourcePieceId;
  const itemId = route.params?.itemId;

  // On mount: prefer a library ABC item if provided, else the requested PD piece.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (itemId) {
        setLoading(true);
        try {
          const item = await getLibraryItem(itemId);
          if (cancelled || !item || item.kind !== 'abc' || !item.fileUri) {
            throw new Error('not-found');
          }
          const abc = await readAbcText(item);
          if (cancelled) return;
          setSourceAbc(abc);
          setSelected(scoreFromAbc(abc, item.title));
          setOffset(0);
        } catch {
          if (!cancelled) {
            Alert.alert(
              'Could not open score',
              'This library item could not be loaded in the editor.',
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }
      if (sourcePieceId) {
        const found = PUBLIC_DOMAIN_ABC_SCORES.find(
          (p) => p.id === sourcePieceId
        );
        if (!cancelled && found) {
          setSourceAbc(found.abc);
          setSelected(found);
          setOffset(0);
          return;
        }
      }
      // Nothing specific was requested: this is the picker open (the "Choose a
      // piece" row below), so it lands on the first bundled score. This is NOT
      // the old first-frame default — the state above starts EMPTY, so the staff
      // can never paint one piece while another one is on its way (v33 §F5).
      if (!cancelled) {
        const first = PUBLIC_DOMAIN_ABC_SCORES[0];
        if (first) {
          setSourceAbc(first.abc);
          setSelected(first);
          setOffset(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, sourcePieceId, navigation]);

  const transposedAbc = useMemo(
    () => (selected ? transposeAbc(selected.abc, offset) : ''),
    [selected, offset]
  );

  const keyLabels = useMemo(() => {
    const source = selected
      ? extractAbcKey(selected.abc) ?? selected.keyLabel ?? 'C'
      : 'C';
    return transposeKeyLabel(source, offset);
  }, [selected, offset]);

  const step = useCallback(
    (delta: number) => {
      setOffset((o) => clampSemitones(o + delta));
    },
    []
  );

  const resetOffset = useCallback(() => setOffset(0), []);

  /**
   * WHAT "REVERT TO ORIGINAL" WOULD DO, as data (v37 item 2, backlog a3a6da0c).
   */
  const revertPlan = useMemo(
    () => originalScorePlan(sourceAbc, selected?.abc ?? '', offset),
    [sourceAbc, selected, offset]
  );

  /**
   * PUT THE LOADED SCORE BACK (v37 item 2). One press: the offset returns to 0
   * AND the shown ABC is restored from the text this editor loaded — the two are
   * set together so the staff can never show a transposed body under an original
   * key (or the reverse). The measured height is cleared because it belonged to
   * the transposed render.
   */
  const handleRevertToOriginal = useCallback(() => {
    const plan = originalScorePlan(sourceAbc, selected?.abc ?? '', offset);
    setOffset(plan.offset);
    setSelected((current) => (current ? { ...current, abc: plan.abc } : current));
  }, [sourceAbc, selected, offset]);

  const pick = useCallback((p: AbcScore) => {
    setSourceAbc(p.abc);
    setSelected(p);
    setOffset(0);
  }, []);

  const offsetZero = offset === 0;
  const canSave = !offsetZero && selected?.isPublicDomain === true;
  /**
   * THE COPY'S TITLE COMES FROM THE SHARED BUILDER (v39 Part 2). The reader window
   * saves the SAME copy through the same function, so the two surfaces cannot name
   * one transposed score two different ways.
   */
  const copyTitle = selected
    ? transposedCopyTitle({ title: selected.title, keyLabel: keyLabels.to, offset })
    : '';
  /** The badge below reads the score itself — see components/SampleBadge. */

  /**
   * OPEN THE FULL-SCORE READER (v39 Part 2, owner direction 10-11). The reader is
   * a registered stack route and gets the CURRENT transposed ABC — the score the
   * user is looking at right now, whatever key they have stepped it into.
   */
  const handleOpenReader = useCallback(() => {
    if (!selected || transposedAbc.trim().length === 0) return;
    navigation.navigate('TransposedScoreReader', {
      abc: transposedAbc,
      title: selected.title,
      keyLabel: keyLabels.to,
      offset,
      isSample: isSampleScore(transposedAbc),
    });
  }, [keyLabels, navigation, offset, selected, transposedAbc]);

  const handleSave = useCallback(async () => {
    if (!selected) return;
    if (offsetZero || selected.isPublicDomain !== true) return;
    setSaving(true);
    try {
      const title = copyTitle;
      await addAbcToLibrary({ title, abc: transposedAbc });
      Alert.alert(
        'Saved to library',
        `"${title}" was added to your library as a transposed copy. Tap it in Library to view or transpose it again.`
      );
    } catch (e) {
      Alert.alert(
        'Could not save',
        e instanceof Error ? e.message : 'The transposed copy could not be saved.'
      );
    } finally {
      setSaving(false);
    }
  }, [offsetZero, selected, copyTitle, transposedAbc]);

  if (loading || !selected) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.centeredText}>Loading score…</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.screenSubtitle}>
        Transpose a public-domain score into a new key and save the copy to
        your library. Note-by-note editing arrives in a later version.
      </Text>

      {/* Piece picker (only when not opened from a saved library item).
          ALL EIGHT, VISIBLE AT ONCE (v43 slice 2, item D; owner 10-22: "only
          Für Elise and Ode to Joy"). The list always held eight pieces — the
          surface was a HORIZONTAL chip scroller with no scroll indicator and no
          count, so two fit on screen and nothing said the rest existed. It is now
          a wrapping 2-column grid (four short rows) under a label whose count is
          DERIVED from the list (`choosePieceLabel`, services/notationPicker.ts),
          so a ninth piece can never go unseen again. */}
      {!itemId && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {choosePieceLabel(PUBLIC_DOMAIN_ABC_SCORES.length)}
          </Text>
          <View style={styles.pickerGrid} testID={NOTATION_PICKER_TAG}>
            {PUBLIC_DOMAIN_ABC_SCORES.map((p) => {
              const active = selected.id === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => pick(p)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${p.title}, ${p.composer}`}
                >
                  <Text style={[styles.chipTitle, active && styles.chipTextActive]}>
                    {p.title}
                  </Text>
                  <Text style={[styles.chipComposer, active && styles.chipTextActive]}>
                    {p.composer}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* Transpose control */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Transpose</Text>
        <View style={styles.transposeCard}>
          <Pressable
            style={[styles.stepBtn, offset <= MIN_OFFSET && styles.stepBtnDisabled]}
            onPress={() => step(-1)}
            disabled={offset <= MIN_OFFSET}
            accessibilityLabel="Transpose down one semitone"
          >
            <Ionicons name="remove" size={26} color={theme.accent} />
          </Pressable>

          <View style={styles.keyReadout}>
            <Text style={styles.keyFrom}>{keyLabels.from}</Text>
            <Ionicons name="arrow-forward" size={18} color={theme.subtext} />
            <Text style={styles.keyTo}>{keyLabels.to}</Text>
          </View>

          <Pressable
            style={[styles.stepBtn, offset >= MAX_OFFSET && styles.stepBtnDisabled]}
            onPress={() => step(1)}
            disabled={offset >= MAX_OFFSET}
            accessibilityLabel="Transpose up one semitone"
          >
            <Ionicons name="add" size={26} color={theme.accent} />
          </Pressable>
        </View>

        <View style={styles.offsetRow}>
          {offset === 0 ? (
            <Text style={styles.offsetText}>Original key — no change</Text>
          ) : (
            <Text style={styles.offsetText}>
              {offset > 0 ? '+' : ''}
              {offset} semitones · {keyLabels.from} → {keyLabels.to}
            </Text>
          )}
          {offset !== 0 && (
            <Pressable onPress={resetOffset}>
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
          )}
        </View>

        {/* REVERT TO THE LOADED SCORE (v37 item 2, backlog a3a6da0c) — ALWAYS
            VISIBLE, so the way back to the score the user opened is never hidden
            behind a state they may not be in: it resets the offset to 0 AND
            restores the ABC this editor loaded (see originalScorePlan). It is
            inert while nothing has changed, which is exactly when there is
            nothing to put back. */}
        <Pressable
          style={[styles.revertBtn, !revertPlan.canRevert && styles.revertBtnOff]}
          onPress={handleRevertToOriginal}
          disabled={!revertPlan.canRevert}
          accessibilityRole="button"
          accessibilityLabel={REVERT_ORIGINAL_LABEL}
        >
          <Ionicons name="refresh" size={16} color={theme.accent} />
          <Text style={styles.revertText}>{REVERT_ORIGINAL_LABEL}</Text>
        </Pressable>
      </View>

      {/* Live rendered score */}
      <View style={styles.scoreCard}>
        <View style={styles.scoreHeader}>
          <View style={styles.scoreHeaderRow}>
            <View style={styles.scoreHeaderText}>
              <Text style={styles.scoreTitle} numberOfLines={1}>
                {selected.title}
              </Text>
              <Text style={styles.scoreComposer} numberOfLines={1}>
                {selected.composer}
              </Text>
            </View>
            {/* THE FULL-SCREEN EXPANDER (v43 slice 3, item E1) — the QUICK LOOK.
                The "View full score" button below still carries save and share; this
                only makes the card's own staff readable at full size, in the same
                transposition (`transposedAbc`, the exact notation drawn here). */}
            {canExpandScore({ hasAbc: transposedAbc }) ? (
              <ExpandScoreButton
                onPress={() => setScoreExpanded(true)}
                testID="notation-editor-expand"
              />
            ) : null}
          </View>
        </View>
        {!itemId && selected.isPublicDomain && (
          <View style={styles.pdBadge}>
            <Ionicons name="leaf" size={12} color={theme.positive} />
            <Text style={styles.pdBadgeText}>Public domain</Text>
          </View>
        )}
        {/* WHAT THIS SCORE ACTUALLY IS (v39 Part 2; shared badge from UX round 1
            step 1, owner 10-18 item 5). Since v43 slice 2 five headliners carry
            their whole melody and three entries are still short samples, so the
            badge says which is which — from the score's own bar count. Saying so
            is the honest
            fix; the title is deliberately left alone because
            services/pieceAbc.ts fuzzy-matches pieces BY TITLE. The editor cannot
            check the catalog, so the badge makes no claim about the free library. */}
        <SampleBadge abc={selected?.abc} style={styles.sampleBadge} />
        {/* THE HONEST LENGTH LINE (v43 slice 2, item A2 — the diagnosis' own
            wording). "Bars 1–4 of 4" for a bundled sample, "16 bars" for a full
            melody: the number comes from the score itself
            (services/scoreLength.ts), so a short piece can never again look like
            a broken renderer, and a full piece never claims to be an excerpt. */}
        <ScoreLengthLine abc={transposedAbc} style={styles.scoreLengthLine} />
        {/* THE STAFF NEEDS A REAL BOX (v36 fix 3 — "the sheet wouldn't open"), AND
            IT IS A FLOOR, NEVER A CEILING (v42 fix A — the owner's "only 4 bars
            again", v41 device pass 10-20).

            WHY A FLOOR. AbcScoreView's own container is `flex: 1` and its WebView
            is `flex: 1`; inside a card with NO height a `flex: 1` child lays out at
            ZERO, so this card used to open with a title, a composer line and no
            score. The box below gives the renderer a definite floor, and the
            viewer's own min-height (ABC_MIN_HEIGHT) makes a silent collapse
            structurally impossible.

            WHY NOT A CEILING. This card used to grow to a measured height that had
            already been run through the app's BOX ceiling
            (`abcScoreContainerHeight` → `clampScoreHeight` →
            ABC_SCORE_MAX_HEIGHT, 4000px). A MEASUREMENT IS NOT A BOX: pre-clamped
            at 4000, a work taller than the ceiling was laid out in a 4000px box
            while the viewer stayed non-interactive (it cannot scroll itself), so
            everything below the ceiling was unreachable — the same clip the reader
            was fixed for in UX round 1, still live on THIS surface because the
            editor kept its own capped rule.

            WHAT IT DOES NOW. The editor hands the viewer `wholeWork`, the SAME band
            contract the full-score reader uses (services/scoreHeight.ts): a score
            that fits is laid out in full and this page scrolls it; a score taller
            than the reader ceiling gets a window-height box the WebView scrolls
            ITSELF, so every bar stays reachable and nothing is clipped. The editor
            applies no height of its own, so it cannot pre-cap the score again.

            WHY NO `viewportHeight` HERE. In the self-scroll band the box must be the
            window the document scrolls inside. This card sits in an AUTO-HEIGHT
            page, so measuring the card would measure the very box the viewer is
            sizing — a feedback loop that lands back on the floor, i.e. back on the
            owner's four bars. The window height the viewer already defaults to is
            the stable number this surface needs. */}
        <View style={styles.scoreStaffBox}>
          <AbcScoreView abc={transposedAbc} wholeWork />
        </View>
        {/* VIEW THE FULL SCORE (v39 Part 2, owner direction 10-11, backlog
            5e3dffd3). The card above is a preview inside a scrolling editor page;
            this opens the SAME transposed ABC in its own full-screen reader window,
            where the whole piece can be read bar by bar, saved and shared. It is
            offered at every offset (0 included) because the reader shows the score
            the user is looking at — transposing is one of the ways to get there,
            not a requirement. */}
        <Pressable
          style={({ pressed }) => [styles.readerBtn, pressed && styles.readerBtnPressed]}
          onPress={handleOpenReader}
          accessibilityRole="button"
          accessibilityLabel={READER_OPEN_LABEL}
        >
          <Ionicons name="expand-outline" size={16} color={theme.accent} />
          <Text style={styles.readerBtnText}>{READER_OPEN_LABEL}</Text>
        </Pressable>
      </View>

      {/* Save transposed copy */}
      <Pressable
        style={[styles.saveBtn, (!canSave || saving) && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!canSave || saving}
      >
        <Ionicons name="bookmark" size={20} color="#fff" />
        <Text style={styles.saveBtnText}>
          {offsetZero
            ? 'Save transposed copy (transpose first)'
            : saving
            ? 'Saving…'
            : `Save transposed copy · ${keyLabels.to}`}
        </Text>
      </Pressable>
      {!offsetZero && selected.isPublicDomain !== true && (
        <Text style={styles.copyrightNote}>
          Transpose is available for public-domain pieces only.
        </Text>
      )}
    </ScrollView>
    {/* THE FULL-SCREEN READING WINDOW (v43 slice 3, item E1). Presentation only:
        it draws the SAME `transposedAbc` the card above draws, handed the modal's
        own viewport box so a long work lands in the renderer's `self-scroll` band
        instead of being clipped at the card's width. The header's chip carries the
        transposition, so the user can see the key they are reading in. */}
    <FullScreenScore
      visible={!!selected && scoreExpanded}
      onClose={() => setScoreExpanded(false)}
      title={selected?.title ?? 'Score'}
      subtitle={scoreExpandSubtitle({ from: keyLabels.from, to: keyLabels.to })}
    >
      <ScrollView contentContainerStyle={styles.expandBody}>
        <AbcScoreView abc={transposedAbc} wholeWork viewportHeight={expandBoxHeight} />
      </ScrollView>
    </FullScreenScore>
    </>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    gap: 12,
  },
  centeredText: {
    color: '#a0a0b8',
    fontSize: 14,
  },
  screenSubtitle: {
    color: '#a0a0b8',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  section: {
    marginBottom: 18,
  },
  sectionLabel: {
    color: '#8a8ab0',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  pickerRow: {
    gap: 10,
    paddingRight: 8,
  },
  /**
   * THE WRAPPING GRID (v43 slice 2, item D). Two chips per row, `wrap` so the
   * rest fall onto the next lines instead of scrolling off-screen; each chip
   * takes just under half the width so eight pieces read as a 2 × 4 block.
   */
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: '48%',
    flexGrow: 1,
  },
  chipActive: {
    borderColor: '#e94560',
    backgroundColor: '#1f2b52',
  },
  chipTitle: {
    color: '#eaeaff',
    fontSize: 14,
    fontWeight: '700',
  },
  chipComposer: {
    color: '#8a8ab0',
    fontSize: 11,
    marginTop: 2,
  },
  chipTextActive: {
    color: '#eaeaff',
  },
  transposeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#e94560',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.35,
    borderColor: '#2a2a4a',
  },
  keyReadout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  keyFrom: {
    color: '#a0a0b8',
    fontSize: 15,
    fontWeight: '600',
  },
  keyTo: {
    color: '#4ecdc4',
    fontSize: 17,
    fontWeight: '800',
  },
  offsetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 10,
  },
  offsetText: {
    color: '#a0a0b8',
    fontSize: 13,
  },
  resetText: {
    color: '#e94560',
    fontSize: 13,
    fontWeight: '700',
  },
  /**
   * THE WAY BACK TO THE LOADED SCORE (v37 item 2, backlog a3a6da0c). Always
   * visible under the transpose card; dimmed (and inert) while nothing has
   * changed, so it never promises a change it cannot make.
   */
  revertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#16213e',
  },
  revertBtnOff: {
    opacity: 0.45,
  },
  revertText: {
    color: '#eaeaff',
    fontSize: 13,
    fontWeight: '700',
  },
  scoreCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    overflow: 'hidden',
    marginBottom: 18,
  },
  /**
   * THE SCORE'S OWN BOX (v36 fix 3). A WebView needs a definite height to draw in;
   * without one the renderer (whose container is `flex: 1`) laid out at zero height
   * and the score card opened EMPTY — the owner's "unable to open the sheet music
   * at all" on the saved transposed copy. Tall enough for a wrapped single-line
   * melody at phone width, and a min-height (not a fixed height) so a longer,
   * multi-system score can still grow.
   */
  scoreStaffBox: {
    // THE FLOOR, and the ONLY height this screen applies (v42 fix A): the viewer
    // owns its own height through the whole-work band, so this card can never
    // pre-cap a score again.
    minHeight: SCORE_STAFF_MIN_HEIGHT,
    marginTop: 8,
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 12,
    overflow: 'hidden',
  },
  scoreHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  scoreHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scoreHeaderText: { flex: 1, paddingRight: 10 },
  expandBody: { flexGrow: 1, padding: 8 },
  scoreTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  scoreComposer: {
    color: '#8a8ab0',
    fontSize: 13,
    marginTop: 2,
  },
  pdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pdBadgeText: {
    color: '#4ecdc4',
    fontSize: 11,
    fontWeight: '700',
  },
  sampleBadge: {
    marginTop: 8,
  },
  /** The honest length line sits right under the badge it complements. */
  scoreLengthLine: {
    marginTop: 6,
  },
  readerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  readerBtnPressed: {
    opacity: 0.8,
  },
  readerBtnText: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '700',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e94560',
    borderRadius: 14,
    paddingVertical: 15,
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  copyrightNote: {
    color: '#8a8ab0',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
