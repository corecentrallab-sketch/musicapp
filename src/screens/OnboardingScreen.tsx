/**
 * Onboarding wizard — shown on first launch.
 * 3-4 screens with skip option.
 */
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
        genres: genres.length === 0 ? ['classical'] : genres,
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  skipBtn: {
    position: 'absolute',
    top: 60,
    right: 24,
    zIndex: 10,
  },
  skipText: {
    color: '#a0a0b8',
    fontSize: 15,
    fontWeight: '600',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333355',
  },
  dotActive: {
    backgroundColor: '#e94560',
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
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  subtitle: {
    fontSize: 15,
    color: '#a0a0b8',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: '#e94560',
    backgroundColor: '#1e2d50',
  },
  optionEmoji: {
    fontSize: 28,
    marginRight: 14,
  },
  optionText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#c0c0d0',
    flex: 1,
  },
  optionTextSelected: {
    color: '#ffffff',
  },
  checkmark: {
    fontSize: 20,
    color: '#e94560',
    fontWeight: '700',
  },
  nextBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginTop: 12,
  },
  nextText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
});
