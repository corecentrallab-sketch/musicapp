import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Animated,
  Easing,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as WebBrowser from "expo-web-browser";
import { recognizeAudio } from "../services/api";
import type { RecognitionResponse, RecognitionMatch, RecognitionState } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RECORDING_DURATION_MS = 6000; // 6 seconds

const COLORS = {
  bg: "#1a1a2e",
  header: "#16213e",
  accent: "#e94560",
  muted: "#a0a0b8",
  card: "#0f3460",
  success: "#2ecc71",
  warning: "#f39c12",
  white: "#ffffff",
} as const;

// ---------------------------------------------------------------------------
// Sub-component: Pulsing Mic Button
// ---------------------------------------------------------------------------
const PulsingMic: React.FC<{ onPress: () => void; disabled?: boolean }> = ({
  onPress,
  disabled,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={styles.micOuter}
    >
      <Animated.View
        style={[
          styles.micInner,
          { transform: [{ scale: pulseAnim }] },
        ]}
      >
        <Ionicons name="mic" size={48} color={COLORS.white} />
      </Animated.View>
    </TouchableOpacity>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: Recording Indicator (animated waveform bars)
// ---------------------------------------------------------------------------
const RecordingWaveform: React.FC = () => {
  const bars = Array.from({ length: 5 }, (_, i) => {
    const anim = useRef(new Animated.Value(0.3)).current;
    useEffect(() => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 300 + i * 80,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: 300 + i * 80,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }, [anim]);

    return (
      <Animated.View
        key={i}
        style={[
          styles.waveBar,
          {
            transform: [{ scaleY: anim }],
            marginHorizontal: 3,
          },
        ]}
      />
    );
  });

  return <View style={styles.waveformContainer}>{bars}</View>;
};

// ---------------------------------------------------------------------------
// Sub-component: Match Result Card
// ---------------------------------------------------------------------------
const MatchCard: React.FC<{
  match: RecognitionMatch;
  onSaveToHistory: (match: RecognitionMatch) => void;
}> = ({ match, onSaveToHistory }) => {
  const isPublicDomain = !!match.sheet_music_url;
  const hasPurchaseUrl = !!match.purchase_url;

  const handlePurchase = useCallback(async () => {
    if (match.purchase_url?.musicnotes) {
      await WebBrowser.openBrowserAsync(match.purchase_url.musicnotes);
    }
  }, [match.purchase_url]);

  const handleOpenSheetMusic = useCallback(async () => {
    if (match.sheet_music_url) {
      // For public-domain: sheet_music_url points to our hosted score
      await WebBrowser.openBrowserAsync(match.sheet_music_url);
    }
  }, [match.sheet_music_url]);

  return (
    <View style={styles.matchCard}>
      {/* Album art placeholder */}
      <View style={styles.albumArtPlaceholder}>
        {match.album_art_url ? (
          <Image
            source={{ uri: match.album_art_url }}
            style={styles.albumArt}
            resizeMode="cover"
          />
        ) : (
          <Ionicons name="musical-notes" size={40} color={COLORS.muted} />
        )}
      </View>

      {/* Info */}
      <Text style={styles.matchTitle}>{match.title}</Text>
      <Text style={styles.matchComposer}>{match.composer}</Text>
      {match.catalog ? (
        <Text style={styles.matchCatalog}>{match.catalog}</Text>
      ) : null}
      <Text style={styles.matchConfidence}>
        Match confidence: {Math.round(match.confidence * 100)}%
      </Text>

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {isPublicDomain ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleOpenSheetMusic}
          >
            <Ionicons name="document-text" size={18} color={COLORS.white} />
            <Text style={styles.buttonText}>Open sheet music</Text>
          </TouchableOpacity>
        ) : hasPurchaseUrl ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handlePurchase}
          >
            <Ionicons name="cart" size={18} color={COLORS.white} />
            <Text style={styles.buttonText}>Get official sheet music</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => onSaveToHistory(match)}
        >
          <Ionicons name="bookmark" size={18} color={COLORS.accent} />
          <Text style={styles.secondaryButtonText}>Save to History</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Main Component: HomeScreen
