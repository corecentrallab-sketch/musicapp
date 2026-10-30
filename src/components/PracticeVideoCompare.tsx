/**
 * PracticeVideoCompare.tsx — THE SIDE-BY-SIDE COMPARISON SURFACE (v47 part B, item
 * 1; owner GO 10-28).
 *
 * WHAT IT IS. Two of the user's OWN filmed takes, one beside the other, on one
 * clock. It is mounted by `screens/PracticeVideoScreen.tsx` from its PLAYBACK phase
 * (the screen owns the row and loads the second take from History), so the surface
 * is always handed real local take data — never a placeholder.
 *
 * THE FOUR THINGS IT MUST NOT DO, AND DOES NOT:
 *   • it never opens a socket — both sides are `file://` videos in the app's own
 *     documents folder, and the copy says the comparison works in airplane mode;
 *   • it never judges — the surface describes what is on the screen (each take's
 *     length, how many of its notes fall inside its own video) and adds nothing;
 *     a tier1 source-scan guard fails the build if a verdict word appears here;
 *   • it never mixes the two sounds — one clock, one playing take at a time;
 *   • it never invents notes — each lane is `compareSide()`'s cues, i.e. the same
 *     `noteCuesForVideo` mapping the playback overlay already draws.
 *
 * THE EDGE CASES ARE ON THE SURFACE (owner brief): one take only (an honest line
 * plus "Record a second take" — no dead end), a take whose file is gone (that
 * column says so while the other still plays), and takes of different lengths
 * (both play their own full length, and the surface says they differ).
 *
 * GUARDED BY src/services/v47PartBContract.ts (hosting + offline + honest copy),
 * asserted on this real file by scripts/v47TakeCompare.test.ts.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { ensurePlaybackAudioMode, playWithAudioFocus, restorePlaybackAudioMode } from '../services/audioSession';
import { reportAudioFailure, usableDetail } from '../services/audioDiagnostics';
import { suggestedChords } from '../services/melodyCapture';
import { VideoOverlayLane } from './VideoOverlayLane';
import type { SavedCaptureTake } from '../services/midiExport';
import type { PracticeVideoRef } from '../services/practiceVideoRef';
import {
  COMPARE_BACK_CTA,
  COMPARE_CLOCK_LABEL,
  COMPARE_CLOCK_LINE,
  COMPARE_EARLIER_CTA,
  COMPARE_LATER_CTA,
  COMPARE_MISSING_LINE,
  COMPARE_ONE_TAKE_LINE,
  COMPARE_PADDING_DP,
  COMPARE_PAUSE_CTA,
  COMPARE_PLAY_CTA,
  COMPARE_RECORD_SECOND_CTA,
  COMPARE_TITLE,
  COMPARE_SUBTITLE,
  COMPARE_NO_NOTES_LINE,
  comparePair,
  compareSeekTarget,
  type CompareSide,
} from '../services/videoCompare';

/** One take as the screen hands it in — the row's own data, nothing derived. */
export interface CompareTakeSide {
  label: string;
  ref: PracticeVideoRef | null;
  take: SavedCaptureTake | null;
  note?: string | null;
}

export interface PracticeVideoCompareProps {
  visible: boolean;
  /** This take (the row the playback surface is showing). */
  left: CompareTakeSide;
  /** The other take, or null when the user has filmed only one. */
  right: CompareTakeSide | null;
  /** Take the user to the record flow for a second take (the one-take path out). */
  onRecordSecond: () => void;
  onClose: () => void;
}

