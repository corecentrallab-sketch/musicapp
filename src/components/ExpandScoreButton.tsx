/**
 * ExpandScoreButton — THE ONE AFFORDANCE for "read this bigger" (v43 fix batch,
 * slice 3, item E).
 *
 * Every notation surface in the app is a card on a page that also carries titles,
 * honesty lines, chords, buttons. That is the right layout for reading ABOUT a
 * score and the wrong one for reading the score, so each of those surfaces offers
 * the same control in the same words: `Full screen` (services/scoreExpand.ts owns
 * the label, so no screen can invent its own synonym).
 *
 * SIZE. 44x44 minimum touch target, which is the platform's own floor — this is a
 * small affordance on a crowded card and it must still be hittable with a thumb.
 * The label is also the accessibility label, so a screen reader hears exactly what
 * a sighted user reads.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemedStyles } from '../services/themeStore';
import { SCORE_EXPAND_LABEL } from '../services/scoreExpand';

export interface ExpandScoreButtonProps {
  /** Open the surface's full-screen score window. */
  onPress: () => void;
  /** Defaults to the shared label; the read-only take editor passes its own. */
  label?: string;
  testID?: string;
}

export const ExpandScoreButton: React.FC<ExpandScoreButtonProps> = ({
  onPress,
  label = SCORE_EXPAND_LABEL,
  testID,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={6}
    >
      <Ionicons name="expand-outline" size={16} color={theme.positive} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
};

const baseStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#0f3460',
  },
  buttonPressed: { opacity: 0.7 },
  label: { color: '#4ecdc4', fontSize: 12, fontWeight: '800', marginLeft: 6 },
});
