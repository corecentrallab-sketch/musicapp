/**
 * StreakNudgeCard — the quiet at-risk-streak card (slice 2).
 *
 * Shown OUTSIDE practice only: on Home and on the piece screen while nothing is
 * being recorded. It is a screen-level card, deliberately low visual weight —
 * no modal, no interruption, no guilt. Copy comes from the engine's nudge
 * payload (services/practiceReinforcement.evaluateNudge); this component only
 * decides whether the surface is allowed to show it
 * (services/practiceReinforcementView.nudgeForSurface — honours the engine's
 * `playSafeOnly` / `surface: 'outside-play-only'` contract) and remembers that
 * the user dismissed it today.
 *
 * Always dismissible. One gentle card per local day, then silence.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ReinforcementNudge } from '../services/practiceReinforcement';
import {
  nudgeForSurface,
  type ReinforcementSurface,
} from '../services/practiceReinforcementView';
import {
  getNudgeDismissedDay,
  getReinforcementNudgeLocal,
  setNudgeDismissedDay,
  todayKeyLocal,
} from '../services/reinforcementStore';

interface StreakNudgeCardProps {
  /** Screen this card is rendered on — play/score surfaces never show it. */
  surface: Extract<ReinforcementSurface, 'home' | 'piece-detail'>;
  /** True while a capture/run is in progress on this screen (hides the card). */
  hidden?: boolean;
}

export const StreakNudgeCard: React.FC<StreakNudgeCardProps> = ({
  surface,
  hidden = false,
}) => {
  const [nudge, setNudge] = useState<ReinforcementNudge | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Never even read the nudge while the screen is in a play/score state.
    if (hidden) return;
    let cancelled = false;
    void (async () => {
      const [raw, dismissedDay] = await Promise.all([
        getReinforcementNudgeLocal(),
        getNudgeDismissedDay(),
      ]);
      if (cancelled) return;
      setNudge(
        nudgeForSurface({
          nudge: raw,
          surface,
          dismissedDayKey: dismissedDay,
          todayKey: todayKeyLocal(),
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [hidden, surface]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    const key = todayKeyLocal();
    if (key) void setNudgeDismissedDay(key);
  }, []);

  if (hidden || dismissed || !nudge) return null;

  return (
    <View style={styles.card} testID="streak-nudge-card">
      <Text style={styles.emoji}>{nudge.emoji}</Text>
      <View style={styles.body}>
        <Text style={styles.title}>{nudge.title}</Text>
        <Text style={styles.copy}>{nudge.copy}</Text>
      </View>
      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={handleDismiss}
        accessibilityLabel="Dismiss"
        testID="streak-nudge-dismiss"
      >
        <Text style={styles.dismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#16213e',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    marginTop: 16,
  },
  emoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  body: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  copy: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    color: '#6f6f88',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default StreakNudgeCard;
