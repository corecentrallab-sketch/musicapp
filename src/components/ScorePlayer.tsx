/**
 * ScorePlayer — compact practice control bar for the score viewer.
 *
 * Sits as a thin strip between the sheet-music canvas and the page-turn bar.
 * Provides, with no pop-ups or ads:
 *   ▶ / ⏸ play-pause, a scrubber with time readout,
 *   A/B section looping (set A, set B, loop toggle, clear),
 *   and playback-speed presets (0.5x / 0.75x / 1.0x / 1.25x).
 *
 * Designed to be visually calm so it never distracts from reading the score.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Slider from "@react-native-community/slider";
import {
  PLAYBACK_SPEEDS,
  useScoreAudio,
  type ScoreAudioSource,
} from "../hooks/useScoreAudio";
import { formatMillis, isLoopReady } from "../utils/playerLoop";

interface ScorePlayerProps {
  /** Score audio (PD) — remote/local uri or bundled asset id. */
  source: ScoreAudioSource;
  /** Short descriptor shown for honesty (e.g. "Score audio" / "Preview"). */
  label?: string;
}

export const ScorePlayer: React.FC<ScorePlayerProps> = ({
  source,
  label = "Score audio",
}) => {
  const {
    state,
    togglePlay,
    seekTo,
    setRate,
    setLoopPoint,
    toggleLoop,
    clearLoop,
  } = useScoreAudio(source);

  const { isLoaded, isPlaying, positionMillis, durationMillis, rate } = state;

  const loopReady = isLoopReady(state.loopStart, state.loopEnd);
  const loopActive = state.loopActive && loopReady;

  // Cycle to the next speed preset.
  const cycleSpeed = () => {
    const idx = PLAYBACK_SPEEDS.indexOf(rate);
    const next = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    void setRate(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>

        <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
          <Text style={styles.playBtnText}>{isPlaying ? "⏸" : "▶"}</Text>
        </TouchableOpacity>

        <View style={styles.sliderWrap}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={Math.max(durationMillis, 1)}
            value={Math.min(positionMillis, Math.max(durationMillis, 1))}
            onSlidingComplete={(v) => void seekTo(v)}
            minimumTrackTintColor="#e94560"
            maximumTrackTintColor="#3a3a55"
            thumbTintColor="#e94560"
            disabled={!isLoaded}
          />
        </View>

        <Text style={styles.time}>
          {formatMillis(positionMillis)} / {formatMillis(durationMillis)}
        </Text>

        <TouchableOpacity onPress={cycleSpeed} style={styles.speedChip}>
          <Text style={styles.speedChipText}>{rate.toFixed(2).replace(/0$/, "")}x</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.loopRow}>
        <TouchableOpacity
          style={[
            styles.loopBtn,
            state.loopStart !== null && styles.loopBtnOn,
          ]}
          onPress={() => setLoopPoint("start")}
        >
          <Text style={styles.loopBtnText}>
            {state.loopStart !== null ? `A ${formatMillis(state.loopStart)}` : "Set A"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.loopBtn, state.loopEnd !== null && styles.loopBtnOn]}
          onPress={() => setLoopPoint("end")}
        >
          <Text style={styles.loopBtnText}>
            {state.loopEnd !== null ? `B ${formatMillis(state.loopEnd)}` : "Set B"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.loopBtn, loopActive && styles.loopBtnActive]}
          onPress={toggleLoop}
          disabled={!loopReady}
        >
          <Text style={[styles.loopBtnText, loopActive && styles.loopBtnTextActive]}>
            {loopActive ? "⏱ Looping A–B" : "Loop"}
          </Text>
        </TouchableOpacity>

        {(state.loopStart !== null || state.loopEnd !== null) && (
          <TouchableOpacity style={styles.clearBtn} onPress={clearLoop}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#16213e",
    borderTopWidth: 1,
    borderTopColor: "#0f3460",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  label: {
    color: "#c0c0d0",
    fontSize: 12,
    fontWeight: "700",
    maxWidth: 90,
  },
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#e94560",
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  sliderWrap: {
    flex: 1,
  },
  slider: {
    width: "100%",
    height: 36,
  },
  time: {
    color: "#a0a0b8",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 78,
    textAlign: "right",
  },
  speedChip: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#0f3460",
  },
  speedChipText: {
    color: "#4ecdc4",
    fontSize: 13,
    fontWeight: "700",
  },
  loopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  loopBtn: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#0f3460",
  },
  loopBtnOn: {
    borderColor: "#4ecdc4",
  },
  loopBtnActive: {
    backgroundColor: "#4ecdc4",
    borderColor: "#4ecdc4",
  },
  loopBtnText: {
    color: "#c0c0d0",
    fontSize: 13,
    fontWeight: "600",
  },
  loopBtnTextActive: {
    color: "#0f3460",
  },
  clearBtn: {
    marginLeft: "auto",
  },
  clearBtnText: {
    color: "#a0a0b8",
    fontSize: 13,
    fontWeight: "600",
  },
});
