/**
 * TunerMeter — the tuner's readout: note name, cents deviation and a needle on a
 * ±50-cent scale (owner APPROVED 10-10, backlog 2bbbbc8f).
 *
 * It renders ONE reading and decides nothing itself — the note name, the cents
 * value, the verdict and the needle position all come from the pure
 * services/tuner.ts (which the tier-1 gate tests), so the display can never
 * disagree with the engine.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../services/themeStore';
import {
  TUNER_CENTS_FULL_SCALE,
  TUNER_CENTS_SUFFIX,
  TUNER_FLAT_LABEL,
  TUNER_HZ_SUFFIX,
  TUNER_SHARP_LABEL,
  tunerVerdictLabel,
  type TunerReading,
} from '../services/tuner';

/** The in-tune colour. A local constant, like ACCENT in AutoScrollControl. */
const IN_TUNE = '#4ade80';
const MUTED = '#a0a0b8';
const TICKS = [0, 25, 50, 75, 100];

interface TunerMeterProps {
  /** The latest reading, or null before the first take. */
  reading: TunerReading | null;
  /** True while the microphone is open or the take is being read. */
  busy: boolean;
}

export const TunerMeter: React.FC<TunerMeterProps> = ({ reading, busy }) => {
  const { styles } = useThemedStyles(baseStyles);
  const note = reading && reading.kind === 'note' ? reading : null;
  const needle = note ? note.needlePercent : 50;
  const accent = note ? (note.inTune ? IN_TUNE : '#e94560') : MUTED;
  const centsText = note
    ? `${note.cents > 0 ? '+' : ''}${note.cents}`
    : '--';

  return (
    <View style={styles.wrap}>
      <Text
        style={[styles.bigNote, { color: accent }]}
        accessibilityLabel={
          note
            ? `Note ${note.display}`
            : busy
              ? 'Reading your note'
              : 'No note yet'
        }
      >
        {note ? note.display : '–'}
      </Text>

      <View style={styles.readoutRow}>
        <Text style={[styles.cents, { color: accent }]}>{centsText}</Text>
        <Text style={styles.centsUnit}>{TUNER_CENTS_SUFFIX}</Text>
        {note ? (
          <Text style={styles.hz}>
            {note.frequencyHz} {TUNER_HZ_SUFFIX}
          </Text>
        ) : null}
      </View>

      {/* The needle scale: −50 … +50 cents, centre = in tune. */}
      <View style={styles.scale}>
        {TICKS.map((tick) => (
          <View
            key={tick}
            style={[
              styles.tick,
              { left: `${tick}%` },
              tick === 50 && styles.tickCentre,
            ]}
          />
        ))}
        <View style={[styles.marker, { left: `${needle}%`, backgroundColor: accent }]} />
      </View>
      <View style={styles.scaleLabels}>
        <Text style={styles.scaleLabel}>
          −{TUNER_CENTS_FULL_SCALE} {TUNER_FLAT_LABEL}
        </Text>
        <Text style={styles.scaleLabel}>in tune</Text>
        <Text style={styles.scaleLabel}>
          +{TUNER_CENTS_FULL_SCALE} {TUNER_SHARP_LABEL}
        </Text>
      </View>

      <Text style={[styles.verdict, { color: accent }]} accessibilityLiveRegion="polite">
        {tunerVerdictLabel(reading)}
      </Text>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingTop: 8,
  },
  bigNote: {
    fontSize: 84,
    fontWeight: '800',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  readoutRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: -6,
    marginBottom: 18,
  },
  cents: {
    fontSize: 30,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  centsUnit: {
    color: MUTED,
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 4,
  },
  hz: {
    color: MUTED,
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 14,
  },
  scale: {
    width: '100%',
    height: 46,
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    width: 2,
    height: 12,
    marginLeft: -1,
    top: 17,
    backgroundColor: '#3a3a5c',
  },
  tickCentre: {
    height: 26,
    top: 10,
    backgroundColor: MUTED,
  },
  marker: {
    position: 'absolute',
    width: 12,
    height: 46,
    marginLeft: -6,
    borderRadius: 4,
    top: 0,
  },
  scaleLabels: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  scaleLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  verdict: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 14,
  },
});
