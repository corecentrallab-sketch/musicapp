/**
 * ScrubBar — THE DRAGGABLE PROGRESS BAR (vc53, item 4).
 *
 * The owner asked for "a draggable progress bar at the bottom of the video that
 * seeks forward and backward". This is that control, and it draws the model in
 * `services/videoScrub.ts` and nothing else:
 *
 *   • the track spans the WHOLE recording (one timeline, one truth);
 *   • the trimmed-out ends are DIMMED, so the cut is visible instead of hidden;
 *   • a drag inside the window seeks there; a drag into a dimmed end snaps to the
 *     nearest window edge (the rule lives in `scrubSeekTargetMs`, where tier1 can
 *     assert it — this file only converts pixels to a fraction).
 *
 * NO NEW DEPENDENCY. `@react-native-community/slider` is not in this project, so
 * the drag is a `PanResponder` on a measured View. Every child is
 * `pointerEvents="none"` so a touch always lands on the track itself and
 * `locationX` is measured from the bar's own left edge.
 *
 * VERTICAL SCROLLING STILL WORKS. The bar sits inside a ScrollView; it claims the
 * responder on touch (so a tap seeks) but always allows termination, so a vertical
 * drag hands the gesture back to the scroll view.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useThemedStyles } from '../services/themeStore';
import type { TakeTrimSpan } from '../services/takeClipTag';
import {
  SCRUB_LABEL,
  SCRUB_SEEK_LABEL,
  scrubRatioForPosition,
  scrubSeekTargetMs,
  scrubTimeLine,
  scrubWindowFractions,
} from '../services/videoScrub';

export interface ScrubBarProps {
  /** The player's own position, in ms. */
  positionMs: number;
  /** The recording's own length, in ms. */
  durationMs: number;
  /** The row's clip window, or null when the whole take plays. */
  span: TakeTrimSpan | null;
  /** Where a drag lands — already snapped by `scrubSeekTargetMs`. */
  onSeekMs: (ms: number) => void;
  /** Taller track and thumb for the full-screen player. */
  large?: boolean;
  /** Draw the caption above the bar (the in-page player does; full screen does not). */
  showLabel?: boolean;
}

export const ScrubBar: React.FC<ScrubBarProps> = ({
  positionMs,
  durationMs,
  span,
  onSeekMs,
  large = false,
  showLabel = true,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  /**
   * The responder is created ONCE, so it reads the live values through refs —
   * a responder rebuilt every render loses the drag mid-gesture.
   */
  const live = useRef({ durationMs, span, onSeekMs, width: 0 });
  live.current.durationMs = durationMs;
  live.current.span = span;
  live.current.onSeekMs = onSeekMs;

  const seekFromX = (x: number): void => {
    const box = live.current.width;
    if (box <= 0) return;
    live.current.onSeekMs(scrubSeekTargetMs(x / box, live.current.durationMs, live.current.span));
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 2,
        // A vertical drag belongs to the ScrollView this bar lives in.
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (event) => {
          setDragging(true);
          seekFromX(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => seekFromX(event.nativeEvent.locationX),
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [],
  );

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    if (next <= 0) return;
    live.current.width = next;
    if (Math.abs(next - width) > 0.5) setWidth(next);
  };

  const window = scrubWindowFractions(span, durationMs);
  const ratio = scrubRatioForPosition(positionMs, durationMs);
  const thumbSize = large ? 26 : 18;
  const trackHeight = large ? 10 : 6;
  const filled = Math.round(ratio * width);

  return (
    <View style={styles.wrap}>
      {showLabel ? <Text style={styles.label}>{SCRUB_LABEL}</Text> : null}
      <View
        style={[styles.track, { height: trackHeight, borderRadius: trackHeight / 2 }]}
        onLayout={onLayout}
        hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={SCRUB_SEEK_LABEL}
        accessibilityValue={{ text: scrubTimeLine(positionMs, durationMs) }}
        {...responder.panHandlers}
      >
        {/* Everything inside is inert, so a touch always measures from the track. */}
        <View style={styles.inert} pointerEvents="none">
          {/* The dimmed ends: what the clip leaves out. */}
          <View
            style={[
              styles.dimmed,
              { left: 0, width: Math.round(window.startFraction * width) },
            ]}
          />
          <View
            style={[
              styles.dimmed,
              {
                left: Math.round(window.endFraction * width),
                width: Math.max(0, width - Math.round(window.endFraction * width)),
              },
            ]}
          />
          {/* The clip window itself, and how far through it the playhead is. */}
          <View style={[styles.windowBand, { left: 0, width: filled }]} />
          <View
            style={[
              styles.thumb,
              dragging && styles.thumbActive,
              {
                left: Math.max(0, Math.min(width - thumbSize, filled - thumbSize / 2)),
                width: thumbSize,
                height: thumbSize,
                borderRadius: thumbSize / 2,
              },
            ]}
          />
        </View>
      </View>
      <Text style={styles.readout}>{scrubTimeLine(positionMs, durationMs)}</Text>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  wrap: { marginTop: 8 },
  label: { color: '#9aa0b5', fontSize: 12, marginBottom: 6 },
  track: {
    backgroundColor: '#101024',
    borderColor: '#25324f',
    borderWidth: 1,
    justifyContent: 'center',
  },
  inert: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' },
  dimmed: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#0a0a18', opacity: 0.9 },
  windowBand: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#4ecdc4', opacity: 0.55 },
  thumb: { position: 'absolute', backgroundColor: '#ffffff', borderColor: '#4ecdc4', borderWidth: 2 },
  thumbActive: { backgroundColor: '#ffd166' },
  readout: { color: '#cfe4ff', fontSize: 12, marginTop: 6 },
});