export const PracticeVideoCompare: React.FC<PracticeVideoCompareProps> = ({
  visible,
  left,
  right,
  onRecordSecond,
  onClose,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.round(windowWidth) - COMPARE_PADDING_DP * 2);

  const pair = useMemo(
    () => comparePair({ left, right, widthDp: contentWidth }),
    [contentWidth, left, right],
  );
  const layout = pair.columns;

  const players = useRef<Array<Video | null>>([]);
  const playingIndexRef = useRef<number | null>(null);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [videoLine, setVideoLine] = useState<string | null>(null);

  /** Leaving the surface must never leave a take playing behind the user. */
  const pauseAll = useCallback(async () => {
    for (const player of players.current) {
      try {
        await player?.pauseAsync();
      } catch {
        // A player that is not loaded has nothing to pause.
      }
    }
    playingIndexRef.current = null;
    setPlayingIndex(null);
  }, []);

  useEffect(() => {
    if (!visible) {
      void pauseAll();
      return;
    }
    // The app may still be in its recording session; a player under a recording
    // session can play at volume 0 (the v40 fix J lesson).
    void restorePlaybackAudioMode();
  }, [pauseAll, visible]);

  const handleClose = useCallback(() => {
    void pauseAll();
    onClose();
  }, [onClose, pauseAll]);

  /** Move the one clock: every registered player follows it. */
  const seekAll = useCallback(
    async (targetMs: number) => {
      const clamped = compareSeekTarget(targetMs, 0, pair.longestSec);
      setClockMs(clamped);
      for (let index = 0; index < players.current.length; index += 1) {
        const side = pair.sides[index];
        const player = players.current[index];
        if (!player || !side || side.state !== 'ready') continue;
        try {
          await player.setPositionAsync(Math.min(clamped, Math.max(0, side.durationSec * 1000)));
        } catch {
          // A player that cannot seek simply keeps its own position.
        }
      }
    },
    [pair.longestSec, pair.sides],
  );

  const toggleSide = useCallback(
    async (index: number) => {
      const side = pair.sides[index];
      const player = players.current[index];
      if (!side || side.state !== 'ready' || !player || busy) return;
      setBusy(true);
      setVideoLine(null);
      try {
        await ensurePlaybackAudioMode();
        if (playingIndexRef.current === index) {
          await player.pauseAsync();
          playingIndexRef.current = null;
          setPlayingIndex(null);
          return;
        }
        // ONE SOUND AT A TIME: the other take stops before this one starts.
        await pauseAll();
        await seekAll(clockMs);
        await player.setPositionAsync(Math.min(clockMs, Math.max(0, side.durationSec * 1000)));
        await playWithAudioFocus(() => player.playAsync(), {
          source: 'take-playback',
          reason: 'clip-load',
        });
        playingIndexRef.current = index;
        setPlayingIndex(index);
      } catch (err) {
        setVideoLine(COMPARE_MISSING_LINE);
        reportAudioFailure({
          source: 'take-playback',
          reason: 'clip-load',
          detail: usableDetail(err),
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, clockMs, pair.sides, pauseAll, seekAll],
  );

  const onStatus = useCallback((index: number, status: unknown) => {
    const position = (status as { positionMillis?: number }).positionMillis;
    const isPlaying = (status as { isPlaying?: boolean }).isPlaying === true;
    if (playingIndexRef.current === index) {
      if (typeof position === 'number' && Number.isFinite(position)) setClockMs(position);
      if (!isPlaying) {
        playingIndexRef.current = null;
        setPlayingIndex(null);
      }
    }
  }, []);

  /**
   * THE CHORDS COME FROM THE TAKE THE SIDE WAS BUILT FROM — the same corrected
   * notes the overlay lane draws, mapped by the app's existing chord suggester. No
   * new analysis: if the take has no notes, no chords are shown.
   */
  const chordRowFor = useCallback(
    (side: CompareSide): string[] => {
      const take = side.label === left.label ? left.take : (right?.take ?? null);
      if (!take) return [];
      return suggestedChords(take.notes, take.key).chords.map((chord) => chord.name);
    },
    [left, right],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={COMPARE_BACK_CTA}
          >
            <Text style={styles.backText}>{COMPARE_BACK_CTA}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{COMPARE_TITLE}</Text>
        </View>

        <ScrollView style={styles.page} contentContainerStyle={styles.body}>
          <Text style={styles.subtitle}>{COMPARE_SUBTITLE}</Text>
          <Text style={styles.honest}>{pair.honesty}</Text>
          <Text style={styles.honest}>{pair.offlineLine}</Text>

          {pair.oneTake ? (
            <View style={styles.oneTakeCard}>
              <Text style={styles.oneTakeText}>{COMPARE_ONE_TAKE_LINE}</Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={onRecordSecond}
                accessibilityRole="button"
                accessibilityLabel={COMPARE_RECORD_SECOND_CTA}
              >
                <Text style={styles.primaryBtnText}>{COMPARE_RECORD_SECOND_CTA}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* THE ONE CLOCK: both videos follow it, one take plays at a time. */}
          <View style={styles.clockRow}>
            <Text style={styles.clockLabel}>{COMPARE_CLOCK_LABEL}</Text>
            <TouchableOpacity
              style={styles.clockBtn}
              onPress={() => void seekAll(compareSeekTarget(clockMs, -1000, pair.longestSec))}
              accessibilityRole="button"
              accessibilityLabel="Move both videos one second earlier"
            >
              <Text style={styles.clockBtnText}>{COMPARE_EARLIER_CTA}</Text>
            </TouchableOpacity>
            <Text style={styles.clockValue}>{formatClock(clockMs)}</Text>
            <TouchableOpacity
              style={styles.clockBtn}
              onPress={() => void seekAll(compareSeekTarget(clockMs, 1000, pair.longestSec))}
              accessibilityRole="button"
              accessibilityLabel="Move both videos one second later"
            >
              <Text style={styles.clockBtnText}>{COMPARE_LATER_CTA}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.honest}>{pair.clockLine}</Text>
          {pair.lengthLine ? <Text style={styles.meta}>{pair.lengthLine}</Text> : null}

          <View style={layout.columns === 2 ? styles.columnsRow : undefined}>
            {pair.sides.map((side, index) => (
              <View
                key={`compare-side-${index}`}
                style={[
                  styles.column,
                  { width: layout.columnWidth },
                  layout.columns === 2 && index === 0 ? { marginRight: layout.gap } : null,
                ]}
              >
                <Text style={styles.columnTitle}>{side.label}</Text>
                <Text style={styles.columnMeta}>{side.lengthLine}</Text>

                {side.state === 'ready' && side.uri ? (
                  <>
                    <Video
                      ref={(player) => {
                        players.current[index] = player;
                      }}
                      style={[
                        styles.video,
                        { width: layout.columnWidth, height: Math.round(layout.columnWidth * 0.75) },
                      ]}
                      source={{ uri: side.uri }}
                      useNativeControls={false}
                      volume={1}
                      isMuted={false}
                      resizeMode={ResizeMode.CONTAIN}
                      progressUpdateIntervalMillis={200}
                      onError={() => setVideoLine(COMPARE_MISSING_LINE)}
                      onPlaybackStatusUpdate={(status) => onStatus(index, status)}
                    />
                    <TouchableOpacity
                      style={styles.playBtn}
                      onPress={() => void toggleSide(index)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={playingIndex === index ? COMPARE_PAUSE_CTA : COMPARE_PLAY_CTA}
                    >
                      <Text style={styles.playBtnText}>
                        {playingIndex === index ? COMPARE_PAUSE_CTA : COMPARE_PLAY_CTA}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.missingCard}>
                    <Text style={styles.missingText}>{COMPARE_MISSING_LINE}</Text>
                  </View>
                )}

                {/* THE TAKE'S OWN NOTES AND CHORDS, on this video's clock. */}
                <VideoOverlayLane
                  cues={side.cues}
                  videoDurationSec={side.durationSec}
                  clockMs={clockMs}
                  chordRow={chordRowFor(side)}
                />
                {side.noteCount === 0 ? (
                  <Text style={styles.honest}>{COMPARE_NO_NOTES_LINE}</Text>
                ) : null}
                {side.cuesLine ? <Text style={styles.meta}>{side.cuesLine}</Text> : null}
                {side.noteLine ? <Text style={styles.meta}>{side.noteLine}</Text> : null}
              </View>
            ))}
          </View>

          {videoLine ? <Text style={styles.error}>{videoLine}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
};

/** `0:12` — the shared clock's own readout (ms in, clock out). */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12122b' },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  backBtn: { minHeight: 44, justifyContent: 'center' },
  backText: { color: '#e94560', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginTop: 2 },
  page: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 40 },
  subtitle: { color: '#ffffff', fontSize: 15, fontWeight: '700', marginTop: 6 },
  honest: { color: '#9aa0b5', fontSize: 12, lineHeight: 18, marginTop: 8 },
  meta: { color: '#cfe4ff', fontSize: 12, lineHeight: 18, marginTop: 6 },
  error: { color: '#ffb4b4', fontSize: 12, lineHeight: 18, marginTop: 12 },
  oneTakeCard: { backgroundColor: '#1b2a4a', borderRadius: 12, padding: 14, marginTop: 14 },
  oneTakeText: { color: '#cfe4ff', fontSize: 13, lineHeight: 19 },
  clockRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  clockLabel: { color: '#9aa0b5', fontSize: 12, marginRight: 10 },
  clockBtn: {
    minWidth: 56,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f4370',
    backgroundColor: '#1b2a4a',
  },
  clockBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  clockValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginHorizontal: 12,
    minWidth: 52,
    textAlign: 'center',
  },
  columnsRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 16 },
  column: { marginTop: 12 },
  columnTitle: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  columnMeta: { color: '#9aa0b5', fontSize: 12, marginTop: 2 },
  video: { backgroundColor: '#000000', borderRadius: 10, marginTop: 8 },
  playBtn: {
    backgroundColor: '#1b2a4a',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  playBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  missingCard: { backgroundColor: '#1b2a4a', borderRadius: 10, padding: 12, marginTop: 8 },
  missingText: { color: '#cfe4ff', fontSize: 12, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});
