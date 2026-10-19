/**
 * MetronomeScreen — practice-tool metronome (owner-requested).
 *
 * Timing model (drift-corrected audio clock):
 *   A coarse `setInterval` (~25 ms) acts as a look-ahead scheduler. Each tick it
 *   schedules every beat whose absolute time falls inside the look-ahead window.
 *   Beat times are computed from an accumulating time base:
 *       beatTime(n) = startTime + n * beatIntervalMs
 *   — never from "now + interval", so a late JS callback (UI jank, GC pause,
 *   background suspension) never shifts the beat; the next beat still lands on
 *   its absolute time. Each beat is fired with its own `setTimeout(delay)` so the
 *   audio click and the visual pulse fire together at the scheduled instant.
 *   If the app was suspended and the clock fell far behind, missed beats are
 *   fast-forwarded (skipped) instead of bursting.
 *
 * Tempo changes while running snap the next beat to one new interval after the
 * most recently scheduled beat and cancel any pending old-tempo clicks, so a
 * slider drag takes effect on the very next click.
 *
 * The whole screen is offline: both click sounds are bundled WAV assets loaded
 * once into expo-av `Audio.Sound` objects and replayed per beat.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import type { AVPlaybackSource } from 'expo-av';
// v40 fix E: the app's ONE playback audio session (v34's fix for expo-av's
// focus-gated volume) and the diagnostics sink that stops a load failure from
// being swallowed.
import {
  ensurePlaybackAudioMode,
  playWithAudioFocus,
  registerAudioPauseHandler,
} from '../services/audioSession';
import { reportAudioFailure, usableDetail } from '../services/audioDiagnostics';

// ─── Constants ─────────────────────────────────────────────────

const BPM_MIN = 40;
const BPM_MAX = 240;
const DEFAULT_BPM = 120;

/** How often the look-ahead scheduler wakes up (ms). */
const SCHEDULER_INTERVAL_MS = 25;
/** How far ahead of "now" the scheduler schedules beats (ms). */
const LOOKAHEAD_MS = 120;
/** Small pickup before the first click after pressing Start. */
const START_DELAY_MS = 120;

/** Tap tempo: reset the tap history if this much time passes between taps. */
const TAP_RESET_MS = 2000;
/** Keep at most this many tap timestamps (→ up to 7 intervals). */
const MAX_TAPS = 8;
/** Average the last N intervals (from up to N+1 taps). */
const TAP_INTERVALS_TO_AVERAGE = 5;

type TimeSignature = { label: string; beats: number };
const TIME_SIGNATURES: TimeSignature[] = [
  { label: '4/4', beats: 4 },
  { label: '3/4', beats: 3 },
  { label: '6/8', beats: 6 },
  { label: '2/4', beats: 2 },
];

const ACCENT_COLOR = '#e94560';
const BEAT_COLOR = '#4ecdc4';
const MUTED_TEXT = '#a0a0b8';

/** Monotonic clock — `performance.now()` is provided by Hermes/RN; DOM lib
 *  types declare it so it also type-checks on web. */
const nowMs = () => performance.now();

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// ─── Bundled click sounds ─────────────────────────────────────

const ACCENT_SOUND_SOURCE = require('../../assets/sounds/click-accent.wav') as AVPlaybackSource;
const BEAT_SOUND_SOURCE = require('../../assets/sounds/click-beat.wav') as AVPlaybackSource;

/**
 * v40 fix E — WHY THE METRONOME WAS SILENT (owner: "the metronome produces no
 * audible beat"), and what this screen does about it.
 *
 * TWO CODE-LEVEL CAUSES, both found in this screen and both fixed here. The WAV
 * assets themselves are fine — they are valid 44.1 kHz 16-bit PCM clicks (40 ms
 * accent, 24 ms beat) with real amplitude in them, so no asset is regenerated.
 *
 *   1. NO PLAYBACK SESSION. This screen called
 *      `Audio.setAudioModeAsync({ playsInSilentModeIOS: true })` — a PARTIAL mode,
 *      whose omitted keys expo-av fills in from whatever mode was already current.
 *      That is the exact v33→v34 defect services/audioSession.ts was written to
 *      close (see its header): on Android expo-av's player computes its volume from
 *      the audio focus it holds, so a play on a session that was never established
 *      can SUCCEED and be completely inaudible with no error at all. The metronome
 *      was the last surface still doing it its own way; it now goes through the
 *      app's ONE playback session (`ensurePlaybackAudioMode`), applied before every
 *      click.
 *   2. ONE AWAIT COULD KILL BOTH LOADS. Both click sounds were created inside a
 *      single `try`, so anything that failed early — the audio-mode call, the first
 *      `loadAsync` — aborted the second one too, and the whole failure was
 *      swallowed by an empty `catch`. The result was a metronome that flashed the
 *      beat and played nothing, with nothing on the screen to say why. Each step is
 *      now independent, and a sound that genuinely cannot load says so on screen.
 *
 * Replaying a click now uses the API that is documented for it (`replayAsync`,
 * which sets the position back to the start and plays) — NOT `playFromPositionAsync`
 * on a sound that has already finished.
 */
