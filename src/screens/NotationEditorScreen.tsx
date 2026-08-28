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
import * as FileSystem from 'expo-file-system';
import type { RootStackParamList } from '../types';
import { AbcScoreView } from '../components/AbcScoreView';
import {
  PUBLIC_DOMAIN_ABC_SCORES,
  type AbcScore,
} from '../data/abcScores';
import {
  addAbcToLibrary,
  getLibraryItem,
} from '../services/libraryStore';
import {
  clampSemitones,
  extractAbcKey,
  transposeAbc,
  transposeKeyLabel,
} from '../services/abcTranspose';
import {
  exportAndShare,
  type ExportFormat,
} from '../services/exportPiece';

type Props = NativeStackScreenProps<RootStackParamList, 'NotationEditor'>;

const MIN_OFFSET = -11;
const MAX_OFFSET = 11;

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
  const [selected, setSelected] = useState<AbcScore>(PUBLIC_DOMAIN_ABC_SCORES[0]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

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
          const abc = await FileSystem.readAsStringAsync(item.fileUri);
          if (cancelled) return;
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
          setSelected(found);
          setOffset(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, sourcePieceId, navigation]);

  const transposedAbc = useMemo(
    () => transposeAbc(selected.abc, offset),
    [selected, offset]
  );

  const keyLabels = useMemo(() => {
    const source = extractAbcKey(selected.abc) ?? selected.keyLabel ?? 'C';
    return transposeKeyLabel(source, offset);
  }, [selected, offset]);

  const step = useCallback(
    (delta: number) => {
      setOffset((o) => clampSemitones(o + delta));
    },
    []
  );

  const resetOffset = useCallback(() => setOffset(0), []);

  const pick = useCallback((p: AbcScore) => {
    setSelected(p);
    setOffset(0);
  }, []);

  const offsetZero = offset === 0;
  const canSave = !offsetZero && selected.isPublicDomain === true;

  const handleSave = useCallback(async () => {
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

  /**
   * Export the current (possibly transposed) public-domain score as MIDI /
   * MusicXML and share it via the native share sheet. Export (like transpose/
   * save) is gated to public-domain pieces — enforced here with the same
   * `isPublicDomain` check the backend mirrors.
   */
  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (selected.isPublicDomain !== true) return;
      setExporting(format);
      try {
        await exportAndShare(
          {
            abc: transposedAbc,
            title: selected.title,
            isPublicDomain: selected.isPublicDomain === true,
          },
          format,
        );
      } catch (e) {
        Alert.alert(
          'Could not export',
          e instanceof Error ? e.message : 'The file could not be exported.'
        );
      } finally {
        setExporting(null);
      }
    },
    [selected, transposedAbc]
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e94560" />
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
            <Ionicons name="remove" size={26} color="#e94560" />
          </Pressable>

          <View style={styles.keyReadout}>
            <Text style={styles.keyFrom}>{keyLabels.from}</Text>
            <Ionicons name="arrow-forward" size={18} color="#4a4a6a" />
            <Text style={styles.keyTo}>{keyLabels.to}</Text>
          </View>

          <Pressable
            style={[styles.stepBtn, offset >= MAX_OFFSET && styles.stepBtnDisabled]}
            onPress={() => step(1)}
            disabled={offset >= MAX_OFFSET}
            accessibilityLabel="Transpose up one semitone"
          >
            <Ionicons name="add" size={26} color="#e94560" />
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
            <Ionicons name="leaf" size={12} color="#4ecdc4" />
            <Text style={styles.pdBadgeText}>Public domain</Text>
          </View>
        )}
        <AbcScoreView abc={transposedAbc} />
      </View>

      {/* Export / Share — public-domain only */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Export / Share</Text>
        <View style={styles.exportRow}>
          <Pressable
            style={[
              styles.exportBtn,
              (selected.isPublicDomain !== true || exporting !== null) &&
                styles.saveBtnDisabled,
            ]}
            onPress={() => handleExport('midi')}
            disabled={selected.isPublicDomain !== true || exporting !== null}
            accessibilityLabel="Export as MIDI"
          >
            <Ionicons name="musical-notes" size={18} color="#4ecdc4" />
            <Text style={styles.exportBtnText}>
              {exporting === 'midi' ? 'Exporting…' : 'MIDI'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.exportBtn,
              (selected.isPublicDomain !== true || exporting !== null) &&
                styles.saveBtnDisabled,
            ]}
            onPress={() => handleExport('musicxml')}
            disabled={selected.isPublicDomain !== true || exporting !== null}
            accessibilityLabel="Export as MusicXML"
          >
            <Ionicons name="musical-note" size={18} color="#4ecdc4" />
            <Text style={styles.exportBtnText}>
              {exporting === 'musicxml' ? 'Exporting…' : 'MusicXML'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.exportBtn, styles.saveBtnDisabled]}
            disabled
            accessibilityLabel="PDF export needs a curated score"
          >
            <Ionicons name="document-text" size={18} color="#8a8ab0" />
            <Text style={[styles.exportBtnText, styles.exportBtnTextDisabled]}>
              PDF
            </Text>
          </Pressable>
        </View>
        <Text style={styles.exportNote}>
          Export and share this public-domain score as a file. PDF is available
          for pieces with a curated score (recognized/library pieces).
        </Text>
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

const styles = StyleSheet.create({
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
  scoreCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    overflow: 'hidden',
    marginBottom: 18,
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
  exportRow: {
    flexDirection: 'row',
    gap: 10,
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 12,
    paddingVertical: 12,
  },
  exportBtnText: {
    color: '#4ecdc4',
    fontSize: 14,
    fontWeight: '700',
  },
  exportBtnTextDisabled: {
    color: '#8a8ab0',
  },
  exportNote: {
    color: '#8a8ab0',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
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
