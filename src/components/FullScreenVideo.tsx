/**
 * FullScreenVideo — THE IN-APP FULL-SCREEN PLAYER (vc53, item 3).
 *
 * WHY THIS EXISTS AND WHY IT IS NOT `presentFullscreenPlayer()`. The owner: "the
 * fullscreen icon on the video does nothing — wire it." The pinned `expo-av`
 * CANNOT do it: `node_modules/expo-av/build/Video.d.ts` documents
 * `presentFullscreenPlayer()` / `dismissFullscreenPlayer()` as iOS-only (the
 * Android platform implementation is a no-op), so calling it would be a control
 * that lies. Instead this window is built on the same pattern the app's own
 * full-screen score window already uses (`components/FullScreenScore.tsx`): a
 * React Native `Modal` with `presentationStyle="fullScreen"`, safe-area padding
 * and `onRequestClose`, so Android BACK closes the window and leaves the screen
 * underneath exactly as it was.
 *
 * WHAT IT PLAYS. The same local `file://` take as the page behind it, with the
 * SAME trim window in force: the position is clamped by `trimPlaybackAction` on
 * every status update, so a trimmed take cannot play its cut ends here either.
 * The scrub bar is the page's own `ScrubBar` (item 4), large, spanning the whole
 * recording with the cut ends dimmed.
 *
 * NO NETWORK, NO SECOND COPY OF THE TAKE, NO STATE THE PAGE DOES NOT HAVE. It is
 * handed a uri, a window and a start position and owns nothing else.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ResizeMode, Video } from 'expo-av';
import { useThemedStyles } from '../services/themeStore';
import {
  ensurePlaybackAudioMode,
  playWithAudioFocus,
  restorePlaybackAudioMode,
} from '../services/audioSession';
import { reportAudioFailure, usableDetail } from '../services/audioDiagnostics';
import {
  trimPlaybackAction,
  trimPlaybackWindowLine,
  trimWindowStartMs,
  type TakeTrimSpan,
} from '../services/takeClipTag';
import { ScrubBar } from './ScrubBar';
import {
  FULL_SCREEN_PREPARING_CTA,
  FULL_SCREEN_PREPARING_HINT,
  FULL_SCREEN_PREPARING_LINE,
  fullScreenCanPlay,
  fullScreenIsPreparing,
  fullScreenPrepOnEvent,
  fullScreenPrepOnOpen,
  type FullScreenPrepState,
} from '../services/videoFullScreenPrep';
import {
  FULL_SCREEN_MOUNT_FALLBACK_MS,
  FULL_SCREEN_PAINT_FRAMES_BEFORE_MOUNT,
  clearFullScreenTap,
  createFullScreenOpenTimeline,
  shouldMountFullScreenPlayer,
  type FullScreenOpenTimeline,
} from '../services/videoFullScreenOpen';

export const FULL_SCREEN_VIDEO_CLOSE_LABEL = 'Close the full-screen video';
export const FULL_SCREEN_VIDEO_CTA = 'Full screen';
export const FULL_SCREEN_VIDEO_TITLE = 'Your practice video';
export const FULL_SCREEN_VIDEO_HINT =
  'Drag the bar to move through the take. Android BACK closes this window and leaves the page as it was.';
export const FULL_SCREEN_VIDEO_FAILED_LINE =
  'This video could not be played on this device. The take itself is still saved in your History.';
/**
 * ── vc54, ITEM 3: THE CONTROL SITS ON THE VIDEO ITSELF ──────────────────────
 *
 * The owner: "icon on the video next build". The icon opens the same window the
 * labelled `FULL_SCREEN_VIDEO_CTA` button opens — the icon is for the hand, the
 * label stays under the video for the screen reader and for a first-time user who
 * does not know the corner glyph. Both are live; neither is a dead control.
 */
export const FULL_SCREEN_VIDEO_ICON_LABEL = 'Play this take full screen';
export const FULL_SCREEN_VIDEO_ICON_NAME = 'expand';

export interface FullScreenVideoProps {
  visible: boolean;
  /** The take's own local file, or null when there is nothing to play. */
  uri: string | null;
  /** The row's clip window — playback stays inside it, exactly as on the page. */
  span: TakeTrimSpan | null;
  /** Where the page's playhead was when the window opened. */
  startMs: number;
  title?: string | null;
  onClose: () => void;
}

