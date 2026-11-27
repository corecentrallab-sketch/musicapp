/**
 * TakeSaveToLibraryButton — "Save to library" for the user's OWN practice take
 * (owner decision 2026-11-24, option A).
 *
 * WHERE IT LIVES: on the practice-video result card (screens/PracticeVideoScreen)
 * and on every History row that carries a take (screens/HistoryScreen). Both pass
 * the SAME things — the take's row id, the take, and the name the row shows — so
 * the two doors write one identical library item, and a take saved from one
 * surface reads as saved on the other.
 *
 * WHAT IT WRITES: `addAbcToLibrary` (services/libraryStore.ts) — the existing
 * library store the editor's own save uses — with `takeId`, so the write is
 * IDEMPOTENT on the take: a second tap, or a save from the other surface, returns
 * the row that is already there instead of writing a duplicate.
 *
 * HONEST STATE (the reason this is a component and not a one-line button):
 *   • the label is a FUNCTION of the real state (services/takeLibraryModel.ts), so
 *     "Saved to library ✓" appears only after a real write or a real registry read;
 *   • it is DISABLED while saving and once saved;
 *   • a failure keeps the button actionable and prints the reason — a silent
 *     failure reads as a dead button;
 *   • a take with NO notes offers nothing at all: there is no score to save, and
 *     an action that could only fail is not rendered.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { addAbcToLibrary, findLibraryItemByTakeId } from '../services/libraryStore';
import { useThemedStyles } from '../services/themeStore';
import type { SavedCaptureTake } from '../services/midiExport';
import {
  SAVED_TAKE_TO_LIBRARY_LINE,
  SAVE_TAKE_TO_LIBRARY_HINT,
  TAKE_SAVE_TO_LIBRARY_FAILED_LINE,
  takeLibraryAbc,
  takeLibrarySaveBusy,
  takeLibrarySaveLabel,
  takeLibraryTitle,
  takeSaveOffered,
  type TakeLibrarySaveState,
} from '../services/takeLibraryModel';

export interface TakeSaveToLibraryButtonProps {
  /** The History row id of the take — the idempotency key. */
  takeId: string | null | undefined;
  /** The name the row shows; the editor's own builder adds the key. */
  title: string | null | undefined;
  /** The take's notes, as the card and the row hold them. */
  take: SavedCaptureTake | null | undefined;
  /** Tight spacing for a History row; the result card uses the full size. */
  compact?: boolean;
}

export const TakeSaveToLibraryButton: React.FC<TakeSaveToLibraryButtonProps> = ({
  takeId,
  title,
  take,
  compact,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [state, setState] = useState<TakeLibrarySaveState>('idle');
  const [line, setLine] = useState<string | null>(null);

  // The saved state is READ from the library registry, never assumed: a take
  // already kept shows "Saved to library ✓" the moment the row is on screen.
  useEffect(() => {
    let cancelled = false;
    setLine(null);
    setState('idle');
    if (!takeSaveOffered(take) || !takeId) return () => undefined;
    void findLibraryItemByTakeId(takeId)
      .then((item) => {
        if (cancelled || !item) return;
        setState('saved');
        setLine(SAVED_TAKE_TO_LIBRARY_LINE);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [take, takeId]);

  const save = useCallback(async () => {
    if (takeLibrarySaveBusy(state)) return;
    if (!takeId || !take) return;
    const abc = takeLibraryAbc(take);
    if (!abc) {
      setState('error');
      setLine(TAKE_SAVE_TO_LIBRARY_FAILED_LINE);
      return;
    }
    setState('saving');
    setLine(null);
    try {
      await addAbcToLibrary({
        title: takeLibraryTitle(title, take),
        abc,
        takeId,
      });
      setState('saved');
      setLine(SAVED_TAKE_TO_LIBRARY_LINE);
    } catch (err) {
      // A failed save is ALWAYS visible: the button stays tappable and the reason
      // is printed here.
      setState('error');
      setLine(
        err instanceof Error && err.message ? err.message : TAKE_SAVE_TO_LIBRARY_FAILED_LINE,
      );
    }
  }, [state, take, takeId, title]);

  // Nothing to save → no control at all.
  if (!takeSaveOffered(take) || !takeId) return null;

  const busy = takeLibrarySaveBusy(state);

  return (
    <View style={[styles.wrap, compact === true ? styles.wrapCompact : null]}>
      <Pressable
        style={[
          styles.btn,
          compact === true ? styles.btnCompact : null,
          {
            backgroundColor: theme.chipBg,
            borderColor: theme.border,
            opacity: busy ? 0.75 : 1,
          },
        ]}
        onPress={() => void save()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={takeLibrarySaveLabel(state)}
        accessibilityHint={SAVE_TAKE_TO_LIBRARY_HINT}
      >
        {state === 'saving' ? (
          <ActivityIndicator size="small" color={theme.chipText} />
        ) : null}
        <Text style={[styles.btnText, { color: theme.chipText }]}>
          {takeLibrarySaveLabel(state)}
        </Text>
      </Pressable>
      {line ? (
        <Text style={[styles.line, { color: theme.subtext }]}>{line}</Text>
      ) : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    alignSelf: 'stretch',
  },
  wrapCompact: {
    marginTop: 8,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  btnCompact: {
    paddingVertical: 10,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  line: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
});
