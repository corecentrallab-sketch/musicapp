/**
 * useTakeClipPlayer.ts — plays a SAVED take clip with expo-av (v33 slice F1).
 *
 * ONE player per screen, keyed by ROW ID: History renders its rows in a
 * FlatList, so a hook per row is not available; the screen owns a single
 * `Audio.Sound` and every row asks it to play ITS clip. Starting a second clip
 * stops the first (exactly one take is ever audible), leaving History / a
 * re-render / unmount stops it, and every outcome is a sentence on the row the
 * user pressed — never silence, never a stuck button.
 *
 * WHAT IT PLAYS is the row's OWN recording (`personalMelody.audioUri`, the clip
 * the capture window persisted in notesnap-melodies/). This hook never builds
 * audio from note data: no tone bank, no preview timeline, no synthesis — the
 * user hears the take they made (src/services/takePlayback.ts says so on the
 * surface).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { reportAudioFailure, usableDetail } from '../services/audioDiagnostics';
import { ensurePlaybackAudioMode } from '../services/audioSession';
import {
  TAKE_PLAYBACK_FAILED_LINE,
  TAKE_PLAYBACK_MISSING_LINE,
  takePlaybackAvailable,
  type TakePlaybackRow,
} from '../services/takePlayback';

export interface TakeClipPlayer {
  /** The row whose clip is audible right now (null = nothing playing). */
  playingId: string | null;
  /** The row whose clip is being loaded (the honest "Loading…" state). */
  busyId: string | null;
  /** The honest sentence the last attempt left on one row. */
  note: { id: string; text: string } | null;
  /** Play this row's clip, or stop it when that row is already playing. */
  toggle(row: { id: string } & TakePlaybackRow): void;
  /** Stop whatever is playing (used when the screen unmounts / reloads). */
  stop(): void;
}

export function useTakeClipPlayer(): TakeClipPlayer {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  // The live sound + the token that invalidates a load the user has moved on from.
  const soundRef = useRef<Audio.Sound | null>(null);
  const tokenRef = useRef(0);

  const stop = useCallback(() => {
    tokenRef.current++;
    const sound = soundRef.current;
    soundRef.current = null;
    setPlayingId(null);
    setBusyId(null);
    if (sound) void sound.stopAsync().then(() => sound.unloadAsync()).catch(() => undefined);
  }, []);

  const toggle = useCallback(
    (row: { id: string } & TakePlaybackRow) => {
      // Second press on the audible row = stop (the button says so).
      if (playingId === row.id) {
        stop();
        return;
      }
      if (!takePlaybackAvailable(row)) {
        stop();
        setNote({ id: row.id, text: TAKE_PLAYBACK_MISSING_LINE });
        // The row keeps its own sentence AND the reason reaches the app-wide chip
        // (v34): "the recording is not on this device any more".
        reportAudioFailure({
          source: 'take-playback',
          reason: 'clip-missing',
          detail: `row ${row.id} has no clip path`,
        });
        return;
      }
      const uri = row.personalMelody?.audioUri;
      if (typeof uri !== 'string' || uri.trim().length === 0) {
        stop();
        setNote({ id: row.id, text: TAKE_PLAYBACK_MISSING_LINE });
        return;
      }

      const token = ++tokenRef.current;
      const previous = soundRef.current;
      soundRef.current = null;
      if (previous) {
        void previous.stopAsync().then(() => previous.unloadAsync()).catch(() => undefined);
      }
      setPlayingId(null);
      setBusyId(row.id);
      setNote(null);

      void (async () => {
        try {
          // THE SESSION FIRST (v34). expo-av reports a play on a session that was
          // never established as success and then plays nothing: on Android the
          // player's volume is literally 0 while it does not hold audio focus, so
          // the mode has to be (re)applied on the way into every play.
          await ensurePlaybackAudioMode();
          const { sound } = await Audio.Sound.createAsync(
            { uri },
            { shouldPlay: true },
          );
          if (token !== tokenRef.current) {
            // The user started another row (or left) while this one loaded.
            await sound.unloadAsync();
            return;
          }
          soundRef.current = sound;
          setBusyId(null);
          setPlayingId(row.id);
          sound.setOnPlaybackStatusUpdate((status) => {
            if (token !== tokenRef.current) return;
            if (status.isLoaded && status.didJustFinish) {
              soundRef.current = null;
              setPlayingId(null);
              void sound.unloadAsync();
            }
          });
        } catch (err) {
          if (token !== tokenRef.current) return;
          soundRef.current = null;
          setBusyId(null);
          setPlayingId(null);
          setNote({ id: row.id, text: TAKE_PLAYBACK_FAILED_LINE });
          // v33 swallowed the reason entirely; the owner's device pass had nothing
          // to read. The chip now carries the device's own message (v34).
          reportAudioFailure({
            source: 'take-playback',
            reason: 'clip-load',
            detail: usableDetail(err) || uri,
          });
        }
      })();
    },
    [playingId, stop],
  );

  // Leaving History (or any unmount) never leaves a clip running.
  useEffect(() => stop, [stop]);

  return { playingId, busyId, note, toggle, stop };
}