// ---------------------------------------------------------------------------
export const HomeScreen: React.FC = () => {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [state, setState] = useState<RecognitionState>("idle");
  const [results, setResults] = useState<RecognitionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Handle "Listen" tap ──────────────────────────────────────────────
  const handleListen = useCallback(async () => {
    try {
      setState("recording");
      setResults(null);
      setErrorMessage(null);
      setElapsedMs(0);

      // Start elapsed timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTime);
      }, 100);

      // Request permission and start recording
      await recorder.record({
        sampleRate: 44100,
        encoding: "opus",
        channelCount: 1,
      });

      // Record for fixed duration
      await new Promise((resolve) => setTimeout(resolve, RECORDING_DURATION_MS));

      // Stop recording
      const recording = await recorder.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (!recording?.uri) {
        setState("error");
        setErrorMessage("Recording failed — no audio captured.");
        return;
      }

      // Upload & recognize
      setState("uploading");
      const response = await recognizeAudio(recording.uri);

      setState("processing");
      // Brief visual pause so the user sees "processing"
      await new Promise((resolve) => setTimeout(resolve, 600));

      if (response.matches.length === 0) {
        setState("no_match");
        setResults(response);
      } else {
        setState("success");
        setResults(response);
      }
    } catch (err: unknown) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong.",
      );
    }
  }, [recorder]);

  // ── Handle "Save to History" ─────────────────────────────────────────
  const handleSaveToHistory = useCallback((match: RecognitionMatch) => {
    // TODO: persist to AsyncStorage or the site DB in a future iteration
    // For now we show feedback inline.
    alert(`Saved "${match.title}" to History!`);
  }, []);

  // ── Handle "Try Again" ───────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setState("idle");
    setResults(null);
    setErrorMessage(null);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Header */}
      <Text style={styles.title}>Discover</Text>
      <Text style={styles.subtitle}>
        Tap the mic to identify music around you.
      </Text>

      {/* ── IDLE STATE ── */}
      {state === "idle" && (
        <View style={styles.centerSection}>
          <PulsingMic onPress={handleListen} />
          <Text style={styles.hint}>Record 6 seconds of audio</Text>
        </View>
      )}

      {/* ── RECORDING STATE ── */}
      {state === "recording" && (
        <View style={styles.centerSection}>
          <View style={styles.recordingIndicator}>
            <Ionicons name="radio" size={24} color={COLORS.accent} />
            <Text style={styles.recordingText}>Listening...</Text>
          </View>
          <RecordingWaveform />
          <Text style={styles.timerText}>
            {(elapsedMs / 1000).toFixed(1)}s / {(RECORDING_DURATION_MS / 1000).toFixed(0)}s
          </Text>
        </View>
      )}

      {/* ── UPLOADING / PROCESSING STATES ── */}
      {(state === "uploading" || state === "processing") && (
        <View style={styles.centerSection}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.statusText}>
            {state === "uploading" ? "Uploading audio..." : "Matching against database..."}
          </Text>
        </View>
      )}

      {/* ── SUCCESS STATE ── */}
      {state === "success" && results && (
        <View style={styles.resultsSection}>
          <Text style={styles.resultsHeader}>
            {results.matches.length} match{results.matches.length !== 1 ? "es" : ""} found
          </Text>
          {results.matches.map((match) => (
            <MatchCard
              key={match.piece_id}
              match={match}
              onSaveToHistory={handleSaveToHistory}
            />
          ))}
          <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
            <Text style={styles.resetButtonText}>Try another</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── NO MATCH STATE ── */}
      {state === "no_match" && (
        <View style={styles.centerSection}>
          <Ionicons name="search" size={64} color={COLORS.muted} />
          <Text style={styles.statusTitle}>No match found</Text>
          <Text style={styles.statusSubtitle}>
            We couldn't identify this piece. Try recording closer to the source.
          </Text>
          {results?.purchase_url && (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={async () => {
                await WebBrowser.openBrowserAsync(
                  results.purchase_url!.musicnotes,
                );
              }}
            >
              <Ionicons name="search" size={18} color={COLORS.white} />
              <Text style={styles.buttonText}>Search on Musicnotes</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
            <Text style={styles.resetButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── ERROR STATE ── */}
      {state === "error" && (
        <View style={styles.centerSection}>
          <Ionicons name="alert-circle" size={64} color={COLORS.warning} />
          <Text style={styles.statusTitle}>Something went wrong</Text>
          <Text style={styles.statusSubtitle}>
            {errorMessage || "An unexpected error occurred."}
          </Text>
          <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
            <Text style={styles.resetButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  contentContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.accent,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },

  // ── Mic button ──
  micOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    elevation: 8,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  micInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 8,
  },

  // ── Center section ──
  centerSection: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    width: "100%",
  },

  // ── Recording ──
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  recordingText: {
    color: COLORS.accent,
    fontSize: 18,
    fontWeight: "600",
  },
  timerText: {
    color: COLORS.muted,
    fontSize: 14,
    marginTop: 12,
    fontVariant: ["tabular-nums"],
  },
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 60,
  },
  waveBar: {
    width: 6,
    height: 40,
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },

  // ── Status (uploading, processing, no_match, error) ──
  statusText: {
    color: COLORS.muted,
    fontSize: 16,
    marginTop: 16,
  },
  statusTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 8,
  },
  statusSubtitle: {
    color: COLORS.muted,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 16,
  },

  // ── Results ──
  resultsSection: {
    width: "100%",
    alignItems: "center",
  },
  resultsHeader: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
  },

  // ── Match card ──
  matchCard: {
    width: "100%",
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: "center",
  },
  albumArtPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: COLORS.header,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  albumArt: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  matchTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  matchComposer: {
    color: COLORS.accent,
    fontSize: 15,
    fontWeight: "500",
    marginTop: 4,
  },
  matchCatalog: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 2,
  },
  matchConfidence: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 6,
    marginBottom: 16,
  },

  // ── Action buttons ──
  actionRow: {
    width: "100%",
    gap: 10,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.accent,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.accent,
    gap: 8,
  },
  secondaryButtonText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: "600",
  },

  // ── Reset button ──
  resetButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  resetButtonText: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
