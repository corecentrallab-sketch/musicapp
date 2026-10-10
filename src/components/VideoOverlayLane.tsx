/**
 * VideoOverlayLane.tsx — THE MOVING OVERLAY'S RENDERER (owner GO 10-10, backlog
 * a49fbe2d; design brief §4.2).
 *
 * WHY A NATIVE DRAWING AND NOT THE ABC STAFF. The staff the editor draws is an
 * ABCjs WebView: right for a still staff, wrong for a moving overlay (a redraw per
 * frame is expensive, it would swallow the video's own touch surface, and a
 * WebView can never be composited into an exported video). So the overlay is a row
 * of plain Views positioned by `services/videoOverlayLayout.ts` — the SAME pure
 * function the tier1 suite asserts, so the pixels and the tests cannot drift.
 *
 * WHAT IT DRAWS (design brief §4.2/§2.4):
 *   • the NOTE LANE — a piano roll of the CORRECTED TAKE's notes (one cue = one
 *     bar, x from the video clock, y from the pitch);
 *   • the CHORD STRIP — the take's suggested / user-overridden chord row;
 *   • the PLAYHEAD — one marker from the video's own position.
 *
 * THE OVERLAY NEVER EDITS. It is handed cues (`noteCuesForVideo` output) and a
 * clock, and it returns pixels; it re-times nothing and reads no video frame.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  OVERLAY_AWAITING_LINE,
  OVERLAY_CHORD_LABEL,
  OVERLAY_EMPTY_LINE,
  OVERLAY_LANE_LABEL,
  OVERLAY_MAX_LANES,
  chordStripLayout,
  overlayLayout,
  visibleCues,
} from '../services/videoOverlayLayout';
import type { VideoCue } from '../services/videoTakeSync';

/** The lane's fixed height on the surface (the pitch rows divide it). */
export const OVERLAY_LANE_HEIGHT = 120;

export interface VideoOverlayLaneProps {
  /** The corrected take's cues on the video's timeline (never a raw trace). */
  cues: ReadonlyArray<VideoCue>;
  /** The video's own length, in seconds (the x-axis). */
  videoDurationSec: number;
  /** The video's position, in milliseconds. */
  clockMs: number;
  /** The take's chord row (suggested or user-overridden) — may be empty. */
  chordRow: ReadonlyArray<string>;
  /** The lane's honest caption (from the model). */
  laneLabel?: string;
  chordLabel?: string;
}

export const VideoOverlayLane: React.FC<VideoOverlayLaneProps> = ({
  cues,
  videoDurationSec,
  clockMs,
  chordRow,
  laneLabel = OVERLAY_LANE_LABEL,
  chordLabel = OVERLAY_CHORD_LABEL,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const [width, setWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - width) > 0.5) setWidth(next);
  };

  const drawList = overlayLayout({
    cues,
    videoDurationSec,
    clockMs,
    box: { width: Math.max(1, width), height: OVERLAY_LANE_HEIGHT, lanes: OVERLAY_MAX_LANES },
  });
  const playhead = drawList.find((item) => item.kind === 'playhead') ?? null;
  const lit = visibleCues(drawList, clockMs).map((item) => item.id);
  const chips = chordStripLayout(chordRow, { maxChips: 8 });

  return (
    <View style={styles.wrap}>
      <Text style={styles.laneLabel}>{laneLabel}</Text>
      <View style={styles.lane} onLayout={onLayout}>
        {cues.length === 0 ? (
          <Text style={styles.empty}>{OVERLAY_EMPTY_LINE}</Text>
        ) : (
          <>
            {drawList
              .filter((item) => item.kind === 'note')
              .map((item) => (
                <View
                  key={item.id}
                  testID={item.id}
                  style={[
                    styles.note,
                    lit.indexOf(item.id) >= 0 && styles.noteLit,
                    {
                      left: item.x,
                      top: item.y,
                      width: Math.max(2, item.w),
                      height: item.h,
                    },
                  ]}
                />
              ))}
            {playhead ? <View style={[styles.playhead, { left: playhead.x }]} /> : null}
          </>
        )}
      </View>
      <Text style={styles.awaiting}>{OVERLAY_AWAITING_LINE}</Text>
      {chips.length > 0 ? (
        <>
          <Text style={styles.laneLabel}>{chordLabel}</Text>
          <View style={styles.chordRow}>
            {chips.map((chip) => (
              <View key={`chord-${chip.index}`} style={styles.chordChip}>
                <Text style={styles.chordText}>{chip.label}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  wrap: { marginTop: 12 },
  laneLabel: { color: '#9aa0b5', fontSize: 12, marginBottom: 6 },
  lane: {
    height: OVERLAY_LANE_HEIGHT,
    backgroundColor: '#101024',
    borderColor: '#25324f',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  empty: { color: '#6f7590', fontSize: 12, paddingHorizontal: 12 },
  note: { position: 'absolute', backgroundColor: '#4ecdc4', borderRadius: 3, opacity: 0.65 },
  noteLit: { backgroundColor: '#ffd166', opacity: 1 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#e94560' },
  awaiting: { color: '#6f7590', fontSize: 11, marginTop: 6 },
  chordRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  chordChip: {
    backgroundColor: '#1b2a4a',
    borderColor: '#2f4370',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  chordText: { color: '#cfe4ff', fontSize: 12, fontWeight: '700' },
});
