/**
 * ScoreLengthLine — THE honest length line for a score (v43 slice 2, owner 10-22).
 *
 * WHY IT EXISTS. The owner's "it only shows 4 bars" was DATA (a bundled 4-bar
 * sample), not a renderer fault — but nothing on screen said so, so a short
 * score and a broken score looked the same. This component prints the score's
 * OWN length ("Bars 1–4 of 4" for a sample, "16 bars" for a full melody) under
 * the staff and in the reader header.
 *
 * THE RULE THAT MUST SURVIVE: the words are DERIVED FROM THE SCORE. There is
 * deliberately NO `label`/`text` prop — a caller hands over the `abc` and
 * `services/scoreLength.ts` computes the line from the bar count. A screen
 * cannot print a length it was not given by the music itself.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { useThemedStyles } from '../services/themeStore';
import {
  SCORE_LENGTH_TAG,
  scoreLengthAccessibilityLabel,
  scoreLengthLine,
} from '../services/scoreLength';

export interface ScoreLengthLineProps {
  /** THE SCORE whose length is printed. Never a pre-built string. */
  abc: string | null | undefined;
  /** Layout only (margin/alignment). Never copy. */
  style?: StyleProp<TextStyle>;
}

export const ScoreLengthLine: React.FC<ScoreLengthLineProps> = ({ abc, style }) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const line = scoreLengthLine(abc);
  if (line === null) return null;
  return (
    <Text
      style={[styles.text, { color: theme.subtext }, style]}
      accessibilityRole="text"
      accessibilityLabel={scoreLengthAccessibilityLabel(abc) ?? line}
      testID={SCORE_LENGTH_TAG}
    >
      {line}
    </Text>
  );
};

const baseStyles = StyleSheet.create({
  text: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
