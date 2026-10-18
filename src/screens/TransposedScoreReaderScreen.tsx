/**
 * TransposedScoreReaderScreen — THE FULL-SCORE READER (v39 Part 2, owner
 * direction 10-11, backlog 5e3dffd3).
 *
 * THE OWNER'S ASK. "Transposing opens the full transposed score — THE ENTIRE
 * PIECE, start to finish, EVERY BAR — in its own full-screen scrollable reader
 * window, save the transposed copy to Library, share the transposed score."
 *
 * WHY A REGISTERED STACK ROUTE. This is a full-screen tool opened from the
 * notation editor, exactly like PdfViewer, ScannedViewer and the Tuner: React
 * Navigation pops it itself, so the Android BACK key needs no handler and the
 * surface adds nothing to the modal-overlay contract (see
 * services/backExitContract.ts — routes are the first class in it).
 *
 * EVERY BAR. The score is rendered by the SAME ABC viewer the editor uses, with
 * `wholeWork`, so the viewer picks its band from the document it measured: a score
 * that fits the reader's ceiling is laid out in full and THIS page scrolls it;
 * anything longer gets a screen-height box and the WebView scrolls itself, so the
 * tail of a real work is reachable instead of clipped at the app's height ceiling
 * (the residual clip the v37 fix left — services/scoreHeight.ts).
 *
 * SAVE reuses `libraryStore.addAbcToLibrary` (the same call the editor saves
 * through) and the SHARED title builder, so the reader and the editor can never
 * write two different names for one transposed copy. SHARE hands the `.abc` (or
 * the ABC text) to the OS share sheet — see services/scoreShare.ts. Recognition,
 * transposing, reading, saving and sharing carry NO paywall code of any kind.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useState } from 'react';
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
import { SampleBadge } from '../components/SampleBadge';
import { addAbcToLibrary } from '../services/libraryStore';
import {
  transposedCopyTitle,
  transposedReaderSubtitle,
} from '../services/transposedScore';
import { SCORE_SHARE_FAILED_HINT } from '../services/scoreShare';
import { shareTransposedScore } from '../services/scoreShareDevice';

type Props = NativeStackScreenProps<RootStackParamList, 'TransposedScoreReader'>;

/** The screen's headline — the same words the stack header carries. */
export const READER_HEADLINE = 'Full score';
/** What the reader promises, in the words the owner used. */
export const READER_WHOLE_WORK_NOTE =
  'The whole piece, every bar — scroll to the end.';
/** The honest state of the money path: this surface is free through launch. */
export const READER_FREE_NOTE =
  'Reading, transposing, saving and sharing are free through launch.';
/** The save control. */
export const READER_SAVE_CTA = 'Save transposed copy to Library';
/** The save control while the write is in flight. */
export const READER_SAVING_LINE = 'Saving…';
/** The save control after the copy is in the Library. */
export const READER_SAVED_CTA = 'Saved to Library';
/** The share control. */
export const READER_SHARE_CTA = 'Share transposed score';
/** The share control while the sheet is opening. */
export const READER_SHARING_LINE = 'Opening the share sheet…';
/** Read out when the reader opens, so the surface is not silent to a screen reader. */
export const READER_ACCESSIBILITY_HINT = 'Full transposed score reader';

export const TransposedScoreReaderScreen: React.FC<Props> = ({ route }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const { abc, title, keyLabel, offset, isSample } = route.params;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);

  const copyTitle = transposedCopyTitle({ title, keyLabel, offset });
  const subtitle = transposedReaderSubtitle({ keyLabel, offset });

  /**
   * SAVE THE TRANSPOSED COPY. The same library write the editor uses
   * (`addAbcToLibrary`), with the SAME title from the same builder — and the
   * outcome is said out loud either way (a save that fails silently is the
   * "dead button" class the team has shipped before).
   */
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await addAbcToLibrary({ title: copyTitle, abc });
      setSaved(true);
      Alert.alert(
        'Saved to Library',
        `“${copyTitle}” is in your Library as a transposed copy. Open it there to view or transpose it again.`,
      );
    } catch (err) {
      Alert.alert(
        'Could not save this copy',
        err instanceof Error && err.message
          ? err.message
          : 'The transposed copy could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }, [abc, copyTitle, saving]);

  /**
   * SHARE THE TRANSPOSED SCORE. The `.abc` when the platform can share a file, the
   * ABC text otherwise; a refused share sheet says so instead of looking dead.
   */
  const handleShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const outcome = await shareTransposedScore({ abc, title, keyLabel, offset });
      if (outcome.status === 'failed') {
        Alert.alert('Share', outcome.message ?? SCORE_SHARE_FAILED_HINT);
      }
    } finally {
      setSharing(false);
    }
  }, [abc, keyLabel, offset, sharing, title]);

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <Text style={styles.title} numberOfLines={2} accessibilityLabel={READER_ACCESSIBILITY_HINT}>
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {/* WHAT THIS SCORE ACTUALLY IS (UX round 1 step 1, owner 10-18 item 5).
            Every bundled ABC score is a 3-4 bar excerpt, so a reader showing "the
            whole piece" shows a few bars — correctly. The shared badge says so,
            from the score's own bar count. The reader may not reach the network
            (v39's no-network contract), so it passes no `libraryState` and the
            badge makes no claim about what the free library holds beyond this. */}
        <SampleBadge abc={abc} isSample={isSample} style={styles.sampleBadge} />
        <Text style={styles.wholeWorkNote}>{READER_WHOLE_WORK_NOTE}</Text>
      </View>

      {/* THE SCORE ITSELF — the entire piece. `wholeWork` is what makes every bar
          reachable at any length (see services/scoreHeight.ts). */}
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <AbcScoreView abc={abc} wholeWork />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            (saving || saved) && styles.primaryBtnBusy,
            pressed && styles.pressed,
          ]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={READER_SAVE_CTA}
          accessibilityState={{ disabled: saving }}
        >
          {saving ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Ionicons name={saved ? 'checkmark' : 'bookmark'} size={18} color="#ffffff" />
          )}
          <Text style={styles.primaryBtnText}>
            {saving ? READER_SAVING_LINE : saved ? READER_SAVED_CTA : READER_SAVE_CTA}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={handleShare}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel={READER_SHARE_CTA}
          accessibilityState={{ disabled: sharing }}
        >
          <Ionicons name="share-outline" size={18} color={theme.accent} />
          <Text style={styles.secondaryBtnText}>
            {sharing ? READER_SHARING_LINE : READER_SHARE_CTA}
          </Text>
        </Pressable>

        <Text style={styles.freeNote}>{READER_FREE_NOTE}</Text>
      </View>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  headerCard: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 4,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: '#a0a0b8',
    fontSize: 13,
  },
  sampleBadge: {
    marginTop: 4,
  },
  wholeWorkNote: {
    color: '#8a8ab0',
    fontSize: 12,
    marginTop: 4,
  },
  scroller: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    backgroundColor: '#1a1a2e',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryBtnBusy: {
    backgroundColor: '#3a3a55',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
  },
  secondaryBtnText: {
    color: '#e94560',
    fontSize: 15,
    fontWeight: '700',
  },
  freeNote: {
    color: '#8a8ab0',
    fontSize: 12,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
});
