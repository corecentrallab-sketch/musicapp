/**
 * Onboarding wizard — shown on first launch.
 * 3-4 screens with skip option.
 */
import { useThemedStyles } from '../services/themeStore';
import { colors, radius, spacing } from '../theme/tokens';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import type { Instrument, SkillLevel, Genre, OnboardingAnswers } from '../types';

interface OnboardingScreenProps {
  onComplete: (answers: OnboardingAnswers) => void;
  onSkip: () => void;
}

const STEPS = ['instrument', 'level', 'genres'] as const;
type Step = (typeof STEPS)[number];

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  onComplete,
  onSkip,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [stepIndex, setStepIndex] = useState(0);
  const [instrument, setInstrument] = useState<Instrument>('piano');
  const [level, setLevel] = useState<SkillLevel>('beginner');
  const [genres, setGenres] = useState<Genre[]>([]);

  const currentStep = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const toggleGenre = (g: Genre) => {
    setGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  };

  const handleNext = () => {
    if (isLast) {
      onComplete({
        instrument,
        level,
        // Genres are the user's OWN picks — an empty list stays empty. The
        // former `genres.length === 0 ? ['classical'] : genres` default made
        // every skipped onboarding look like a classical-only musician, which is
        // what rendered "Curated Classical" on Home for guitar/pop learners
        // (owner 09-24: the home line is genre-neutral and instrument-aware).
        genres,
        completedAt: new Date().toISOString(),
      });
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  return (
    <View style={styles.container}>
      {/* Skip button */}
      <TouchableOpacity style={styles.skipBtn} onPress={onSkip}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Progress dots */}
      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === stepIndex && styles.dotActive]}
          />
        ))}
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Instrument step */}
        {currentStep === 'instrument' && (
          <View>
            <Text style={styles.emoji}>🎹</Text>
            <Text style={styles.title}>What instrument do you play?</Text>
            <Text style={styles.subtitle}>
              We'll tailor sheet music and tablature to your instrument.
            </Text>
            {(['piano', 'guitar', 'both'] as Instrument[]).map((inst) => (
              <TouchableOpacity
                key={inst}
                style={[
                  styles.option,
                  instrument === inst && styles.optionSelected,
                ]}
                onPress={() => setInstrument(inst)}
              >
                <Text style={styles.optionEmoji}>
                  {inst === 'piano' ? '🎹' : inst === 'guitar' ? '🎸' : '🎹🎸'}
                </Text>
                <Text
                  style={[
                    styles.optionText,
                    instrument === inst && styles.optionTextSelected,
                  ]}
                >
                  {inst === 'piano'
                    ? 'Piano'
                    : inst === 'guitar'
                    ? 'Guitar'
                    : 'Both'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Level step */}
        {currentStep === 'level' && (
          <View>
            <Text style={styles.emoji}>📈</Text>
            <Text style={styles.title}>What's your level?</Text>
            <Text style={styles.subtitle}>
              We'll match pieces to your skill level.
            </Text>
            {(['beginner', 'intermediate', 'advanced'] as SkillLevel[]).map(
              (lvl) => (
                <TouchableOpacity
                  key={lvl}
                  style={[styles.option, level === lvl && styles.optionSelected]}
                  onPress={() => setLevel(lvl)}
                >
                  <Text style={styles.optionEmoji}>
                    {lvl === 'beginner'
                      ? '🌱'
                      : lvl === 'intermediate'
                      ? '🌿'
                      : '🌳'}
                  </Text>
                  <Text
                    style={[
                      styles.optionText,
                      level === lvl && styles.optionTextSelected,
                    ]}
                  >
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        )}

        {/* Genres step */}
        {currentStep === 'genres' && (
          <View>
            <Text style={styles.emoji}>🎶</Text>
            <Text style={styles.title}>What genres interest you?</Text>
            <Text style={styles.subtitle}>Select all that apply.</Text>
            {(
              [
                { id: 'classical' as Genre, emoji: '🎻', label: 'Classical' },
                {
                  id: 'jazz-ragtime' as Genre,
                  emoji: '🎷',
                  label: 'Jazz / Ragtime',
                },
                {
                  id: 'folk-traditional' as Genre,
                  emoji: '🪕',
                  label: 'Folk / Traditional',
                },
              ] as const
            ).map((g) => {
              const selected = genres.includes(g.id);
              return (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => toggleGenre(g.id)}
                >
                  <Text style={styles.optionEmoji}>{g.emoji}</Text>
                  <Text
                    style={[
                      styles.optionText,
                      selected && styles.optionTextSelected,
                    ]}
                  >
                    {g.label}
                  </Text>
                  {selected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Next / Get Started button */}
      <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
        <Text style={styles.nextText}>
          {isLast ? 'Get Started 🚀' : 'Next →'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.canvas,
    paddingHorizontal: spacing.s24,
    paddingTop: 60,
    paddingBottom: spacing.s40,
  },
  skipBtn: {
    position: 'absolute',
    top: 60,
    right: spacing.s24,
    zIndex: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  skipText: {
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.s8,
    marginBottom: spacing.s32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.border.control,
  },
  dotActive: {
    backgroundColor: colors.accent.primary,
    width: 24,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 20,
  },
  emoji: {
    fontSize: 72,
    textAlign: 'center',
    marginBottom: spacing.s16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.s8,
    paddingHorizontal: spacing.s16,
  },
  subtitle: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.s32,
    lineHeight: 22,
    paddingHorizontal: spacing.s16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.s16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: colors.border.control,
  },
  optionSelected: {
    borderColor: colors.brand.anchor,
    backgroundColor: colors.bg.surfaceTinted,
  },
  optionEmoji: {
    fontSize: 28,
    marginRight: 14,
  },
  optionText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text.secondary,
    flex: 1,
  },
  optionTextSelected: {
    color: colors.text.primary,
  },
  checkmark: {
    fontSize: 20,
    color: colors.accent.primary,
    fontWeight: '700',
  },
  nextBtn: {
    backgroundColor: colors.brand.anchor,
    borderRadius: radius.pill,
    padding: 18,
    alignItems: 'center',
    marginTop: spacing.s12,
  },
  nextText: {
    color: colors.bg.surface,
    fontSize: 18,
    fontWeight: '700',
  },
});
