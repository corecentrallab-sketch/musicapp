/**
 * AutoScrollControl — viewer toolbar control for BPM-linked auto-scroll
 * (FEATURE BUILD 2). Shared by the PDF viewer and the scanned viewer.
 *
 * Renders a compact bar with:
 *   - play/pause toggle (start, pause, resume depending on status)
 *   - stop button (fully exit auto-scroll) — only when active
 *   - BPM stepper (− / +, 30–200, default 60)
 *   - beats-per-page stepper (− / +, 1–16, default 4)
 *   - an honest status line, e.g. "Auto-scroll @ 60 BPM · 4 beats/page · 4.0 s/page"
 *
 * Visual state is always explicit: idle / running / paused.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AutoScrollApi, AutoScrollStatus } from '../hooks/useAutoScroll';
import { useThemedStyles } from '../services/themeStore';
import {
  PAGE_TURN_PRESETS_HINT,
  PAGE_TURN_PRESETS_LABEL,
  PAGE_TURN_REMEMBERED_LINE,
  pageTurnPresetChipLabel,
  pageTurnSecondsPerPage,
  type PageTurnPreset,
  type PageTurnPresetId,
} from '../services/pageTurnPresets';

const ACCENT = '#e94560';
const MUTED_TEXT = '#a0a0b8';

const formatSecondsPerPage = (seconds: number): string => {
  const value = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} s/page`;
};

const statusLabel = (
  status: AutoScrollStatus,
  bpm: number,
  beatsPerPage: number,
  secondsPerPage: number
): string => {
  switch (status) {
    case 'running':
      return `Auto-scrolling @ ${bpm} BPM · ${formatSecondsPerPage(secondsPerPage)} — tap the page to pause`;
    case 'paused':
      return 'Paused — tap the page or ▶ to resume';
    default:
      return `Auto-scroll @ ${bpm} BPM · ${beatsPerPage} beats/page · ${formatSecondsPerPage(secondsPerPage)}`;
  }
};

interface StepperProps {
  value: number;
  label: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
  accessibilityLabel: string;
}

const Stepper: React.FC<StepperProps> = ({
  value,
  label,
  onDecrement,
  onIncrement,
  decrementDisabled = false,
  incrementDisabled = false,
  accessibilityLabel,
}) => {
  // The shared light/dark palette (v34b): this sub-component paints its own
  // buttons and labels, so it reads the theme itself (a concise-body arrow
  // function cannot hold the hook, hence the block body).
  const { styles, theme } = useThemedStyles(baseStyles);
  return (
  <View style={styles.stepperGroup}>
    <Pressable
      style={({ pressed }) => [
        styles.stepButton,
        decrementDisabled && styles.stepButtonDisabled,
        pressed && styles.pressed,
      ]}
      onPress={onDecrement}
      disabled={decrementDisabled}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel} decrease`}
      hitSlop={6}
    >
      <Ionicons name="remove" size={16} color={theme.text} />
    </Pressable>
    <View style={styles.stepperValue}>
      <Text style={styles.stepperValueText}>{value}</Text>
      <Text style={styles.stepperLabel}>{label}</Text>
    </View>
    <Pressable
      style={({ pressed }) => [
        styles.stepButton,
        incrementDisabled && styles.stepButtonDisabled,
        pressed && styles.pressed,
      ]}
      onPress={onIncrement}
      disabled={incrementDisabled}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel} increase`}
      hitSlop={6}
    >
      <Ionicons name="add" size={16} color={theme.text} />
    </Pressable>
  </View>
  );
};

interface AutoScrollControlProps {
  /** The full API object returned by useAutoScroll. */
  autoScroll: AutoScrollApi;
  /** Disable starting when there are not enough pages to scroll (e.g. < 2). */
  disabled?: boolean;
  /**
   * The page-turner SPEED PROFILES (owner 10-10, backlog 7f64272f): one-tap
   * skill levels + the per-piece memory, from hooks/usePageTurnSpeed.ts. The row
   * is only rendered when the host supplies it — the steppers below work either
   * way, so the fine-tuning this control always had is untouched.
   */
  speedProfiles?: {
    presets: readonly PageTurnPreset[];
    activePresetId: PageTurnPresetId | null;
    onSelectPreset: (id: PageTurnPresetId) => void;
    remembered?: boolean;
  };
}

