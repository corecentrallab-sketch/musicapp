import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { recognizeAudio } from "../services/api";
import type { RecognitionMatch, RecognitionState } from "../types";

// ── Theme ────────────────────────────────────────────────────────────────────
const COLORS = {
  bg: "#1a1a2e",
  accent: "#e94560",
  card: "#16213e",
  border: "#0f3460",
  text: "#eaeaea",
  muted: "#888",
  success: "#2ecc71",
};

const RECORDING_DURATION_S = 6;

// ── Demo mock data ──────────────────────────────────────────────────────────
const DEMO_MATCHES: RecognitionMatch[] = [
  {
    piece_id: "demo-clair-de-lune",
    title: "Clair de Lune",
    composer: "Claude Debussy",
    catalog: "Suite bergamasque, L. 75, III",
    confidence: 0.94,
    album_art_url: null,
    sheet_music_url: null,
    tab_url: null,
    matched_at_s: 2.3,
    purchase_url: {
      musicnotes:
        "https://www.musicnotes.com/sheetmusic/mtd.asp?ppn=MN0065432",
      sheetmusicplus:
        "https://www.sheetmusicplus.com/title/clair-de-lune-digital-sheet-music/123456",
    },
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export const HomeScreen: React.FC = () => {
  // ── State ──
  const [recState, setRecState] = useState<RecognitionState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [matches, setMatches] = useState<RecognitionMatch[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // ── Refs ──
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) {
        recordingRef.current
          .stopAndUnloadAsync()
          .catch(() => {});
      }
    };
  }, []);

  // ── Helpers ──
  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetState = () => {
    clearTimer();
    setElapsed(0);
    setMatches([]);
    setErrorMsg("");
  };

  // ── Recording ──
  const startRecording = useCallback(async () => {
    resetState();
    setRecState("idle");

    try {
      // 1. Request microphone permission
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setErrorMsg("Microphone permission is required to recognize music.");
        setRecState("error");
        return;
      }

      // 2. Prepare recording
      const recording = new Audio.Recording();
      recordingRef.current = recording;

      // Configure for 16000Hz mono — use custom options instead of preset
      // so we get the right sample rate for the audio fingerprinting API.
      await recording.prepareToRecordAsync({
        android: {
          extension: ".m4a",
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: ".m4a",
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        web: {
          mimeType: "audio/webm",
          bitsPerSecond: 64000,
        },
      });

      // 3. Start recording
      setRecState("recording");
      await recording.startAsync();

      // 4. Start timer
      let seconds = 0;
      timerRef.current = setInterval(() => {
        seconds++;
        setElapsed(seconds);
        if (seconds >= RECORDING_DURATION_S) {
          clearTimer();
          stopAndUpload(recording);
        }
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to start recording.");
      setRecState("error");
    }
  }, []);

  // ── Stop + Upload ──
  const stopAndUpload = useCallback(
    async (recording: Audio.Recording) => {
      try {
        clearTimer();
        setRecState("uploading");

        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        recordingRef.current = null;

        if (!uri) {
          throw new Error("No recording URI after stop.");
        }

        const response = await recognizeAudio(uri);

        if (!mountedRef.current) return;

        if (response.matches && response.matches.length > 0) {
          setMatches(response.matches);
          setRecState("success");
        } else {
          setRecState("no_match");
        }
      } catch (err: any) {
        if (!mountedRef.current) return;
        setErrorMsg(err?.message || "Recognition failed. Try again.");
        setRecState("error");
      }
    },
    [],
  );

  // ── Mic button press ──
  const handleMicPress = () => {
    if (recState === "recording") {
      // Manual stop before 6s
      if (recordingRef.current) {
        clearTimer();
        stopAndUpload(recordingRef.current);
      }
    } else if (recState === "idle" || recState === "error" || recState === "no_match" || recState === "success") {
      startRecording();
    }
  };

  // ── Demo mode ──
  const handleDemo = () => {
    resetState();
    setMatches(DEMO_MATCHES);
    setRecState("success");
  };

  // ── Dismiss results ──
  const handleDismiss = () => {
    resetState();
    setRecState("idle");
  };

  // ── Open purchase link ──
  const openPurchaseLink = (match: RecognitionMatch) => {
    if (match.sheet_music_url) {
      Linking.openURL(match.sheet_music_url).catch(() => {});
    } else if (match.purchase_url?.musicnotes) {
      Linking.openURL(match.purchase_url.musicnotes).catch(() => {});
    }
  };

  // ── Render helpers ──

  const renderMicButton = () => {
    const isActive =
      recState === "recording" || recState === "uploading";

    return (
      <TouchableOpacity
        style={[styles.listenButton, isActive && styles.listenButtonActive]}
        onPress={handleMicPress}
        activeOpacity={0.8}
        disabled={recState === "uploading"}
      >
        {recState === "uploading" ? (
          <ActivityIndicator size="large" color="#fff" />
        ) : recState === "recording" ? (
          <Ionicons name="stop" size={48} color="#fff" />
        ) : (
          <Ionicons name="mic" size={48} color="#fff" />
        )}
      </TouchableOpacity>
    );
  };

  const renderStatusLabel = () => {
    switch (recState) {
      case "idle":
        return "Tap to recognize music";
      case "recording":
        return `Recording... ${elapsed}s / ${RECORDING_DURATION_S}s`;
      case "uploading":
        return "Uploading & analyzing...";
      case "success":
        return matches.length === 1
          ? "1 match found"
          : `${matches.length} matches found`;
      case "no_match":
        return "No match found — try again";
      case "error":
        return errorMsg || "Something went wrong";
      default:
        return "";
    }
  };

  const renderProgressBar = () => {
    if (recState !== "recording") return null;
    const pct = (elapsed / RECORDING_DURATION_S) * 100;
    return (
      <View style={styles.progressBarTrack}>
        <View style={[styles.progressBarFill, { width: `${pct}%` }]} />
      </View>
    );
  };

  const renderMatchCard = (match: RecognitionMatch, idx: number) => {
    const confidencePct = Math.round(match.confidence * 100);
    const isPublicDomain = match.sheet_music_url != null;
    const isCopyrighted = match.purchase_url != null;

    return (
      <View key={match.piece_id || idx} style={styles.matchCard}>
        {/* Header row */}
        <View style={styles.matchHeader}>
          <Ionicons name="musical-notes" size={24} color={COLORS.accent} />
          <View style={styles.matchTitleGroup}>
            <Text style={styles.matchTitle}>{match.title}</Text>
            <Text style={styles.matchComposer}>{match.composer}</Text>
          </View>
          <View style={styles.confidenceBadge}>
            <Text style={styles.confidenceText}>{confidencePct}%</Text>
          </View>
        </View>

        {/* Catalog info */}
        {match.catalog ? (
          <Text style={styles.catalogText}>{match.catalog}</Text>
        ) : null}

        {/* Action buttons */}
        <View style={styles.matchActions}>
          {isPublicDomain && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => openPurchaseLink(match)}
            >
              <Ionicons name="document-text" size={18} color="#fff" />
              <Text style={styles.actionBtnText}>Open sheet music</Text>
            </TouchableOpacity>
          )}

          {isCopyrighted && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.purchaseBtn]}
              onPress={() => openPurchaseLink(match)}
            >
              <Ionicons name="cart" size={18} color="#fff" />
              <Text style={styles.actionBtnText}>
                Get official sheet music
              </Text>
            </TouchableOpacity>
          )}

          {!isPublicDomain && !isCopyrighted && (
            <Text style={styles.noLinkText}>
              No sheet music available for this piece.
            </Text>
          )}
        </View>
      </View>
    );
  };

  const renderResults = () => {
    if (recState !== "success" && recState !== "no_match") return null;

    return (
      <ScrollView
        style={styles.resultsContainer}
        contentContainerStyle={styles.resultsContent}
      >
        {recState === "no_match" && (
          <View style={styles.noMatchCard}>
            <Ionicons name="search-outline" size={40} color={COLORS.muted} />
            <Text style={styles.noMatchTitle}>No Match</Text>
            <Text style={styles.noMatchText}>
              We couldn't identify this piece. Try recording closer to the
              music source, or check your internet connection.
            </Text>
          </View>
        )}

        {matches.map(renderMatchCard)}

        {/* Dismiss button */}
        <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss}>
          <Text style={styles.dismissBtnText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ── Main render ──
  const showingResults =
    recState === "success" || recState === "no_match" || recState === "error";

  return (
    <View style={styles.container}>
      {/* Static header — always visible */}
      <Text style={styles.heading}>NoteSnap</Text>
      <Text style={styles.subtitle}>Identify music. Get sheet music.</Text>

      {!showingResults && (
        <>
          {/* Mic section */}
          {renderMicButton()}
          <Text style={styles.listenLabel}>{renderStatusLabel()}</Text>
          {renderProgressBar()}

          {/* Error inline */}
          {recState === "error" && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={handleMicPress}
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          )}

          {/* Info cards */}
          <View style={styles.card}>
            <Ionicons name="flame" size={20} color={COLORS.accent} />
            <Text style={styles.cardText}>
              Practice daily to build your streak
            </Text>
          </View>

          <View style={styles.card}>
            <Ionicons name="star" size={20} color={COLORS.accent} />
            <Text style={styles.cardText}>
              Today's Challenge: Prelude in C Major — J.S. Bach
            </Text>
          </View>

          {/* Demo button */}
          <TouchableOpacity style={styles.demoBtn} onPress={handleDemo}>
            <Ionicons name="flask" size={16} color={COLORS.muted} />
            <Text style={styles.demoBtnText}>Demo</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Results overlay */}
      {showingResults && (
        <>
          {/* Compact status after recognition */}
          <View style={styles.resultsHeader}>
            <Ionicons
              name={
                recState === "success"
                  ? "checkmark-circle"
                  : recState === "error"
                    ? "alert-circle"
                    : "help-circle"
              }
              size={24}
              color={recState === "success" ? COLORS.success : COLORS.muted}
            />
            <Text style={styles.resultsHeaderText}>
              {renderStatusLabel()}
            </Text>
          </View>

          {recState === "error" && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={handleMicPress}
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          )}

          {renderResults()}
        </>
      )}
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  heading: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  subtitle: {
    fontSize: 16,
    color: COLORS.muted,
    marginTop: 8,
    marginBottom: 32,
  },

  // Mic button
  listenButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    elevation: 8,
    shadowColor: COLORS.accent,
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  listenButtonActive: {
    backgroundColor: "#c0392b",
    shadowColor: "#c0392b",
  },
  listenLabel: { fontSize: 14, color: COLORS.muted, marginBottom: 12 },
  progressBarTrack: {
    width: "80%",
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    marginBottom: 24,
  },
  progressBarFill: {
    height: 4,
    backgroundColor: COLORS.accent,
    borderRadius: 2,
  },

  // Retry
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.card,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  retryBtnText: { color: "#fff", fontSize: 14 },

  // Info cards
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    width: "100%",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardText: { color: COLORS.text, fontSize: 14, flex: 1 },

  // Demo button
  demoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  demoBtnText: { color: COLORS.muted, fontSize: 12 },

  // Results header
  resultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  resultsHeaderText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
  },

  // Results scroll area
  resultsContainer: {
    flex: 1,
    width: "100%",
  },
  resultsContent: {
    paddingBottom: 40,
  },

  // No-match card
  noMatchCard: {
    alignItems: "center",
    backgroundColor: COLORS.card,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  noMatchTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    marginTop: 12,
  },
  noMatchText: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 8,
  },

  // Match cards
  matchCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  matchHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  matchTitleGroup: {
    flex: 1,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  matchComposer: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 2,
  },
  confidenceBadge: {
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  catalogText: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 8,
    fontStyle: "italic",
  },
  matchActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
  },
  purchaseBtn: {
    backgroundColor: COLORS.accent,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  noLinkText: {
    fontSize: 13,
    color: COLORS.muted,
    fontStyle: "italic",
  },

  // Dismiss button
  dismissBtn: {
    alignSelf: "center",
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 32,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dismissBtnText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "600",
  },
});
