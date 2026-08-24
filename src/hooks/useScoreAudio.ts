/**
 * useScoreAudio — expo-av playback foundation for practicing from a score.
 *
 * Wraps an Audio.Sound with:
 *  - Play / pause / seek (scrub)
 *  - Playback-speed control (time-stretch) via setRateAsync
 *  - A/B section looping with a real-time loop-jump callback
 *
 * The A/B loop works regardless of playback speed: a status-update listener
 * keeps the playhead inside [loopStart, loopEnd] by seeking back to the loop
 * start the instant the playhead crosses loopEnd. All positions are ms.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Audio, type AVPlaybackStatus } from "expo-av";
import { resolveLoopPosition } from "../utils/playerLoop";

/** Time-stretch presets offered in the viewer. */
export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 0.75, 1.0, 1.25];

/** Audio source: a bundled asset id (number) or a remote/local uri (string). */
export type ScoreAudioSource = string | number;

export interface ScoreAudioState {
  isLoaded: boolean;
  isPlaying: boolean;
  /** Current playhead position, in ms. */
  positionMillis: number;
  durationMillis: number;
  rate: number;
  loopActive: boolean;
  /** Loop A point, in ms (null = not set). */
  loopStart: number | null;
  /** Loop B point, in ms (null = not set). */
  loopEnd: number | null;
  error: boolean;
}

const initial: ScoreAudioState = {
  isLoaded: false,
  isPlaying: false,
  positionMillis: 0,
  durationMillis: 0,
  rate: 1,
  loopActive: false,
  loopStart: null,
  loopEnd: null,
  error: false,
};

export function useScoreAudio(source: ScoreAudioSource | null | undefined) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const rateRef = useRef<number>(1);
  const loopStartRef = useRef<number | null>(null);
  const loopEndRef = useRef<number | null>(null);
  const loopActiveRef = useRef<boolean>(false);
  /** Guards against re-entrant loop-jump seek callbacks. */
  const seekingRef = useRef<boolean>(false);

  const [state, setState] = useState<ScoreAudioState>(initial);

  // Real-time status listener: keeps playhead + looping in sync.
  const handleStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const positionMillis = status.positionMillis ?? 0;
    let next = positionMillis;
    let jumped = false;

    if (!seekingRef.current) {
      const resolved = resolveLoopPosition(
        positionMillis,
        loopStartRef.current,
        loopEndRef.current,
      );
      if (resolved.looped) {
        next = resolved.position;
        jumped = true;
      }
    }

    setState((prev) => ({
      ...prev,
      isPlaying: !!status.isPlaying,
      positionMillis: next,
      durationMillis: status.durationMillis ?? prev.durationMillis,
    }));

    if (jumped && !seekingRef.current) {
      seekingRef.current = true;
      soundRef.current
        ?.setPositionAsync(next)
        .catch(() => {})
        .finally(() => {
          seekingRef.current = false;
        });
    }
  }, []);

  // (Re)load the sound whenever the source changes.
  useEffect(() => {
    let cancelled = false;
    let loaded: Audio.Sound | null = null;
    let reapplied = false;

    // Reset refs for a new source.
    loopStartRef.current = null;
    loopEndRef.current = null;
    loopActiveRef.current = false;
    rateRef.current = 1;
    seekingRef.current = false;
    setState(initial);

    async function init() {
      if (source === null || source === undefined) return;
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
          staysActiveInBackground: false,
        });
        const sourceArg =
          typeof source === "number" ? source : { uri: source as string };
        const { sound } = await Audio.Sound.createAsync(
          sourceArg,
          { shouldPlay: false, rate: rateRef.current },
          handleStatus,
        );
        if (cancelled) {
          sound.unloadAsync().catch(() => {});
          return;
        }
        loaded = sound;
        soundRef.current = sound;
        await sound.setRateAsync(rateRef.current, true).catch(() => {});
        const status = await sound.getStatusAsync();
        if (!cancelled) {
          reapplied = true;
          setState((prev) => ({
            ...prev,
            isLoaded: true,
            durationMillis: status.isLoaded ? status.durationMillis ?? 0 : 0,
            error: false,
          }));
        }
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, error: true }));
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (loaded) {
        void loaded.unloadAsync().catch(() => {});
      } else {
        void soundRef.current?.unloadAsync().catch(() => {});
      }
      soundRef.current = null;
    };
  }, [source, handleStatus]);

  const togglePlay = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    const status = await s.getStatusAsync();
    if (status.isLoaded && status.isPlaying) {
      await s.pauseAsync();
    } else {
      // Replay from the start when it already finished.
      if (
        status.isLoaded &&
        status.didJustFinish &&
        (status.positionMillis ?? 0) >= (status.durationMillis ?? 0) - 50
      ) {
        await s.setPositionAsync(0);
      }
      await s.playAsync();
    }
  }, []);

  const seekTo = useCallback(async (ms: number) => {
    const s = soundRef.current;
    if (!s) return;
    await s.setPositionAsync(ms);
    setState((prev) => ({ ...prev, positionMillis: ms }));
  }, []);

  const setRate = useCallback(async (rate: number) => {
    rateRef.current = rate;
    setState((prev) => ({ ...prev, rate }));
    const s = soundRef.current;
    if (s) {
      await s.setRateAsync(rate, true).catch(() => {});
    }
  }, []);

  /** Set the A or B loop point at the current playhead. */
  const setLoopPoint = useCallback(
    (point: "start" | "end") => {
      const pos = state.positionMillis;
      if (point === "start") {
        loopStartRef.current = pos;
        setState((prev) => ({ ...prev, loopStart: pos }));
      } else {
        loopEndRef.current = pos;
        setState((prev) => ({ ...prev, loopEnd: pos }));
      }
    },
    [state.positionMillis],
  );

  const toggleLoop = useCallback(() => {
    const next = !loopActiveRef.current;
    loopActiveRef.current = next;
    setState((prev) => ({ ...prev, loopActive: next }));
  }, []);

  const clearLoop = useCallback(() => {
    loopStartRef.current = null;
    loopEndRef.current = null;
    loopActiveRef.current = false;
    setState((prev) => ({
      ...prev,
      loopStart: null,
      loopEnd: null,
      loopActive: false,
    }));
  }, []);

  const stop = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    await s.stopAsync().catch(() => {});
    await s.setPositionAsync(0).catch(() => {});
    setState((prev) => ({ ...prev, positionMillis: 0, isPlaying: false }));
  }, []);

  return {
    state,
    togglePlay,
    seekTo,
    setRate,
    setLoopPoint,
    toggleLoop,
    clearLoop,
    stop,
  };
}