export const AutoScrollControl: React.FC<AutoScrollControlProps> = ({
  autoScroll,
  disabled = false,
  speedProfiles,
}) => {
  const {
    status,
    bpm,
    beatsPerPage,
    secondsPerPage,
    toggle,
    stop,
    stepBpm,
    stepBeatsPerPage,
  } = autoScroll;
  // The shared light/dark palette (v34b).
  const { styles, theme } = useThemedStyles(baseStyles);

  const isActive = status !== 'idle';
  const toggleDisabled = disabled && status === 'idle';

  return (
    <View style={styles.bar}>
      {/* SKILL-LEVEL SPEED PRESETS (owner 10-10, backlog 7f64272f): one tap sets
          BOTH numbers of the turn model, so a first read-through and a
          well-practised piece are one tap apart. The steppers below stay, for
          fine-tuning — and the piece remembers whichever the user lands on. */}
      {speedProfiles && speedProfiles.presets.length > 0 && (
        <View style={styles.presetBlock}>
          <View style={styles.presetHeaderRow}>
            <Text style={styles.presetLabel}>{PAGE_TURN_PRESETS_LABEL}</Text>
            {speedProfiles.remembered ? (
              <Text style={styles.presetRemembered}>{PAGE_TURN_REMEMBERED_LINE}</Text>
            ) : null}
          </View>
          <View style={styles.presetRow}>
            {speedProfiles.presets.map((preset) => {
              const active = speedProfiles.activePresetId === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  style={({ pressed }) => [
                    styles.presetChip,
                    active && styles.presetChipActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => speedProfiles.onSelectPreset(preset.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${preset.blurb} ${pageTurnPresetChipLabel(preset)}`}
                  hitSlop={4}
                >
                  <Text
                    style={[styles.presetChipLabel, active && styles.presetChipLabelActive]}
                    numberOfLines={1}
                  >
                    {preset.label}
                  </Text>
                  <Text
                    style={[styles.presetChipRate, active && styles.presetChipLabelActive]}
                    numberOfLines={1}
                  >
                    {formatSecondsPerPage(pageTurnSecondsPerPage(preset))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.presetHint}>{PAGE_TURN_PRESETS_HINT}</Text>
        </View>
      )}

      <View style={styles.controlsRow}>
        {/* Play / Pause / Resume toggle */}
        <Pressable
          style={({ pressed }) => [
            styles.toggleButton,
            status === 'running' && styles.toggleButtonRunning,
            toggleDisabled && styles.stepButtonDisabled,
            pressed && styles.pressed,
          ]}
          onPress={toggle}
          disabled={toggleDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            status === 'running'
              ? 'Pause auto-scroll'
              : status === 'paused'
                ? 'Resume auto-scroll'
                : 'Start auto-scroll'
          }
          accessibilityState={{ disabled: toggleDisabled }}
        >
          <Ionicons
            name={status === 'running' ? 'pause' : 'play'}
            size={18}
            color={theme.text}
          />
        </Pressable>

        {/* BPM stepper */}
        <Stepper
          value={bpm}
          label="BPM"
          onDecrement={() => stepBpm(-1)}
          onIncrement={() => stepBpm(1)}
          decrementDisabled={bpm <= 30}
          incrementDisabled={bpm >= 200}
          accessibilityLabel="Auto-scroll tempo"
        />

        {/* Beats per page stepper */}
        <Stepper
          value={beatsPerPage}
          label="beats/page"
          onDecrement={() => stepBeatsPerPage(-1)}
          onIncrement={() => stepBeatsPerPage(1)}
          decrementDisabled={beatsPerPage <= 1}
          incrementDisabled={beatsPerPage >= 16}
          accessibilityLabel="Auto-scroll beats per page"
        />

        {/* Stop — only while auto-scroll is active */}
        {isActive && (
          <Pressable
            style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
            onPress={stop}
            accessibilityRole="button"
            accessibilityLabel="Stop auto-scroll"
            hitSlop={6}
          >
            <Ionicons name="stop" size={16} color={theme.text} />
          </Pressable>
        )}
      </View>

      <Text style={styles.statusText}>
        {statusLabel(status, bpm, beatsPerPage, secondsPerPage)}
      </Text>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  bar: {
    backgroundColor: '#16213e',
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 6,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // ── skill-level presets (owner 10-10) ──────────────────────────────────────
  presetBlock: {
    gap: 6,
  },
  presetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  presetLabel: {
    color: MUTED_TEXT,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  presetRemembered: {
    color: MUTED_TEXT,
    fontSize: 10,
    fontWeight: '600',
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  presetChipActive: {
    backgroundColor: '#2a1a2c',
    borderColor: ACCENT,
  },
  presetChipLabel: {
    color: '#eaeaff',
    fontSize: 12,
    fontWeight: '800',
  },
  presetChipLabelActive: {
    color: '#ffffff',
  },
  presetChipRate: {
    color: MUTED_TEXT,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  presetHint: {
    color: MUTED_TEXT,
    fontSize: 10,
    lineHeight: 14,
  },
  toggleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
  },
  toggleButtonRunning: {
    backgroundColor: '#3a3a5c',
    borderWidth: 1,
    borderColor: ACCENT,
  },
  stopButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
    marginLeft: 'auto',
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  stepButtonDisabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.7,
  },
  stepperValue: {
    alignItems: 'center',
    minWidth: 44,
  },
  stepperValueText: {
    color: '#eaeaff',
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  stepperLabel: {
    color: MUTED_TEXT,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statusText: {
    color: MUTED_TEXT,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
