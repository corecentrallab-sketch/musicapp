import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const COLORS = { bg: "#1a1a2e", accent: "#e94560", card: "#16213e", border: "#0f3460", text: "#eaeaea", muted: "#888" };

export const HomeScreen: React.FC = () => {
  const [state, setState] = useState<"idle" | "loading">("idle");

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>NoteSnap</Text>
      <Text style={styles.subtitle}>Identify music. Get sheet music.</Text>

      <TouchableOpacity
        style={styles.listenButton}
        onPress={() => { setState("loading"); setTimeout(() => setState("idle"), 2000); }}
        activeOpacity={0.8}
      >
        {state === "loading" ? (
          <ActivityIndicator size="large" color="#fff" />
        ) : (
          <Ionicons name="mic" size={48} color="#fff" />
        )}
      </TouchableOpacity>
      <Text style={styles.listenLabel}>{state === "loading" ? "Listening..." : "Tap to recognize music"}</Text>

      <View style={styles.card}>
        <Ionicons name="flame" size={20} color={COLORS.accent} />
        <Text style={styles.cardText}>Practice daily to build your streak</Text>
      </View>

      <View style={styles.card}>
        <Ionicons name="star" size={20} color={COLORS.accent} />
        <Text style={styles.cardText}>Today's Challenge: Prelude in C Major — J.S. Bach</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", paddingTop: 60, paddingHorizontal: 20 },
  heading: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  subtitle: { fontSize: 16, color: COLORS.muted, marginTop: 8, marginBottom: 40 },
  listenButton: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.accent,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
    elevation: 8, shadowColor: COLORS.accent, shadowOpacity: 0.4, shadowRadius: 16,
  },
  listenLabel: { fontSize: 14, color: COLORS.muted, marginBottom: 40 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: COLORS.card, padding: 16, borderRadius: 12,
    width: "100%", marginBottom: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  cardText: { color: COLORS.text, fontSize: 14, flex: 1 },
});
