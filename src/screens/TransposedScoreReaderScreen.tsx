/**
 * TransposedScoreReaderScreen — THE FULL-SCORE READER (v39 Part 2, owner
 * direction 10-11, backlog 5e3dffd3; UX round 1 step 3, owner 10-18 item 1).
 *
 * THE OWNER'S ASK. "Transposing opens the full transposed score — THE ENTIRE
 * PIECE, start to finish, EVERY BAR — in its own full-screen scrollable reader
 * window, save the transposed copy to Library, share the transposed score." UX
 * round 1 item 1 adds the other half: the window must not be ONE-WAY. The key is
 * chosen here, with a − / + stepper, and a change that is not saved may not be
 * discarded by a BACK press without asking.
 *
 * WHY A REGISTERED STACK ROUTE. This is a full-screen tool opened from the
 * notation editor, exactly like PdfViewer, ScannedViewer and the Tuner: React
 * Navigation pops it itself, so the surface adds nothing to the back-exit contract
 * (services/backExitContract.ts — routes are its first class). The back-out guard
 * is therefore NOT a hardware-BACK handler (that would move this screen into the
 * in-place-flow class): it is React Navigation's own `beforeRemove` event plus a
 * modal-overlay-style confirm INSIDE this route, so the route keeps popping
 * itself and the contract keeps being true.
 *
 * EVERY BAR. The score is rendered by the SAME ABC viewer the editor uses, with
 * `wholeWork`, so the viewer picks its band from the document it measured: a score
 * that fits the reader's ceiling is laid out in full and THIS page scrolls it;
 * anything longer gets a box the height of the score AREA (`viewportHeight`, so a
 * full-screen reader's sticky header and footer are accounted for) and the WebView
 * scrolls itself, so the tail of a real work is reachable instead of clipped at
 * the app's height ceiling (the residual clip the v37 fix left —
 * services/scoreHeight.ts, including why the reported height may never be
 * pre-clamped to the app's box ceiling).
 *
 * SAVE reuses `libraryStore.addAbcToLibrary` (the same call the editor saves
 * through) and the SHARED title builder, so the reader and the editor can never
 * write two different names for one transposed copy — and it writes the score the
 * user is LOOKING AT, in the key they CHOSE (services/readerKeyControl.ts,
 * `readerSavePlan`), never the params this window was opened with. SHARE hands the
 * `.abc` (or the ABC text) to the OS share sheet — see services/scoreShare.ts.
 * Recognition, transposing, reading, saving and sharing carry NO paywall code of
 * any kind.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import {
  READER_KEY_CHIP_LABEL,
  READER_KEY_DECREASE_LABEL,
  READER_KEY_INCREASE_LABEL,
  READER_KEY_LIMIT_LINE,
  READER_KEEP_PROMPT_LEAVE,
  READER_KEEP_PROMPT_SAVE,
  READER_KEEP_PROMPT_TITLE,
  READER_UNSAVED_LINE,
  readerIsDirty,
  readerKeyChipLabel,
  readerKeyPlan,
  readerLeaveOutcome,
  readerSavePlan,
} from '../services/readerKeyControl';

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

/** The one field the back-out guard needs from React Navigation's own event. */
type BeforeRemoveEvent = { preventDefault: () => void };

