/**
 * SaveToLibraryButton — the explicit "Save to library" action for a
 * PUBLIC-DOMAIN piece (v37 item 4, backlog d9d458bb, owner v36 ask item 9).
 *
 * WHERE IT LIVES: on a PD result card (the ONE shared result surface,
 * components/RecognitionResultView.tsx) and on the PD piece page
 * (screens/PieceDetailScreen.tsx). Both pass the score URL the surface is
 * ALREADY offering, so the button saves exactly what the user is looking at —
 * never a different edition, never a guessed link.
 *
 * WHAT IT WRITES: nothing itself. It calls
 * services/pieceLibrarySave.ts → the EXISTING library store
 * (`importDocumentAsset`, the import picker's own write path), so the saved piece
 * lives in the same on-device registry and folder as every picked/scanned/synced
 * score and opens offline from the Library — there is no second store.
 *
 * HONEST STATE, NO FAKE SUCCESS (the whole reason this is a component and not a
 * one-line button):
 *   • the label comes from the PURE model (services/librarySaveModel.ts) as a
 *     function of the real state, so "Saved to library" can only be shown after a
 *     successful write or a registry read that found the row;
 *   • it is DISABLED while saving and once saved (a second tap cannot duplicate);
 *   • a failure keeps the button actionable and prints the reason, so a failed
 *     save never looks like a success (the repo's dead-button rule);
 *   • with no saveable score URL the component renders NOTHING — an action that
 *     could only fail is not offered at all.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  findSavedPieceCopy,
  savePieceScoreToLibrary,
} from '../services/pieceLibrarySave';
import {
  SAVE_TO_LIBRARY_FAILED_MESSAGE,
  SAVE_TO_LIBRARY_HINT,
  SAVED_TO_LIBRARY_LINE,
  isSaveableScoreUrl,
  saveToLibraryIsBusy,
  saveToLibraryLabel,
  type LibrarySaveState,
} from '../services/librarySaveModel';

export interface SaveToLibraryButtonProps {
  /** The catalog piece id the saved row is marked with. */
  pieceId: string;
  title: string;
  composer?: string | null;
  /** The hosted PD score (`sheet_music_url` / `piece.sheetMusicUrl`). */
  scoreUrl?: string | null;
  /** Compact styling for the result card; the piece page uses the full size. */
  compact?: boolean;
}

export const SaveToLibraryButton: React.FC<SaveToLibraryButtonProps> = ({
  pieceId,
  title,
  composer,
  scoreUrl,
  compact,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const [state, setState] = useState<LibrarySaveState>('idle');
  const [line, setLine] = useState<string | null>(null);

  // The saved state is READ from the existing library registry (never assumed):
  // reopening the same piece shows "Saved to library" because the row is there.
  useEffect(() => {
    let cancelled = false;
    setLine(null);
    setState('idle');
    if (!isSaveableScoreUrl(scoreUrl)) return () => undefined;
    void findSavedPieceCopy(pieceId)
      .then((item) => {
        if (cancelled || !item) return;
        setState('saved');
        setLine(SAVED_TO_LIBRARY_LINE);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pieceId, scoreUrl]);

  const save = useCallback(async () => {
    if (saveToLibraryIsBusy(state)) return;
    setState('saving');
    setLine(null);
    try {
      await savePieceScoreToLibrary({
        pieceId,
        title,
        composer: composer ?? null,
        scoreUrl,
      });
      setState('saved');
      setLine(SAVED_TO_LIBRARY_LINE);
    } catch (err) {
      // A failed save is ALWAYS visible: the button stays tappable and the
      // reason is printed here (a silent failure reads as a dead button).
      setState('error');
      setLine(
        err instanceof Error && err.message
          ? err.message
          : SAVE_TO_LIBRARY_FAILED_MESSAGE,
      );
    }
  }, [composer, pieceId, scoreUrl, state, title]);

  // No score we may hand out → no control at all.
  if (!isSaveableScoreUrl(scoreUrl)) return null;

  const busy = saveToLibraryIsBusy(state);

  return (
    <View style={[styles.wrap, compact === true ? styles.wrapCompact : null]}>
      <Pressable
        style={[styles.btn, compact === true ? styles.btnCompact : null, busy ? styles.btnSaved : null]}
        onPress={() => void save()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={saveToLibraryLabel(state)}
        accessibilityHint={SAVE_TO_LIBRARY_HINT}
      >
        {state === 'saving' ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : null}
        <Text style={styles.btnText}>{saveToLibraryLabel(state)}</Text>
      </Pressable>
      {line ? (
        <Text style={styles.line}>{line}</Text>
      ) : (
        <Text style={styles.hint}>{SAVE_TO_LIBRARY_HINT}</Text>
      )}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  wrap: {
    marginTop: 12,
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
    backgroundColor: '#0f3460',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#4ecdc4',
  },
  btnCompact: {
    paddingVertical: 10,
  },
  btnSaved: {
    opacity: 0.75,
    borderColor: '#0f3460',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    color: '#a0a0b8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  line: {
    color: '#4ecdc4',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
});