export const FullScreenVideo: React.FC<FullScreenVideoProps> = ({
  visible,
  uri,
  span,
  startMs,
  title,
  onClose,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const player = useRef<Video | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  /**
   * ── vc55, F2 ── THE WINDOW SAYS IT IS PREPARING ────────────────────────────
   *
   * The owner waited 15–20 s on a black rectangle with a dead Play button. This
   * state is `preparing` from the moment the window opens until the player
   * reports its file (`onLoad`) or its first frame (`onReadyForDisplay`), and it
   * drives a spinner + a sentence over the video area — and a Play control that
   * is disabled rather than tappable-but-dead.
   */
  const [prep, setPrep] = useState<FullScreenPrepState>(() => fullScreenPrepOnOpen(uri));
  const reportPrep = useCallback((event: 'opened' | 'ready' | 'failed' | 'closed') => {
    setPrep((current) => fullScreenPrepOnEvent(current, event));
  }, []);
  /**
   * ── vc56 ── THE WINDOW PAINTS BEFORE ITS PLAYER EXISTS ─────────────────────
   *
   * vc55 put the spinner INSIDE the window, but the window and its `expo-av`
   * player were created in the same React commit. Creating a player over a long
   * local take is native work on the main thread, so the window's first painted
   * frame waited for the player to exist — the owner saw the window arrive 15–20 s
   * late, spinner and all, and read it as "the app did nothing".
   *
   * `windowPainted` is set by the frame callbacks below, and the `<Video>` is not
   * mounted until `shouldMountFullScreenPlayer` says the window is on screen. The
   * first thing painted is therefore the window with its spinner; the decoder
   * comes up behind it.
   */
  const [windowPainted, setWindowPainted] = useState(false);
  const playerMounted = shouldMountFullScreenPlayer(visible, windowPainted);
  const timeline = useRef<FullScreenOpenTimeline>(createFullScreenOpenTimeline());
  const openTimingLogged = useRef(false);

  /** The measured split, once per opening: press → paint → mount → file/frame. */
  const logOpenTiming = useCallback(() => {
    if (openTimingLogged.current) return;
    openTimingLogged.current = true;
    console.log(timeline.current.line());
  }, []);

  /** A seek that can never land in the trimmed-out part of the take. */
  const clampedSeek = useCallback(
    (ms: number): number => {
      const windowStart = trimWindowStartMs(span);
      const wanted = Number.isFinite(ms) ? Math.max(0, ms) : 0;
      if (windowStart === null) return wanted;
      return Math.max(windowStart, wanted);
    },
    [span],
  );

  // Every open starts from where the page's playhead was, and never from a
  // position the trim excludes. It also starts a fresh PREPARING wait, so the
  // indicator is up from the first frame the window paints.
  useEffect(() => {
    if (!visible) {
      setPrep((current) => fullScreenPrepOnEvent(current, 'closed'));
      setWindowPainted(false);
      clearFullScreenTap();
      return;
    }
    setErrorLine(null);
    setPlaying(false);
    setPrep(fullScreenPrepOnOpen(uri));
    setWindowPainted(false);
    // A fresh timeline per opening, seeded with the press that opened it.
    timeline.current = createFullScreenOpenTimeline();
    openTimingLogged.current = false;
    const target = clampedSeek(Number(startMs) || 0);
    setPositionMs(target);
    void restorePlaybackAudioMode();
  }, [clampedSeek, startMs, uri, visible]);

  /**
   * ── vc56 ── LET THE WINDOW PAINT, THEN MOUNT THE PLAYER ────────────────────
   *
   * Two frame callbacks, because the first one can still run before the freshly
   * mounted Modal's frame reaches the screen. The timeout is the safety net: a
   * window whose frames never come (opened while the app is backgrounded) still
   * gets its player, because a window that never plays is a dead end — a worse
   * outcome than a late start.
   */
  useEffect(() => {
    if (!visible) return undefined;
    let settled = false;
    let rafId: number | null = null;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let remaining = FULL_SCREEN_PAINT_FRAMES_BEFORE_MOUNT;

    const paint = () => {
      if (settled) return;
      settled = true;
      if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      if (fallback !== null) clearTimeout(fallback);
      timeline.current.mark('windowPainted');
      setWindowPainted(true);
    };
    const tick = () => {
      if (settled) return;
      remaining -= 1;
      if (remaining <= 0) {
        paint();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    fallback = setTimeout(paint, FULL_SCREEN_MOUNT_FALLBACK_MS);

    return () => {
      settled = true;
      if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      if (fallback !== null) clearTimeout(fallback);
    };
  }, [visible]);

  // The player exists: stamp it, so the split can say how long the decoder took
  // separately from how long the window itself took to appear.
  useEffect(() => {
    if (!playerMounted) return;
    timeline.current.mark('playerMounted');
  }, [playerMounted]);

  const handleClose = useCallback(() => {
    void player.current?.pauseAsync().catch(() => undefined);
    setPlaying(false);
    reportPrep('closed');
    onClose();
  }, [onClose, reportPrep]);

  const handleLoad = useCallback(() => {
    const target = clampedSeek(Number(startMs) || 0);
    void player.current?.setPositionAsync(target).catch(() => undefined);
    // The file is in the player: the wait is over and the indicator comes down.
    timeline.current.mark('loaded');
    logOpenTiming();
    reportPrep('ready');
  }, [clampedSeek, logOpenTiming, reportPrep, startMs]);

  /** The first frame is on screen — the same end of the wait as `onLoad`. */
  const handleReadyForDisplay = useCallback(() => {
    timeline.current.mark('firstFrame');
    logOpenTiming();
    reportPrep('ready');
    void restorePlaybackAudioMode();
  }, [logOpenTiming, reportPrep]);

  const toggle = useCallback(async () => {
    const video = player.current;
    // A window that is still preparing (or has no file) refuses the press: the
    // Play control is disabled, and the handler refuses too, so a stale tap on a
    // disabled-looking control can never reach a player with no file in it.
    if (!video || busy || !fullScreenCanPlay(prep)) return;
    setBusy(true);
    setErrorLine(null);
    try {
      if (playing) {
        await video.pauseAsync();
        setPlaying(false);
        return;
      }
      await ensurePlaybackAudioMode();
      // A window that has already finished starts again from its first frame.
      const action = trimPlaybackAction(positionMs, span);
      if (action.kind !== 'free') await video.setPositionAsync(action.toMs);
      await playWithAudioFocus(() => video.playAsync(), {
        source: 'take-playback',
        reason: 'clip-load',
      });
      setPlaying(true);
    } catch (err) {
      setErrorLine(FULL_SCREEN_VIDEO_FAILED_LINE);
      reportAudioFailure({
        source: 'take-playback',
        reason: 'clip-load',
        detail: usableDetail(err),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, playing, positionMs, prep, span]);

  const onSeekMs = useCallback((ms: number) => {
    const target = clampedSeek(ms);
    setPositionMs(target);
    void player.current?.setPositionAsync(target).catch(() => undefined);
  }, [clampedSeek]);

  const onStatus = useCallback((status: unknown) => {
    const position = (status as { positionMillis?: number }).positionMillis;
    const duration = (status as { durationMillis?: number }).durationMillis;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      setDurationMs(duration);
    }
    if (typeof position !== 'number' || !Number.isFinite(position)) return;
    setPositionMs(position);
    // The SAME rule the page uses: the window is in force here too.
    const action = trimPlaybackAction(position, span);
    if (action.kind === 'seek') {
      void player.current?.setPositionAsync(action.toMs).catch(() => undefined);
    } else if (action.kind === 'stop') {
      void player.current
        ?.pauseAsync()
        .then(() => player.current?.setPositionAsync(action.toMs))
        .catch(() => undefined);
    }
    setPlaying((status as { isPlaying?: boolean }).isPlaying === true);
  }, [span]);

  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      statusBarTranslucent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title ?? FULL_SCREEN_VIDEO_TITLE}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={FULL_SCREEN_VIDEO_CLOSE_LABEL}
            testID="full-screen-video-close"
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color="#ffffff" />
          </Pressable>
        </View>

        <View style={styles.body}>
          {uri ? (
            <View style={styles.videoWrap}>
              {/* ── vc56 ── NO PLAYER UNTIL THE WINDOW IS ON SCREEN ────────────
                  Mounting `expo-av` over a long take is main-thread native work,
                  and doing it in the same commit as the window is what made the
                  window itself arrive late. The box below is the same size, so
                  the spinner sits exactly where the picture will be. */}
              {playerMounted ? (
                <Video
                  ref={player}
                  style={styles.video}
                  source={{ uri }}
                  useNativeControls={false}
                  volume={1}
                  isMuted={false}
                  resizeMode={ResizeMode.CONTAIN}
                  progressUpdateIntervalMillis={200}
                  onLoad={handleLoad}
                  onReadyForDisplay={handleReadyForDisplay}
                  onError={(message) => {
                    reportPrep('failed');
                    setErrorLine(FULL_SCREEN_VIDEO_FAILED_LINE);
                    reportAudioFailure({
                      source: 'take-playback',
                      reason: 'clip-load',
                      detail: usableDetail(message),
                    });
                  }}
                  onPlaybackStatusUpdate={onStatus}
                />
              ) : (
                <View style={styles.video} />
              )}
              {/* ── vc55, F2 ── THE WAIT, SAID OUT LOUD ────────────────────────
                  This is the black rectangle the owner sat in front of for 15–20 s.
                  While the player is coming up the window says it is preparing, so
                  the surface is never frozen-looking and never silent — and it
                  claims no duration, because the app cannot measure one. */}
              {fullScreenIsPreparing(prep) ? (
                <View style={styles.preparing} pointerEvents="none">
                  <ActivityIndicator size="large" color="#4ecdc4" />
                  <Text style={styles.preparingLine}>{FULL_SCREEN_PREPARING_LINE}</Text>
                  <Text style={styles.preparingHint}>{FULL_SCREEN_PREPARING_HINT}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.missing}>
              <Text style={styles.meta}>{FULL_SCREEN_VIDEO_FAILED_LINE}</Text>
            </View>
          )}

          <View style={styles.controls}>
            <Pressable
              style={({ pressed }) => [
                styles.playButton,
                pressed && styles.playButtonPressed,
                !fullScreenCanPlay(prep) && styles.playButtonOff,
              ]}
              onPress={() => void toggle()}
              disabled={!uri || busy || !fullScreenCanPlay(prep)}
              accessibilityRole="button"
              accessibilityLabel={
                fullScreenIsPreparing(prep)
                  ? FULL_SCREEN_PREPARING_LINE
                  : playing
                    ? 'Pause the video'
                    : 'Play the video'
              }
              accessibilityState={{ disabled: !uri || busy || !fullScreenCanPlay(prep) }}
            >
              <Text style={styles.playButtonText}>
                {fullScreenIsPreparing(prep) ? FULL_SCREEN_PREPARING_CTA : playing ? 'Pause' : 'Play'}
              </Text>
            </Pressable>
            <View style={styles.scrub}>
              <ScrubBar
                positionMs={positionMs}
                durationMs={durationMs}
                span={span}
                onSeekMs={onSeekMs}
                large
                showLabel={false}
              />
            </View>
          </View>

          <Text style={styles.meta}>
            {trimPlaybackWindowLine(span, durationMs / 1000)}
          </Text>
          {errorLine ? <Text style={styles.error}>{errorLine}</Text> : null}
          <Text style={styles.honest}>{FULL_SCREEN_VIDEO_HINT}</Text>
        </View>
      </View>
    </Modal>
  );
};

const baseStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#12122b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '800', flex: 1, paddingRight: 12 },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  closeButtonPressed: { backgroundColor: '#1b2a4a' },
  body: { flex: 1, paddingHorizontal: 12, paddingBottom: 12 },
  /** vc55 F2 — the player and its "preparing" overlay share this box. */
  videoWrap: { flex: 1, borderRadius: 10, overflow: 'hidden' },
  video: { flex: 1, backgroundColor: '#000000', borderRadius: 10 },
  preparing: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(18, 18, 43, 0.86)',
  },
  preparingLine: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 14,
    textAlign: 'center',
  },
  preparingHint: {
    color: '#9aa0b5',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  controls: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  playButton: {
    minWidth: 96,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#4ecdc4',
    paddingHorizontal: 16,
  },
  playButtonPressed: { opacity: 0.8 },
  /** vc55 F2 — a control that cannot be pressed looks like it, not like a bug. */
  playButtonOff: { opacity: 0.5 },
  playButtonText: { color: '#101024', fontSize: 16, fontWeight: '800' },
  scrub: { flex: 1, marginLeft: 12 },
  meta: { color: '#cfe4ff', fontSize: 13, lineHeight: 19, marginTop: 10 },
  honest: { color: '#9aa0b5', fontSize: 12, lineHeight: 18, marginTop: 6 },
  error: { color: '#ffb4b4', fontSize: 12, lineHeight: 18, marginTop: 10 },
});