export const TransposedScoreReaderScreen: React.FC<Props> = ({ navigation, route }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const { abc: openedAbc, title, keyLabel: openedKeyLabel, offset: openedOffset, isSample } =
    route.params;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);
  /**
   * THE SCORE, THE KEY AND THE OFFSET THE USER IS LOOKING AT (UX round 1 step 3).
   * They start as the editor's params — the reader is still opened on the
   * transposed score the editor handed over — and the in-place key control moves
   * all three together. Nothing here is a copy of the params: every step is an
   * ABSOLUTE re-derivation from `abc` (services/readerKeyControl.ts), so stepping
   * is never cumulative and every step still carries every bar.
   */
  const [abc, setAbc] = useState(openedAbc);
  const [keyLabel, setKeyLabel] = useState(openedKeyLabel);
  const [offset, setOffset] = useState(openedOffset);
  /** The offset of the last copy SAVED from this window (null = nothing saved yet). */
  const [savedOffset, setSavedOffset] = useState<number | null>(null);
  /** The height of the score area this screen can show (measured, not guessed). */
  const [scoreAreaHeight, setScoreAreaHeight] = useState(0);
  /** The back-out confirm is a modal-overlay-style surface INSIDE this route. */
  const [keepPromptOpen, setKeepPromptOpen] = useState(false);
  /** Set only when a leave has been decided, so the guard lets the pop through. */
  const allowLeaveRef = useRef(false);
  /** The chip's one pulse per change (a scale, so it stays on the native driver). */
  const chipPulse = useRef(new Animated.Value(1)).current;

  const copyTitle = transposedCopyTitle({ title, keyLabel, offset });
  const subtitle = transposedReaderSubtitle({ keyLabel, offset });
  const chipLabel = readerKeyChipLabel(keyLabel);
  const keyPlan = readerKeyPlan({ abc, keyLabel, offset, delta: 0 });
  /** True while the reader holds a key change that is not in the Library. */
  const dirty = readerIsDirty({ offset, initialOffset: openedOffset, savedOffset });

  const pulseKeyChip = useCallback(() => {
    chipPulse.setValue(1);
    Animated.sequence([
      Animated.timing(chipPulse, { toValue: 1.14, duration: 110, useNativeDriver: true }),
      Animated.timing(chipPulse, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [chipPulse]);

  /**
   * RE-KEY THE WHOLE SCORE IN PLACE (the owner's "unified single window"). The
   * step is a no-op at the ±11 bound and a no-op step is not a change at all, so a
   * spent stepper can never mark the window dirty — the chip pulses exactly when
   * the score really changed.
   */
  const applyKeyStep = useCallback(
    (delta: number) => {
      const plan = readerKeyPlan({ abc, keyLabel, offset, delta });
      if (!plan.changed) return;
      pulseKeyChip();
      setSaved(false);
      setAbc(plan.abc);
      setKeyLabel(plan.keyLabel);
      setOffset(plan.offset);
    },
    [abc, keyLabel, offset, pulseKeyChip],
  );

  const handleKeyDown = useCallback(() => applyKeyStep(-1), [applyKeyStep]);
  const handleKeyUp = useCallback(() => applyKeyStep(1), [applyKeyStep]);

  /**
   * SAVE THE TRANSPOSED COPY. The same library write the editor uses
   * (`addAbcToLibrary`), with the SAME title from the same builder — and the
   * outcome is said out loud either way (a save that fails silently is the
   * "dead button" class the team has shipped before). It writes the plan's ABC,
   * i.e. the score on screen in the key on the chip, and it records THAT offset as
   * the saved baseline, which is what lets the back-out guard stay quiet after a
   * save and speak up again after the next change.
   */
  const saveCopy = useCallback(async (): Promise<boolean> => {
    const plan = readerSavePlan({ abc, title, keyLabel, offset });
    setSaving(true);
    try {
      await addAbcToLibrary({ title: plan.title, abc: plan.abc });
      setSaved(true);
      setSavedOffset(plan.offset);
      return true;
    } catch (err) {
      Alert.alert(
        'Could not save this copy',
        err instanceof Error && err.message
          ? err.message
          : 'The transposed copy could not be saved.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [abc, keyLabel, offset, title]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const written = await saveCopy();
    if (written) {
      Alert.alert(
        'Saved to Library',
        `“${copyTitle}” is in your Library as a transposed copy. Open it there to view or transpose it again.`,
      );
    }
  }, [copyTitle, saveCopy, saving]);

  /**
   * SHARE THE TRANSPOSED SCORE. The `.abc` when the platform can share a file, the
   * ABC text otherwise; a refused share sheet says so instead of looking dead. The
   * sheet carries what is ON SCREEN — the key the user chose, not the one the
   * window was opened with.
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

  /** Leave the reader, with the guard already told that this pop is intended. */
  const leaveReader = useCallback(() => {
    allowLeaveRef.current = true;
    navigation.goBack();
  }, [navigation]);

  /**
   * THE BACK-OUT GUARD (UX round 1 item 1.3: "edits are never lost"). React
   * Navigation raises `beforeRemove` for EVERY way out of this route — the header
   * back arrow, the Android BACK key and the iOS swipe — so one listener covers
   * them all without touching the hardware-BACK contract. The decision itself is
   * pure (`readerLeaveOutcome`): nothing unsaved → the route pops exactly as it
   * always did; unsaved and no prompt → the ONE prompt; unsaved with the prompt
   * already up → a second BACK closes the prompt and stays. Never a second prompt,
   * never a silent loss.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event: BeforeRemoveEvent) => {
      if (allowLeaveRef.current) return;
      const outcome = readerLeaveOutcome({ dirty, promptOpen: keepPromptOpen });
      if (outcome === 'leave') return;
      event.preventDefault();
      // 'ask' opens the ONE prompt; 'close-prompt' closes it and stays put.
      setKeepPromptOpen(outcome === 'ask');
    });
    return unsubscribe;
  }, [dirty, keepPromptOpen, navigation]);

  /** The prompt's "Save to Library": write, then leave — with NO second prompt. */
  const handlePromptSave = useCallback(async () => {
    const written = await saveCopy();
    setKeepPromptOpen(false);
    if (written) leaveReader();
  }, [leaveReader, saveCopy]);

  /** The prompt's "Leave without saving": it says what it does to the work. */
  const handlePromptLeave = useCallback(() => {
    setKeepPromptOpen(false);
    leaveReader();
  }, [leaveReader]);

  return (
    <View style={styles.container}>
      {/* THE STICKY HEADER — it is a sibling of the scroller, so the key control
          and the honest lines can never scroll away from the score. */}
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
        {/* THE KEY CONTROL (UX round 1 item 1.2): the chip says which key the user
            is reading in, and the steppers re-key the WHOLE score in place. The
            chip pulses once per real change; a spent stepper is disabled and the
            reason is stated below, so neither control is ever a dead area. */}
        <View style={styles.keyRow}>
          <Animated.View
            style={[styles.keyChip, { transform: [{ scale: chipPulse }] }]}
            accessibilityRole="text"
            accessibilityLabel={`${READER_KEY_CHIP_LABEL}: ${chipLabel}`}
          >
            <Ionicons name="musical-notes-outline" size={14} color={theme.accent} />
            <Text style={styles.keyChipText}>{chipLabel}</Text>
          </Animated.View>
          <Pressable
            style={({ pressed }) => [
              styles.keyStep,
              keyPlan.atFloor && styles.keyStepSpent,
              pressed && styles.pressed,
            ]}
            onPress={handleKeyDown}
            disabled={keyPlan.atFloor}
            accessibilityRole="button"
            accessibilityLabel={READER_KEY_DECREASE_LABEL}
            accessibilityState={{ disabled: keyPlan.atFloor }}
            testID="reader-key-down"
          >
            <Ionicons
              name="remove"
              size={20}
              color={keyPlan.atFloor ? '#6a6a8a' : theme.accent}
            />
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.keyStep,
              keyPlan.atCeiling && styles.keyStepSpent,
              pressed && styles.pressed,
            ]}
            onPress={handleKeyUp}
            disabled={keyPlan.atCeiling}
            accessibilityRole="button"
            accessibilityLabel={READER_KEY_INCREASE_LABEL}
            accessibilityState={{ disabled: keyPlan.atCeiling }}
            testID="reader-key-up"
          >
            <Ionicons
              name="add"
              size={20}
              color={keyPlan.atCeiling ? '#6a6a8a' : theme.accent}
            />
          </Pressable>
        </View>
        {(keyPlan.atFloor || keyPlan.atCeiling) && (
          <Text style={styles.keyLimitNote}>{READER_KEY_LIMIT_LINE}</Text>
        )}
        <Text style={styles.wholeWorkNote}>{READER_WHOLE_WORK_NOTE}</Text>
      </View>

      {/* THE SCORE ITSELF — the entire piece. `wholeWork` is what makes every bar
          reachable at any length (see services/scoreHeight.ts), and `viewportHeight`
          is the area this screen really shows, measured on the scroller below. */}
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onLayout={(layout) => setScoreAreaHeight(Math.round(layout.nativeEvent.layout.height))}
      >
        <AbcScoreView abc={abc} wholeWork viewportHeight={scoreAreaHeight} />
      </ScrollView>

      {/* THE STICKY FOOTER — always visible while the score scrolls, because the
          action that can lose work must never hide (UX round 1 item 1). */}
      <View style={styles.footer}>
        {dirty && !saving && <Text style={styles.unsavedNote}>{READER_UNSAVED_LINE}</Text>}
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

      {/* THE BACK-OUT CONFIRM — a modal-overlay-STYLE surface, deliberately not an
          RN Modal element: this screen is a ROUTE and owns no modal element of its
          own (v39ReaderContract.readerIsARouteNotAModal), and the route's own
          `beforeRemove` event is what raises it. */}
      {keepPromptOpen && (
        <View style={styles.promptOverlay} accessibilityViewIsModal>
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>{READER_KEEP_PROMPT_TITLE}</Text>
            <Text style={styles.promptBody}>
              {`“${copyTitle}” is not in your Library yet.`}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.promptPrimary, pressed && styles.pressed]}
              onPress={handlePromptSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={READER_KEEP_PROMPT_SAVE}
            >
              <Text style={styles.promptPrimaryText}>{READER_KEEP_PROMPT_SAVE}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.promptSecondary, pressed && styles.pressed]}
              onPress={handlePromptLeave}
              accessibilityRole="button"
              accessibilityLabel={READER_KEEP_PROMPT_LEAVE}
            >
              <Text style={styles.promptSecondaryText}>{READER_KEEP_PROMPT_LEAVE}</Text>
            </Pressable>
          </View>
        </View>
      )}
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
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  keyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  keyChipText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  keyStep: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
    borderWidth: 1,
  },
  keyStepSpent: {
    backgroundColor: '#101828',
    borderColor: '#1b2540',
  },
  keyLimitNote: {
    color: '#8a8ab0',
    fontSize: 12,
    marginTop: 2,
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
  unsavedNote: {
    color: '#f0c674',
    fontSize: 12,
    textAlign: 'center',
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
  promptOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(6, 8, 20, 0.72)',
  },
  promptCard: {
    alignSelf: 'stretch',
    gap: 10,
    backgroundColor: '#16213e',
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  promptTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  promptBody: {
    color: '#a0a0b8',
    fontSize: 13,
  },
  promptPrimary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e94560',
    borderRadius: 12,
    paddingVertical: 13,
  },
  promptPrimaryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  promptSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    borderColor: '#0f3460',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  promptSecondaryText: {
    color: '#e94560',
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.8,
  },
});
