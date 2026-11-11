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
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

export const FULL_SCREEN_VIDEO_CLOSE_LABEL = 'Close the full-screen video';
export const FULL_SCREEN_VIDEO_CTA = 'Full screen';
export const FULL_SCREEN_VIDEO_TITLE = 'Your practice video';
export const FULL_SCREEN_VIDEO_HINT =
  'Drag the bar to move through the take. Android BACK closes this window and leaves the page as it was.';
export const FULL_SCREEN_VIDEO_FAILED_LINE =
  'This video could not be played on this device. The take itself is still saved in your History.';

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
  // position the trim excludes.
  useEffect(() => {
    if (!visible) return;
    setErrorLine(null);
    setPlaying(false);
    const target = clampedSeek(Number(startMs) || 0);
    setPositionMs(target);
    void restorePlaybackAudioMode();
  }, [clampedSeek, startMs, visible]);

  const handleClose = useCallback(() => {
    void player.current?.pauseAsync().catch(() => undefined);
    setPlaying(false);
    onClose();
  }, [onClose]);

  const handleLoad = useCallback(() => {
    const target = clampedSeek(Number(startMs) || 0);
    void player.current?.setPositionAsync(target).catch(() => undefined);
  }, [clampedSeek, startMs]);

  const toggle = useCallback(async () => {
    const video = player.current;
    if (!video || busy) return;
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
  }, [busy, playing, positionMs, span]);

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
              onError={(message) => {
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
            <View style={styles.missing}>
              <Text style={styles.meta}>{FULL_SCREEN_VIDEO_FAILED_LINE}</Text>
            </View>
          )}

          <View style={styles.controls}>
            <Pressable
              style={({ pressed }) => [styles.playButton, pressed && styles.playButtonPressed]}
              onPress={() => void toggle()}
              disabled={!uri || busy}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause the video' : 'Play the video'}
            >
              <Text style={styles.playButtonText}>{playing ? 'Pause' : 'Play'}</Text>
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
  video: { flex: 1, backgroundColor: '#000000', borderRadius: 10 },
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
  playButtonText: { color: '#101024', fontSize: 16, fontWeight: '800' },
  scrub: { flex: 1, marginLeft: 12 },
  meta: { color: '#cfe4ff', fontSize: 13, lineHeight: 19, marginTop: 10 },
  honest: { color: '#9aa0b5', fontSize: 12, lineHeight: 18, marginTop: 6 },
  error: { color: '#ffb4b4', fontSize: 12, lineHeight: 18, marginTop: 10 },
});
