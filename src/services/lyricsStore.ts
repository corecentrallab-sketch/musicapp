/**
 * lyricsStore.ts — WHERE A LYRIC SHEET IS WRITTEN (v45 slice 6).
 *
 * THE ONE SEAM. Like `correctedTakeStore` for takes, every lyric read and write
 * goes through here, so the words the card shows, the words History would show
 * and the words a later surface reads are the same words. Two subjects exist —
 * the user's captured take (a melody History row id) and the user's own
 * composition (its own id) — and both are stored the same way: one record per
 * subject, keyed by `lyricsStorageKey()` from the pure model.
 *
 * WHAT IS NOT HERE, ON PURPOSE. No network client, no lyrics database, no URL,
 * no audio input and no transcription: the only thing this module can write is
 * text the user typed on the device. The encoding, the caps and the honest
 * sentences all live in `services/lyricsSheet.ts` (pure, tier1-compiled) so the
 * decisions are proven without a device; this file is the AsyncStorage I/O.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LYRICS_CLEARED_LINE,
  LYRICS_SAVE_FAILED_LINE,
  decodeLyricsRecord,
  encodeLyricsRecord,
  lyricsSavedLine,
  lyricsStorageKey,
  normalizeLyrics,
  type LyricsSourceKind,
} from './lyricsSheet';

export interface LyricsWriteResult {
  ok: boolean;
  /** True when the write removed the subject's words (the user emptied them). */
  cleared: boolean;
  /** The honest sentence the surface shows after the attempt. */
  message: string;
}

/**
 * The words stored for a subject, or '' when there are none (nothing saved, a
 * record from another subject, damaged storage). Never throws: a read failure on
 * a lyric sheet must not take the surface down.
 */
export async function loadLyrics(kind: LyricsSourceKind, subjectId: string | null): Promise<string> {
  const key = lyricsStorageKey(kind, subjectId ?? '');
  if (!key) return '';
  try {
    const raw = await AsyncStorage.getItem(key);
    const record = decodeLyricsRecord(raw, { kind, subjectId: String(subjectId) });
    return record ? record.text : '';
  } catch {
    return '';
  }
}

/**
 * Write (or, for empty words, remove) a subject's lyric sheet. Never throws: a
 * failed write is `ok: false` with a sentence saying so, so the surface can keep
 * the user's text on screen rather than looking saved when it is not.
 */
export async function saveLyrics(
  kind: LyricsSourceKind,
  subjectId: string | null,
  text: unknown,
): Promise<LyricsWriteResult> {
  const key = lyricsStorageKey(kind, subjectId ?? '');
  if (!key) {
    return { ok: false, cleared: false, message: LYRICS_SAVE_FAILED_LINE };
  }
  const normalized = normalizeLyrics(text);
  try {
    if (normalized === '') {
      await AsyncStorage.removeItem(key);
      return { ok: true, cleared: true, message: LYRICS_CLEARED_LINE };
    }
    const encoded = encodeLyricsRecord({ kind, subjectId: String(subjectId), text: normalized });
    if (!encoded) {
      return { ok: false, cleared: false, message: LYRICS_SAVE_FAILED_LINE };
    }
    await AsyncStorage.setItem(key, encoded);
    return { ok: true, cleared: false, message: lyricsSavedLine(kind) };
  } catch {
    return { ok: false, cleared: false, message: LYRICS_SAVE_FAILED_LINE };
  }
}

/** The user's words for THEIR CAPTURED TAKE (source 3). */
export function loadTakeLyrics(rowId: string | null): Promise<string> {
  return loadLyrics('take', rowId);
}

export function saveTakeLyrics(rowId: string | null, text: unknown): Promise<LyricsWriteResult> {
  return saveLyrics('take', rowId, text);
}

/** The user's words for THEIR OWN COMPOSITION (source 2). */
export function loadOriginalLyrics(compositionId: string | null): Promise<string> {
  return loadLyrics('original', compositionId);
}

export function saveOriginalLyrics(
  compositionId: string | null,
  text: unknown,
): Promise<LyricsWriteResult> {
  return saveLyrics('original', compositionId, text);
}