export const CLICK_SOUND_FAILED_LINE =
  'The click sound could not load on this device — the beat still flashes, but it will be silent. Check the app’s audio hasn’t been muted in Settings.';

/** How one click is played (the body lives INSIDE the guarded play call below). */
const CLICK_REPLAY_FAILED = 'click-replay-failed';

export const MetronomeScreen: React.FC = () => {
  const { styles, theme } = useThemedStyles(baseStyles);
  // ── UI state ────────────────────────────────────────────────
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>(TIME_SIGNATURES[0]);
  const [isRunning, setIsRunning] = useState(false);
  /** Beat index (0-based) of the most recent click; -1 when stopped. */
  const [currentBeat, setCurrentBeat] = useState(-1);
  /** BPM derived from tap tempo, shown on the tap button. */
  const [tapBpm, setTapBpm] = useState<number | null>(null);
  /** True once both click sounds finished loading. */
  const [soundsReady, setSoundsReady] = useState(false);
  /** True when at least one click sound could not be loaded (v40 fix E). */
  const [soundFailed, setSoundFailed] = useState(false);

  // ── Audio clock refs (never read stale values from the scheduler) ──
  const bpmRef = useRef(DEFAULT_BPM);
  const beatsPerMeasureRef = useRef(TIME_SIGNATURES[0].beats);
  const isRunningRef = useRef(false);
  /** Absolute time (nowMs base) the next beat is scheduled for. */
  const nextTickTimeRef = useRef(0);
  /** Absolute time of the most recently scheduled beat. */
  const lastTickTimeRef = useRef(0);
  /** 0-based beat index within the current bar. */
  const beatInBarRef = useRef(0);
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Every pending per-beat setTimeout, so we can cancel on stop/tempo change. */
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // ── Audio objects ───────────────────────────────────────────
  const accentSoundRef = useRef<Audio.Sound | null>(null);
  const beatSoundRef = useRef<Audio.Sound | null>(null);

  // ── Tap tempo ───────────────────────────────────────────────
  const tapsRef = useRef<number[]>([]);

  // ── Visual pulse ────────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });

  // ── Sound loading (v40 fix E) ───────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      // THE PLAYBACK SESSION FIRST, and on its own: this is the app's ONE playback
      // mode (services/audioSession.ts), which is what makes a click actually
      // audible on Android. It is awaited but never fatal — a session that could
      // not be set must not stop the sounds from loading.
      await ensurePlaybackAudioMode();
      const load = async (
        source: AVPlaybackSource,
      ): Promise<Audio.Sound | null> => {
        try {
          const sound = new Audio.Sound();
          await sound.loadAsync(source);
          return sound;
        } catch (err) {
          // Never swallowed (v34 rule): the reason reaches the surface and the
          // app-wide diagnostics chip.
          reportAudioFailure({
            source: 'tone-preview',
            reason: 'tone-load',
            detail: usableDetail(err),
          });
          return null;
        }
      };
      // INDEPENDENT loads: a click that cannot load never takes the other with it.
      const accent = await load(ACCENT_SOUND_SOURCE);
      const beat = await load(BEAT_SOUND_SOURCE);
      if (!mounted) {
        await accent?.unloadAsync().catch(() => {});
        await beat?.unloadAsync().catch(() => {});
        return;
      }
      accentSoundRef.current = accent;
      beatSoundRef.current = beat;
      const ready = !!accent || !!beat;
      setSoundsReady(ready);
      setSoundFailed(!ready);
    })();
    // The session stays active in the background (v41), so the app stops the beat
    // when the user leaves — a metronome ticking in their pocket is not practice.
    const unregisterPause = registerAudioPauseHandler(() => {
      isRunningRef.current = false;
      setIsRunning(false);
      stopScheduler();
      cancelPendingTimers();
    });
    return () => {
      unregisterPause();
      mounted = false;
      stopScheduler();
      cancelPendingTimers();
      accentSoundRef.current?.unloadAsync().catch(() => {});
      beatSoundRef.current?.unloadAsync().catch(() => {});
      accentSoundRef.current = null;
      beatSoundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scheduler core ──────────────────────────────────────────

  const cancelPendingTimers = useCallback(() => {
    pendingTimersRef.current.forEach((t) => clearTimeout(t));
    pendingTimersRef.current.clear();
  }, []);

  /** Fire one beat: audio click + visual pulse at the given delay (ms). */
  const fireBeat = useCallback(
    (beatIndex: number, delay: number) => {
      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(timer);
        const sound = beatIndex === 0 ? accentSoundRef.current : beatSoundRef.current;
        // v41 item 1: EVERY click goes through the ONE guarded play path
        // (playWithAudioFocus) — the session is re-applied and a refused audio
        // focus request is retried once. This is the metronome the owner re-flagged
        // twice ("makes no sound output still"): the clicks ARE expo-av Sounds, so
        // the shared focus failure silenced them exactly like the video and the
        // listen rows, and a bare replayAsync could not recover. `replayAsync` is
        // still what makes a finished click sound again.
        void (async () => {
          try {
            await playWithAudioFocus(
              async () => {
                if (!sound) return;
                try {
                  await sound.replayAsync();
                } catch {
                  // A sound that cannot replay from the start position still gets
                  // one more chance through the explicit seek-then-play pair before
                  // we give up on it.
                  try {
                    await sound.setPositionAsync(0);
                    await sound.playAsync();
                  } catch {
                    throw new Error(CLICK_REPLAY_FAILED);
                  }
                }
              },
              { source: 'tone-preview', reason: 'clip-load' },
            );
          } catch {
            // playWithAudioFocus already reported the reason to the chip; a beat
            // must never throw out of the scheduler.
          }
        })();
        // Visual pulse synced to the click.
        pulseAnim.stopAnimation();
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 45, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 240, useNativeDriver: true }),
        ]).start();
        setCurrentBeat(beatIndex);
      }, delay);
      pendingTimersRef.current.add(timer);
    },
    [pulseAnim]
  );

  const schedulerTick = useCallback(() => {
    if (!isRunningRef.current) return;
    const now = nowMs();
    const intervalMs = 60000 / bpmRef.current;

    // If the app was suspended (backgrounded) we may be far behind. Skip the
    // missed beats instead of firing a burst of clicks when the UI resumes.
    if (nextTickTimeRef.current < now - Math.max(intervalMs * 1.5, 250)) {
      const missed = Math.ceil((now - nextTickTimeRef.current) / intervalMs);
      nextTickTimeRef.current += missed * intervalMs;
      beatInBarRef.current =
        (beatInBarRef.current + missed) % beatsPerMeasureRef.current;
    }

    // Schedule every beat whose absolute time is inside the look-ahead window.
    while (nextTickTimeRef.current < now + LOOKAHEAD_MS) {
      const delay = Math.max(0, nextTickTimeRef.current - now);
      fireBeat(beatInBarRef.current, delay);
      beatInBarRef.current =
        (beatInBarRef.current + 1) % beatsPerMeasureRef.current;
      lastTickTimeRef.current = nextTickTimeRef.current;
      nextTickTimeRef.current += intervalMs;
    }
  }, [fireBeat]);

  /** Snap the next beat to one new interval after the last scheduled beat,
   *  so BPM changes apply from the next click (not after the look-ahead). */
  const snapNextBeat = useCallback(
    (newBpm: number) => {
      if (!isRunningRef.current) return;
      cancelPendingTimers();
      const now = nowMs();
      nextTickTimeRef.current = Math.max(
        now,
        lastTickTimeRef.current + 60000 / newBpm
      );
    },
    [cancelPendingTimers]
  );

  const start = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setIsRunning(true);
    beatInBarRef.current = 0;
    nextTickTimeRef.current = nowMs() + START_DELAY_MS;
    lastTickTimeRef.current = nextTickTimeRef.current - 60000 / bpmRef.current;
    schedulerRef.current = setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
  }, [schedulerTick]);

  const stop = useCallback(() => {
    isRunningRef.current = false;
    setIsRunning(false);
    if (schedulerRef.current) {
      clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
    cancelPendingTimers();
    setCurrentBeat(-1);
  }, [cancelPendingTimers]);

  const stopScheduler = useCallback(() => {
    isRunningRef.current = false;
    if (schedulerRef.current) {
      clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
  }, []);

  // Stop cleanly when the user leaves the screen while it is playing.
  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  // ── Controls ────────────────────────────────────────────────

  const applyBpm = useCallback(
    (value: number) => {
      const next = clamp(Math.round(value), BPM_MIN, BPM_MAX);
      setBpm(next);
      bpmRef.current = next;
      snapNextBeat(next);
    },
    [snapNextBeat]
  );

  const stepBpm = useCallback(
    (delta: number) => {
      applyBpm(bpmRef.current + delta);
    },
    [applyBpm]
  );

  const selectTimeSignature = useCallback((ts: TimeSignature) => {
    setTimeSignature(ts);
    beatsPerMeasureRef.current = ts.beats;
    if (isRunningRef.current) {
      // Start a fresh bar so the accent lands on the next click.
      beatInBarRef.current = 0;
    }
  }, []);

  const handleTap = useCallback(() => {
    const now = nowMs();
    const taps = tapsRef.current;
    const last = taps.length > 0 ? taps[taps.length - 1] : 0;
    if (taps.length === 0 || now - last > TAP_RESET_MS) {
      // First tap, or a stale tap — start a fresh tempo estimate.
      tapsRef.current = [now];
      setTapBpm(null);
      return;
    }
    taps.push(now);
    if (taps.length > MAX_TAPS) taps.shift();
    tapsRef.current = taps;
    if (taps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i += 1) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      const recent = intervals.slice(-TAP_INTERVALS_TO_AVERAGE);
      const avgIntervalMs =
        recent.reduce((sum, v) => sum + v, 0) / recent.length;
      const derived = clamp(Math.round(60000 / avgIntervalMs), BPM_MIN, BPM_MAX);
      setTapBpm(derived);
      // Tap tempo sets the metronome immediately — even while running.
      setBpm(derived);
      bpmRef.current = derived;
      snapNextBeat(derived);
    }
  }, [snapNextBeat]);

  const toggleRunning = useCallback(() => {
    if (isRunningRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  // ── Render ──────────────────────────────────────────────────

  const beatDots = useMemo(
    () => Array.from({ length: timeSignature.beats }, (_, i) => i),
    [timeSignature.beats]
  );

  const isAccent = currentBeat === 0;
  const orbColor = isAccent ? theme.accent : theme.positive;
  const orbGlow = isAccent ? theme.accent : theme.chipBg;

  return (
    <View style={styles.container}>
      {/* BPM readout */}
      <Text style={styles.bpmValue} accessibilityRole="text">
        {bpm}
      </Text>
      <Text style={styles.bpmLabel}>BPM</Text>

      {/* Slider + steppers */}
      <View style={styles.sliderRow}>
        <Pressable
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          onPress={() => stepBpm(-1)}
          accessibilityRole="button"
          accessibilityLabel="Decrease tempo"
          hitSlop={8}
        >
          <Ionicons name="remove" size={22} color={theme.text} />
        </Pressable>
        <Slider
          style={styles.slider}
          minimumValue={BPM_MIN}
          maximumValue={BPM_MAX}
          step={1}
          value={bpm}
          onValueChange={applyBpm}
          minimumTrackTintColor={theme.accent}
          maximumTrackTintColor={theme.chipBg}
          thumbTintColor={theme.accent}
          accessibilityLabel="Tempo"
        />
        <Pressable
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          onPress={() => stepBpm(1)}
          accessibilityRole="button"
          accessibilityLabel="Increase tempo"
          hitSlop={8}
        >
          <Ionicons name="add" size={22} color={theme.text} />
        </Pressable>
      </View>

      {/* Time signature presets */}
      <View style={styles.tsRow}>
        {TIME_SIGNATURES.map((ts) => {
          const selected = ts.label === timeSignature.label;
          return (
            <Pressable
              key={ts.label}
              style={({ pressed }) => [
                styles.tsChip,
                selected && styles.tsChipSelected,
                pressed && styles.pressed,
              ]}
              onPress={() => selectTimeSignature(ts)}
              accessibilityRole="button"
              accessibilityLabel={`Time signature ${ts.label}`}
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.tsChipText,
                  selected && styles.tsChipTextSelected,
                ]}
              >
                {ts.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Visual pulse orb + bar position dots */}
      <View style={styles.pulseArea}>
        <Animated.View
          style={[
            styles.orb,
            {
              borderColor: orbGlow,
              backgroundColor: 'rgba(22,33,62,0.55)',
              transform: [{ scale: pulseScale }],
            },
          ]}
        >
          <View
            style={[styles.orbInner, { backgroundColor: orbColor }]}
          >
            <Text style={styles.orbBeatNumber}>
              {isRunning && currentBeat >= 0 ? currentBeat + 1 : ''}
            </Text>
          </View>
        </Animated.View>
        <View style={styles.dotsRow}>
          {beatDots.map((i) => (
            <View
              key={i}
              style={[
                styles.dot,
                isRunning && i === currentBeat && styles.dotActive,
              ]}
            />
          ))}
        </View>
      </View>

      {/* Tap tempo */}
      <Pressable
        style={({ pressed }) => [
          styles.tapButton,
          pressed && styles.tapButtonPressed,
        ]}
        onPress={handleTap}
        accessibilityRole="button"
        accessibilityLabel="Tap tempo"
      >
        <Text style={styles.tapTitle}>TAP</Text>
        <Text style={styles.tapHint}>
          {tapBpm !== null ? `${tapBpm} BPM` : 'tap the beat'}
        </Text>
      </Pressable>

      {/* Start / Stop */}
      <Pressable
        style={({ pressed }) => [
          styles.startButton,
          isRunning && styles.startButtonRunning,
          pressed && styles.pressed,
        ]}
        onPress={toggleRunning}
        accessibilityRole="button"
        accessibilityLabel={isRunning ? 'Stop metronome' : 'Start metronome'}
      >
        <Ionicons
          name={isRunning ? 'stop' : 'play'}
          size={22}
          color="#ffffff"
        />
        <Text style={styles.startButtonText}>
          {isRunning ? 'Stop' : 'Start'}
        </Text>
      </Pressable>

      {!soundsReady && !soundFailed && (
        <Text style={styles.loadingHint}>Loading click sounds…</Text>
      )}
      {/* v40 fix E: a click that could not load is SAID, not swallowed — the beat
          still pulses, so without this line the metronome would look like it was
          working while playing nothing (exactly what the owner reported). */}
      {soundFailed && <Text style={styles.soundFailedHint}>{CLICK_SOUND_FAILED_LINE}</Text>}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  bpmValue: {
    fontSize: 72,
    fontWeight: '800',
    color: '#eaeaff',
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  bpmLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: MUTED_TEXT,
    letterSpacing: 2,
    marginBottom: 20,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
    marginBottom: 24,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  tsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  tsChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  tsChipSelected: {
    backgroundColor: '#e94560',
    borderColor: '#e94560',
  },
  tsChipText: {
    color: MUTED_TEXT,
    fontSize: 15,
    fontWeight: '700',
  },
  tsChipTextSelected: {
    color: '#ffffff',
  },
  pulseArea: {
    alignItems: 'center',
    marginBottom: 28,
  },
  orb: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  orbInner: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbBeatNumber: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2a2a4a',
  },
  dotActive: {
    backgroundColor: BEAT_COLOR,
  },
  tapButton: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: '#16213e',
    borderWidth: 2,
    borderColor: '#0f3460',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  tapButtonPressed: {
    borderColor: ACCENT_COLOR,
    backgroundColor: '#1f2b52',
  },
  tapTitle: {
    color: '#eaeaff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
  },
  tapHint: {
    color: MUTED_TEXT,
    fontSize: 13,
    marginTop: 4,
    fontWeight: '600',
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e94560',
    borderRadius: 28,
    paddingHorizontal: 44,
    paddingVertical: 14,
  },
  startButtonRunning: {
    backgroundColor: '#3a3a5c',
    borderWidth: 1,
    borderColor: '#e94560',
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  loadingHint: {
    color: MUTED_TEXT,
    fontSize: 12,
    marginTop: 12,
  },
  soundFailedHint: {
    color: '#ffd166',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
  },
});
