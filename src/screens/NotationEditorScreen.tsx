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
import { abcScoreContainerHeight } from '../services/scoreHeight';

type Props = NativeStackScreenProps<RootStackParamList, 'NotationEditor'>;

const MIN_OFFSET = -11;
const MAX_OFFSET = 11;
/**
 * THE SCORE'S BOX MAY NOT COLLAPSE (v36 fix 3) — but it is only a FLOOR. v37 item
 * 2 (backlog 9e71e467, owner 10-09: "the transposed copy re-opens showing ~4
 * bars") adds the missing half: the score's document reports its own height, and
 * this box grows to it, so a longer score is laid out in full and the PAGE
 * scrolls it instead of the viewer clipping it.
 */
const SCORE_STAFF_MIN_HEIGHT = 240;

/** Simple AbcScore wrapper used for a library-loaded (already-transposed) copy. */
function scoreFromAbc(abc: string, title: string): AbcScore {
  return {
    id: 'from-library',
    title,
    composer: 'Your library',
    keyLabel: extractAbcKey(abc) ?? 'C',
    isPublicDomain: true,
    abc,
  };
}

export const NotationEditorScreen: React.FC<Props> = ({ route, navigation }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
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
  /**
   * THE HEIGHT THE SCORE'S DOCUMENT REPORTED (v37 item 2). null until the
   * document says; it grows the box below so a long score lays out in FULL
   * instead of being clipped to the box (the owner's "~4 bars"). It is cleared
   * whenever a different score is loaded, because a height that belonged to the
   * previous score says nothing about this one.
   */
  const [scoreHeight, setScoreHeight] = useState<number | null>(null);

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
          setScoreHeight(null);
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
          setScoreHeight(null);
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
          setScoreHeight(null);
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
   * The score's document measured itself (v37 item 2). The height is clamped by
   * the same pure rule the viewer uses, so a runaway document cannot grow the
   * page without end.
   */
  const handleDocumentHeight = useCallback((height: number) => {
    setScoreHeight(abcScoreContainerHeight({ interactive: false, measuredHeight: height }));
  }, []);

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
    setScoreHeight(null);
    setSelected((current) => (current ? { ...current, abc: plan.abc } : current));
  }, [sourceAbc, selected, offset]);

  const pick = useCallback((p: AbcScore) => {
    setSourceAbc(p.abc);
    setScoreHeight(null);
    setSelected(p);
    setOffset(0);
  }, []);

  const offsetZero = offset === 0;
  const canSave = !offsetZero && selected?.isPublicDomain === true;

  const handleSave = useCallback(async () => {
    if (!selected) return;
    if (offsetZero || selected.isPublicDomain !== true) return;
    setSaving(true);
    try {
      const sign = offset > 0 ? '+' : '';
      const title = `${selected.title} (${keyLabels.to} · ${sign}${offset})`;
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
  }, [offsetZero, selected, keyLabels, offset, transposedAbc]);

  if (loading || !selected) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.centeredText}>Loading score…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.screenSubtitle}>
        Transpose a public-domain score into a new key and save the copy to
        your library. Note-by-note editing arrives in a later version.
      </Text>

      {/* Piece picker (only when not opened from a saved library item). */}
      {!itemId && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Choose a piece</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pickerRow}
          >
            {PUBLIC_DOMAIN_ABC_SCORES.map((p) => {
              const active = selected.id === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => pick(p)}
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
          </ScrollView>
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
          <Text style={styles.scoreTitle} numberOfLines={1}>
            {selected.title}
          </Text>
          <Text style={styles.scoreComposer} numberOfLines={1}>
            {selected.composer}
          </Text>
        </View>
        {!itemId && selected.isPublicDomain && (
          <View style={styles.pdBadge}>
            <Ionicons name="leaf" size={12} color={theme.positive} />
            <Text style={styles.pdBadgeText}>Public domain</Text>
          </View>
        )}
        {/* THE STAFF NEEDS A REAL BOX (v36 fix 3 — "the sheet wouldn't open").
            AbcScoreView's own container is `flex: 1` and its WebView is `flex: 1`.
            Inside a card with NO height, a `flex: 1` child lays out at ZERO — so
            this card opened with a title, a composer line and NO SCORE, on every
            score, and the owner could not check that a transposed copy had saved.
            The box below gives the renderer a definite height, and the viewer's own
            min-height floor (ABC_MIN_HEIGHT) means no future call site can silently
            collapse it again. `interactive={false}` closes the WebView's touch
            surface so a finger on the staff scrolls THIS page instead. */}
        {/* THE BOX GROWS TO THE SCORE (v37 item 2, backlog 9e71e467). The box is
            a FLOOR (SCORE_STAFF_MIN_HEIGHT); the score's own document reports how
            tall it really is and the box is given that as a min-height, so a long
            score lays out in full and THIS page scrolls it. Without it the viewer
            (non-interactive, so it cannot scroll itself) showed only as much as
            the box was tall — the owner's "~4 bars". `interactive={false}` keeps
            the WebView's touch surface closed so a finger on the staff scrolls
            this page (v36 fix 1). */}
        <View
          style={[
            styles.scoreStaffBox,
            scoreHeight !== null && {
              minHeight: Math.max(SCORE_STAFF_MIN_HEIGHT, scoreHeight),
            },
          ]}
        >
          <AbcScoreView abc={transposedAbc} interactive={false} onDocumentHeight={handleDocumentHeight} />
        </View>
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
  chip: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 200,
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
    minHeight: 240,
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
